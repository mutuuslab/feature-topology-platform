"""Native Tauri lifecycle smoke. Requires development-only psutil; never uses CIM or global process kills."""
import argparse
import ctypes
import json
import pathlib
import subprocess
import time
import urllib.request
import uuid
import psutil

parser = argparse.ArgumentParser()
parser.add_argument('--pid', type=int, required=True)
parser.add_argument('--exe', required=True)
parser.add_argument('--timeout', type=int, default=180)
parser.add_argument('--retention-proof')
parser.add_argument('--retention-phase', choices=['create', 'verify'])
args = parser.parse_args()
root = psutil.Process(args.pid)
assert pathlib.Path(root.exe()).resolve() == pathlib.Path(args.exe).resolve(), 'Unexpected desktop owner'
created = root.create_time()
owned = {}
pg_data = None

def remember(process):
    owned[process.pid] = process.create_time()

def same(pid, started):
    try:
        process = psutil.Process(pid)
        return process if process.create_time() == started else None
    except psutil.NoSuchProcess:
        return None

def close_window():
    callback_type = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def visit(hwnd, unused):
        pid = ctypes.c_ulong()
        ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value == root.pid:
            ctypes.windll.user32.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE, only this launched Tauri process
        return True
    ctypes.windll.user32.EnumWindows(callback_type(visit), 0)

passed = False
try:
    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        if not same(root.pid, created):
            raise RuntimeError('Desktop exited before readiness')
        children = root.children(recursive=True)
        for child in children:
            try:
                remember(child)
                command = ' '.join(child.cmdline()).replace('\\', '/')
                if 'tools/unleash/runtime.mjs' in command:
                    pg_data = pathlib.Path(child.environ()['FF_RUNTIME_DATA']) / 'postgres-data'
                if 'backend/dist/main.js' not in command:
                    continue
                for connection in child.net_connections(kind='tcp'):
                    if connection.status != 'LISTEN' or connection.laddr.ip != '127.0.0.1':
                        continue
                    base = f'http://127.0.0.1:{connection.laddr.port}'
                    with urllib.request.urlopen(base + '/api/health', timeout=2) as response:
                        assert json.load(response)['status'] == 'ok'
                    with urllib.request.urlopen(base + '/api/unleash/status', timeout=2) as response:
                        status = json.load(response)
                    assert status['mode'] == 'live' and status['version'] == '8.3.1' and status['state'] == 'OK'
                    passed = True
            except (psutil.NoSuchProcess, psutil.AccessDenied, OSError):
                continue
        if pg_data:
            for process in psutil.process_iter(['name']):
                try:
                    if process.info['name'] != 'postgres.exe':
                        continue
                    command = process.cmdline()
                    if '-D' in command and pathlib.Path(command[command.index('-D') + 1]).resolve() == pg_data.resolve():
                        remember(process)
                        for child in process.children(recursive=True): remember(child)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
        if passed:
            break
        time.sleep(.25)
    assert passed, 'Desktop did not expose healthy FF + real Unleash before timeout'
    if args.retention_phase:
        assert args.retention_proof, 'Retention proof file is required'
        proof_file = pathlib.Path(args.retention_proof)
        if args.retention_phase == 'create':
            assert not proof_file.exists(), 'Do not overwrite an earlier retention proof'
            name = 'Native desktop retention ' + uuid.uuid4().hex[:12]
            body = json.dumps({'name': name, 'description': 'Isolated integrated desktop persistence proof', 'country': 'KR', 'vehicleModel': 'test', 'trim': 'test', 'ownerId': 'test', 'asil': 'QM', 'featureRefs': [{'refId': 'AD-ADS-004', 'role': 'PRIMARY'}]}).encode()
            request = urllib.request.Request(base + '/api/features', data=body, method='POST', headers={'Content-Type': 'application/json', 'X-Actor-Id': 'kim.author', 'X-Actor-Role': 'FEATURE_AUTHOR', 'Idempotency-Key': uuid.uuid4().hex})
            with urllib.request.urlopen(request, timeout=15) as response:
                assert response.status == 201
                feature_id = json.load(response)['featureId']
            proof_file.parent.mkdir(parents=True, exist_ok=True)
            proof_file.write_text(json.dumps({'featureId': feature_id, 'version': '0.1.0', 'name': name, 'initialApiPort': int(base.rsplit(':', 1)[1])}, indent=2), encoding='utf8')
            print('PASS: created isolated native desktop persistence record')
        else:
            proof = json.loads(proof_file.read_text(encoding='utf8'))
            with urllib.request.urlopen(base + f"/api/features/{proof['featureId']}/versions/{proof['version']}", timeout=15) as response:
                restored = json.load(response)
            feature = restored['feature']
            assert feature['featureId'] == proof['featureId'] and feature['version'] == proof['version']
            assert feature['name'] == proof['name'], 'Native restart lost or replaced the original record'
            proof['verifiedApiPort'] = int(base.rsplit(':', 1)[1])
            proof['retention'] = 'PASS'
            proof_file.write_text(json.dumps(proof, indent=2), encoding='utf8')
            print('PASS: native desktop restart preserved the exact original record')
finally:
    if same(root.pid, created):
        close_window()
        try: root.wait(40)
        except psutil.TimeoutExpired: root.terminate(); root.wait(10)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and any(same(pid, at) for pid, at in owned.items()): time.sleep(.1)
    remaining = [(pid, at) for pid, at in owned.items() if same(pid, at)]
    if remaining:
        # Verified cleanup only, followed by failure. Never mask orphaned sidecars as a passing test.
        for pid, at in remaining:
            process = same(pid, at)
            if process and process.name() == 'postgres.exe' and pg_data:
                command = process.cmdline()
                if '-D' in command and pathlib.Path(command[command.index('-D') + 1]).resolve() == pg_data.resolve():
                    subprocess.run([str(pathlib.Path(process.exe()).parent / 'pg_ctl.exe'), '-D', str(pg_data), '-m', 'fast', '-w', 'stop'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        for pid, at in remaining:
            process = same(pid, at)
            if process: process.terminate()
        raise RuntimeError('Desktop required verified forced cleanup after window exit')
print('PASS: native Tauri UI owner, FF + Unleash 8.3.1 live health, clean owned-sidecar shutdown')
