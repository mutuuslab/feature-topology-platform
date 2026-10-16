"""FF 가상검증 실행기 CLI — FF 백엔드(CarlaAdapter)가 부르는 이음매(IF-09 가상검증 공급자).

  python sim/carla/ffcarla_cli.py --out <dir>          패키지 JSON은 stdin
  python sim/carla/ffcarla_cli.py --probe              서버 상태 한 줄

패키지: {policy, scope?, fleet[], vehicle(VIN), safety, evaluation{value, decision, reason}, scenarios:[{scenarioId, ...}], seed?}
  evaluation은 FF가 자기 평가기(flags/evaluate.ts)로 계산해 넣는다 — 실행기에 평가기를 복제하지 않는다.
stdout 마지막 줄: {tool:'ff-carla', simulator, runs:[{scenarioId, testId, overall, criteria, minTimeGap, evaluation, repro, dir, files}]}
종료 코드: 0 실행 완료(판정과 무관) · 2 입력 오류 · 3 서버 연결 불가·전용 서버 아님 · 1 내부 오류.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import VERSION
from .report import report_html
from .run import ValidationRun

HERE = Path(__file__).resolve().parent
TOOL = 'ff-carla'
FEATURES = {'FEAT-00022'}  # 차량 측 런타임이 있는 Feature
REQUIRED = ('scenarioId', 'duration_s', 'lead_kph', 'target_gap_m', 'link_latency_ms')


class InputError(ValueError):
    pass


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def canon(x) -> bytes:
    return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def script_hash() -> str:
    """판정 코드 정체성 — 판정이 나온 Python 모듈 전부(재현 정보, 보고서 12.4.1)."""
    h = hashlib.sha256()
    for p in sorted(HERE.glob('*.py')):
        h.update(p.name.encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def load_package(raw: str) -> dict:
    try:
        pkg = json.loads(raw)
    except json.JSONDecodeError as e:
        raise InputError(f'패키지 JSON이 아닙니다: {e}') from e
    pol = pkg.get('policy') or {}
    if pol.get('featureId') not in FEATURES:
        raise InputError(f"{pol.get('featureId')}: 이 실행기에 차량 측 런타임이 없습니다")
    ev = pkg.get('evaluation')
    if not isinstance(ev, dict) or 'value' not in ev:
        raise InputError('evaluation(FF 정책 판단 결과)이 없습니다')
    scs = pkg.get('scenarios') or ([pkg['scenario']] if pkg.get('scenario') else [])
    if not scs:
        raise InputError('scenarios가 비었습니다')
    for s in scs:
        miss = [k for k in REQUIRED if k not in s]
        if miss:
            raise InputError(f"시나리오 {s.get('scenarioId')}: {', '.join(miss)} 없음")
    pkg['scenarios'] = scs
    return pkg


def run_package(pkg: dict, out: Path, world, simulator: str, server_version: str, clock=time.time) -> dict:
    W_TAU, W_ACCEL = getattr(world, 'TAU_S', 0.6), getattr(world, 'ACCEL_FILTER_S', 0.5)
    out = out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    pol, ev, safety, seed = pkg['policy'], pkg['evaluation'], pkg.get('safety') or {}, int(pkg.get('seed') or 0)
    vin = pkg.get('vehicle')
    vehicle = next((v for v in pkg.get('fleet') or [] if v.get('vin') == vin), {'vin': vin})
    runs = []
    for sc in pkg['scenarios']:
        base = datetime.fromtimestamp(clock(), tz=timezone.utc)
        stamp = base.strftime('%Y%m%d%H%M%S') + f'{base.microsecond // 1000:03d}'
        test_id = f"TEST-{pol.get('flagKey', 'flag')}-{sc['scenarioId']}-{stamp}"
        d = out / test_id
        d.mkdir(parents=True, exist_ok=False)
        iso = lambda t, b=base: (b + timedelta(seconds=t)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        run = ValidationRun(sc, safety, bool(ev.get('value')), iso=iso)
        rec = (d / 'carla_recording.log').resolve()  # 서버는 상대 경로를 자기 Saved 폴더 기준으로 쓴다
        info = world.drive(run, str(rec), seed)
        v = run.verdict()
        repro = dict(ffvalVersion=f'{VERSION} · CARLA {server_version} · {info["map"]}', simulator=simulator, serverVersion=server_version,
                     map=info['map'], stepS=info['stepS'], seed=seed, scenarioHash=sha256(canon(sc)), scriptHash=script_hash(),
                     safety=run.safety, clockBase=iso(0), routeStart=info['routeStart'], vehicles=dict(ego=info['egoBlueprint'], lead=info['leadBlueprint']),
                     replay=f"client.replay_file('{rec.name}', 0, 0, 0) — CARLA {server_version} {info['map']}")
        verdict = dict(testId=test_id, kind='FF virtual validation (CARLA)', overall=v['overall'], generatedAt=iso(run.t), internalOnly=True,
                       repro=repro, policy={k: pol.get(k) for k in ('policyId', 'revision', 'status', 'contentHash', 'featureId', 'featureVersion', 'flagKey')},
                       evaluation=ev, vehicle=vehicle, scenario=sc, start=info['start'], maxLateralDevM=info['maxLateralDevM'],
                       simulator=simulator, criteria=v['criteria'], minTimeGap=v['minTimeGap'], minTimeGapAt=v['minTimeGapAt'],
                       limitations=['독립 기준 측정은 CARLA 레이더(정지물 반사 제외) — 실차 센서 오차 모델이 아님',
                                    '차량 동역학은 CARLA 기본 차량 모델(Town04 고속도로) — 실차 제동·구동 특성과 다를 수 있음',
                                    f"자차 종방향은 기능 명령의 1차 지연(τ {W_TAU} s)을 PI로 추종, 감속은 {W_ACCEL} s 이동 평균",
                                    'CARLA 물리는 실행 간 0.01 수준의 값 차이가 있다 — 판정(통과·실패)은 같아야 재현으로 본다'])
        files = {
            'verdict.json': json.dumps(verdict, ensure_ascii=False, indent=1, allow_nan=False).encode('utf-8'),
            'events.json': json.dumps(run.events, ensure_ascii=False, indent=1, allow_nan=False).encode('utf-8'),
            'telemetry.jsonl': ('\n'.join(json.dumps(r, ensure_ascii=False, allow_nan=False) for r in run.tel) + '\n').encode('utf-8'),
            'policy.json': json.dumps(pol, ensure_ascii=False, indent=1).encode('utf-8'),
            'report.html': report_html(verdict, run.tel, run.events).encode('utf-8'),
        }
        for name, b in files.items():
            (d / name).write_bytes(b)
        listed = [dict(name=n, sha256=sha256((d / n).read_bytes()), bytes=(d / n).stat().st_size) for n in sorted([*files, rec.name]) if (d / n).exists()]
        runs.append(dict(scenarioId=sc['scenarioId'], testId=test_id, overall=v['overall'], criteria=v['criteria'], minTimeGap=v['minTimeGap'],
                         evaluation=dict(value=bool(ev.get('value')), decision=ev.get('decision', ''), reason=ev.get('reason', '')),
                         repro=repro, dir=str(d), files=listed))
    return dict(tool=TOOL, simulator=simulator, runs=runs)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog='ffcarla_cli')
    ap.add_argument('--out', help='Evidence 폴더')
    ap.add_argument('--package', help='패키지 JSON 파일 (없으면 stdin)')
    ap.add_argument('--probe', action='store_true', help='서버 상태만')
    a = ap.parse_args(argv)
    # stdout에는 결과 한 줄만 — carla 네이티브 라이브러리가 종료할 때 stdout에 'INFO: …'을 찍으므로 fd 1을 stderr로 돌리고
    # 결과는 원래 stdout으로 직접 쓴다(FF CarlaAdapter는 마지막 줄을 결과로 읽는다)
    real = os.dup(1)
    os.dup2(2, 1)
    sys.stdout = os.fdopen(os.dup(2), 'w', encoding='utf-8')

    def emit(obj) -> None:
        os.write(real, (json.dumps(obj, ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8'))

    return _main(a, emit)


def _main(a, emit) -> int:
    host, port = os.environ.get('CARLA_HOST', '127.0.0.1'), int(os.environ.get('CARLA_PORT', '2100'))
    try:
        from . import world as W  # carla 모듈 — 입력 검사는 그 전에 해도 되지만 연결 실패를 같은 코드로 알린다
    except ImportError as e:
        emit(dict(tool=TOOL, error=f'carla 모듈을 불러오지 못했습니다: {e}'))
        return 3
    if a.probe:
        try:
            c, _ = W.connect(host, port, 10.0)
            emit(dict(tool=TOOL, host=host, port=port, **W.probe(c)))
            return 0
        except RuntimeError as e:
            emit(dict(tool=TOOL, host=host, port=port, error=str(e)))
            return 3
    if not a.out:
        emit(dict(tool=TOOL, error='--out이 필요합니다'))
        return 2
    try:
        pkg = load_package(Path(a.package).read_text(encoding='utf-8') if a.package else sys.stdin.read())
    except InputError as e:
        emit(dict(tool=TOOL, error=str(e)))
        return 2
    need = max(s['duration_s'] * s['lead_kph'] / 3.6 + s['target_gap_m'] for s in pkg['scenarios']) + 150
    try:
        c, ver = W.connect(host, port, 60.0)
        world = W.World(c, need)
    except (RuntimeError, W.NotDedicated) as e:
        emit(dict(tool=TOOL, error=f'CARLA 서버 {host}:{port} — {e}'))
        return 3
    try:
        res = run_package(pkg, Path(a.out), world, f'CARLA {ver} ({W.MAP}, sync {round(1 / W.STEP_S)} Hz)', ver)
    except Exception as e:  # noqa: BLE001 — 실행기 내부 오류는 한 줄로 알리고 1
        emit(dict(tool=TOOL, error=f'{type(e).__name__}: {e}'))
        return 1
    finally:
        world.close()
    emit(res)
    return 0
