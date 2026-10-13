// OpenFeature — 공식 SDK 적합성(OF-1·OF-4), 감사 Hook·OTel(OF-5), 차량 내장 provider(OF-6), 매니페스트·flagd(OF-7)와
// OpenFeature 경계(보고서 11장 FFG-OFT-001~007·FFG-PLT-011, TC-FF-51·52).
// OpenFeature로 평가하는 flag는 F0·F1(시드: IVI 내비 ivi_00024_guide, FEAT-00024 QM)뿐이다. F2 이상(FEAT-00022 care_00022_*)은
// 값을 계산하지 않고 Safe Default + DISABLED — 차량 동작 값은 서명 정책·차량 Safety Guard 경로(/vehicle/v1)로만 간다.
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { ErrorCode, OpenFeature, type Client } from '@openfeature/server-sdk';
import { OFREPProvider } from '@openfeature/ofrep-provider';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { vehiclePseudonym } from '../../src/kernel/crypto';
import { actor, bootApp, killV2 } from '../helpers';

const FLAG = 'ivi_00024_guide';
const F3_FLAG = 'care_00022_param';

describe('OpenFeature SDK ↔ FF OFREP', () => {
  let app: INestApplication;
  let http: () => any;
  let client: Client;
  beforeAll(async () => {
    process.env.GLEO_MODE = 'internal';
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    await OpenFeature.setProviderAndWait('ff', new OFREPProvider({ baseUrl: `http://127.0.0.1:${port}` }));
    client = OpenFeature.getClient('ff');
  });
  afterAll(async () => {
    await OpenFeature.close();
    await app.close();
    delete process.env.GLEO_MODE;
  });

  const spans = async () => (await http().get('/api/integrations/otel/spans?name=feature_flag.evaluation&limit=500').expect(200)).body.items as { attributes: Record<string, unknown> }[];

  describe('OF-1·OF-4 적합성 (F0·F1 flag)', () => {
    it('ego-01: ON · TARGETING_MATCH · flagMetadata에 정책·안전 등급·Feature Version·스냅샷 Version', async () => {
      const d = await client.getBooleanDetails(FLAG, false, { targetingKey: 'ego-01' });
      expect(d).toMatchObject({ value: true, variant: 'on', reason: 'TARGETING_MATCH' });
      expect(d.flagMetadata).toMatchObject({ policyId: 'POL-00003', decision: 'ALLOW', feature_version: '1.0.0', snapshot_version: expect.stringMatching(/^snap-[0-9a-f]{12}$/) });
      expect(['F0', 'F1']).toContain(d.flagMetadata.f_class);
    });

    it('적용 범위 밖(트림 Modern) → OFF · DEFAULT, 문맥 품질 불명(STALE) → UNKNOWN', async () => {
      expect(await client.getBooleanDetails(FLAG, false, { targetingKey: 'KMH-NX4-0101' })).toMatchObject({ value: false, reason: 'DEFAULT' });
      expect(await client.getBooleanDetails(FLAG, false, { targetingKey: 'KMH-NX4-0003' })).toMatchObject({ value: false, reason: 'UNKNOWN' });
    });

    it.each([
      ['없는 flag', 'nope_flag', { targetingKey: 'ego-01' }, ErrorCode.FLAG_NOT_FOUND],
      ['targetingKey 누락', FLAG, {}, ErrorCode.TARGETING_KEY_MISSING],
      ['미등록 차량', FLAG, { targetingKey: 'NOPE-1' }, ErrorCode.INVALID_CONTEXT],
    ])('%s → SDK는 앱이 넘긴 기본값(Safe Default)과 오류 코드', async (_n, key, ctx, code) => {
      expect(await client.getBooleanDetails(key, false, ctx)).toMatchObject({ value: false, reason: 'ERROR', errorCode: code });
    });

    it('targetingKey는 차량 가명도 받는다 — 같은 판단', async () => {
      expect((await client.getBooleanDetails(FLAG, false, { targetingKey: vehiclePseudonym('ego-01') })).value).toBe(true);
    });

    it('OF-4: SDK가 보낸 속성이 등록 정보와 다르면 등록 정보를 쓰고 무시한 속성을 알린다', async () => {
      const d = await client.getBooleanDetails(FLAG, false, { targetingKey: 'ego-01', country: 'US', vehicleTrim: 'Premium' });
      expect(d.value).toBe(true);
      expect(d.flagMetadata).toMatchObject({ contextSource: 'REGISTRY', ignoredContext: 'country' });
    });
  });

  describe('OpenFeature 경계 — TC-FF-51', () => {
    it('FFG-OFT-001·FFG-PLT-011: F2 이상 flag는 값을 계산하지 않고 Safe Default + DISABLED, decided_by=vehicle_safety_guard', async () => {
      const prof = (await http().get('/api/features/FEAT-00022/versions/1.0.0/safety').expect(200)).body;
      expect(['F2', 'F3', 'F4']).toContain(prof.profile?.fClass ?? prof.fClass);
      const d = await client.getBooleanDetails(F3_FLAG, false, { targetingKey: 'ego-01' });
      expect(d).toMatchObject({ value: false, reason: 'DISABLED' });
      expect(d.flagMetadata).toMatchObject({ decided_by: 'vehicle_safety_guard' });
      // 같은 차량의 Safety Guard 경로(서버 활성화 판단)는 원래대로 평가한다 — 체험 중이라 ON
      expect((await http().get(`/api/activation/decide?vin=ego-01&flagKey=${F3_FLAG}`).expect(200)).body.result.value).toBe(true);
    });

    it('FFG-OFT-005: OFREP bulk 응답에 F2 이상 키 0건', async () => {
      const r = await http().post('/ofrep/v1/evaluate/flags').send({ context: { targetingKey: 'ego-01' } }).expect(200);
      expect(r.body.flags.map((f: { key: string }) => f.key)).toEqual([FLAG]);
    });

    it('FFG-OFT-003: 위치·운전자 식별·연락처·동적 상태 문맥은 INVALID_CONTEXT, SDK는 기본값', async () => {
      for (const ctx of [{ latitude: 37.5 }, { driverId: 'D1' }, { phone: '010' }, { speed: 88 }]) {
        expect(await client.getBooleanDetails(FLAG, false, { targetingKey: 'ego-01', ...ctx })).toMatchObject({ value: false, reason: 'ERROR', errorCode: ErrorCode.INVALID_CONTEXT });
      }
    });

    it('FFG-OFT-004: 평가 수 = 감사 기록 수, 원본 VIN 없이 가명 subject·f_class·provider', async () => {
      const n0 = (await spans()).length;
      await client.getBooleanDetails(FLAG, false, { targetingKey: 'ego-01' });
      await client.getBooleanDetails(F3_FLAG, false, { targetingKey: 'ego-01' });
      await client.getBooleanDetails(FLAG, false, { targetingKey: 'ego-01', latitude: 1 });
      const all = await spans();
      expect(all.length - n0).toBe(3);
      const last = all.slice(0, 3);
      expect(last.every((s) => s.attributes['feature_flag.context.id'] === vehiclePseudonym('ego-01'))).toBe(true);
      expect(JSON.stringify(all)).not.toContain('ego-01');
      expect(last.map((s) => s.attributes['feature_flag.result.reason']).sort()).toEqual(['disabled', 'error', 'targeting_match']);
      expect(last.find((s) => s.attributes['error.type'])!.attributes['error.type']).toBe('invalid_context');
      expect(last.every((s) => s.attributes['feature_flag.provider.name'] === 'ffp-ofrep')).toBe(true);
    });
  });

  describe('flagd 내보내기·매니페스트 — TC-FF-52 · OF-7', () => {
    it('FFG-OFT-005·002: flagd에는 F0·F1만, defaultVariant=off, 내보낸 결과 검사 통과', async () => {
      const f = (await http().get('/api/openfeature/flagd').expect(200)).body;
      expect(Object.keys(f.flags)).toEqual([FLAG]);
      expect(f.flags[FLAG]).toMatchObject({ state: 'ENABLED', defaultVariant: 'off', variants: { on: true, off: false } });
      expect(f.excluded.map((x: { flagKey: string }) => x.flagKey).sort()).toEqual(['care_00022_param', 'care_00022_signal']);
      expect(f.check).toEqual({ leakedF2Keys: [], ok: true });
    });

    it('OF-7 매니페스트 — OpenFeature CLI 형식, 기본값 = Safe Default(false), 규율 위반 0건', async () => {
      const m = (await http().get('/api/openfeature/manifest').expect(200)).body;
      expect(m.flags).toEqual({ [FLAG]: { flagType: 'boolean', defaultValue: false, description: expect.any(String) } });
      expect(m.findings).toEqual([]);
    });

    it('범위 표 — OF-1~7과 경계, 범위 밖 항목, SDK Version 고정, 감사 기록 수', async () => {
      const s = (await http().get('/api/openfeature/scope').expect(200)).body;
      expect(s.items.filter((i: { status: string }) => i.status === 'done').map((i: { id: string }) => i.id)).toEqual(['OF-1', 'OF-2', 'OF-3', 'OF-4', 'OF-5', 'OF-6', 'OF-7', 'BOUNDARY']);
      expect(s.pins.sdks['@openfeature/server-sdk']).toBe('1.23.0');
      expect(s.catalog.find((c: { flagKey: string }) => c.flagKey === F3_FLAG)).toMatchObject({ openFeature: false });
      expect(s.audit.spans).toBeGreaterThan(0);
    });
  });

  describe('OF-6 차량 내장 provider (공식 server SDK Provider)', () => {
    // 부팅 동기화 게시본은 비동기로 차량에 닿는다 — IVI flag 묶음이 도착할 때까지 기다린다
    beforeAll(async () => {
      for (let i = 0; i < 50; i++) {
        const b = (await http().get('/api/vehicles/ego-01/runtime').expect(200)).body.runtime.bundles;
        if (b[FLAG]) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    it('ego-01 — F0·F1은 차량 묶음으로 로컬 평가(Guard와 같은 값), F2 이상은 기본값·DISABLED, 모두 일치', async () => {
      const r = (await http().get('/api/vehicles/ego-01/openfeature').expect(200)).body;
      expect(r).toMatchObject({ provider: 'ffp-vehicle-bundle', pseudonym: vehiclePseudonym('ego-01'), stale: false });
      const by = Object.fromEntries(r.items.map((i: any) => [i.flagKey, i]));
      expect(by[FLAG]).toMatchObject({ openFeature: true, sdk: { value: true, reason: 'TARGETING_MATCH' }, guard: { value: true }, agrees: true });
      expect(by[F3_FLAG]).toMatchObject({ openFeature: false, sdk: { value: false, reason: 'DISABLED' }, guard: { value: true }, agrees: true });
      expect(by[F3_FLAG].sdk.flagMetadata).toMatchObject({ decided_by: 'vehicle_safety_guard' });
    });

    it('통신 단절 차량(KMH-NX4-0003) — 받은 묶음이 늦을 수 있어 STALE (FFG-OFT-006)', async () => {
      const r = (await http().get('/api/vehicles/KMH-NX4-0003/openfeature').expect(200)).body;
      expect(r.stale).toBe(true);
      const ivi = r.items.find((i: any) => i.flagKey === FLAG);
      if (ivi) expect(ivi.sdk.reason).toBe('STALE');
    });
  });
  // 마지막 — 차단은 해제하지 않는다(FEAT-00024 안전 분류에 SBOM 참조가 없어 복원은 게이트 FFG-PLT-010이 막는다)
  describe('긴급 차단 (마지막)', () => {
    it('차단 중이면 DISABLED, 스냅샷 Version이 바뀐다 (FFG-OFT-006)', async () => {
      const before = (await client.getBooleanDetails(FLAG, false, { targetingKey: 'ego-01' })).flagMetadata.snapshot_version;
      await killV2(http, { featureId: 'FEAT-00024', featureVersion: '1.0.0', vins: ['ego-01'], reason: 'SDK 확인', confirm: 'FEAT-00024' }, actor('seo.ops', 'OPERATOR'));
      const killed = await client.getBooleanDetails(FLAG, true, { targetingKey: 'ego-01' });
      expect(killed).toMatchObject({ value: false, reason: 'DISABLED' });
      expect(killed.flagMetadata).toMatchObject({ platformReason: 'KILL_SWITCH' });
      expect(killed.flagMetadata.snapshot_version).not.toBe(before);
    });
  });
});
