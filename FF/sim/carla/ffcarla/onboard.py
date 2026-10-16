"""차량 내 타당성 감시 — 보고서 v1.1 코드 패키지 FdPlaus_Step(c/src/fd_feature.c, TC-FF-21)과 같은 규칙.
기능의 거리 추정을 독립 기준 측정(CARLA에서는 자차 전방 레이더)과 매 주기 비교한다:
band = max(기준의 rel_pct %, abs_m), band 밖이 debounce_s 연속이면 확정(다음 시동까지 유지).
확정 = 차량 스스로의 고장 감지 — Guard가 고장 램프로 기능 효과를 거둔다(클라우드 불필요).
"""
from __future__ import annotations

ONBOARD_DEFAULTS = dict(rel_pct=20.0, abs_m=2.0, debounce_s=0.2)


class Plausibility:
    def __init__(self, cfg: dict | None = None):
        self.cfg = {**ONBOARD_DEFAULTS, **(cfg or {})}
        self.acc_s = 0.0
        self.latched = False

    def step(self, est_m: float, ref_m: float | None, dt: float) -> bool:
        """한 주기 — 확정되면 True. 기준 측정이 없는 주기(레이더 미검출)는 누적을 바꾸지 않는다."""
        if self.latched:
            return True
        if ref_m is None:
            return False
        c = self.cfg
        band = max(ref_m * c['rel_pct'] / 100.0, c['abs_m'])
        if abs(est_m - ref_m) > band:
            self.acc_s += dt
            if self.acc_s >= c['debounce_s'] - 1e-9:
                self.latched = True
        else:
            self.acc_s = 0.0
        return self.latched
