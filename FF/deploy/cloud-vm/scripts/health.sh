#!/usr/bin/env bash
# shellcheck disable=SC2329  # check()가 함수 이름으로 부른다
# shellcheck source-path=SCRIPTDIR
# 상태 점검 — 컨테이너 상태(db·web·edge·app·caddy) + 공개 주소 준비 점검 + 공개 데모 게이트(세션 없이 401)(20-99 §점검).
#   scripts/health.sh          # 문제가 있으면 종료 코드 1
set -uo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

fail=0
check() {
  local name="$1"
  shift
  if "$@"; then log "정상  $name"; else log "실패  $name"; fail=1; fi
}

# health가 starting이면(막 뜬 직후 — 점검 간격만큼 늦다) 최대 FF_HEALTH_WAIT초(기본 60) 기다린다
container_healthy() {
  local id status waited=0
  id="$(dc ps -q "$1" 2>/dev/null)"
  [ -n "$id" ] || return 1
  while :; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null)"
    if [ "$status" != starting ] || [ "$waited" -ge "${FF_HEALTH_WAIT:-60}" ]; then break; fi
    sleep 5
    waited=$((waited + 5))
  done
  [ "$status" = healthy ] || [ "$status" = running ]
}

ready_json() {
  local body
  body="$(curl_tls -fsS --max-time 15 "$(ready_url)")" || return 1
  printf '%s' "$body" | grep -q '"status":"ready"'
}

# 공개 데모 게이트 — 세션 없이 API를 부르면 401(머리글을 붙여도). 게이트가 꺼진 공개 설치를 바로 알아챈다.
# 설정 값(FF_AUTH)을 믿지 않고 늘 본다 — 회사 계정(OIDC)도 로그인 없이는 401이다
gate_closed() {
  local base code
  base="$(env_get FF_PUBLIC_URL)"
  code="$(curl_tls -s -o /dev/null -w '%{http_code}' --max-time 15 -H 'X-Actor-Id: usr-opslead' -H 'X-Actor-Role: OPS_LEAD' "$base/api/features")"
  [ "$code" = 401 ]
}

# Unleash·Edge는 내부망만 — 컨테이너 안에서 본다
unleash_health() { dc exec -T web node -e "fetch('http://127.0.0.1:4242/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; }

for s in db web edge app caddy; do check "컨테이너 $s" container_healthy "$s"; done
check "Unleash /health(내부)" unleash_health
check "공개 준비 점검 $(ready_url)" ready_json
check "공개 데모 게이트(세션 없이 401)" gate_closed
exit "$fail"
