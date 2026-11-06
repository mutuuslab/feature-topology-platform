#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# 일일 백업 — PostgreSQL 두 DB(feature_platform·unleash) 덤프 + FF 파일 볼륨(증거·감사 고정점) → BACKUP_DIR/<UTC 시각>/ (20-99 §백업).
# 보존 BACKUP_KEEP_DAYS일(기본 7). BACKUP_RCLONE_REMOTE가 있으면 바깥 저장소로도 복사한다(rclone 설정은 운영자가 먼저).
# ff-backup.timer가 매일 부른다. .env(비밀·KEK)는 여기에 넣지 않는다 — 비밀 보관소에 따로.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

root="$(env_get BACKUP_DIR)"
root="${root:-/var/backups/ff-cloud}"
keep="$(env_get BACKUP_KEEP_DAYS)"
keep="${keep:-7}"
remote="$(env_get BACKUP_RCLONE_REMOTE)"
case "$keep" in '' | *[!0-9]*) die "BACKUP_KEEP_DAYS는 일 수(정수)" ;; esac

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dir="$root/ff-cloud-$stamp"
umask 077
mkdir -p "$dir"
# 덤프에는 감사 이력·봉인된 키가 있다 — 백업 폴더는 root만(이미 있던 폴더도)
chmod 700 "$root" "$dir"

for db in feature_platform unleash; do
  log "덤프 $db"
  dc exec -T db pg_dump -U ff_owner -d "$db" --format=custom --compress=6 >"$dir/$db.dump"
  [ -s "$dir/$db.dump" ] || die "$db 덤프가 비었습니다"
done
log "역할 정의(비밀번호 제외)"
dc exec -T db pg_dumpall -U ff_owner --roles-only --no-role-passwords >"$dir/roles.sql"
log "FF 파일 볼륨(증거·감사 고정점)"
dc exec -T app sh -c 'tar -C /var/lib -czf - ff ff-anchor' >"$dir/ff-files.tar.gz"

{
  printf 'instance=%s\n' "$(env_get FF_INSTANCE_ID)"
  printf 'image=%s\n' "$(env_get FF_IMAGE)"
  printf 'created=%s\n' "$stamp"
} >"$dir/manifest.txt"
(cd "$dir" && sha256sum ./*.dump roles.sql ff-files.tar.gz manifest.txt >SHA256SUMS)
log "백업: $dir ($(du -sh "$dir" | cut -f1))"

# 보존 — 이 스크립트가 만든 폴더만 지운다
find "$root" -maxdepth 1 -type d -name 'ff-cloud-*' -mtime +"$keep" -print -exec rm -rf {} + | sed 's/^/지움 /' >&2 || true

if [ -n "$remote" ]; then
  command -v rclone >/dev/null || die "BACKUP_RCLONE_REMOTE가 있는데 rclone이 없습니다"
  # 바깥 저장소는 클라이언트 쪽 암호화(rclone crypt 원격)로만 — 버킷 공개·자격 증명 유출에도 덤프가 읽히지 않게.
  # 암호화 없이 올리려면 BACKUP_RCLONE_PLAINTEXT=1(비공개 버킷·업체 암호화를 따로 확인한 경우)
  if ! rclone_remote_encrypted "$remote" && [ "$(env_norm "$(env_get BACKUP_RCLONE_PLAINTEXT)")" != 1 ]; then
    die "BACKUP_RCLONE_REMOTE($remote)가 rclone crypt 원격이 아닙니다 — 'rclone config'로 crypt 원격을 만들어 쓰세요(20-99 §6). 로컬 백업은 끝남: $dir"
  fi
  log "바깥 저장소로 복사: $remote"
  rclone copy "$dir" "$remote/ff-cloud-$stamp" --immutable
  rclone delete "$remote" --min-age "${keep}d" --include 'ff-cloud-*/**' || log "바깥 저장소 보존 정리 실패(복사는 끝남)"
fi
