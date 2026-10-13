// FF ↔ vECU 연계 계약 — 두 저장소가 따로 바뀌어도 어긋남을 여기서 잡는다.
// ① 출력 계약: 시험 대역과 실제 vECU 실행기가 같은 스키마(contracts schemas/vecu.ts)와 FF가 쓰는 기준 ID를 낸다.
// ② 평가기 복사본: vECU js/vendor/ff_evaluate.js가 지금의 contracts flags/evaluate.ts와 같다(다르면 tools/build_ff_vendor.py 재실행).
// ③ 차량 요청 차등: vECU가 모의 플랫폼으로 답한 차량 요청을 같은 순서로 FF 실제 차량 채널(/vehicle/v1)에 재생해 결과를 대조한다.
// 실제 vECU가 없는 환경(CI)에서는 ①의 시험 대역만 돈다.
import { INestApplication } from '@nestjs/common';
import { VECU_REQUIRED_CRITERIA, VECU_REQUIRED_FILES, VecuCliOutput, VIRTUAL_SCENARIOS, grantState } from '@ff/contracts';
import { buildSync } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { FleetRepo, PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { FeatureRepo } from '../../src/domains/d01-policy/repos';
import { VecuAdapter } from '../../src/adapters/vecu/vecu.adapter';
import { bootApp } from '../helpers';

const FF = resolve(__dirname, '../../..');
const FAKE = resolve(__dirname, '../fixtures/fake-vecu');
const REAL = process.env.VECU_DIR_REAL ?? resolve(FF, '../../2026-10-11_vECU');
const HAS_REAL = existsSync(join(REAL, 'tools', 'ffval_cli.mjs'));
const FLAG = 'care_00022_param';
const VIN = 'ego-01';
const AT = '2026-10-12T01:00:00.000Z';

/** vECU 실행기를 FF와 같은 방식(stdin 패키지 → --out → stdout 한 줄)으로 부른다 */
function runCli(dir: string, pkg: unknown) {
  const out = mkdtempSync(join(tmpdir(), 'ff-vecu-contract-'));
  const r = spawnSync(process.execPath, [join(dir, 'tools', 'ffval_cli.mjs'), '--out', out], { input: JSON.stringify(pkg), cwd: dir, encoding: 'utf8', timeout: 60_000 });
  return { status: r.status, stderr: r.stderr, out, json: r.status === 0 ? JSON.parse(r.stdout.trim().split('\n').at(-1)!) : null };
}

describe('FF ↔ vECU 연계 계약', () => {
  let app: INestApplication;
  let http: () => any;
  const dirs: string[] = [];
  /** FF 메모리 앱의 실제 데이터로 만든 가상검증 패키지 (virtual-validation.service와 같은 모양) */
  let base: Record<string, any>;

  beforeAll(async () => {
    ({ app, http } = await bootApp());
    app.get(Clock).set(AT);
    const policy = app.get(PolicyRepo).deployed(FLAG)!;
    const feature = app.get(FeatureRepo).get(policy.featureId, policy.featureVersion)!;
    const grants = app.get(FleetRepo).grants(VIN).filter((g) => g.catalogId === policy.entitlementCatalogId);
    const states = grants.map((g) => grantState(g, AT.slice(0, 10)).state);
    base = {
      kind: 'ff-virtual-validation',
      policy: { ...policy, contentHash: 'sha256:contract-test' },
      scope: { country: feature.country, vehicleModel: feature.vehicleModel, trim: feature.trim },
      fleet: app.get(FleetRepo).vehicles(),
      vehicle: VIN,
      // 체험권 상태를 FF와 같게 맞춘다 — 차등 시험에서 TRIAL_ACCEPT 판정이 같은 출발점에서 비교되도록
      entitlementActive: states.includes('ACTIVE') || !policy.entitlementCatalogId,
      trial: states.includes('ACTIVE') ? 'ACTIVE' : states.includes('OFFERED') ? 'OFFERED' : 'NONE',
    };
  });
  afterAll(async () => {
    await app.close();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  const ffScenarios = () => VIRTUAL_SCENARIOS.filter((s) => s.featureId === 'FEAT-00022').map((s) => ({ scenarioId: s.scenarioId, ...s.params }));

  it('① 시험 대역(CI용)도 같은 출력 계약을 지킨다', () => {
    const r = runCli(FAKE, { ...base, scenarios: ffScenarios() });
    dirs.push(r.out);
    expect(r.status, r.stderr).toBe(0);
    const parsed = VecuCliOutput.safeParse(r.json);
    expect(parsed.success, JSON.stringify(!parsed.success && parsed.error.issues)).toBe(true);
  });

  it('① 계약에서 벗어난 출력은 FF 어댑터가 조용히 읽지 않고 거부한다 (증적 불인정)', () => {
    const prev = process.env.VECU_DIR;
    process.env.VECU_DIR = resolve(__dirname, '../fixtures/drifted-vecu');
    try {
      const r = app.get(VecuAdapter).run({ ...base, scenarios: ffScenarios() });
      expect(r.ok).toBe(false);
      expect('error' in r ? r.error : '').toMatch(/vECU 출력이 연계 계약과 다릅니다 — runs\.0\.criteria\.0\./);
    } finally {
      if (prev === undefined) delete process.env.VECU_DIR;
      else process.env.VECU_DIR = prev;
    }
  });

  describe.skipIf(!HAS_REAL)(`실제 vECU (${REAL})`, () => {
    it('① 실제 실행기 출력이 계약 스키마를 지키고, FF가 판정에 쓰는 기준 ID·증적 파일을 시나리오마다 모두 낸다', () => {
      const r = runCli(REAL, { ...base, scenarios: ffScenarios() });
      dirs.push(r.out);
      expect(r.status, r.stderr).toBe(0);
      const parsed = VecuCliOutput.safeParse(r.json);
      expect(parsed.success, JSON.stringify(!parsed.success && parsed.error.issues)).toBe(true);
      for (const run of parsed.success ? parsed.data.runs : []) {
        expect(VECU_REQUIRED_CRITERIA.filter((id) => !run.criteria.some((c) => c.id === id)), `${run.scenarioId} 기준 ID`).toEqual([]);
        expect(VECU_REQUIRED_FILES.filter((f) => !run.files.some((x) => x.name === f)), `${run.scenarioId} 증적`).toEqual([]);
        for (const f of run.files) expect(existsSync(join(run.dir, f.name)), f.name).toBe(true);
      }
    });

    it('② vECU의 평가기 복사본이 지금의 contracts flags/evaluate.ts와 같다 (다르면 vECU tools/build_ff_vendor.py)', () => {
      const now = buildSync({ entryPoints: [join(FF, 'contracts/src/flags/evaluate.ts')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false, logLevel: 'silent' }).outputFiles[0].text;
      const code = (s: string) => s.split('\n').filter((l) => !l.startsWith('//') && l.trim() !== '').join('\n');
      expect(code(readFileSync(join(REAL, 'js/vendor/ff_evaluate.js'), 'utf8'))).toBe(code(now));
    });

    it('③ 차량 요청 차등: vECU 샘플 VEHICLE-REQ를 FF 실제 차량 채널에 같은 순서로 재생하면 거부 코드·Flag 값·판정이 같다', async () => {
      const sample = JSON.parse(readFileSync(join(REAL, 'ff/FEAT-00022_sample.json'), 'utf8'));
      const test = sample.tests.find((t: { id: string }) => t.id === 'SCN-FEAT00022-VEHICLE-REQ');
      expect(test, 'vECU 샘플에 VEHICLE-REQ 시험이 있어야 한다').toBeDefined();
      // FF가 보내는 모양 — 판정 기준 역할(criteria)은 빼고, 요청 목록만 싣는다
      const { criteria: _c, ...scenario } = test.scenario;
      const r = runCli(REAL, { ...base, scenarios: [{ scenarioId: test.id, ...scenario }] });
      dirs.push(r.out);
      expect(r.status, r.stderr).toBe(0);
      const run = r.json.runs[0];
      const events = JSON.parse(readFileSync(join(run.dir, 'events.json'), 'utf8'));
      const list: { type: string; request?: any; response?: any }[] = Array.isArray(events) ? events : events.events;
      const asked = list.filter((e) => e.type === 'vehicle_request').map((e) => e.request);
      const answered = new Map(list.filter((e) => e.type === 'platform_response').map((e) => [e.response.id, e.response]));
      // 시나리오 요청(시각순, repeat 펼침)과 증적의 요청은 같은 순서다 — 값·오류 코드 같은 세부는 시나리오에서 읽는다
      const script = [...scenario.vehicle_requests].sort((a: any, b: any) => a.at_s - b.at_s).flatMap((q: any) => Array.from({ length: q.repeat ?? 1 }, () => q));
      expect(asked).toHaveLength(script.length);
      expect(answered.size, '모든 요청에 응답 (vECU CLI await 회귀)').toBe(asked.length);

      const rows: { id: string; type: string; vecu: string; ff: string }[] = [];
      for (const [i, q] of asked.entries()) {
        const src = script[i];
        const v = answered.get(q.id);
        const seq = { bootId: q.bootId, sequence: q.sequence, observedAt: AT };
        const send =
          q.type === 'FLAGS'
            ? http().post(`/vehicle/v1/${q.vin}/flags/${FLAG}`).set({ 'X-Vehicle-Id': VIN }).send({})
            : q.type === 'READBACK'
              ? null // FF 회신은 게시본 ID가 필요하다 — vECU는 관측값만 보낸다(아래 알려진 차이)
              : http()
                  .post(`/vehicle/v1/${q.vin}/reports`)
                  .set({ 'X-Vehicle-Id': VIN })
                  .send(
                    q.type === 'CONTEXT'
                      ? { type: 'CONTEXT', ...seq, set: q.set ?? {} }
                      : q.type === 'OVERRIDE'
                        ? { type: 'OVERRIDE', ...seq, flagKey: FLAG, value: src.value ?? true }
                        : q.type === 'TRIAL_ACCEPT'
                          ? { type: 'TRIAL_ACCEPT', ...seq, catalogId: base.policy.entitlementCatalogId }
                          : q.type === 'HELLO'
                            ? { type: 'HELLO', ...seq, highest: {} }
                            : { type: 'FAULT', ...seq, featureId: 'FEAT-00022', code: src.code ?? 'VECU_FAULT', severity: src.severity ?? 'WARNING' },
                  );
        if (!send) continue;
        const f = await send;
        const ffFlag = q.type === 'FLAGS' ? f.body : f.body.flags?.find((x: { key: string }) => x.key === FLAG);
        // vECU 응답의 reason은 플랫폼 사유(FlagResult.reason), FF는 OFREP 사유 + metadata.platformReason — 플랫폼 사유끼리 대조한다
        const vecuSaid = v.error ? `${v.status} ${v.error}` : `${v.value ? 'ON' : 'OFF'} ${v.metadata?.decision} ${v.reason}`;
        const ffSaid = f.status !== 200 ? `${f.status} ${f.body.error?.code}` : `${ffFlag?.value ? 'ON' : 'OFF'} ${ffFlag?.metadata?.decision} ${ffFlag?.metadata?.platformReason}`;
        rows.push({ id: q.id, type: q.type, vecu: vecuSaid, ff: ffSaid });
      }
      // 한 표로 비교해 어긋난 요청을 모두 보여 준다
      expect(rows.filter((x) => x.vecu !== x.ff)).toEqual([]);
      expect(rows.length).toBeGreaterThanOrEqual(5);
    });
  });
});
