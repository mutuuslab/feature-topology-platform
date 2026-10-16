"""CLI 계약 시험 — 입력 오류·서버 없음은 종료 코드와 한 줄 JSON으로 알린다(stdout에는 그 한 줄만).
FF CarlaAdapter가 이 규칙에 기대어 UNAVAILABLE을 기록한다."""
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

CLI = Path(__file__).resolve().parents[1] / 'ffcarla_cli.py'
PKG = {
    'policy': {'policyId': 'POL-00002', 'revision': 1, 'featureId': 'FEAT-00022', 'featureVersion': '1.0.0', 'flagKey': 'care_00022_param'},
    'fleet': [{'vin': 'ego-01'}], 'vehicle': 'ego-01', 'evaluation': {'value': True, 'decision': 'ALLOW', 'reason': 'POLICY_MATCH'},
    'scenarios': [{'scenarioId': 'SCN-X', 'duration_s': 5, 'lead_kph': 80, 'target_gap_m': 40, 'fault': None, 'kill': None, 'link_latency_ms': 300}],
}


def free_port() -> int:
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def cli(stdin: str, *args, port: int | None = None):
    env = {**os.environ, 'CARLA_PORT': str(port or free_port())}
    p = subprocess.run([sys.executable, str(CLI), *args], input=stdin.encode('utf-8'), capture_output=True, env=env, timeout=120)
    lines = [x for x in p.stdout.decode('utf-8').splitlines() if x.strip()]
    assert len(lines) == 1, p.stdout
    return p.returncode, json.loads(lines[0])


def test_bad_json_is_input_error(tmp_path):
    code, out = cli('not json', '--out', str(tmp_path))
    assert code == 2 and out['tool'] == 'ff-carla' and 'JSON' in out['error']


def test_feature_without_runtime_is_input_error(tmp_path):
    pkg = {**PKG, 'policy': {**PKG['policy'], 'featureId': 'FEAT-00099'}}
    code, out = cli(json.dumps(pkg), '--out', str(tmp_path))
    assert code == 2 and 'FEAT-00099' in out['error']


def test_missing_evaluation_is_input_error(tmp_path):
    pkg = {k: v for k, v in PKG.items() if k != 'evaluation'}
    code, out = cli(json.dumps(pkg), '--out', str(tmp_path))
    assert code == 2 and 'evaluation' in out['error']


def test_no_server_is_exit_3(tmp_path):
    code, out = cli(json.dumps(PKG), '--out', str(tmp_path))
    assert code == 3 and 'CARLA 서버' in out['error']


def test_probe_without_server_is_exit_3():
    code, out = cli('', '--probe')
    assert code == 3 and 'error' in out
