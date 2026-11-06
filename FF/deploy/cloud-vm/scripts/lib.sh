#!/usr/bin/env bash
# 공통 — 클라우드 VM 스크립트가 source한다(20-99). 직접 실행하지 않는다.
# KIT: deploy/cloud-vm 폴더, ENV_FILE: 그 안의 .env(권한 600)

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${FF_ENV_FILE:-$KIT/.env}"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() {
  log "오류: $*"
  exit 1
}

# .env에서 키 하나(따옴표 없는 KEY=값 줄)
env_get() {
  local key="$1"
  [ -f "$ENV_FILE" ] || die ".env가 없습니다 — scripts/gen-secrets.sh를 먼저 실행하세요"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

# compose가 컨테이너에 넘기는 모양으로 — 앞뒤 공백·CR·한 겹의 따옴표를 벗긴다(docker compose --env-file 규칙)
env_norm() {
  local v="$1"
  v="${v%$'\r'}"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  case "$v" in \"*\" | \'*\') v="${v:1:${#v}-2}" ;; esac
  printf '%s' "$v"
}

# .env의 키 하나를 바꾼다(없으면 끝에 더한다). 값에 / | & 가 있어도 되게 awk로
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  awk -v k="$key" -v v="$value" 'BEGIN { done = 0 } index($0, k "=") == 1 { print k "=" v; done = 1; next } { print } END { if (!done) print k "=" v }' "$ENV_FILE" >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

# FF_COMPOSE_EXTRA: 선택 덧붙임 파일(예: '-f compose.vehicle-mtls.yml') — .env에 두면 부팅 서비스도 같은 구성으로 올린다. 공백으로 나눈다
dc() {
  local extra=() raw="${FF_COMPOSE_EXTRA:-}"
  [ -n "$raw" ] || [ ! -f "$ENV_FILE" ] || raw="$(env_get FF_COMPOSE_EXTRA)"
  read -r -a extra <<<"$raw"
  # 덧붙임 파일의 상대 경로가 키트 폴더 기준이 되게
  (cd "$KIT" && docker compose --project-directory "$KIT" -f "$KIT/docker-compose.yml" "${extra[@]}" --env-file "$ENV_FILE" "$@")
}

# 고정 이미지인가 — 다이제스트(@sha256:) 또는 latest가 아닌 태그
image_pinned() {
  local image="$1" ref
  ref="${image##*/}"
  case "$image" in
    '' | *:latest) return 1 ;;
    *@sha256:*) return 0 ;;
  esac
  [[ "$ref" == *:?* ]]
}

# 공개 전 안전 확인 — 데모 인증을 게이트 없이 인터넷에 열지 않는다, 이미지 태그는 고정
# 백엔드는 FF_AUTH가 정확히 oidc일 때만 SSO이고 그 밖의 값(Demo·OIDC·빈 값 등)은 데모 인증이다(auth-config.ts) — 같은 규칙으로 판정한다
preflight() {
  [ -f "$ENV_FILE" ] || die ".env가 없습니다 — scripts/gen-secrets.sh"
  local mode gate image
  mode="$(env_norm "$(env_get FF_AUTH)")"
  gate="$(env_norm "$(env_get FF_DEMO_GATE)")"
  gate="${gate:-on}"
  image="$(env_get FF_IMAGE)"
  if [ "$mode" != oidc ]; then
    case "${gate,,}" in on | 1 | true) ;; *) die "FF_AUTH가 oidc가 아니라(지금 '${mode}') 데모 인증인데 FF_DEMO_GATE가 켜져 있지 않습니다 — 누구나 머리글로 역할을 주장할 수 있어 공개하지 않습니다" ;; esac
  fi
  image_pinned "$image" || die "FF_IMAGE는 고정 태그(:v0.1.0-demo) 또는 다이제스트(@sha256:…)여야 합니다 — 지금: '${image}'"
  local missing=()
  for k in FF_DOMAIN FF_PUBLIC_URL ACME_EMAIL FF_SESSION_SECRET FF_KEK FF_AUDIT_KEY PG_ADMIN_PASSWORD FF_DB_PASSWORD UNLEASH_DB_PASSWORD UNLEASH_ADMIN_TOKEN; do
    [ -n "$(env_get "$k")" ] || missing+=("$k")
  done
  [ "${#missing[@]}" -eq 0 ] || die "비어 있는 설정: ${missing[*]}"
}

# 받은 이미지를 레지스트리 다이제스트로 묶는다 — 같은 태그를 다시 올려도 이 설치는 같은 내용을 쓴다.
# 이미 다이제스트거나 레지스트리 기록이 없으면(로컬 빌드·docker load) 그대로 돌려준다
pinned_ref() {
  local image="$1" repo digest
  case "$image" in *@sha256:*) printf '%s\n' "$image"; return 0 ;; esac
  repo="${image%:*}"
  [[ "${image##*/}" == *:* ]] || repo="$image"
  digest="$(docker image inspect --format '{{json .RepoDigests}}' "$image" 2>/dev/null | tr -d '[]"' | tr ',' '\n' | sed -n "s#^${repo}@\(sha256:[0-9a-f]\{64\}\)\$#\1#p" | head -n 1)"
  if [ -n "$digest" ]; then printf '%s@%s\n' "$image" "$digest"; else printf '%s\n' "$image"; fi
}

# 이미지 서명 확인(선택) — .env의 FF_IMAGE_SIGNER(게시 워크플로 신원 정규식)가 있으면 cosign keyless 서명을 확인한다
verify_image_signature() {
  local ref="$1" signer
  signer="${FF_IMAGE_SIGNER:-}"
  [ -n "$signer" ] || [ ! -f "$ENV_FILE" ] || signer="$(env_norm "$(env_get FF_IMAGE_SIGNER)")"
  [ -n "$signer" ] || return 0
  command -v cosign >/dev/null || die "FF_IMAGE_SIGNER가 있는데 cosign이 없습니다 — https://docs.sigstore.dev/cosign/system_config/installation/"
  case "$ref" in *@sha256:*) ;; *) die "서명은 다이제스트(@sha256:)로 확인합니다: $ref" ;; esac
  cosign verify --certificate-identity-regexp "$signer" --certificate-oidc-issuer https://token.actions.githubusercontent.com "$ref" >/dev/null ||
    die "이미지 서명 확인 실패: $ref — 게시 워크플로(app-image.yml)가 서명한 이미지만 씁니다"
  log "서명 확인: $ref"
}

# 바깥 백업 저장소가 rclone crypt(클라이언트 쪽 암호화) 원격인가 — 'name:경로'의 name으로 본다
rclone_remote_encrypted() {
  local name="${1%%:*}"
  rclone listremotes --long 2>/dev/null | awk -v n="$name:" '$1 == n && $2 == "crypt" { found = 1 } END { exit found ? 0 : 1 }'
}

# 공개 주소 준비 점검 — 로컬 시험(자체 서명 인증서)은 FF_INSECURE_TLS=1
ready_url() {
  printf '%s/api/health/ready' "$(env_get FF_PUBLIC_URL)"
}
curl_tls() {
  if [ "${FF_INSECURE_TLS:-0}" = 1 ]; then curl -k "$@"; else curl "$@"; fi
}

wait_ready() {
  local limit="${1:-900}" waited=0
  while [ "$waited" -lt "$limit" ]; do
    if curl_tls -fsS --max-time 10 "$(ready_url)" 2>/dev/null | grep -q '"status":"ready"'; then
      log "준비됨 ($(ready_url), ${waited}초)"
      return 0
    fi
    sleep 10
    waited=$((waited + 10))
  done
  log "준비 점검 시간 초과(${limit}초) — scripts/health.sh, docker compose logs app"
  return 1
}
