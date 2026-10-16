"""FEAT-00022 '전방 안전거리 3단계' 차량 측 런타임 — FF_IMP beamng/feature_runtime.py v2(Guard 상태)와
같은 계산을 한다(1:1, golden 시계열로 확인: tests/fixtures/feat00022_golden.json).

상태 = 차량 Safety Guard 상태(status_report v2): ACTIVE / DEACT_PENDING_* / DEACT_WARNING(기능이 아직 제어),
DEACT_RAMP(기능 명령 → 기본 명령, 램프 동안 선형), DISABLED / INACTIVE(안전 상태 BASE_ONLY: 기본 차간 시간 제어).
주입된 고장은 기능이 모르는 채로 기능의 거리 추정을 부풀린다.
확장(이전 실행기 기준 운동학과 같음): set_guard_state(t, 'DEACT_RAMP', ramp_s)는 그 램프의 길이를 받는다 — 차량 내 고장 램프
(Registry faultRampMs)는 원격 램프(rampMs)보다 짧다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

STAGES = ('정상', '주의', '위험')
RANK = {'정상': 0, '주의': 1, '위험': 2}
# 기능이 아직 차량을 제어하는 Guard 상태 — 나머지는 모두 기본 제어(BASE_ONLY)
FEATURE_STATES = ('ACTIVE', 'DEACT_PENDING_IDLE', 'DEACT_PENDING_CYCLE', 'DEACT_WARNING', 'DEACT_RAMP')


def stage_of(gap_m: float, speed_mps: float) -> str:
    tg = gap_m / max(speed_mps, 1.0)  # 차간 시간 (s)
    if tg >= 1.6:
        return '정상'
    if tg >= 0.9:
        return '주의'
    return '위험'


DEFAULT_CONFIG = dict(
    target_gap_m=40.0, fault_at=17.0, fault_ramp=8.0, fault_bias_max=2.4,
    base_time_gap_s=2.2,  # 안전 상태 BASE_ONLY: 기존 차간 시간 제어
    ramp_s=3.0,  # DEACT_RAMP 길이 — Registry rampMs (FEAT-00022 3000 ms)
    max_speed_mps=33.0, gain_feature=0.30, gain_default=0.22,
    max_accel_mps2=1.6,  # 명령 변화율 제한 (급가속·급감속 없음)
    max_decel_mps2=2.8,
)


@dataclass
class Runtime:
    cfg: dict
    cmd_mps: float = 22.0
    state: str = 'ACTIVE'
    fault_active: bool = False
    deact_at: float | None = None
    ramp_at: float | None = None
    ramp_s: float = 3.0
    disabled_at: float | None = None
    extra: dict = field(default_factory=dict)

    def bias(self, t: float) -> float:
        c = self.cfg
        if not (t >= c['fault_at']):
            return 1.0
        k = min(1.0, (t - c['fault_at']) / c['fault_ramp'])
        return 1.0 + (c['fault_bias_max'] - 1.0) * (k * k * (3 - 2 * k))

    def set_guard_state(self, t: float, state: str, ramp_s: float | None = None) -> str:
        """차량 Guard가 정한 상태 — 같은 상태를 다시 받으면 처음 시각을 유지한다."""
        if state == self.state:
            return state
        if state.startswith('DEACT_') and self.deact_at is None:
            self.deact_at = t
        if state == 'DEACT_RAMP':
            self.ramp_at = t
            self.ramp_s = ramp_s if ramp_s is not None else self.cfg['ramp_s']
        if state not in FEATURE_STATES and state != 'RESTORE_PENDING' and self.disabled_at is None:
            self.disabled_at = t
        if state == 'ACTIVE':
            self.deact_at = self.ramp_at = self.disabled_at = None
        self.state = state
        return state

    def weight(self, t: float) -> float:
        """기능 명령의 몫 (0..1) — 램프 동안 1 → 0."""
        if self.state == 'DEACT_RAMP':
            start = self.ramp_at if self.ramp_at is not None else t
            return max(0.0, 1.0 - (t - start) / max(self.ramp_s, 1e-6))
        return 1.0 if self.state in FEATURE_STATES else 0.0

    def apply_kill(self, t: float) -> str:
        """플랫폼이 기능을 끔(flag OFF): 램프 없이 바로 기본 제어."""
        return self.set_guard_state(t, 'DISABLED')

    def step(self, t: float, dt: float, gap_true: float, ego_mps: float, lead_mps: float) -> dict:
        c = self.cfg
        self.fault_active = t >= c['fault_at']
        w = self.weight(t)
        gap_est = gap_true * self.bias(t) if w > 0 else gap_true
        want_feature = lead_mps + c['gain_feature'] * (gap_est - c['target_gap_m'])
        desired = c['base_time_gap_s'] * max(ego_mps, 5.0)
        want_base = lead_mps + c['gain_default'] * (gap_true - desired)
        want = w * want_feature + (1.0 - w) * want_base
        want = max(0.0, min(c['max_speed_mps'], want))
        dv = want - self.cmd_mps
        dv = max(-c['max_decel_mps2'] * dt, min(c['max_accel_mps2'] * dt, dv))
        self.cmd_mps += dv
        return dict(
            feature_state=self.state, feature_weight=round(w * 1000) / 1000, fault_active=self.fault_active,
            gap_true=gap_true, gap_est=gap_est, stage_feature=stage_of(gap_est, ego_mps) if w > 0 else None,
            stage_true=stage_of(gap_true, ego_mps), cmd_mps=self.cmd_mps,
        )


def create_runtime(cfg: dict | None = None, initial_cmd_mps: float = 22.0) -> Runtime:
    c = {**DEFAULT_CONFIG, **(cfg or {})}
    return Runtime(cfg=c, cmd_mps=initial_cmd_mps, ramp_s=c['ramp_s'])


def runtime_for(scenario: dict, v0: float) -> Runtime:
    """시나리오 → 런타임 설정 (고장 없으면 fault_at = 무한)."""
    f = scenario.get('fault')
    return create_runtime(dict(
        target_gap_m=scenario['target_gap_m'],
        fault_at=f['at_s'] if f else math.inf,
        fault_ramp=f['ramp_s'] if f else 8.0,
        fault_bias_max=f['bias_max'] if f else 1.0,
    ), v0)
