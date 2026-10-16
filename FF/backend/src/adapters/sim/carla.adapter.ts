// 가상검증 실행기 어댑터 (IF-09 가상검증 공급자) — FF 저장소의 CARLA 실행기(sim/carla/ffcarla_cli.py)를 LearnCarla venv의
// Python으로 돌려 판정·Evidence를 받는다. 실행기는 검증 전용 CARLA 서버(기본 127.0.0.1:2100, sim/carla/server.sh)에 붙는다.
// 비동기 실행 — 3종 70 s 시나리오는 실시간보다 빠르지만 수 초~수십 초 걸리므로 이벤트 루프를 막지 않는다. 서버 하나를 같이 쓰므로 한 번에 하나(대기열).
//   SIM_MODE=auto(기본) | off,  CARLA_PYTHON=<python.exe>,  CARLA_RUNNER=<ffcarla_cli.py | 시험 대역 .mjs>,
//   CARLA_HOST·CARLA_PORT(2100)·CARLA_HOME,  FF_EVIDENCE_DIR=<Evidence 저장 폴더>
import { Injectable } from '@nestjs/common';
import { SimCliOutput, type SimStatus } from '@ff/contracts';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** FF 저장소 루트 (backend/src/adapters/sim 또는 backend/dist/adapters/sim 기준) */
const FF_ROOT = resolve(__dirname, '..', '..', '..', '..');
const LEARN_CARLA = 'C:/project/2026-10-17_Carlra';
const PROBE_CACHE_MS = 5_000;

export interface SimRunResult {
  scenarioId: string | null;
  testId: string;
  overall: 'PASS' | 'FAIL' | 'RUNNING';
  criteria: { id: string; label: string; unit: string; op: string; limit: number; status: 'pass' | 'fail' | 'pending' | 'na'; value: number | null; at: number | null }[];
  minTimeGap: number | null;
  evaluation: { value: boolean; decision: string; reason: string } | null;
  /** 재현 정보(없으면 G5 근거 아님) */
  repro?: Record<string, unknown> | null;
  dir: string;
  files: { name: string; sha256: string; bytes: number }[];
}

export type SimRun = { ok: true; simulator: string; runs: SimRunResult[] } | { ok: false; error: string };

type Exec = { code: number | null; stdout: string; stderr: string; error?: Error };

@Injectable()
export class CarlaAdapter {
  private chain: Promise<unknown> = Promise.resolve();
  private running = 0;
  private waiting = 0;
  private probed: { at: number; value: SimStatus['server']; reason: string | null } | null = null;

  get mode(): 'auto' | 'off' {
    return process.env.SIM_MODE === 'off' ? 'off' : 'auto';
  }
  get runner(): string {
    return process.env.CARLA_RUNNER ?? join(FF_ROOT, 'sim', 'carla', 'ffcarla_cli.py');
  }
  get python(): string {
    return process.env.CARLA_PYTHON ?? `${LEARN_CARLA}/.venv/Scripts/python.exe`;
  }
  get host(): string {
    return process.env.CARLA_HOST ?? '127.0.0.1';
  }
  get port(): number {
    return Number(process.env.CARLA_PORT ?? 2100);
  }
  get evidenceDir(): string {
    return process.env.FF_EVIDENCE_DIR ?? join(FF_ROOT, '.evidence', 'carla');
  }
  /** 시험 대역(.mjs)은 Node로, 실제 실행기(.py)는 LearnCarla venv Python으로 */
  private get command(): [string, string[]] {
    return this.runner.endsWith('.mjs') ? [process.execPath, [this.runner]] : [this.python, [this.runner]];
  }
  /** 실행기를 돌릴 수 있는가(파일·인터프리터) — 서버 연결은 status()의 탐침이 따로 본다 */
  get installed(): string | null {
    if (this.mode === 'off') return 'SIM_MODE=off';
    if (!existsSync(this.runner)) return `실행기 없음: ${this.runner}`;
    if (!this.runner.endsWith('.mjs') && !existsSync(this.python)) return `CARLA Python 없음: ${this.python} (CARLA_PYTHON)`;
    return null;
  }

  private exec(args: string[], input: string, timeoutMs: number): Promise<Exec> {
    const [cmd, base] = this.command;
    return new Promise((done) => {
      const child = execFile(
        cmd,
        [...base, ...args],
        {
          cwd: FF_ROOT,
          timeout: timeoutMs,
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, CARLA_HOST: this.host, CARLA_PORT: String(this.port), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        },
        (error, stdout, stderr) => done({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, stdout: String(stdout), stderr: String(stderr), error: error && typeof error.code !== 'number' ? error : undefined }),
      );
      child.stdin?.end(input);
    });
  }

  /** stdout의 마지막 JSON 줄 */
  private lastJson(stdout: string): unknown {
    const line = stdout.trim().split(/\r?\n/).filter((l) => l.trim()).at(-1);
    if (!line) throw new Error('출력 없음');
    return JSON.parse(line);
  }

  async status(): Promise<SimStatus> {
    const base = { mode: this.mode, simulator: 'CARLA' as const, host: this.host, port: this.port, runner: this.runner, python: this.python, queue: { running: this.running, waiting: this.waiting } };
    const missing = this.installed;
    if (missing) return { ...base, available: false, server: null, reason: missing };
    if (!this.probed || Date.now() - this.probed.at > PROBE_CACHE_MS) {
      const r = await this.exec(['--probe'], '', 20_000);
      let value: SimStatus['server'] = null;
      let reason: string | null = null;
      try {
        const o = this.lastJson(r.stdout) as Record<string, unknown>;
        if (r.code === 0 && !o.error) value = { version: String(o.server), map: String(o.map), synchronous: !!o.synchronous, vehicles: Number(o.vehicles), foreignVehicles: Number(o.foreignVehicles) };
        else reason = `CARLA 검증 서버 ${this.host}:${this.port} 응답 없음 — npm run carla:up (${String(o.error ?? r.code)})`;
      } catch (e) {
        reason = `실행기 탐침 실패: ${r.error?.message ?? (e as Error).message}`;
      }
      if (value && value.foreignVehicles > 0) reason = `FF가 만들지 않은 차량 ${value.foreignVehicles}대 — 검증 전용 서버가 아닙니다(공유 서버 포트를 가리키고 있지 않은지 CARLA_PORT 확인)`;
      this.probed = { at: Date.now(), value, reason };
    }
    return { ...base, available: !this.probed.reason, server: this.probed.value, reason: this.probed.reason };
  }

  /** 패키지 실행 — 대기열에서 한 번에 하나. 성공하면 시나리오별 결과, 실패하면 사유 */
  run(pkg: { scenarios: unknown[] } & Record<string, unknown>): Promise<SimRun> {
    this.waiting++;
    const job = this.chain.then(async (): Promise<SimRun> => {
      this.waiting--;
      this.running++;
      try {
        return await this.runNow(pkg);
      } finally {
        this.running--;
        this.probed = null;
      }
    });
    this.chain = job.catch(() => undefined);
    return job;
  }

  private async runNow(pkg: { scenarios: unknown[] }): Promise<SimRun> {
    const missing = this.installed;
    if (missing) return { ok: false, error: missing };
    mkdirSync(this.evidenceDir, { recursive: true });
    const r = await this.exec(['--out', this.evidenceDir], JSON.stringify(pkg), 60_000 + pkg.scenarios.length * 120_000);
    if (r.error) return { ok: false, error: `가상검증 실행 실패: ${r.error.message}` };
    let out: unknown;
    try {
      out = this.lastJson(r.stdout);
    } catch (e) {
      return { ok: false, error: `가상검증 결과를 읽지 못했습니다 (종료 ${r.code}): ${(e as Error).message} ${r.stderr.trim().slice(-300)}` };
    }
    const err = (out as { error?: string }).error;
    if (r.code !== 0 || err) return { ok: false, error: `CARLA 실행기 종료 ${r.code}: ${err ?? r.stderr.trim().slice(-300)}` };
    // 출력 계약(contracts schemas/sim.ts) — 실행기가 형식·기준 ID를 바꾸면 조용히 잘못 읽지 않고 거부한다(Evidence 불인정)
    const parsed = SimCliOutput.safeParse(out);
    if (!parsed.success) {
      const where = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      return { ok: false, error: `가상검증 출력이 연계 계약과 다릅니다 — ${where}` };
    }
    return { ok: true, simulator: parsed.data.simulator, runs: parsed.data.runs as SimRunResult[] };
  }
}
