"""검증 실행 한 건 — 차량 Safety Guard(DC0~DC4 단계·고장 램프), 원격 차단 경로(링크 지연), 차량 내 감지, 기준 판정.
엔진 중립이다: 매 주기 측정값(실제 간격·자차/선행차 속도·자차 종가속·독립 기준 측정)을 받아 기능 명령 속도를 돌려준다.
차량 동역학은 world.py(CARLA)가, 서버 없는 시험은 tests의 운동학 루프가 맡는다.
판정 규칙은 FF가 Gate 근거로 받아들이는 기준과 같다(contracts/src/schemas/sim.ts SIM_REQUIRED_CRITERIA).
"""
from __future__ import annotations

import math

from .feature00022 import FEATURE_STATES, RANK, runtime_for
from .onboard import Plausibility

IDLE_S = 1.5  # DC1 '기능이 동작하지 않음' 확인 시간 (FF 차량 시뮬레이터 FLEET_SIM_IDLE_MS)
SAFETY_DEFAULTS = dict(deactClass='DC2', takeoverMs=4000, rampMs=3000, faultRampMs=1500, faultTolerantTimeMs=5000)

C_KILL = dict(id='kill_latency', label='원격 차단 → 차량 Guard 수락', unit='s', op='<=', limit=1.0)
C_DEACT = dict(id='deact_time', label='수락 → 기능 꺼짐 (DISABLED, 인계+램프)', unit='s', op='<=')
C_REFUSE = dict(id='remote_refused', label='DC4 원격 차단 거부 (차량 Guard)', unit='건', op='>=', limit=1)
C_DETECT = dict(id='detect_latency', label='고장 시작 → 차량 내 감지 확정', unit='s', op='<=')
C_FTTI = dict(id='ftti_margin', label='FTTI 여유 (FTTI 끝 − 기능 효과 제거)', unit='s', op='>=', limit=0)
C_MIS = dict(id='misjudge', label='기능 오판단 최장 지속 (실제보다 안전하다고 판단)', unit='s', op='<=', limit=2.0)
C_DANGER = dict(id='danger_time', label="실제 '위험' 단계 누적", unit='s', op='<=', limit=0)
C_TTC = dict(id='min_ttc', label='최소 TTC', unit='s', op='>=', limit=2.0)
C_DECEL = dict(id='max_decel', label='최대 감속', unit='m/s²', op='<=', limit=2.8)
C_RECOVER = dict(id='recovery', label="BASE_ONLY 후 실제 '정상' 복귀", unit='s', op='<=', limit=15)
CRITERIA = [C_KILL, C_DEACT, C_REFUSE, C_DETECT, C_FTTI, C_MIS, C_DANGER, C_TTC, C_DECEL, C_RECOVER]
# 최댓값·누적·최솟값은 끝나야 확정이고, 한 번 일어나면 바뀌지 않는 사건형 기준은 통과하는 순간 확정이다
EVENT_CRITERIA = {'kill_latency', 'recovery', 'deact_time', 'detect_latency', 'ftti_margin', 'remote_refused'}


def r2(x):
    if x is None or (isinstance(x, float) and not math.isfinite(x)):
        return x
    return round(x * 100) / 100


class ValidationRun:
    def __init__(self, scenario: dict, safety: dict | None, flag_on: bool, iso=None):
        self.sc = sc = scenario
        self.on = bool(flag_on)
        self.safety = {**SAFETY_DEFAULTS, **(safety or {})}
        self.rt = runtime_for(sc, sc['lead_kph'] / 3.6)
        if not self.on:
            self.rt.apply_kill(0.0)  # flag OFF: 처음부터 차량 기본 동작
        self.iso = iso or (lambda t: f'+{t:.2f}s')
        self.t = 0.0
        self.done = False
        self.events: list[dict] = []
        self.tel: list[dict] = []
        self.m = dict(mis_run=0.0, mis_max=0.0, mis_at=None, danger=0.0, danger_at=None, min_ttc=math.inf, min_ttc_at=None,
                      min_tg=math.inf, min_tg_at=None, recovered_at=None, stage=None)
        self.k = dict(max_decel=0.0, max_decel_at=None, kill_issued=None, kill_applied=None, kill_rejected=None)
        onboard = sc.get('onboard')
        self.g = dict(due=[], accepted_at=None, disabled_at=None if self.on else 0.0, detect_at=None,
                      onboard=Plausibility({} if onboard is True else onboard) if onboard else None)
        self.pending_kill: float | None = None
        self.ev('policy_evaluated', '정책 판단 ON' if self.on else '정책 OFF — 기본 동작으로 시험')

    # ---- 기록 -------------------------------------------------------------------------------------------------------
    def ev(self, type_: str, detail: str, **extra):
        self.events.append({'t': r2(self.t), 'type': type_, 'detail': detail, **extra})

    @property
    def state(self) -> str:
        return 'DISABLED' if not self.on else self.rt.state

    def expects_disable(self) -> bool:
        return self.on and (bool(self.sc.get('kill')) or (bool(self.g['onboard']) and bool(self.sc.get('fault'))))

    # ---- 차량 Guard ---------------------------------------------------------------------------------------------------
    def guard_set(self, t: float, state: str, ramp_s: float | None = None):
        prev = self.rt.state
        self.rt.set_guard_state(t, state, ramp_s)
        if prev != state:
            self.ev('guard_state', f'차량 Guard {prev} → {state}' + (f' (램프 {ramp_s} s)' if ramp_s is not None else ''), at=self.iso(t), state=state)
        if state not in FEATURE_STATES and state != 'RESTORE_PENDING' and self.g['disabled_at'] is None:
            self.g['disabled_at'] = t
            self.ev('feature_base_only', f'기능 효과 제거 — 안전 상태 BASE_ONLY ({state})', at=self.iso(t), state=state)

    def guard_receive(self, t: float):
        """서명된 원격 비활성화가 차량에 닿음: Guard가 비활성화 등급을 적용한다(9.3 등급 확인, DEACT 단계)."""
        S, k = self.safety, self.k
        if S['deactClass'] == 'DC4':  # 설계상 원격 비활성화 금지(FFG-DEAC-011): 상태 유지, 거부 보고
            k['kill_rejected'] = t
            self.ev('kill_rejected', '차량 Guard 거부 — DC4 원격 비활성화 금지 (DESIGN_CLASS), 상태 그대로', at=self.iso(t), reject_code='DESIGN_CLASS')
            return
        k['kill_applied'] = t
        self.g['accepted_at'] = t
        ms = round((t - k['kill_issued']) * 1000)
        self.ev('deact_accepted', f"원격 차단 수락 ({S['deactClass']}, {ms} ms)", at=self.iso(t), latency_ms=ms, deact_class=S['deactClass'])
        self.g['due'] = [d for d in self.g['due'] if d['src'] != 'remote']
        dc = S['deactClass']
        if dc == 'DC0':
            return self.guard_set(t, 'DISABLED')
        if dc == 'DC1':
            self.guard_set(t, 'DEACT_PENDING_IDLE')
            wait = min(S.get('maxPendingMs') or IDLE_S * 1000, IDLE_S * 1000) / 1000
            self.g['due'].append(dict(at=t + wait, state='DISABLED', src='remote'))
            return
        if dc == 'DC3':
            return self.guard_set(t, 'DEACT_PENDING_CYCLE')  # 다음 시동에 끝난다 — 한 주행 안에서는 끝나지 않음
        self.guard_set(t, 'DEACT_WARNING')
        self.g['due'] += [dict(at=t + S['takeoverMs'] / 1000, state='DEACT_RAMP', ramp=S['rampMs'] / 1000, src='remote'),
                          dict(at=t + (S['takeoverMs'] + S['rampMs']) / 1000, state='DISABLED', src='remote')]

    def guard_local_fault(self, t: float):
        """차량 내 고장(타당성 감시 확정): 고장 램프, 램프가 없으면 즉시 — 진행 중인 램프는 줄이기만 하고 늘리지 않는다."""
        S, st = self.safety, self.rt.state
        fr = S['faultRampMs'] / 1000
        if st not in FEATURE_STATES:
            return
        if fr <= 0:
            self.g['due'] = []
            return self.guard_set(t, 'DISABLED')
        if st == 'DEACT_RAMP':
            w = self.rt.weight(t)
            end = next((d for d in self.g['due'] if d['state'] == 'DISABLED'), None)
            if end and end['at'] - t <= fr:
                return
            self.rt.ramp_s = fr / max(w, 1e-6)
            self.rt.ramp_at = t - (1 - w) * self.rt.ramp_s  # 지금 몫에서 이어서
            self.ev('guard_state', f'차량 Guard 고장 램프로 단축 ({fr} s)', at=self.iso(t), state='DEACT_RAMP')
        else:
            self.guard_set(t, 'DEACT_RAMP', fr)
        self.g['due'] = [dict(at=t + fr, state='DISABLED', src='onboard')]

    # ---- 한 주기 ------------------------------------------------------------------------------------------------------
    def step(self, dt: float, gap_true: float, ego_mps: float, lead_mps: float, ego_a: float, ref_gap: float | None) -> float:
        """측정값 한 주기 → 기능(또는 기본 제어)의 명령 속도 (m/s). ref_gap = 독립 기준 측정(없으면 None)."""
        if self.done:
            return self.rt.cmd_mps
        t, sc, k = self.t, self.sc, self.k
        # Guard 단계 타이머 (DEACT_WARNING → DEACT_RAMP → DISABLED)
        while self.on and self.g['due'] and t >= self.g['due'][0]['at'] - 1e-9:
            d = self.g['due'].pop(0)
            self.guard_set(d['at'], d['state'], d.get('ramp'))
        kill = sc.get('kill')
        if self.on and k['kill_issued'] is None and kill and t >= kill['at_s']:
            k['kill_issued'] = t
            self.ev('kill_issued', f"긴급 차단 발령 (kill_command v2 deactivate · 설계 {self.safety['deactClass']})", at=self.iso(t), deact_class=self.safety['deactClass'])
            self.pending_kill = t + (sc.get('link_latency_ms') or 0) / 1000
        if self.pending_kill is not None and t >= self.pending_kill:
            self.pending_kill = None
            self.guard_receive(t)
        f = sc.get('fault')
        if f and t < f['at_s'] <= t + dt:
            self.ev('fault_injected', f"거리 추정 오류 주입 (최대 ×{f['bias_max']})")

        out = self.rt.step(t, dt, gap_true, ego_mps, lead_mps)
        stage_feature = out['stage_feature'] if self.on else None
        m = self.m
        closing = ego_mps - lead_mps
        ttc = gap_true / closing if closing > 0.1 else None
        tg = gap_true / max(ego_mps, 1.0)
        if out['stage_true'] != m['stage']:
            if m['stage']:
                self.ev('stage_true', f"실제 단계 {m['stage']} → {out['stage_true']}")
            m['stage'] = out['stage_true']
        mis = self.on and self.rt.state == 'ACTIVE' and stage_feature and RANK[stage_feature] < RANK[out['stage_true']]
        m['mis_run'] = m['mis_run'] + dt if mis else 0.0
        if m['mis_run'] > m['mis_max']:
            m['mis_max'], m['mis_at'] = m['mis_run'], t
        if out['stage_true'] == '위험':
            m['danger'] += dt
            if m['danger_at'] is None:
                m['danger_at'] = t
        if ttc is not None and ttc < m['min_ttc']:
            m['min_ttc'], m['min_ttc_at'] = ttc, t
        if tg < m['min_tg']:
            m['min_tg'], m['min_tg_at'] = tg, t
        if self.g['disabled_at'] is not None and m['recovered_at'] is None and out['stage_true'] == '정상':
            m['recovered_at'] = t
        # 차량 내 타당성 감시 — 기능이 효과를 내는 동안만, 확정 = 차량 스스로의 감지
        ob = self.g['onboard']
        if ob and self.on and self.g['detect_at'] is None and self.rt.state in FEATURE_STATES and ob.step(out['gap_est'], ref_gap, dt):
            self.g['detect_at'] = t
            c = ob.cfg
            self.ev('onboard_fault', f"차량 내 감지 확정 — 추정 {r2(out['gap_est'])} m / 기준 {r2(ref_gap)} m ({c['rel_pct']}%·{c['abs_m']} m 밖 {c['debounce_s']} s)", at=self.iso(t))
            self.guard_local_fault(t)
        if -ego_a > k['max_decel']:
            k['max_decel'], k['max_decel_at'] = -ego_a, t
        self.tel.append(dict(sim_t=r2(t), ego_kph=r2(ego_mps * 3.6), lead_kph=r2(lead_mps * 3.6), feature_state=self.state,
                             fault_active=out['fault_active'], gap_true=r2(gap_true), gap_est=r2(out['gap_est'] if self.on else gap_true),
                             gap_ref=r2(ref_gap), stage_feature=stage_feature, stage_true=out['stage_true'], cmd_kph=r2(out['cmd_mps'] * 3.6),
                             ttc=r2(ttc), feature_weight=out['feature_weight'], ego_a=r2(ego_a)))
        self.t = t + dt
        if self.t >= sc['duration_s'] - 1e-9:
            self.done = True
            self.ev('run_end', '시나리오 종료')
        return out['cmd_mps']

    # ---- 판정 ---------------------------------------------------------------------------------------------------------
    def _values(self) -> dict:
        k, sc, g, m, end, S = self.k, self.sc, self.g, self.m, self.done, self.safety
        INF = math.inf
        if k['kill_applied'] is not None:
            kill = [k['kill_applied'] - k['kill_issued'], k['kill_applied']]
        elif k['kill_rejected'] is not None:
            kill = 'na'
        elif k['kill_issued'] is None and (not self.on or not sc.get('kill')):
            kill = 'na' if (end or not sc.get('kill')) else None
        else:
            kill = [INF, None] if end else None
        if g['accepted_at'] is None:
            if k['kill_issued'] is not None and k['kill_rejected'] is None and self.on and end:
                deact = [INF, None]
            else:
                deact = 'na' if (k['kill_issued'] is None or k['kill_rejected'] is not None) else None
        elif g['disabled_at'] is not None:
            deact = [g['disabled_at'] - g['accepted_at'], g['disabled_at']]
        else:
            deact = 'na' if S['deactClass'] in ('DC1', 'DC3') else ([INF, None] if end else None)
        refused = 'na' if (S['deactClass'] != 'DC4' or k['kill_issued'] is None) else [1 if k['kill_rejected'] is not None else 0, k['kill_rejected']]
        f = sc.get('fault')
        if not g['onboard'] or not f or not self.on:
            detect = 'na'
        else:
            detect = [g['detect_at'] - f['at_s'], g['detect_at']] if g['detect_at'] is not None else ([INF, None] if end else None)
        ftti_end = (f['at_s'] + S['faultTolerantTimeMs'] / 1000) if f else None
        if not f or not self.on:
            ftti = 'na'
        elif g['disabled_at'] is not None:
            ftti = [ftti_end - g['disabled_at'], g['disabled_at']]
        else:
            ftti = [-INF, None] if (end or self.t >= ftti_end) else None
        if g['disabled_at'] is None:
            recovery = 'na' if not self.expects_disable() else ([INF, None] if end else None)
        elif m['recovered_at'] is not None:
            recovery = [m['recovered_at'] - g['disabled_at'], m['recovered_at']]
        else:
            recovery = [INF, None] if end else None
        return dict(kill_latency=kill, deact_time=deact, remote_refused=refused, detect_latency=detect, ftti_margin=ftti,
                    misjudge=[m['mis_max'], m['mis_at']], danger_time=[m['danger'], m['danger_at']],
                    min_ttc=[None if m['min_ttc'] == INF else m['min_ttc'], m['min_ttc_at']],
                    max_decel=[k['max_decel'], k['max_decel_at']], recovery=recovery)

    def limits(self) -> dict:
        S = self.safety
        return dict(deact_time=r2((S['takeoverMs'] + S['rampMs']) / 1000 + 0.05),
                    detect_latency=r2((S['faultTolerantTimeMs'] - S['faultRampMs']) / 1000))

    def verdict(self) -> dict:
        val, lim, end = self._values(), self.limits(), self.done
        items = []
        for c0 in CRITERIA:
            c = {**c0, 'role': 'gate'}
            if c['id'] in lim:
                c['limit'] = lim[c['id']]
            v = val[c['id']]
            if v == 'na':
                items.append({**c, 'status': 'na', 'value': None, 'at': None})
                continue
            if v is None or v[0] is None:
                items.append({**c, 'status': 'pass' if (c['id'] == 'min_ttc' and end) else 'pending', 'value': None, 'at': None})
                continue
            ok = v[0] <= c['limit'] + 1e-9 if c['op'] == '<=' else v[0] >= c['limit'] - 1e-9
            status = ('pass' if (end or c['id'] in EVENT_CRITERIA) else 'pending') if ok else 'fail'
            value = r2(v[0]) if math.isfinite(v[0]) else None  # 무한(미반영·미복귀)은 JSON null — 상태가 fail을 말한다
            items.append({**c, 'status': status, 'value': value, 'at': r2(v[1])})
        overall = 'FAIL' if any(i['status'] == 'fail' for i in items) else ('PASS' if end else 'RUNNING')
        m = self.m
        return dict(overall=overall, criteria=items,
                    minTimeGap=None if m['min_tg'] == math.inf else r2(m['min_tg']), minTimeGapAt=r2(m['min_tg_at']))
