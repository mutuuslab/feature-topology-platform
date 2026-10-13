// 기준정보·추적 조회 (P10-C4) — v0.81 데이터셋 그대로: ECU·SW·SW 구조·UPG-VC·제어점·Taxonomy·요구 추적·Evidence·변경 이력
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp } from '../helpers';

describe('기준정보·추적 조회', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' })));
  afterAll(() => app.close());

  it('ECU 15종·SW 47종 — SW는 탑재 ECU와 쓰는 Feature를 함께', async () => {
    expect((await http().get('/api/master/ecu').expect(200)).body.items).toHaveLength(15);
    const sw = (await http().get('/api/master/sw').expect(200)).body.items;
    expect(sw).toHaveLength(47);
    const app00022 = sw.find((s: any) => s.features.includes('FEAT-00022@1.0.0'));
    expect(app00022).toMatchObject({ swId: expect.any(String), ecuName: expect.any(String), supplier: expect.any(String) });
    expect((await http().get(`/api/master/sw?ecuPno=${app00022.ecuPno}`).expect(200)).body.items.every((s: any) => s.ecuPno === app00022.ecuPno)).toBe(true);
  });

  it('SW 구조 — ECU → SW → Function, 모든 Function이 한 번씩', async () => {
    const tree = (await http().get('/api/master/structure').expect(200)).body.items;
    const fns = tree.flatMap((e: any) => e.sw.flatMap((s: any) => s.functions));
    expect(fns.length).toBe(122);
  });

  it('UPG-VC — Feature가 지원하는 코드와 Fleet 차량 코드, 제어점은 BD-06 단일 묶음', async () => {
    const upg = (await http().get('/api/master/upg').expect(200)).body.items;
    expect(upg.find((u: any) => u.upgVc === 'F111A114001').vehicles).toContain('ego-01');
    const cps = (await http().get('/api/master/control-points').expect(200)).body.items;
    const f22 = cps.find((c: any) => c.featureId === 'FEAT-00022');
    expect(f22.policies.map((p: any) => p.flagKey).sort()).toEqual(['care_00022_param', 'care_00022_signal']);
    expect(f22.unbound).toEqual([]);
    expect(cps.every((c: any) => c.multiBound.length === 0)).toBe(true);
  });

  it('Taxonomy — 태그별 Feature, 범위별 수', async () => {
    const t = (await http().get('/api/master/taxonomy').expect(200)).body;
    expect(t.tags.find((x: any) => x.tag === 'adas').features.length).toBeGreaterThan(0);
    expect(t.scopes.reduce((n: number, s: any) => n + s.count, 0)).toBeGreaterThan(30);
  });

  it('요구·안전 추적 — FEAT-00022: 요구사항 → Function → SW → ECU, Gate 9개·Evidence, 안전 분류, REQUIRES 의존, Baseline·정책', async () => {
    const t = (await http().get('/api/trace/FEAT-00022/1.0.0').expect(200)).body;
    expect(t.requirements.length).toBeGreaterThan(0);
    expect(t.functions[0]).toMatchObject({ functionId: expect.stringMatching(/^FUNC-/), swId: expect.any(String), ecuName: expect.any(String) });
    expect(t.gates.map((g: any) => g.gate)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9']);
    expect(t.safety.fClass).toBe('F3');
    expect(t.dependencies.some((d: any) => d.type === 'REQUIRES' && d.target.startsWith('FEAT-00145'))).toBe(true);
    expect(t.baseline).toBe('BL-00028');
    await http().get('/api/trace/FEAT-09999/1.0.0').expect(404);
  });

  it('Evidence 원장 — 477건, Gate·결과로 거름 · 변경 이력(Version 변경 사유)', async () => {
    expect((await http().get('/api/evidence').expect(200)).body.items).toHaveLength(477);
    const g5 = (await http().get('/api/evidence?featureId=FEAT-00022&gate=G5').expect(200)).body.items;
    expect(g5).toHaveLength(1);
    const ch = (await http().get('/api/changes').expect(200)).body.items;
    expect(ch.length).toBeGreaterThan(10);
    expect(ch[0]).toMatchObject({ featureId: expect.stringMatching(/^FEAT-/), fromVersion: expect.any(String), toVersion: expect.any(String), rationale: expect.any(String) });
  });
});
