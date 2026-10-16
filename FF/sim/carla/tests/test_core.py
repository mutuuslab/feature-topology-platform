"""서버 없이 도는 판정 핵심 시험 — 기능 런타임 golden 1:1, 타당성 감시, Guard 단계 시각, 기준 판정.
운동학 루프(60 Hz, 자차는 기능 명령을 1차 지연으로 따른다)로 이전 기준 시뮬레이터가 같은 시나리오에서 낸 판정
(tests/fixtures/reference_kinematic_verdicts.json)을 그대로 재현해야 한다 — 차량 동역학만 CARLA로 바꾸는 근거.
"""
import json
import math
from pathlib import Path

import pytest

from ffcarla.feature00022 import create_runtime, stage_of
from ffcarla.onboard import Plausibility
from ffcarla.run import ValidationRun

FIX = Path(__file__).parent / 'fixtures'
GOLDEN = json.loads((FIX / 'feat00022_golden.json').read_text(encoding='utf-8'))
REF = json.loads((FIX / 'reference_kinematic_verdicts.json').read_text(encoding='utf-8'))


def test_runtime_matches_golden_series():
    rt = create_runtime(GOLDEN['config'])  # 기본 초기 명령 22.0 m/s (원본과 같음)
    for r in GOLDEN['rows']:
        if r['guard']:
            rt.set_guard_state(r['t'], r['guard'])
        out = rt.step(r['t'], r['dt'], r['gap_true'], r['ego_mps'], r['lead_mps'])
        assert out['feature_state'] == r['state'], r['t']
        assert out['feature_weight'] == pytest.approx(r['weight'], abs=1e-3), r['t']
        assert out['gap_est'] == pytest.approx(r['gap_est'], abs=0.01), r['t']
        assert out['stage_feature'] == r['stage_feature'], r['t']
        assert out['stage_true'] == r['stage_true'], r['t']
        assert out['cmd_mps'] == pytest.approx(r['cmd_mps'], abs=1e-6), r['t']


def test_stage_thresholds():
    assert stage_of(40, 22.2) == '정상'
    assert stage_of(25, 22.2) == '주의'
    assert stage_of(16, 22.2) == '위험'


def test_plausibility_band_debounce_and_latch():
    p = Plausibility(dict(rel_pct=20, abs_m=2.0, debounce_s=0.2))
    assert not p.step(41.0, 40.0, 0.05)        # band 8 m 안
    for _ in range(3):
        assert not p.step(50.0, 40.0, 0.05)    # band 밖 0.15 s — 아직
    assert p.step(50.0, 40.0, 0.05)            # 0.2 s 연속 → 확정
    assert p.step(40.0, 40.0, 0.05)            # 확정 유지
    q = Plausibility()
    q.step(50.0, 40.0, 0.1)
    q.step(40.0, 40.0, 0.1)                    # 안으로 돌아오면 누적 초기화
    assert not q.step(50.0, 40.0, 0.1)
    assert not q.step(50.0, None, 0.1)         # 기준 측정 없음 = 판단 보류(누적 그대로)
    assert q.step(50.0, 40.0, 0.1)


def drive(scenario, safety=None, flag_on=True, dt=1 / 60):
    """이전 기준 시뮬레이터의 운동학 루프 — 선행차 정속, 자차 가속 = (명령 − 현재)/0.6 (−9..4 m/s²)."""
    run = ValidationRun(scenario, safety, flag_on)
    lead = scenario['lead_kph'] / 3.6
    ego, gap, a = lead, scenario['target_gap_m'], 0.0
    while not run.done:
        cmd = run.step(dt, gap, ego, lead, a, gap)  # 이상적 기준 측정 = 실제 간격
        a = max(-9.0, min(4.0, (cmd - ego) / 0.6))
        ego = max(0.0, ego + a * dt)
        gap += (lead - ego) * dt
    return run


@pytest.mark.parametrize('sid', sorted(REF['scenarios']))
def test_kinematic_loop_reproduces_reference_verdicts(sid):
    ref = REF['scenarios'][sid]
    v = drive(ref['scenario'], ref['safety']).verdict()
    assert v['overall'] == ref['overall']
    got = {c['id']: c for c in v['criteria']}
    for cid, exp in ref['criteria'].items():
        c = got[cid]
        assert c['status'] == exp['status'], cid
        assert c['limit'] == pytest.approx(exp['limit']), cid
        if exp['value'] is None:
            assert c['value'] is None, cid
        else:
            assert c['value'] == pytest.approx(exp['value'], abs=0.02), cid


def test_dc2_remote_stages_and_dc4_refusal():
    sc = dict(duration_s=60, lead_kph=80, target_gap_m=40, fault=None, kill={'at_s': 10}, link_latency_ms=300)
    run = drive(sc, dict(deactClass='DC2', takeoverMs=4000, rampMs=3000, faultRampMs=1500, faultTolerantTimeMs=5000), dt=0.05)
    ev = {e['type']: e for e in run.events}
    assert ev['deact_accepted']['latency_ms'] == 300
    assert run.g['accepted_at'] == pytest.approx(10.3, abs=0.051)
    assert run.g['disabled_at'] - run.g['accepted_at'] == pytest.approx(7.0, abs=0.051)   # 인계 4 s + 램프 3 s
    v = {c['id']: c for c in run.verdict()['criteria']}
    assert v['kill_latency']['status'] == 'pass' and v['deact_time']['status'] == 'pass'
    dc4 = drive(sc, dict(deactClass='DC4', takeoverMs=0, rampMs=0, faultRampMs=0, faultTolerantTimeMs=0), dt=0.05)
    v4 = {c['id']: c for c in dc4.verdict()['criteria']}
    assert v4['remote_refused']['status'] == 'pass' and v4['remote_refused']['value'] == 1
    assert dc4.rt.state == 'ACTIVE'                                                       # 상태 그대로


def test_flag_off_runs_base_behaviour_and_judges_na():
    sc = dict(duration_s=20, lead_kph=80, target_gap_m=40, fault=None, kill=None, link_latency_ms=300)
    run = drive(sc, flag_on=False)
    assert run.state == 'DISABLED'
    v = {c['id']: c for c in run.verdict()['criteria']}
    assert v['kill_latency']['status'] == 'na' and v['detect_latency']['status'] == 'na'


def test_unfinished_run_is_pending_not_pass():
    """fail-closed: 끝나지 않은 실행의 최댓값·누적 기준은 pending — FF judgeVirtual이 PASS로 받지 않는다."""
    sc = dict(duration_s=70, lead_kph=80, target_gap_m=40, fault=None, kill=None, link_latency_ms=300)
    run = ValidationRun(sc, None, True)
    for _ in range(10):
        run.step(0.05, 40.0, 22.2, 22.2, 0.0, 40.0)
    v = run.verdict()
    assert v['overall'] == 'RUNNING'
    assert {c['id']: c['status'] for c in v['criteria']}['danger_time'] == 'pending'


def test_infinite_values_serialise_as_null_with_fail():
    sc = dict(duration_s=30, lead_kph=80, target_gap_m=40, fault={'at_s': 5, 'ramp_s': 8, 'bias_max': 2.4}, kill=None,
              onboard={'rel_pct': 20, 'abs_m': 2.0, 'debounce_s': 0.2}, link_latency_ms=300)
    run = ValidationRun(sc, None, True)
    while not run.done:
        run.step(0.05, 40.0, 22.2, 22.2, 0.0, None)  # 기준 측정이 끝내 없으면 감지 못 함
    c = {x['id']: x for x in run.verdict()['criteria']}
    assert c['detect_latency']['status'] == 'fail' and c['detect_latency']['value'] is None
    assert c['ftti_margin']['status'] == 'fail'
    json.dumps(run.verdict(), allow_nan=False)  # NaN·Infinity가 JSON에 새지 않는다
    assert not any(isinstance(x['value'], float) and not math.isfinite(x['value']) for x in run.verdict()['criteria'])
