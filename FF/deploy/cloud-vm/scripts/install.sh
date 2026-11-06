#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# 첫 설치 — 이미지 받기 → 기동 → 공개 주소 준비 점검 → (root면) 부팅 서비스·일일 백업 타이머 등록(20-99 §설치).
#   sudo bash scripts/install.sh            # 게시 이미지(FF_IMAGE)를 받아 띄운다
#   sudo FF_BUILD_LOCAL=1 bash scripts/install.sh   # 이미지를 VM에서 직접 빌드(전체 저장소가 있어야 한다, 4 GiB 이상)
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

preflight
command -v docker >/dev/null || die "docker가 없습니다 — cloud-init.yaml로 만든 VM인지 확인하세요"
docker compose version >/dev/null 2>&1 || die "docker compose(v2)가 없습니다"
dc config --quiet || die "compose 설정 오류"

if [ "${FF_BUILD_LOCAL:-0}" = 1 ]; then
  log "이미지를 VM에서 빌드합니다(수 분)"
  FF_BUILD_SHA="$(git -C "$KIT" rev-parse --short HEAD 2>/dev/null || echo unknown)" dc build app
  dc pull db web edge caddy
else
  log "이미지 받기: $(env_get FF_IMAGE)"
  dc pull || die "이미지를 받지 못했습니다 — 비공개 패키지면 먼저: echo <읽기 토큰> | docker login ghcr.io -u <GitHub 사용자> --password-stdin"
  # 태그를 받은 다이제스트로 묶는다(나중에 같은 태그가 다시 올라와도 이 설치·부팅 서비스는 같은 내용) → 서명 확인(선택)
  image="$(env_get FF_IMAGE)"
  pinned="$(pinned_ref "$image")"
  verify_image_signature "$pinned"
  if [ "$pinned" != "$image" ]; then
    env_set FF_IMAGE "$pinned"
    log "이미지 고정: $pinned"
  fi
fi

dc up -d --remove-orphans
log "기동 중 — 첫 기동은 시연 데이터 생성으로 수 분 걸립니다"
wait_ready "${FF_READY_TIMEOUT:-1200}"

mkdir -p "$KIT/state"
printf '%s %s\n' "$(date -u +%FT%TZ)" "$(env_get FF_IMAGE)" >>"$KIT/state/image-history"

if [ "$(id -u)" = 0 ] && [ -d /etc/systemd/system ] && command -v systemctl >/dev/null; then
  for unit in ff-platform.service ff-backup.service ff-backup.timer; do
    sed "s#@KIT@#$KIT#g" "$KIT/systemd/$unit" >"/etc/systemd/system/$unit"
  done
  systemctl daemon-reload
  systemctl enable ff-platform.service >/dev/null
  systemctl enable --now ff-backup.timer >/dev/null
  log "부팅 서비스(ff-platform)·일일 백업(ff-backup.timer) 등록"
else
  log "root가 아니거나 systemd가 없어 부팅 서비스·백업 타이머는 건너뜁니다"
fi

bash "$KIT/scripts/health.sh"
log "완료 — 브라우저: $(env_get FF_PUBLIC_URL)"
