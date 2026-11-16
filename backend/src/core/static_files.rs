// dogroo·docook 공통 사본 - 고칠 때 두 곳을 같이 고친다.
//
// @fastify/static 8 (send) 의 파일 응답: Accept-Ranges, Cache-Control, Last-Modified, ETag W/"<크기hex>-<mtime ms hex>",
// Content-Type(확장자), If-None-Match/If-Modified-Since → 304, 단일 Range → 206.
// 없는 파일·폴더는 Fastify 404, '..' 는 403.
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde_json::json;

use super::app::{Reply, Req};

pub enum Served {
    File(Reply),
    NotFound,
}

fn mime(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("heic") => "image/heic",
        Some("heif") => "image/heif",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn http_date(secs: i64) -> String {
    chrono::DateTime::from_timestamp(secs, 0)
        .map(|d| d.format("%a, %d %b %Y %H:%M:%S GMT").to_string())
        .unwrap_or_default()
}

/// root 아래 rel 파일 응답. rel 은 이미 퍼센트 디코딩된 와일드카드 부분
pub async fn serve(req: &Req, root: &Path, rel: &str, cache_control: &str) -> Served {
    if rel.split('/').any(|seg| seg == "..") {
        return Served::File(Reply::json(
            403,
            json!({ "statusCode": 403, "error": "Forbidden", "message": "Forbidden" }),
        ));
    }
    if rel.is_empty() || rel.ends_with('/') || rel.contains('\0') {
        return Served::NotFound;
    }
    let path = root.join(rel);
    let Ok(meta) = tokio::fs::metadata(&path).await else {
        return Served::NotFound;
    };
    if !meta.is_file() {
        return Served::NotFound;
    }
    let size = meta.len();
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let etag = format!("W/\"{:x}-{:x}\"", size, mtime_ms);
    let last_modified = http_date(mtime_ms / 1000);
    let base = |r: Reply| {
        r.header("accept-ranges", "bytes")
            .header("cache-control", cache_control)
            .header("last-modified", &last_modified)
            .header("etag", &etag)
    };
    // 조건부 요청
    let inm = req.header("if-none-match");
    let not_modified = match inm {
        Some(v) => {
            v.trim() == "*"
                || v.split(',')
                    .any(|t| t.trim().trim_start_matches("W/") == etag.trim_start_matches("W/"))
        }
        None => req
            .header("if-modified-since")
            .and_then(|s| chrono::DateTime::parse_from_rfc2822(s).ok())
            .is_some_and(|ims| mtime_ms / 1000 <= ims.timestamp()),
    };
    if not_modified {
        return Served::File(base(Reply::empty(304)));
    }
    let Ok(data) = tokio::fs::read(&path).await else {
        return Served::NotFound;
    };
    let ty = mime(rel);
    if let Some(range) = req.header("range").and_then(|r| r.strip_prefix("bytes="))
        && !range.contains(',')
    {
        let (a, b) = range.split_once('-').unwrap_or(("", ""));
        let (start, end) = match (a.trim().parse::<u64>().ok(), b.trim().parse::<u64>().ok()) {
            (Some(s), Some(e)) => (s, e.min(size.saturating_sub(1))),
            (Some(s), None) => (s, size.saturating_sub(1)),
            (None, Some(n)) => (size.saturating_sub(n), size.saturating_sub(1)),
            _ => (1, 0),
        };
        if start > end || start >= size {
            return Served::File(
                base(Reply::empty(416)).header("content-range", &format!("bytes */{size}")),
            );
        }
        let part = data[start as usize..=end as usize].to_vec();
        return Served::File(
            base(Reply::bytes(206, ty, part))
                .header("content-range", &format!("bytes {start}-{end}/{size}")),
        );
    }
    Served::File(base(Reply::bytes(200, ty, data)))
}
