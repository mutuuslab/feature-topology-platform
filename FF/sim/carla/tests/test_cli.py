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


def test_vehicle_not_in_fleet_is_input_error(tmp_path):
    code, out = cli(json.dumps({**PKG, 'vehicle': 'no-such-vin'}), '--out', str(tmp_path))
    assert code == 2 and 'no-such-vin' in out['error']


def test_no_server_is_exit_3(tmp_path):
    code, out = cli(json.dumps(PKG), '--out', str(tmp_path))
    assert code == 3 and 'CARLA 서버' in out['error']


# 회귀: 같은 검증 서버에 실행기 둘이 동시에 붙으면 서로의 세계를 건드려 판정이 조용히 틀렸다(FAULT-ONBOARD FAIL·종료 1).
# 이제 서버(host:port)마다 잠금을 잡고, 다른 실행이 쓰는 중이면 기다리다 시간이 넘으면 '사용 중'(종료 3)으로 알린다.
def test_busy_server_waits_then_reports_busy(tmp_path):
    port = free_port()
    holder = subprocess.Popen(
        [sys.executable, '-c',
         'import sys,time; sys.path.insert(0, sys.argv[1]); from ffcarla.lock import server_lock\n'
         'with server_lock("127.0.0.1", int(sys.argv[2]), 5):\n print("held", flush=True); time.sleep(30)',
         str(CLI.parent), str(port)],
        stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == 'held'
        env_timeout = os.environ.get('CARLA_LOCK_TIMEOUT_S')
        os.environ['CARLA_LOCK_TIMEOUT_S'] = '1'
        try:
            code, out = cli(json.dumps(PKG), '--out', str(tmp_path), port=port)
        finally:
            if env_timeout is None:
                os.environ.pop('CARLA_LOCK_TIMEOUT_S')
            else:
                os.environ['CARLA_LOCK_TIMEOUT_S'] = env_timeout
        assert code == 3 and '쓰는 중' in out['error'], out
    finally:
        holder.kill()
        holder.wait()


def test_probe_without_server_is_exit_3():
    code, out = cli('', '--probe')
    assert code == 3 and 'error' in out


def test_replay_missing_file_is_input_error(tmp_path):
    code, out = cli('', '--replay', str(tmp_path / 'nope.log'), '--info')
    assert code == 2 and '기록 파일이 없습니다' in out['error']


def test_recording_summary_reads_carla_0916_info():
    sys.path.insert(0, str(CLI.parent))
    from ffcarla.recorder import recording_summary
    info = 'Version: 2\nMap: Town04\nDate: 10/17/26 02:20:27\n\nFrame 1 at 0 seconds\n Create 24: spectator (0)\n\nFrames: 1400\nDuration: 69.95 seconds\n'
    assert recording_summary(info) == dict(format='2', map='Town04', frames=1400, durationS=69.95, readable=True)
    assert recording_summary('File not found')['readable'] is False
