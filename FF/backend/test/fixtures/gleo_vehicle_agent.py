"""FF 백엔드 GLEO 실연동 시험용 차량 에이전트 — FF_IMP의 실제 gleo.decision_engine으로 영상 키트 차량(ego-01, lead-01)을 흉내 낸다.

    PYTHONPATH=<FF_IMP> python gleo_vehicle_agent.py ws://127.0.0.1:8798

어댑터는 UnrealExecutionAdapter처럼 kill_mode로 Safe Stop/Safe Default를 고른다(kill_command.safe_mode가 반영되는지 확인).
"""
import sys
import time

from gleo import messages
from gleo.broker_client import BrokerClient
from gleo.decision_engine import DecisionEngine


class KitAdapter:
    kill_mode = "safe_default"

    def apply_kill(self, targets):
        return "SAFE_STOP" if self.kill_mode == "safe_stop" else "SAFE_DEFAULT"

    def apply_drive(self, vehicle_id, throttle, steer):
        pass


def main(url: str):
    t0 = time.perf_counter()
    client = BrokerClient(url, "ff-test-vehicle-kit")
    engine = DecisionEngine(["ego-01", "lead-01"], KitAdapter(), messages.SimClock(), lambda: time.perf_counter() - t0, client.send)
    client.on_message = engine.on_message
    client.start()
    print("READY", flush=True)
    while True:
        if engine.has_pending():
            engine.apply_pending()
        time.sleep(0.02)


if __name__ == "__main__":
    main(sys.argv[1])
