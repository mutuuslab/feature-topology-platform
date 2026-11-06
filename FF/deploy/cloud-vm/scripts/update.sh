#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# 업데이트·되돌리기 — 이미지 태그를 고정해 바꾸고, 준비 점검이 실패하면 이전 태그로 자동으로 되돌린다(20-99 §업데이트).
#   sudo bash scripts/update.sh ghcr.io/mutuuslab/feature-platform:v0.1.1-demo
#   sudo bash scripts/update.sh --rollback          # 바로 전 태그로
#   sudo FF_SKIP_PULL=1 bash scripts/update.sh <이미지>   # docker load로 반입한 이미지(레지스트리 없이)
# 업데이트 전에 백업을 남긴다. DB 마이그레이션은 앞으로만 간다 — 새 판이 DB를 바꾼 뒤 되돌리면 그 백업으로 restore.sh가 필요할 수 있다.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

# 준비 점검을 통과한 판의 기록(시각 이미지) — install.sh·update.sh가 쓴다. --rollback은 지금 판이 아닌 마지막 기록으로
history="$KIT/state/image-history"
mkdir -p "$KIT/state"
current="$(env_get FF_IMAGE)"

if [ "${1:-}" = --rollback ]; then
  [ -f "$history" ] || die "이전 이미지 기록이 없습니다($history)"
  target="$(awk -v cur="$current" '{ img = $2 } img != cur { last = img } END { print last }' "$history")"
  [ -n "$target" ] || die "되돌릴 이전 이미지가 없습니다"
else
  target="${1:-}"
fi
[ -n "$target" ] || die "새 이미지(고정 태그 또는 @sha256 다이제스트)를 주세요"
image_pinned "$target" || die "고정 태그 또는 다이제스트만 받습니다(latest 금지): $target"
[ "$target" != "$current" ] || die "이미 $target 입니다"

preflight
log "업데이트 전 백업"
bash "$KIT/scripts/backup.sh"

if [ "${FF_SKIP_PULL:-0}" = 1 ]; then
  # 인터넷 없이 docker load로 반입한 이미지
  docker image inspect "$target" >/dev/null 2>&1 || die "반입된 이미지가 없습니다: $target"
else
  log "이미지 받기: $target"
  FF_IMAGE="$target" dc pull app || die "이미지를 받지 못했습니다: $target"
fi
# 받은 다이제스트로 묶고(기록·되돌리기도 이 값) 서명을 확인한다(FF_IMAGE_SIGNER가 있을 때)
target="$(pinned_ref "$target")"
[ "$target" != "$current" ] || die "이미 $target 입니다(같은 다이제스트)"
verify_image_signature "$target"

env_set FF_IMAGE "$target"
dc up -d --no-deps app
if wait_ready "${FF_READY_TIMEOUT:-1200}" && bash "$KIT/scripts/health.sh"; then
  # 기록은 준비 점검을 통과한 판만 — --rollback이 실패한 판으로 가지 않게
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$target" >>"$history"
  log "업데이트 완료: $current → $target"
  exit 0
fi

log "준비 점검 실패 — $current 로 되돌립니다"
env_set FF_IMAGE "$current"
dc up -d --no-deps app
wait_ready "${FF_READY_TIMEOUT:-1200}" || die "되돌린 판도 준비되지 않았습니다 — 업데이트 전 백업으로 restore.sh를 쓰세요"
die "업데이트를 되돌렸습니다($target 실패). 로그: docker compose logs app"
