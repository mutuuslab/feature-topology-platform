// 가상검증 실행기 어댑터 (IF-09 가상검증 공급자) — FF 저장소의 CARLA 실행기(sim/carla/ffcarla_cli.py)를 CARLA 휠이 깔린
// Python(CARLA_PYTHON → harness/siblings.json의 LearnCarla venv → PATH의 python)으로 돌려 판정·Evidence를 받는다. 실행기는 검증 전용 CARLA 서버(기본 127.0.0.1:2100, sim/carla/server.sh)에 붙는다.
// 비동기 실행 — 3종 70 s 시나리오는 실시간보다 빠르지만 수 초~수십 초 걸리므로 이벤트 루프를 막지 않는다. 서버 하나를 같이 쓰므로 한 번에 하나(대기열).
//   SIM_MODE=auto(기본) | off,  CARLA_PYTHON=<python.exe>,  CARLA_RUNNER=<ffcarla_cli.py | 시험 대역 .mjs>,
//   CARLA_HOST·CARLA_PORT(2100)·CARLA_HOME,  FF_EVIDENCE_DIR=<Evidence 저장 폴더>
// 응답에는 로컬 절대 경로를 싣지 않는다 — 실행기·Python은 저장소 기준 상대 경로나 파일 이름, Evidence 폴더·재생 명령은 evidence/<시험 ID>(2026-11-06)
import { Injectable } from '@nestjs/common';
import { SimCliOutput, type SimStatus } from '@ff/contracts';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { isProduction } from '../../kernel/runtime-config';

/** FF 저장소 루트 (backend/src/adapters/sim 또는 backend/dist/adapters/sim 기준) */
const FF_ROOT = resolve(__dirname, '..', '..', '..', '..');
/** 응답의 Evidence 폴더 접두어 — Evidence 저장 폴더(FF_EVIDENCE_DIR) 기준 */
export const EVIDENCE_PREFIX = 'evidence';
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

/** 기본 Python — harness/siblings.json의 LearnCarla venv가 있으면 그것(저장소 기준 상대 위치), 없으면 PATH의 python */
function defaultPython(): string {
  try {
    const cfg = (JSON.parse(readFileSync(join(FF_ROOT, 'harness', 'siblings.json'), 'utf8')) as { carla?: { dir: string; env: string; python: string } }).carla;
    if (cfg) {
      const py = join(process.env[cfg.env] ?? resolve(FF_ROOT, cfg.dir), cfg.python);
      if (existsSync(py)) return py;
    }
  } catch {
    /* 패키지 설치본에는 harness가 없다 */
  }
  return 'python';
}

/** 화면에 보일 경로 — 저장소 안이면 상대 경로(/), 밖이면 파일 이름만, PATH 명령은 그대로 */
export function displayPath(path: string, root = FF_ROOT): string {
  if (!isAbsolute(path)) return path.replace(/\\/g, '/');
  const rel = relative(root, path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.replace(/\\/g, '/') : basename(path);
}

/** Evidence 폴더 안의 절대 경로 → evidence/<상대 경로>(/) — 실행기가 쓴 재생 명령 등 글자 안의 경로도 바꾼다 */
export function publicEvidencePath(text: string, root: string): string {
  const abs = resolve(root);
  const body = abs.split(/[\\/]+/).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]+');
  const lead = /^[\\/]/.test(abs) ? '[\\\\/]' : '';
  const re = new RegExp(`${lead}${body}((?:[\\\\/][^"'\\s]*)?)`, process.platform === 'win32' ? 'gi' : 'g');
  const tail = (_m: string, id: string, rest: string) => `${EVIDENCE_PREFIX}/${id}${rest.replace(/\\/g, '/')}`;
  return text
    .replace(re, (_m, rest: string) => EVIDENCE_PREFIX + rest.replace(/\\/g, '/'))
    .replace(OTHER_WIN, tail)
    .replace(OTHER_POSIX, tail);
}

// 지금 저장 폴더 밖의 Evidence 절대 경로(저장 폴더를 옮기기 전 기록·다른 실행의 임시 폴더) — 시험 ID 폴더(TEST-…)부터 evidence/…로.
// Windows(X:\… · UNC, 폴더 이름에 공백 허용)·POSIX(/…, URL·상대 경로 evidence/… 는 건드리지 않는다)
const OTHER_WIN = /(?<![A-Za-z0-9])(?:[A-Za-z]:|\\\\[^\\/:"'*?<>|\r\n]+)[\\/](?:[^\\/:"'*?<>|\r\n]+[\\/])*?(TEST-[^\\/"'\s<>]+)((?:[\\/][^"'\s<>]*)?)/g;
const OTHER_POSIX = /(?<![\w.~:/-])\/(?:[^/"'\s<>]+\/)+?(TEST-[^/"'\s<>]+)((?:\/[^"'\s<>]*)?)/g;

/** Evidence 파일 본문 — 이전 기록의 판정(JSON)·보고서(HTML) 안 절대 경로를 응답 규칙과 같게. 바뀐 것이 없으면 null(파일 그대로 보낸다) */
export function publicEvidenceText(name: string, text: string, root: string): string | null {
  if (/\.json$/i.test(name)) {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      return null;
    }
    const out = JSON.stringify(mapStrings(doc, (x) => publicEvidencePath(x, root)));
    return out === JSON.stringify(doc) ? null : out;
  }
  if (!/\.(html?|txt|csv|md|xml)$/i.test(name)) return null; // 기록(.log)·그림 등 바이너리는 그대로
  const out = publicEvidencePath(text, root);
  return out === text ? null : out;
}

/** 응답 값의 문자열에만 f를 적용한다(모양은 그대로) */
function mapStrings(v: unknown, f: (s: string) => string): unknown {
  if (typeof v === 'string') return f(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)]));
  return v;
}

@Injectable()
export class CarlaAdapter {
  private chain: Promise<unknown> = Promise.resolve();
  private running = 0;
  private waiting = 0;
  private probed: { at: number; value: SimStatus['server']; reason: string | null } | null = null;

  get mode(): 'auto' | 'off' {
    // 운영 모드는 명시하지 않으면 끈다(출시 준비 RD-OPS-12)
    return (process.env.SIM_MODE ?? (isProduction() ? 'off' : 'auto')) === 'off' ? 'off' : 'auto';
  }
  get runner(): string {
    return process.env.CARLA_RUNNER ?? join(FF_ROOT, 'sim', 'carla', 'ffcarla_cli.py');
  }
  get python(): string {
    return process.env.CARLA_PYTHON ?? defaultPython();
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
  /** 저장된 Evidence 폴더(evidence/... 또는 이전 기록의 절대 경로) → 실제 폴더 */
  evidencePath(dir: string): string {
    const p = dir.replace(/\\/g, '/');
    return p === EVIDENCE_PREFIX || p.startsWith(`${EVIDENCE_PREFIX}/`) ? resolve(this.evidenceDir, p.slice(EVIDENCE_PREFIX.length + 1)) : resolve(dir);
  }
  /** 응답용 — 실행 기록 안의 Evidence 절대 경로를 evidence/...로(이전 기록 포함) */
  publicRun<T>(run: T): T {
    const root = this.evidenceDir;
    return mapStrings(run, (x) => publicEvidencePath(x, root)) as T;
  }
  /** 응답용 Evidence 파일 본문 — 경로를 바꿀 것이 있는 글자 파일만(그 밖은 null: 파일 그대로) */
  publicEvidenceFile(path: string): string | null {
    if (!/\.(json|html?|txt|csv|md|xml)$/i.test(path)) return null;
    return publicEvidenceText(basename(path), readFileSync(path, 'utf8'), this.evidenceDir);
  }
  /** 시험 대역(.mjs)은 Node로, 실제 실행기(.py)는 CARLA Python으로 */
  private get command(): [string, string[]] {
    return this.runner.endsWith('.mjs') ? [process.execPath, [this.runner]] : [this.python, [this.runner]];
  }
  /** 실행기를 돌릴 수 있는가(파일·인터프리터) — 서버 연결은 status()의 탐침이 따로 본다 */
  get installed(): string | null {
    if (this.mode === 'off') return 'SIM_MODE=off';
    if (!existsSync(this.runner)) return `실행기 없음: ${displayPath(this.runner)}`;
    // PATH의 명령(python)은 실행해 봐야 안다 — 없으면 탐침이 실패 사유를 낸다
    if (!this.runner.endsWith('.mjs') && isAbsolute(this.python) && !existsSync(this.python)) return `CARLA Python 없음: ${displayPath(this.python)} (CARLA_PYTHON)`;
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
    const base = { mode: this.mode, simulator: 'CARLA' as const, host: this.host, port: this.port, runner: displayPath(this.runner), python: displayPath(this.python), queue: { running: this.running, waiting: this.waiting } };
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
        reason = `실행기 탐침 실패: ${(r.error?.message ?? (e as Error).message).split(this.python).join(displayPath(this.python)).split(this.runner).join(displayPath(this.runner))}`;
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
    // 기록·응답에는 Evidence 저장 폴더 기준 경로만(evidence/<시험 ID>) — 파일은 evidencePath로 되찾는다
    return { ok: true, simulator: parsed.data.simulator, runs: (parsed.data.runs as SimRunResult[]).map((x) => this.publicRun(x)) };
  }
}
