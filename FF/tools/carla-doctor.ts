// CARLA 검증 서버 점검 (npm run carla:doctor) · 실행기 판정 핵심 시험 (npm run sim:test, verify `sim:test`).
//   node tools/carla-doctor.ts           검증 전용 서버(CARLA_PORT, 기본 2100)를 실행기 --probe로 보고 PASS/WARN/FAIL
//   node tools/carla-doctor.ts --pytest  서버 없는 pytest(sim/carla/tests, test_live 제외) — LearnCarla venv가 없으면 건너뛴다(CI)
// Python = CARLA_PYTHON 또는 harness/siblings.json carla(LearnCarla venv). 공유 서버 2000은 점검 대상으로도 받지 않는다.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FF, readJson } from './lib.ts';

export const SHARED_PORT = 2000;
export const EXPECTED_SERVER = '0.9.16';
export const EXPECTED_MAP = 'Town04';

export interface Probe {
  error?: string;
  server?: string;
  map?: string;
  synchronous?: boolean;
  vehicles?: number;
  foreignVehicles?: number;
}
export type Check = { status: 'PASS' | 'WARN' | 'FAIL'; note: string };

/** 탐침 결과 판정 — FAIL은 검증에 쓸 수 없음, WARN은 실행기가 스스로 정리·로드하는 상태 */
export function judge(p: Probe | null, port: number): Check[] {
  if (port === SHARED_PORT) return [{ status: 'FAIL', note: `포트 ${port}는 공유 서버(다른 클라이언트 교통·TM 8001) — 검증 전용 서버(2100)를 쓰세요` }];
  if (!p) return [{ status: 'FAIL', note: '실행기 탐침 출력을 읽지 못했습니다' }];
  if (p.error) return [{ status: 'FAIL', note: `서버 응답 없음 — npm run carla:up (${p.error})` }];
  const out: Check[] = [];
  out.push(p.server === EXPECTED_SERVER ? { status: 'PASS', note: `CARLA ${p.server}` } : { status: 'FAIL', note: `서버 ${p.server} — 실행기는 ${EXPECTED_SERVER} 휠로 시험됐습니다` });
  out.push((p.foreignVehicles ?? 0) === 0 ? { status: 'PASS', note: '전용 서버 (FF 외 차량 없음)' } : { status: 'FAIL', note: `FF가 만들지 않은 차량 ${p.foreignVehicles}대 — 공유 서버를 가리키고 있지 않은지 CARLA_PORT 확인` });
  out.push(p.map === EXPECTED_MAP ? { status: 'PASS', note: `맵 ${p.map}` } : { status: 'WARN', note: `맵 ${p.map} — 첫 실행 때 ${EXPECTED_MAP}를 불러옵니다(수십 초)` });
  if (p.synchronous) out.push({ status: 'WARN', note: '동기 모드로 남아 있음 — 이전 실행이 중단됐을 수 있습니다(다음 실행이 설정을 다시 씁니다)' });
  if ((p.vehicles ?? 0) > (p.foreignVehicles ?? 0)) out.push({ status: 'WARN', note: `이전 FF 실행의 차량 ${(p.vehicles ?? 0) - (p.foreignVehicles ?? 0)}대 — 다음 실행이 정리합니다` });
  return out;
}

export function pythonPath(): string {
  if (process.env.CARLA_PYTHON) return process.env.CARLA_PYTHON;
  const cfg = readJson<{ carla: { dir: string; env: string; python: string } }>(join(FF, 'harness', 'siblings.json')).carla;
  return join(process.env[cfg.env] ?? resolve(FF, cfg.dir), cfg.python);
}

if (import.meta.main ?? process.argv[1]?.endsWith('carla-doctor.ts')) {
  const py = pythonPath();
  if (process.argv.includes('--pytest')) {
    if (!existsSync(py)) {
      console.log(`sim:test · LearnCarla venv 없음 (${py}) — 건너뜀`);
      process.exit(0);
    }
    const r = spawnSync(py, ['-m', 'pytest', 'sim/carla/tests', '-q', '--ignore=sim/carla/tests/test_live.py', '-p', 'no:cacheprovider'], { cwd: FF, stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  const port = Number(process.env.CARLA_PORT ?? 2100);
  let probe: Probe | null = null;
  if (!existsSync(py)) probe = { error: `CARLA Python 없음: ${py} (CARLA_PYTHON)` };
  else if (port !== SHARED_PORT) {
    const r = spawnSync(py, [join(FF, 'sim', 'carla', 'ffcarla_cli.py'), '--probe'], { cwd: FF, encoding: 'utf8', timeout: 30_000, env: { ...process.env, CARLA_PORT: String(port) } });
    try {
      probe = JSON.parse(r.stdout.trim().split('\n').pop() ?? '');
    } catch {
      probe = null;
    }
  }
  const checks = judge(probe, port);
  console.log(`carla:doctor — ${process.env.CARLA_HOST ?? '127.0.0.1'}:${port}`);
  for (const c of checks) console.log(`  ${c.status === 'PASS' ? '✓' : c.status === 'WARN' ? '!' : '✕'} ${c.status} ${c.note}`);
  process.exit(checks.some((c) => c.status === 'FAIL') ? 1 : 0);
}
