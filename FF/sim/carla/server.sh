#!/usr/bin/env bash
# FF 가상검증 전용 CARLA 서버 — LearnCarla 설치본을 쓰되 공유 서버(2000, Traffic Manager 8001)와 다른 포트에서 화면 없이 돈다.
# 사용: bash sim/carla/server.sh up|down|status   (포트 8000 금지 — 이 서버는 Traffic Manager를 쓰지 않는다)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FF="$(cd "$HERE/../.." && pwd)"
CARLA_HOME="${CARLA_HOME:-C:/project/2026-10-17_Carlra/sandbox/CARLA_0.9.16}"
PORT="${CARLA_PORT:-2100}"
STATE="$FF/.sim"
PIDF="$STATE/carla-server.pid"
LOG="$STATE/carla-server.log"
mkdir -p "$STATE"

listening() { (echo > "/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }
# 포트를 잡은 Windows PID (netstat) — 종료는 이 PID로만 한다
port_pid() { netstat -ano | awk -v p=":$PORT" '$2 ~ p"$" && $4 == "LISTENING" {print $5; exit}'; }

case "${1:-status}" in
  up)
    if listening; then echo "CARLA 검증 서버가 이미 $PORT에서 대기 중"; exit 0; fi
    [ -x "$CARLA_HOME/CarlaUE4.exe" ] || { echo "CarlaUE4.exe 없음: $CARLA_HOME" >&2; exit 1; }
    "$CARLA_HOME/CarlaUE4.exe" -RenderOffScreen -quality-level=Low -nosound \
      -carla-rpc-port="$PORT" -carla-streaming-port="$((PORT + 1))" > "$LOG" 2>&1 &
    for _ in $(seq 1 120); do
      if listening; then port_pid > "$PIDF"; echo "CARLA 검증 서버 준비 — 포트 $PORT (PID $(cat "$PIDF"))"; exit 0; fi
      sleep 2
    done
    echo "240초 안에 $PORT가 열리지 않았습니다 — $LOG" >&2; exit 1 ;;
  down)
    pid="$(port_pid || true)"
    if [ -z "$pid" ]; then echo "$PORT에서 대기 중인 서버 없음"; rm -f "$PIDF"; exit 0; fi
    taskkill //PID "$pid" //F > /dev/null && echo "CARLA 검증 서버 종료 (PID $pid)"; rm -f "$PIDF" ;;
  status)
    if listening; then echo "up $PORT (PID $(port_pid))"; else echo "down $PORT"; exit 1; fi ;;
  *) echo "사용: $0 up|down|status" >&2; exit 2 ;;
esac
