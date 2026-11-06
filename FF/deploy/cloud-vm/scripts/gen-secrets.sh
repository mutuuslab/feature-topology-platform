#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# .env 만들기 — .env.example을 바탕으로 비밀을 새 무작위 값으로 채운다(20-99 §비밀).
#   scripts/gen-secrets.sh --domain ff.example.com --email ops@example.com
#   scripts/gen-secrets.sh --ip 203.0.113.10 --email ops@example.com     # 도메인 없이 <IP>.sslip.io
# 이미 .env가 있으면 덮어쓰지 않는다. 값은 화면에 찍지 않는다. 권한 600.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

domain='' email='' port=''
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) domain="$2"; shift 2 ;;
    --ip)
      printf '%s' "$2" | grep -Eq '^((25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])$' || die "--ip는 IPv4 주소(예: 203.0.113.10)"
      domain="$(printf '%s' "$2" | tr '.' '-').sslip.io"
      shift 2
      ;;
    --email) email="$2"; shift 2 ;;
    --https-port) port="$2"; shift 2 ;;
    *) die "알 수 없는 인자: $1 (--domain 이름 | --ip 공인IP, --email 메일, [--https-port 포트])" ;;
  esac
done
[ -n "$domain" ] || die "--domain 또는 --ip가 필요합니다"
[ -n "$email" ] || die "--email이 필요합니다(인증서 만료 알림)"
# 공개 출처 비교는 소문자(브라우저 Origin) — 대문자 도메인이면 백엔드가 FF_PUBLIC_URL 형식 오류로 멈춘다
domain="$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')"
# 값은 .env 한 줄에 들어간다 — 줄바꿈·공백이 섞이면 다른 설정을 끼워 넣을 수 있어 형식을 좁힌다
one_line() { [ "$(printf '%s' "$1" | wc -l)" -eq 0 ]; }
if ! one_line "$domain" || [ "${#domain}" -gt 253 ] || ! printf '%s' "$domain" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$'; then
  die "도메인 형식이 아닙니다: $domain"
fi
if ! one_line "$email" || ! printf '%s' "$email" | grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
  die "메일 형식이 아닙니다: $email"
fi
if [ -n "$port" ] && ! { printf '%s' "$port" | grep -Eq '^[0-9]{1,5}$' && [ "$port" -ge 1 ] && [ "$port" -le 65535 ]; }; then
  die "--https-port는 1~65535"
fi
[ ! -e "$ENV_FILE" ] || die "$ENV_FILE가 이미 있습니다 — 덮어쓰지 않습니다(비밀을 잃지 않게)"
command -v openssl >/dev/null || die "openssl이 필요합니다"

hex() { openssl rand -hex 32; }
b64() { openssl rand -base64 32 | tr -d '\n'; }
tok() { openssl rand -base64 48 | tr -d '\n/+='; }

public="https://$domain"
[ -z "$port" ] || [ "$port" = 443 ] || public="$public:$port"

umask 077
tmp="$(mktemp "$ENV_FILE.XXXXXX")"
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  key="${line%%=*}"
  case "$line" in
    FF_DOMAIN=) line="FF_DOMAIN=$domain" ;;
    FF_PUBLIC_URL=) line="FF_PUBLIC_URL=$public" ;;
    ACME_EMAIL=) line="ACME_EMAIL=$email" ;;
    HTTPS_PORT=*) [ -z "$port" ] || line="HTTPS_PORT=$port" ;;
    FF_SESSION_SECRET= | FF_AUDIT_KEY= | GITLAB_WEBHOOK_TOKEN= | JIRA_WEBHOOK_SECRET= | CODEBEAMER_WEBHOOK_SECRET=) line="$key=$(tok)" ;;
    FF_KEK= | FF_HSM_VEHICLE_ROOT=) line="$key=$(b64)" ;;
    PG_ADMIN_PASSWORD= | FF_DB_PASSWORD= | UNLEASH_DB_PASSWORD= | UNLEASH_ADMIN_PASSWORD=) line="$key=$(hex)" ;;
    UNLEASH_ADMIN_TOKEN=) line="$key=*:*.$(hex)" ;;
    UNLEASH_EDGE_BACKEND_TOKEN= | UNLEASH_EDGE_FRONTEND_TOKEN=) line="$key=default:development.$(hex)" ;;
  esac
  printf '%s\n' "$line" >>"$tmp"
done <"$KIT/.env.example"
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
log "만들었습니다: $ENV_FILE (권한 600, 값은 출력하지 않음). 공개 주소 $public"
log "다음: .env 사본을 비밀 보관소에 따로 보관 → scripts/install.sh"
