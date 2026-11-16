// 알림 스케줄러 - 30초마다 설정 시각(HH:MM) 도달 여부를 확인해 Web Push 발송
use std::collections::HashMap;
use std::time::Duration;

use serde_json::json;

use crate::config::CONFIG;
use crate::core::db;
use crate::core::{dates, js, webpush};
use crate::params;
use crate::plants_query::list_plants;

pub fn start() {
    tokio::spawn(async {
        // type → 마지막 발송일 (같은 날 중복 발송 방지)
        let mut last_sent: HashMap<String, String> = HashMap::new();
        let mut timer = tokio::time::interval(Duration::from_secs(30));
        timer.tick().await; // setInterval 은 30초 뒤 첫 실행
        loop {
            timer.tick().await;
            if let Err(e) = check(&mut last_sent).await {
                tracing::error!("알림 확인 실패: {e}");
            }
        }
    });
}

async fn check(last_sent: &mut HashMap<String, String>) -> Result<(), String> {
    let now = chrono::Utc::now().with_timezone(&dates::TZ);
    let hhmm = now.format("%H:%M").to_string();
    let today = dates::today_str();
    let settings = {
        let c = db::conn();
        db::all(
            &c,
            "SELECT * FROM notification_settings WHERE enabled = 1",
            params![],
        )
        .map_err(|e| e.0)?
    };
    for s in settings {
        let ty = db::text(&s, "type").unwrap_or("").to_string();
        if db::text(&s, "send_at") != Some(hhmm.as_str()) || last_sent.get(&ty) == Some(&today) {
            continue;
        }
        last_sent.insert(ty.clone(), today.clone());
        if let Some((title, body)) = build_message(&ty, &today)? {
            broadcast(&title, &body).await?;
        }
    }
    Ok(())
}

// 알림은 물주기 단일 (분갈이·리마인더 없음)
fn build_message(ty: &str, today: &str) -> Result<Option<(String, String)>, String> {
    if ty != "watering" {
        return Ok(None);
    }
    let plants = list_plants(today, false).map_err(|e| e.message)?;
    let due: Vec<_> = plants
        .iter()
        .filter(|p| {
            p.get("water_dday")
                .and_then(|v| v.as_f64())
                .is_some_and(|d| d <= 0.0)
        })
        .collect();
    if due.is_empty() {
        return Ok(None);
    }
    let names: Vec<String> = due
        .iter()
        .map(|p| js::to_js_string(p.get("name")))
        .collect();
    let mut body = names.iter().take(5).cloned().collect::<Vec<_>>().join(", ");
    if names.len() > 5 {
        body.push_str(&format!(" 외 {}개", names.len() - 5));
    }
    Ok(Some((format!("💧 오늘 물 줄 화분 {}개", due.len()), body)))
}

async fn broadcast(title: &str, body: &str) -> Result<(), String> {
    let subs = {
        let c = db::conn();
        db::all(&c, "SELECT * FROM push_subscriptions", params![]).map_err(|e| e.0)?
    };
    let payload = js::stringify(&json!({ "title": title, "body": body }));
    for sub in subs {
        let s = webpush::Subscription {
            endpoint: db::text(&sub, "endpoint").unwrap_or(""),
            p256dh: db::text(&sub, "keys_p256dh").unwrap_or(""),
            auth: db::text(&sub, "keys_auth").unwrap_or(""),
        };
        if let Err(err) = webpush::send(&CONFIG.vapid, &s, &payload).await {
            // 만료된 구독은 정리
            if matches!(err.status, Some(404 | 410)) {
                let c = db::conn();
                db::run(
                    &c,
                    "DELETE FROM push_subscriptions WHERE id = ?",
                    params![db::int(&sub, "id")],
                )
                .map_err(|e| e.0)?;
            } else {
                tracing::info!(
                    "푸시 발송 실패 ({}): WebPushError: {}",
                    db::int(&sub, "id").unwrap_or(0),
                    err.message
                );
            }
        }
    }
    tracing::info!("푸시 발송: {title}");
    Ok(())
}
