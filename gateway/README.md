# gateway

`sudosoon.org` 홈서버의 공용 게이트웨이 (dogroo 리포 소속이지만 역할은 앱 중립). 80/443을 단독 점유하는 caddy 하나가 도메인별로 앱 컨테이너에 라우팅하고, 배포 웹훅(`adnanh/webhook`)과 Cloudflare DDNS도 이 폴더 소관이다.

```
인터넷 ── Cloudflare DNS ── iptime 공유기(80/443 포워딩)
  [gateway-caddy] ─ HTTPS 자동 인증서 (도메인별 라우팅)
    ├ dogroo.sudosoon.org  /api/* → dogroo-backend:4746, /* → dogroo-frontend:80
    ├ donoti.sudosoon.org  /api/* → donoti-backend:4646, /* → donoti-frontend:80
    └ */deploy/hook → host:9099 (systemd webhook → 각 리포 deploy/deploy.sh)
```

## 규칙

- 앱 compose는 caddy를 갖지 않는다. `container_name`을 `<앱>-backend`/`<앱>-frontend`로 고정하고 external 네트워크 `gateway`에 참여한다 (서비스명은 앱끼리 겹쳐 alias가 섞이므로 Caddyfile은 컨테이너명만 참조).
- 네트워크 `gateway`는 서버에서 수동 생성(`docker network create gateway`) - compose 소유가 아니라 `down`에 휘말리지 않는다.
- 앱 추가 시: Caddyfile에 사이트 블록, hooks.json에 훅, caddy.env에 도메인, cf-ddns.sh의 `RECORD_NAMES`에 레코드 추가 후 push (+ `systemctl restart webhook`, caddy.env 변경 시 `docker compose up -d --force-recreate caddy`).

## 배포 반영

dogroo push 시 `deploy/deploy.sh`가 앱과 함께 게이트웨이도 재적용한다 - compose 변경은 `up -d`로, Caddyfile 변경은 무중단 `caddy reload`로 반영된다. 단 `hooks.json`/`webhook.service` 변경은 예외로 수동 반영해야 한다 (webhook 재시작이 실행 중인 배포 자신을 죽일 수 있어 자동화하지 않음):

```bash
cp /root/workspace/dogroo/gateway/webhook.service /etc/systemd/system/webhook.service
systemctl daemon-reload && systemctl restart webhook
```

## 서버 파일 배치

| 경로 | 내용 |
|---|---|
| `/root/workspace/dogroo/gateway` | 이 폴더 |
| `/etc/gateway/caddy.env` | `DOGROO_DOMAIN`, `DONOTI_DOMAIN` |
| `/etc/gateway/deploy.env` | `DEPLOY_KEY_DOGROO`, `DEPLOY_KEY_DONOTI` (webhook systemd가 로드) |
| `/etc/gateway/cf.env` | `CF_TOKEN` (Edit zone DNS 권한) |
| `/etc/cron.d/cf-ddns` | 10분마다 `cf-ddns.sh` (유동 IP 대응) |

## 최초 전환 / 재설치

dogroo 단독 구성(자체 caddy)에서 gateway 구성으로의 전환 절차 전체가 `server-setup.sh`에 코드화되어 있다 (재실행 안전):

```bash
sudo -i
bash /root/workspace/dogroo/gateway/server-setup.sh
```

전제: dogroo main에 "gateway 폴더 + 자체 caddy 제거" 커밋이 push되어 있어야 한다. 컷오버(6단계) 동안 수십 초 다운타임이 있고, 인증서는 새 볼륨에 재발급된다(수 초). 재발급 대신 기존 인증서를 옮기려면 컷오버 전에:

```bash
docker volume create gateway_caddy-data
docker run --rm -v dogroo_caddy-data:/from -v gateway_caddy-data:/to alpine cp -a /from/. /to/
```
