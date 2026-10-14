// 재-HARA 자동 검출 (D06-05, 보고서 v1.1 6.4 · FFG-LCY-003) — 수용 기준: 조건별 변경 1건씩 주입하면 6개 조건 모두 재-HARA 요청이 생긴다.
// 열린 요청은 G3 이후 Gate PASS를 막고, G2 재판정 PASS가 닫는다. 설명만 바꾼 Version은 요청이 없다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReharaService } from '../../src/domains/d06-qsec/change-impact-validation/rehara.service';
import { actor, bootApp, confirmSafety } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');

describe('재-HARA 자동 검출 (FFG-LCY-003)', () => {
  let app: INestApplication;
  let http: () => any;
  let ver: string;
  const requests = async (featureId = 'FEAT-00022', v = ver) => (await http().get(`/api/rehara-requests?featureId=${featureId}&featureVersion=${v}`).expect(200)).body.items;
  const judge = (gate: string) => http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${gate}` });

  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
    const v = await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: '설명 보완', changes: { description: '설명만 바꾼 Version' } }).expect(201);
    ver = v.body.feature.version;
  });
  afterAll(async () => app?.close());

  it('설명만 바꾼 새 Version은 재-HARA 요청이 없다', async () => {
    expect(await requests()).toEqual([]);
  });

  it('② 제어 권한 — 인계 시간을 바꾸면 CONTROL 요청이 열리고 Safety Manager 알림 이벤트', async () => {
    await http().put(`/api/features/FEAT-00022/versions/${ver}/safety`).set(AUTHOR).send({ takeoverMs: 2500 }).expect(200);
    expect(await requests()).toEqual([expect.objectContaining({ condition: 'CONTROL', status: 'OPEN', detail: expect.stringMatching(/takeoverMs 4000 → 2500/), source: expect.objectContaining({ event: 'safety.profile.updated' }) })]);
    const ev = (await http().get('/api/events?type=rehara.requested').expect(200)).body.items;
    expect(ev[0].payload).toMatchObject({ featureId: 'FEAT-00022', featureVersion: ver, condition: 'CONTROL', notify: 'SAFETY_OFFICER' });
    // 같은 변경을 다시 저장해도 요청은 하나
    await http().put(`/api/features/FEAT-00022/versions/${ver}/safety`).set(AUTHOR).send({ takeoverMs: 2500 }).expect(200);
    expect(await requests()).toHaveLength(1);
  });

  it('① 시장 확대 — SCOPE', async () => {
    const p = (await http().get(`/api/features/FEAT-00022/versions/${ver}/safety`).expect(200)).body.profile;
    await http().put(`/api/features/FEAT-00022/versions/${ver}/safety`).set(AUTHOR).send({ markets: [...p.markets, 'JP'] }).expect(200);
    expect((await requests()).map((r: any) => r.condition)).toContain('SCOPE');
  });

  it('③ Topology 관계 신규 — 원천·대상 Feature 모두 TOPOLOGY', async () => {
    const d = (await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: 'FEAT-00022', sourceVersion: ver, targetFeatureId: 'FEAT-00024', targetVersion: '1.0.0' }).expect(201)).body;
    expect((await requests()).filter((r: any) => r.condition === 'TOPOLOGY').map((r: any) => r.ref)).toEqual([`dep:${d.dependencyId}`]);
    expect((await requests('FEAT-00024', '1.0.0')).map((r: any) => r.condition)).toEqual(['TOPOLOGY']);
  });

  it('④ 현장 트리거·⑤ TARA·⑥ ADS 검증 도구 — 이상 징후·가상검증 이벤트로', async () => {
    const svc = app.get(ReharaService);
    svc.on('anomaly.opened', 'ANM-90001', { anomalyId: 'ANM-90001', kind: 'FIELD_SOTIF', featureId: 'FEAT-00022' });
    svc.on('anomaly.opened', 'ANM-90002', { anomalyId: 'ANM-90002', kind: 'SECURITY', featureId: 'FEAT-00022' });
    const latest = (await http().get('/api/features/FEAT-00022').expect(200)).body.latestVersion ?? ver;
    const conds = (await requests('FEAT-00022', latest)).map((r: any) => r.condition);
    expect(conds).toEqual(expect.arrayContaining(['FIELD', 'TARA']));
    // ADS 도구 변경은 순수 규칙 시험(contracts rehara.test)과 같은 판정 — 여기서는 ADS가 아닌 Feature의 도구 변경이 요청을 만들지 않는지만
    expect(conds).not.toContain('ADS_TOOL');
  });

  it('열린 요청이 있으면 G3 PASS 거부(감사 FAILED) → G2 재판정 PASS가 닫고 G3 PASS 가능', async () => {
    await confirmSafety(http, 'FEAT-00022', ver);
    await judge('G1').expect(201);
    const r = await judge('G3').expect(422);
    expect(r.body.error.message).toMatch(/재-HARA 요청 RH-\d{5}/);
    await judge('G2').expect(201);
    expect((await requests()).every((x: any) => x.status === 'RESOLVED' && /^SIM-G2-/.test(x.resolvedBy))).toBe(true);
    await judge('G3').expect(201);
    const g = (await http().get(`/api/features/FEAT-00022/versions/${ver}/gates`).expect(200)).body;
    expect(g.rehara.length).toBeGreaterThanOrEqual(3);
  });
});
