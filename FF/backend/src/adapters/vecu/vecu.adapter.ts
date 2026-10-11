// vECU 가상검증 어댑터 — C:\project\2026-10-11_vECU의 헤드리스 실행기(tools/ffval_cli.mjs)를 실행해 판정·증적을 받는다.
// 브라우저·포트 없이 Node 프로세스 하나(시나리오당 수십 ms). vECU가 없으면 'unavailable' — 증적으로 인정되지 않는 결과만 남긴다.
//   VECU_MODE=auto(기본: 있으면 실행) | off,  VECU_DIR=<vECU 폴더>,  FF_EVIDENCE_DIR=<증적 저장 폴더>
import { Injectable } from '@nestjs/common';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** FF 저장소 루트 (backend/src/adapters/vecu 또는 backend/dist/adapters/vecu 기준) */
const FF_ROOT = resolve(__dirname, '..', '..', '..', '..');

export interface VecuRunResult {
  scenarioId: string | null;
  testId: string;
  overall: 'PASS' | 'FAIL' | 'RUNNING';
  criteria: { id: string; label: string; unit: string; op: string; limit: number; status: 'pass' | 'fail' | 'pending' | 'na'; value: number | null; at: number | null }[];
  minTimeGap: number | null;
  evaluation: { value: boolean; decision: string; reason: string } | null;
  dir: string;
  files: { name: string; sha256: string; bytes: number }[];
}

@Injectable()
export class VecuAdapter {
  get mode(): 'auto' | 'off' {
    return process.env.VECU_MODE === 'off' ? 'off' : 'auto';
  }
  get dir(): string {
    return process.env.VECU_DIR ?? resolve(FF_ROOT, '..', '..', '2026-10-11_vECU');
  }
  get evidenceDir(): string {
    return process.env.FF_EVIDENCE_DIR ?? join(FF_ROOT, '.evidence', 'vecu');
  }
  private get cli() {
    return join(this.dir, 'tools', 'ffval_cli.mjs');
  }
  get available(): boolean {
    return this.mode !== 'off' && existsSync(this.cli);
  }

  status() {
    return {
      mode: this.mode,
      available: this.available,
      dir: this.dir,
      cli: this.available ? this.cli : null,
      /** 3D 실사 주행 화면(선택) — 판정 원천은 헤드리스 실행기 */
      simulatorUrl: 'http://localhost:8793/index.html',
      reason: this.mode === 'off' ? 'VECU_MODE=off' : this.available ? null : `실행기 없음: ${this.cli}`,
    };
  }

  /** 패키지 실행 — 성공하면 시나리오별 결과, 실패하면 사유 */
  run(pkg: unknown): { ok: true; simulator: string; runs: VecuRunResult[] } | { ok: false; error: string } {
    if (!this.available) return { ok: false, error: this.status().reason! };
    mkdirSync(this.evidenceDir, { recursive: true });
    const r = spawnSync(process.execPath, [this.cli, '--out', this.evidenceDir], { input: JSON.stringify(pkg), cwd: this.dir, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    if (r.error) return { ok: false, error: `vECU 실행 실패: ${r.error.message}` };
    if (r.status !== 0) return { ok: false, error: `vECU 실행기 종료 ${r.status}: ${(r.stderr || '').trim().slice(0, 300)}` };
    try {
      const out = JSON.parse(r.stdout.trim().split('\n').at(-1)!);
      return { ok: true, simulator: out.simulator, runs: out.runs };
    } catch (e) {
      return { ok: false, error: `vECU 결과를 읽지 못했습니다: ${(e as Error).message}` };
    }
  }
}
