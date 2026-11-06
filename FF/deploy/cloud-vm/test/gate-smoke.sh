#!/usr/bin/env bash
# 공개 데모 인증 우회 시험 — 실행 중인 공개 주소에 바깥 사람처럼 요청을 보낸다(20-99 §보안 점검). 설치 직후·업데이트 뒤에 돌린다.
#   deploy/cloud-vm/test/gate-smoke.sh https://ff.example.com            # 공개 데모 기본 자격 증명(ff/ff)
#   FF_SMOKE_ID=... FF_SMOKE_PW=... test/gate-smoke.sh https://...       # 비밀번호를 바꾼 설치
#   FF_INSECURE_TLS=1 test/gate-smoke.sh https://localhost:9178          # 로컬 시험(자체 서명 인증서)
#   FF_SMOKE_HOST=1 …  # VM 안에서 돌릴 때 — 내부 포트(5432·4242·3063·9101)가 호스트에 열려 있지 않은지도 본다
#   FF_SMOKE_THROTTLE=0 …  # 로그인 실패 제한 시험을 건너뛴다(기본은 마지막에 한다 — 이 출처 IP는 10분 동안 로그인이 막힌다)
set -uo pipefail

base="${1:?공개 주소(https://…)를 주세요}"
base="${base%/}"
host="${base#*://}"
host="${host%%/*}"
scheme="${base%%://*}"
id="${FF_SMOKE_ID:-ff}"
pw="${FF_SMOKE_PW:-ff}"
jar="$(mktemp)"
trap 'rm -f "$jar"' EXIT
k=()
[ "${FF_INSECURE_TLS:-0}" = 1 ] && k=(-k)
pass=0
fail=0

# code METHOD PATH [curl 인자…] → HTTP 상태
code() {
  local m="$1" p="$2"
  shift 2
  curl "${k[@]}" -s -o /dev/null -w '%{http_code}' --max-time 20 -X "$m" "$@" "$base$p"
}
expect() {
  local want="$1" got="$2" what="$3"
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
    printf '통과  %-62s %s\n' "$what" "$got"
  else
    fail=$((fail + 1))
    printf '실패  %-62s 기대 %s, 실제 %s\n' "$what" "$want" "$got"
  fi
}
json=(-H 'Content-Type: application/json')
origin=(-H "Origin: $base")
forge=(-H 'X-Actor-Id: usr-opslead' -H 'X-Actor-Role: OPS_LEAD')

ready="$(curl "${k[@]}" -s --max-time 20 "$base/api/health/ready")"
case "$ready" in *'"status":"ready"'*) expect ready ready '준비 점검 /api/health/ready' ;; *) expect ready "${ready:0:60}" '준비 점검 /api/health/ready' ;; esac
expect 200 "$(code GET /)" '화면(같은 출처)'
if [ "$scheme" = https ]; then
  hsts="$(curl "${k[@]}" -s -o /dev/null -D - --max-time 20 "$base/api/health/live" | tr -d '\r' | grep -ci '^strict-transport-security:')"
  expect 1 "$hsts" 'HSTS 머리글'
fi

# ── 세션 없이 ──
expect 401 "$(code GET /api/features)" '세션 없이 조회'
expect 401 "$(code GET /api/features "${forge[@]}")" '세션 없이 머리글로 운영 리더 주장(조회)'
expect 401 "$(code POST /api/notifications/read-all "${forge[@]}" "${origin[@]}" "${json[@]}" -d '{}')" '세션 없이 머리글로 운영 리더 주장(쓰기)'
expect 401 "$(code GET /api/features -H 'Cookie: ff_session=forged.value')" '위조 세션 쿠키'

# ── 로그인 ──
body="{\"id\":\"$id\",\"password\":\"$pw\"}"
expect 403 "$(code POST /api/auth/demo-login "${json[@]}" -d "$body")" '출처(Origin) 없는 로그인'
expect 403 "$(code POST /api/auth/demo-login "${json[@]}" -H 'Origin: https://evil.example' -d "$body")" '다른 사이트에서 보낸 로그인'
expect 401 "$(code POST /api/auth/demo-login "${json[@]}" "${origin[@]}" -d "{\"id\":\"$id\",\"password\":\"wrong-$pw\"}")" '틀린 비밀번호'
expect 403 "$(code POST /api/auth/demo-login "${json[@]}" -H 'Origin: null' -d "$body")" '출처 null(샌드박스 iframe)에서 보낸 로그인'
hdr="$(curl "${k[@]}" -s -o /dev/null -D - --max-time 20 -X POST "${json[@]}" "${origin[@]}" -c "$jar" -d "$body" "$base/api/auth/demo-login" | tr -d '\r')"
expect 200 "$(printf '%s\n' "$hdr" | sed -n '1s/^HTTP[^ ]* \([0-9]*\).*/\1/p')" '데모 로그인'
expect 1 "$(grep -c 'ff_session' "$jar")" '세션 쿠키 받음'
setc="$(printf '%s\n' "$hdr" | grep -i '^set-cookie: ff_session=')"
attrs=ok
case "$setc" in *HttpOnly*) ;; *) attrs="$attrs,HttpOnly-빠짐" ;; esac
case "$setc" in *'SameSite=Lax'* | *'SameSite=Strict'*) ;; *) attrs="$attrs,SameSite-빠짐" ;; esac
case "$setc" in *'Path=/'*) ;; *) attrs="$attrs,Path-빠짐" ;; esac
if [ "$scheme" = https ]; then case "$setc" in *Secure*) ;; *) attrs="$attrs,Secure-빠짐" ;; esac; fi
expect ok "$attrs" '세션 쿠키 속성(HttpOnly·SameSite·Path, https면 Secure)'

# ── 세션으로 ──
s=(-b "$jar")
expect 200 "$(code GET /api/features "${s[@]}")" '세션으로 조회'
expect 403 "$(code GET /api/features "${s[@]}" -H 'X-Actor-Id: usr-author' -H 'X-Actor-Role: OPS_LEAD')" '계정이 맡지 않은 역할 주장'
expect 403 "$(code POST /api/notifications/read-all "${s[@]}" "${origin[@]}" "${json[@]}" -H 'X-Actor-Id: attacker' -H 'X-Actor-Role: AUDITOR' -d '{}')" '표 밖 행위자 ID'
expect 403 "$(code POST /api/notifications/read-all "${s[@]}" "${origin[@]}" "${json[@]}" -H 'X-Actor-Id: usr-integrator' -H 'X-Actor-Role: SYSTEM' -d '{}')" 'SYSTEM 역할 주장'
expect 403 "$(code POST /api/notifications/read-all "${s[@]}" "${json[@]}" "${forge[@]}" -d '{}')" '출처 없는 쓰기(CSRF)'
expect 403 "$(code POST /api/notifications/read-all "${s[@]}" "${json[@]}" "${forge[@]}" -H 'Origin: https://evil.example' -d '{}')" '다른 사이트의 쓰기(CSRF)'
expect 201 "$(code POST /api/notifications/read-all "${s[@]}" "${origin[@]}" "${json[@]}" "${forge[@]}" -d '{}')" '데모 계정 표 안의 쓰기(운영 리더)'

# ── 머리글 변형으로 역할 사칭 ──
w=("${s[@]}" "${origin[@]}" "${json[@]}" -d '{}')
expect 403 "$(code POST /api/notifications/read-all "${w[@]}" -H 'X-Actor-Id: usr-author' -H 'X-Actor-Id: usr-opslead' -H 'X-Actor-Role: OPS_LEAD')" '같은 머리글 두 번(X-Actor-Id 배열)'
expect 403 "$(code POST /api/notifications/read-all "${w[@]}" -H 'X-Actor-Id: usr-opslead' -H 'X-Actor-Role: AUDITOR, OPS_LEAD')" '역할 쉼표 목록'
expect 403 "$(code POST /api/notifications/read-all "${w[@]}" -H 'X-Actor-Id: usr-opslead' -H 'X-Actor-Role: ops_lead')" '역할 소문자'
expect 403 "$(code POST /api/notifications/read-all "${w[@]}" -H 'X-Actor-Id: USR-OPSLEAD' -H 'X-Actor-Role: OPS_LEAD')" '행위자 ID 대문자'
expect 403 "$(code POST /api/notifications/read-all "${w[@]}" -H 'X-Actor-Id: usr-opslеad' -H 'X-Actor-Role: OPS_LEAD')" '행위자 ID 유니코드 닮은 글자(키릴 е)'
expect 403 "$(code POST /api/notifications/read-all "${w[@]}" -H 'X-Actor-Id: usr-operator' -H 'X-Actor-Role: VEHICLE')" 'VEHICLE 역할 주장'

# ── 출처 변형(CSRF) — 정확히 같은 출처만 ──
for o in null "https://evil.$host" "$base.evil.example" "$scheme://${host%%:*}:8443" "http://$host" "$base/"; do
  [ "$o" = "$base" ] && continue
  expect 403 "$(code POST /api/notifications/read-all "${s[@]}" "${json[@]}" "${forge[@]}" -H "Origin: $o" -d '{}')" "쓰기 출처 $o"
done
expect 403 "$(code POST /api/auth/logout "${s[@]}" "${json[@]}" -H 'Origin: https://evil.example' -d '{}')" '다른 사이트가 로그아웃시키기'
expect 200 "$(code GET /api/features "${s[@]}")" '그 뒤에도 세션은 살아 있다'

# ── 세션 고정 — 다시 로그인하면 이전 세션은 무효 ──
jar2="$(mktemp)"
trap 'rm -f "$jar" "$jar2"' EXIT
expect 200 "$(code POST /api/auth/demo-login "${s[@]}" "${json[@]}" "${origin[@]}" -c "$jar2" -d "$body")" '같은 브라우저에서 다시 로그인'
expect 401 "$(code GET /api/features "${s[@]}")" '이전 세션 쿠키는 무효'
s=(-b "$jar2")
expect 200 "$(code GET /api/features "${s[@]}")" '새 세션 쿠키로 조회'

# ── 차량·외부 연계·내부 창구 ──
expect 401 "$(code POST /vehicle/v1/ego-01/flags "${json[@]}" -H 'X-Vehicle-Id: ego-01' -d '{"context":{}}')" '머리글만으로 차량 주장'
expect 401 "$(code POST /vehicle/v1/ego-01/flags "${json[@]}" -H 'X-Vehicle-Id: ego-01' -H 'X-Client-Cert-Subject: CN=ego-01' -d '{"context":{}}')" '인증서 주체 머리글 위조(mTLS 사칭)'
expect 401 "$(code POST /vehicle/v1/ego-01/flags "${json[@]}" -H 'X-Vehicle-Id: ego-01' -H 'x-client-cert-subject: CN=ego-01' -H 'X-CLIENT-CERT-SUBJECT: CN=ego-01' -d '{"context":{}}')" 'mTLS 주체 머리글 대소문자·중복'
expect 404 "$(code POST /api/webhooks/gitlab "${json[@]}" -H 'X-Gitlab-Token: ff-mock-gitlab-token' -d '{}')" '외부 webhook(공개 시연은 닫음)'
expect 404 "$(code POST /API/Webhooks/gitlab "${json[@]}" -d '{}')" 'webhook 경로 대소문자'
expect 404 "$(code POST /api/webhooks/gitlab/ "${json[@]}" -d '{}')" 'webhook 경로 끝 빗금'
expect 404 "$(code POST /api/ota/v1/events "${json[@]}" -d '{}')" 'OTA 서버 webhook(공개 시연은 닫음)'
expect 404 "$(code GET /api/health/metrics)" '지표(내부만)'
expect 404 "$(code GET /api/health/metrics/ "${s[@]}")" '지표 끝 빗금 — 로그인한 방문자도'
expect 404 "$(code GET /API/HEALTH/METRICS "${s[@]}")" '지표 경로 대소문자'

# ── 로그아웃 ──
expect 200 "$(code POST /api/auth/logout "${s[@]}" "${origin[@]}" "${json[@]}" -d '{}')" '로그아웃'
expect 401 "$(code GET /api/features "${s[@]}")" '로그아웃한 쿠키로 조회'

# ── 로그인 실패 제한 — 바깥에서 X-Forwarded-For를 바꿔 출처를 속여도 같은 출처로 센다(Caddy가 바깥 값을 버린다) ──
if [ "${FF_SMOKE_THROTTLE:-1}" = 1 ]; then
  bad="{\"id\":\"$id\",\"password\":\"wrong-$pw\"}"
  got=''
  for i in 1 2 3 4 5 6 7 8 9 10; do got="$got$(code POST /api/auth/demo-login "${json[@]}" "${origin[@]}" -H "X-Forwarded-For: 198.51.100.$i" -d "$bad") "; done
  expect '401 401 401 401 401 401 401 401 401 401 ' "$got" '틀린 비밀번호 10회(X-Forwarded-For를 매번 바꿈)'
  expect 429 "$(code POST /api/auth/demo-login "${json[@]}" "${origin[@]}" -H 'X-Forwarded-For: 203.0.113.250' -d "$bad")" '11번째 — 위조한 새 출처로도 429'
  expect 429 "$(code POST /api/auth/demo-login "${json[@]}" "${origin[@]}" -H 'X-Forwarded-For: 10.0.0.9' -d "$body")" '막힌 동안은 맞는 비밀번호도 429'
  printf '알림  이 출처는 10분 동안 데모 로그인이 막힙니다(실패 제한 시험)\n'
fi

# 내부 포트 — HTTP가 아닌 창구(PostgreSQL 등)도 열림을 알아채게 TCP 연결로 본다(curl은 HTTP 응답이 아니면 실패해 닫힘으로 잘못 본다)
port_open() { timeout 3 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" 2>/dev/null; }
if [ "${FF_SMOKE_HOST:-0}" = 1 ]; then
  for p in 5432 5543 4242 3063 9101 9171; do
    if port_open "$p"; then expect closed open "호스트 포트 $p"; else expect closed closed "호스트 포트 $p"; fi
  done
fi

printf '\n통과 %d · 실패 %d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
