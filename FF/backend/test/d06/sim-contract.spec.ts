// FF ↔ 가상검증 실행기(CARLA) 연계 계약 — 실행기(sim/carla)와 FF 어댑터가 따로 바뀌어도 어긋남을 여기서 잡는다.
// ① 출력 계약: 시험 대역과 실제 실행기가 같은 스키마(contracts schemas/sim.ts)·FF가 쓰는 기준 ID·Evidence 파일을 낸다.
// ② 계약에서 벗어난 출력은 어댑터가 조용히 읽지 않고 거부한다(Evidence 불인정).
// 실제 실행기 시험은 검증 전용 CARLA 서버(기본 2100)가 떠 있을 때만 돈다(npm run carla:up). 판단(evaluation)은 FF가 넣으므로
// 평가기 복사본·동등성 시험은 없다(실행기에 평가기를 두지 않는다).
import { INestApplication } from '@nestjs/common';
import { SIM_REQUIRED_CRITERIA, SIM_REQUIRED_FILES, SimCliOutput, VIRTUAL_SCENARIOS } from '@ff/contracts';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CarlaAdapter } from '../../src/adapters/sim/carla.adapter';
import { FleetRepo, PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { FeatureRepo } from '../../src/domains/d01-policy/repos';
import { bootApp } from '../helpers';

const FF = resolve(__dirname, '../../..');
const FAKE = resolve(__dirname, '../fixtures/fake-carla/ffcarla_cli.mjs');
const DRIFT = resolve(__dirname, '../fixtures/drifted-sim/ffcarla_cli.mjs');
const REAL = join(FF, 'sim', 'carla', 'ffcarla_cli.py');
const PYTHON = process.env.CARLA_PYTHON ?? 'C:/project/2026-10-17_Carlra/.venv/Scripts/python.exe';
const FLAG = 'care_00022_param';
const VIN = 'ego-01';

/** 검증 전용 서버가 떠 있는가 — 실행기 --probe(서버 없으면 1 s 안에 종료 3) */
function serverUp(): boolean {
  if (!existsSync(PYTHON)) return false;
  try {
    const o = JSON.parse(execFileSync(PYTHON, [REAL, '--probe'], { cwd: FF, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').at(-1)!);
    return !o.error && o.foreignVehicles === 0;
  } catch {
    return false;
  }
}

/** 실행기를 FF와 같은 방식(stdin 패키지 → --out → stdout 한 줄)으로 부른다 */
function runCli(cmd: [string, string], pkg: unknown, timeout = 60_000) {
  const out = mkdtempSync(join(tmpdir(), 'ff-sim-contract-'));
  const r = spawnSync(cmd[0], [cmd[1], '--out', out], { input: JSON.stringify(pkg), cwd: FF, encoding: 'utf8', timeout });
  const last = r.stdout?.trim().split('\n').at(-1);
  return { status: r.status, stderr: r.stderr, out, json: last ? JSON.parse(last) : null };
}

describe('FF ↔ 가상검증 실행기(CARLA) 연계 계약', () => {
  let app: INestApplication;
  const dirs: string[] = [];
  /** FF 메모리 앱의 실제 데이터로 만든 가상검증 패키지 (virtual-validation.service와 같은 모양) */
  let base: Record<string, any>;

  beforeAll(async () => {
    ({ app } = await bootApp());
    const policy = app.get(PolicyRepo).deployed(FLAG)!;
    const feature = app.get(FeatureRepo).get(policy.featureId, policy.featureVersion)!;
    base = {
      kind: 'ff-virtual-validation',
      policy: { ...policy, contentHash: 'sha256:contract-test' },
      scope: { country: feature.country, vehicleModel: feature.vehicleModel, trim: feature.trim },
      fleet: app.get(FleetRepo).vehicles(),
      vehicle: VIN,
      entitlementActive: true,
      evaluation: { value: true, decision: 'ALLOW', reason: 'POLICY_MATCH' },
      safety: { deactClass: 'DC2', takeoverMs: 4000, rampMs: 3000, faultRampMs: 1500, faultTolerantTimeMs: 5000 },
    };
  });
  afterAll(async () => {
    await app.close();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  const ffScenarios = () => VIRTUAL_SCENARIOS.filter((s) => s.featureId === 'FEAT-00022').map((s) => ({ scenarioId: s.scenarioId, ...s.params }));

  it('① 시험 대역(CI용)도 같은 출력 계약을 지킨다 — 필수 기준·Evidence 파일 포함', () => {
    const r = runCli([process.execPath, FAKE], { ...base, scenarios: ffScenarios() });
    dirs.push(r.out);
    expect(r.status, r.stderr).toBe(0);
    const parsed = SimCliOutput.safeParse(r.json);
    expect(parsed.success, JSON.stringify(!parsed.success && parsed.error.issues)).toBe(true);
    for (const run of parsed.data!.runs) {
      expect(run.criteria.map((c) => c.id)).toEqual(expect.arrayContaining([...SIM_REQUIRED_CRITERIA]));
      expect(run.files.map((f) => f.name)).toEqual(expect.arrayContaining([...SIM_REQUIRED_FILES]));
    }
  });

  it('② 계약에서 벗어난 출력은 FF 어댑터가 조용히 읽지 않고 거부한다 (Evidence 불인정)', async () => {
    const prev = process.env.CARLA_RUNNER;
    process.env.CARLA_RUNNER = DRIFT;
    try {
      const r = await app.get(CarlaAdapter).run({ ...base, scenarios: ffScenarios() });
      expect(r.ok).toBe(false);
      expect('error' in r ? r.error : '').toMatch(/가상검증 출력이 연계 계약과 다릅니다 — runs\.0\.criteria\.0\./);
    } finally {
      if (prev === undefined) delete process.env.CARLA_RUNNER;
      else process.env.CARLA_RUNNER = prev;
    }
  });

  it('② 입력 오류(패키지 차량이 fleet에 없음)는 실행기 오류로 돌려준다', async () => {
    const prev = process.env.CARLA_RUNNER;
    process.env.CARLA_RUNNER = FAKE;
    try {
      const r = await app.get(CarlaAdapter).run({ ...base, vehicle: 'no-such-vin', scenarios: ffScenarios() });
      expect(r.ok).toBe(false);
      expect('error' in r ? r.error : '').toMatch(/종료 2: vehicle no-such-vin/);
    } finally {
      if (prev === undefined) delete process.env.CARLA_RUNNER;
      else process.env.CARLA_RUNNER = prev;
    }
  });

  describe.skipIf(!serverUp())('실제 실행기 sim/carla (검증 전용 CARLA 서버)', () => {
    it('① 실제 실행기 출력이 계약 스키마를 지키고, FF가 판정에 쓰는 기준 ID·Evidence 파일·재현 정보를 시나리오마다 모두 낸다', () => {
      const r = runCli([PYTHON, REAL], { ...base, scenarios: ffScenarios() }, 300_000);
      dirs.push(r.out);
      expect(r.status, r.stderr.slice(-500)).toBe(0);
      const parsed = SimCliOutput.safeParse(r.json);
      expect(parsed.success, JSON.stringify(!parsed.success && parsed.error.issues)).toBe(true);
      expect(parsed.data!.runs.map((x) => x.scenarioId)).toEqual(ffScenarios().map((s) => s.scenarioId));
      for (const run of parsed.data!.runs) {
        expect(run.criteria.map((c) => c.id)).toEqual(expect.arrayContaining([...SIM_REQUIRED_CRITERIA]));
        expect(run.files.map((f) => f.name)).toEqual(expect.arrayContaining([...SIM_REQUIRED_FILES]));
        expect(run.repro).toMatchObject({ toolVersion: expect.stringMatching(/^ff-carla /), scenarioHash: expect.stringMatching(/^[0-9a-f]{64}$/), scriptHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
        expect(run.evaluation).toEqual(base.evaluation); // FF가 넣은 판단을 그대로 싣는다
      }
    }, 300_000);

    it('② 입력 오류는 종료 2 + error 한 줄', () => {
      const r = runCli([PYTHON, REAL], { ...base, vehicle: 'no-such-vin', scenarios: ffScenarios() });
      dirs.push(r.out);
      expect(r.status).toBe(2);
      expect(r.json).toMatchObject({ tool: 'ff-carla', error: expect.any(String) });
    });
  });
});
