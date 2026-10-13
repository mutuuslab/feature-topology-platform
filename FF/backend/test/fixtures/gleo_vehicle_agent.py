"""FF 백엔드 GLEO 실연동 시험용 차량 에이전트 — FF_IMP의 실제 gleo.decision_engine·VehicleGuard(v2)로 영상 키트 차량(ego-01, lead-01)을 흉내 낸다.

    PYTHONPATH=<FF_IMP> python gleo_vehicle_agent.py ws://127.0.0.1:8798 <config.json>

config.json(시험이 FF API에서 만든다): root_b64(FF_HSM_VEHICLE_ROOT), epoch, keys[{kid, purpose, pem}](GET /api/pki/keys),
profiles[{feature_id, version, deact_class, takeover_ms, ramp_ms, max_pending_ms}](Registry 확정값), ecu_id, sw_version, vins.
Guard가 봉투를 검증(JWS·cmd_auth·순번·시각·등급·승인자)하고 DC 단계마다 state_auth로 서명한 status_report v2를 브로커로 보낸다.
시각 축은 벽시계(FF 시험 서버와 같은 축) — 봉투 validity가 FF 시계 기준이므로.
"""
import base64
import json
import sys
import time
from datetime import datetime, timezone

from cryptography.hazmat.primitives.serialization import load_pem_public_key

from gleo import messages
from gleo.broker_client import BrokerClient
from gleo.decision_engine import DecisionEngine
from gleo.vehicle_guard import FeatureProfile, VehicleGuard


class KitAdapter:
    def apply_guard_state(self, vehicle_ids, state, weight_permille, hmi):
        pass

    def apply_drive(self, vehicle_id, throttle, steer):
        pass


def main(url: str, config_path: str):
    with open(config_path, encoding="utf-8") as f:
        cfg = json.load(f)
    keys = {k["kid"]: (k["purpose"], load_pem_public_key(k["pem"].encode())) for k in cfg["keys"]}
    profiles = {p["feature_id"]: FeatureProfile(**p) for p in cfg["profiles"]}
    root = base64.b64decode(cfg["root_b64"])
    guards = {vin: VehicleGuard(vin, root=root, epoch=cfg["epoch"], platform_keys=keys, profiles=profiles,
                                ecu_id=cfg["ecu_id"], sw_version=cfg["sw_version"]) for vin in cfg["vins"]}
    t0 = time.perf_counter()
    clock = messages.SimClock(base=datetime.now(timezone.utc).isoformat())
    client = BrokerClient(url, "ff-test-vehicle-kit")
    engine = DecisionEngine(guards, KitAdapter(), clock, lambda: time.perf_counter() - t0, client.send)
    client.on_message = engine.on_message
    client.start()
    print("READY", flush=True)
    while True:
        if engine.has_pending():
            engine.apply_pending()
        engine.tick()
        time.sleep(0.02)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
