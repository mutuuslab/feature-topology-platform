#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# 복원 — backup.sh가 만든 폴더 하나로 두 DB와 FF 파일 볼륨을 되돌린다(20-99 §복원). 지금 데이터는 덮어쓴다.
#   sudo bash scripts/restore.sh /var/backups/ff-cloud/ff-cloud-20261106T033000Z --yes
# 같은 .env(같은 비밀·KEK)여야 한다 — KEK가 다르면 봉인된 키를 열 수 없다. 복원 전에 지금 상태를 한 번 더 백업한다.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

src="${1:-}"
[ -n "$src" ] && [ -d "$src" ] || die "백업 폴더를 주세요(예: $(env_get BACKUP_DIR)/ff-cloud-<시각>)"
[ "${2:-}" = --yes ] || die "지금 데이터를 덮어씁니다. 확인했으면 --yes를 붙이세요"
(cd "$src" && sha256sum -c --quiet SHA256SUMS) || die "체크섬이 맞지 않습니다 — 손상된 백업"
want="$(sed -n 's/^instance=//p' "$src/manifest.txt")"
[ "$want" = "$(env_get FF_INSTANCE_ID)" ] || die "다른 설치의 백업입니다(백업 $want, 이 설치 $(env_get FF_INSTANCE_ID))"

log "복원 전 현재 상태 백업"
bash "$KIT/scripts/backup.sh" || log "현재 상태 백업 실패 — 계속합니다"

log "FF·Unleash·Edge 멈춤(DB는 유지)"
dc stop app edge web

restore_db() {
  local db="$1" owner="$2"
  log "복원 $db (소유자 $owner)"
  dc exec -T db dropdb -U ff_owner --if-exists --force "$db"
  dc exec -T db createdb -U ff_owner -O "$owner" -T template0 --locale=C -E UTF8 "$db"
  dc exec -T db psql -U ff_owner -d postgres -v ON_ERROR_STOP=1 -c "REVOKE CONNECT ON DATABASE $db FROM PUBLIC; GRANT CONNECT ON DATABASE $db TO $owner;" >/dev/null
  dc exec -T db pg_restore -U ff_owner -d "$db" --no-owner --role="$owner" --exit-on-error <"$src/$db.dump"
}
restore_db feature_platform ff_app
restore_db unleash unleash_app

log "FF 파일 볼륨"
dc run --rm --no-deps -T --entrypoint sh app -c 'rm -rf /var/lib/ff/* /var/lib/ff-anchor/* && tar -C /var/lib -xzf -' <"$src/ff-files.tar.gz"

dc up -d
wait_ready "${FF_READY_TIMEOUT:-1200}"
bash "$KIT/scripts/health.sh"
