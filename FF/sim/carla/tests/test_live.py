"""검증 전용 CARLA 서버가 있을 때만 — 실제 물리로 3종을 돌려 판정·CS-01 수치·재현성·Evidence를 본다.
서버: bash sim/carla/server.sh up (기본 127.0.0.1:2100). 없으면 건너뛴다."""
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest

HOST, PORT = os.environ.get('CARLA_HOST', '127.0.0.1'), int(os.environ.get('CARLA_PORT', '2100'))
CLI = Path(__file__).resolve().parents[1] / 'ffcarla_cli.py'


def up() -> bool:
    try:
        socket.create_connection((HOST, PORT), 1).close()
        return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(not up(), reason=f'CARLA 검증 서버 {HOST}:{PORT} 없음')

FAULT = {'at_s': 17, 'ramp_s': 8, 'bias_max': 2.4}
PKG = {
    'policy': {'policyId': 'POL-00002', 'revision': 1, 'status': 'VALIDATED', 'featureId': 'FEAT-00022', 'featureVersion': '1.0.0', 'flagKey': 'care_00022_param'},
    'fleet': [{'vin': 'ego-01'}], 'vehicle': 'ego-01',
    'safety': {'deactClass': 'DC2', 'takeoverMs': 4000, 'rampMs': 3000, 'faultRampMs': 1500, 'faultTolerantTimeMs': 5000},
    'evaluation': {'value': True, 'decision': 'ALLOW', 'reason': 'POLICY_MATCH'},
    'scenarios': [
        {'scenarioId': 'SCN-FEAT00022-NOMINAL', 'duration_s': 70, 'lead_kph': 80, 'target_gap_m': 40, 'fault': None, 'kill': None, 'link_latency_ms': 300},
        {'scenarioId': 'SCN-FEAT00022-FAULT-ONBOARD', 'duration_s': 70, 'lead_kph': 80, 'target_gap_m': 40, 'fault': FAULT, 'kill': None,
         'onboard': {'rel_pct': 20, 'abs_m': 2.0, 'debounce_s': 0.2}, 'link_latency_ms': 300},
        {'scenarioId': 'SCN-FEAT00022-FAULT-REMOTE-DC2', 'duration_s': 70, 'lead_kph': 80, 'target_gap_m': 40, 'fault': FAULT, 'kill': {'at_s': 48},
         'onboard': None, 'link_latency_ms': 300},
    ],
}


def run(tmp: Path) -> dict:
    p = subprocess.run([sys.executable, str(CLI), '--out', str(tmp)], input=json.dumps(PKG).encode(), capture_output=True, timeout=600)
    lines = [x for x in p.stdout.decode('utf-8').splitlines() if x.strip()]
    assert p.returncode == 0 and len(lines) == 1, p.stderr.decode('utf-8', 'replace')[-2000:]
    out = json.loads(lines[0])
    return {r['scenarioId']: r for r in out['runs']}


@pytest.fixture(scope='module')
def runs(tmp_path_factory):
    return run(tmp_path_factory.mktemp('a')), run(tmp_path_factory.mktemp('b'))


def crit(r):
    return {c['id']: c for c in r['criteria']}


def test_nominal_passes(runs):
    r = runs[0]['SCN-FEAT00022-NOMINAL']
    assert r['overall'] == 'PASS'
    assert crit(r)['danger_time']['value'] == 0 and crit(r)['misjudge']['value'] == 0


def test_onboard_detection_matches_cs01(runs):
    """보고서 v1.1 CS-01: 감지 19.11 s · BASE_ONLY 20.61 s · FTTI 끝 22.00 s — 20 Hz 주기 안에서 같아야 한다."""
    r = runs[0]['SCN-FEAT00022-FAULT-ONBOARD']
    c = crit(r)
    assert r['overall'] == 'PASS'
    assert c['detect_latency']['at'] == pytest.approx(19.11, abs=0.3)
    assert c['ftti_margin']['at'] == pytest.approx(20.61, abs=0.3) and c['ftti_margin']['value'] >= 0
    assert c['max_decel']['status'] == 'pass'


def test_remote_only_baseline_fails_for_the_right_reasons(runs):
    c = crit(runs[0]['SCN-FEAT00022-FAULT-REMOTE-DC2'])
    assert c['kill_latency']['status'] == 'pass' and c['deact_time']['value'] == pytest.approx(7.0, abs=0.06)
    assert {k for k, v in c.items() if v['status'] == 'fail'} >= {'misjudge', 'danger_time', 'ftti_margin'}


def test_reproducible(runs):
    """같은 패키지 두 번 — 판정은 같고 값은 CARLA 물리 차이 안(±0.05 또는 1 %)."""
    a, b = runs
    for sid in a:
        assert a[sid]['overall'] == b[sid]['overall']
        for x, y in zip(a[sid]['criteria'], b[sid]['criteria']):
            assert x['status'] == y['status'], (sid, x['id'])
            if x['value'] is not None:
                assert y['value'] == pytest.approx(x['value'], abs=0.05, rel=0.01), (sid, x['id'])  # 큰 TTC(접근 거의 없음)는 상대 오차로
        assert a[sid]['repro']['scriptHash'] == b[sid]['repro']['scriptHash']
        assert a[sid]['repro']['scenarioHash'] == b[sid]['repro']['scenarioHash']


def test_evidence_files_and_recording(runs):
    r = runs[0]['SCN-FEAT00022-FAULT-ONBOARD']
    names = {f['name'] for f in r['files']}
    assert {'verdict.json', 'report.html', 'carla_recording.log', 'telemetry.jsonl', 'events.json'} <= names
    rec = next(f for f in r['files'] if f['name'] == 'carla_recording.log')
    assert rec['bytes'] > 100_000 and len(rec['sha256']) == 64
    assert Path(r['dir']).is_absolute()
