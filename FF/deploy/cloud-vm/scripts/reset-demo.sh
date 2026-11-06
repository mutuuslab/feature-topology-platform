#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# 시연 초기화 — 방문자가 바꾼 데이터를 지우고 처음 시연 데이터로 다시 시작한다(20-99 §운영). 비밀(.env)·인증서는 그대로.
#   sudo bash scripts/reset-demo.sh --yes
# DB·FF 볼륨을 지운다. 지우기 전에 백업을 남긴다.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

[ "${1:-}" = --yes ] || die "모든 시연 데이터를 지우고 다시 만듭니다. 확인했으면 --yes를 붙이세요"
preflight
bash "$KIT/scripts/backup.sh" || log "백업 실패 — 계속합니다"
project="$(env_get FF_COMPOSE_PROJECT)"
project="${project:-ff-cloud}"
dc down
for v in db-data ff-data ff-anchor ff-backups; do
  docker volume rm "${project}_$v" >/dev/null 2>&1 && log "지움 볼륨 ${project}_$v" || true
done
dc up -d
wait_ready "${FF_READY_TIMEOUT:-1200}"
bash "$KIT/scripts/health.sh"
