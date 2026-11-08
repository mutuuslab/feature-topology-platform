// 26580 하네스 리뷰(2026-11-06) 회귀 — 구성 승인 막힘(D-26580-2), 자동 채움 이력·변이점이 최종 제어점을 따름, 사람이 고친 프로필 보존,
// 저장 없는 점검·구성기, 시드 등록의 자동 채움 이력. 고치기 전 실패를 확인한 시험이다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { PleRepo } from '../../src/domains/d01-policy/ple/ple.repo';
import { Scheduler } from '../../src/kernel/scheduler';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const P_AUTHOR = actor('park.product', 'PRODUCT_AUTHOR');
const P_APPROVER = actor('lee.product', 'PRODUCT_APPROVER');
const AT = '2026-11-06T01:00:00.000Z';
const CP_KINDS: Record<string, string> = { FLAG: 'Flag', PARAMETER: 'Parameter', SIGNAL: 'Signal', DTC: 'DTC' };

describe('26580 하네스 리뷰 — 회귀', () => {
  let app: INestApplication;
  let http: () => any;
  let repo: PleRepo;
  let db: Db;
  beforeAll(async () => {
    const b = await bootApp({ at: AT });
    ({ app, http } = b);
    repo = b.get(PleRepo);
    db = b.get<Db>(DB);
  });
  afterAll(() => app.close());

  /** 제어점 계획이 Flag 말고도 있는 기준 행 하나 */
  async function richRef(): Promise<{ refId: string; af: any }> {
    for (const refId of ['BC-SEAT-001', 'AD-LON-002', 'BC-SEAT-002', 'BC-SEAT-003', 'BC-SEAT-004', 'AD-LON-001', 'AD-LON-003']) {
      const r = await http().get(`/api/ple/autofill/${refId}`);
      if (r.status === 200 && (r.body.fields.find((x: any) => x.key === 'controlPoints')?.value ?? []).length > 1) return { refId, af: r.body };
    }
    throw new Error('제어점 계획이 둘 이상인 기준 행이 시드에 없습니다');
  }
  const body = (refId: string, af: any, o: Record<string, unknown> = {}) => {
    const f = Object.fromEntries(af.fields.map((x: any) => [x.key, x.value]));
    return { name: `${f.name} 회귀`, description: f.description, asil: f.asil, tags: f.tags, ...(f.regulations ? { refRegulations: f.regulations } : {}), controlPoints: f.controlPoints, country: 'KR', vehicleModel: 'PLE-HARD', trim: `T${Math.random().toString(36).slice(2, 7)}`, ownerId: f.owner ?? '바디상품기획팀', featureRefs: [{ refId, role: 'PRIMARY' }], ...o };
  };

  it('구성 승인은 카탈로그 제약 위반이 있으면 막힌다 — 상세 버튼 사유와 서버 거부가 같은 문장(D-26580-2)', async () => {
    // 시드 CAT-00018 구성은 기준 행 선행(REF_REQUIRES_MISSING)이 빠져 있다 — 같은 구성으로 새 상품을 만든다
    const src = (await http().get('/api/products/CAT-00018/versions/1.0.0').expect(200)).body.product;
    const bof = (await http().get('/api/ple/bill-of-features/CAT-00018/1.0.0').expect(200)).body;
    expect(bof.issues.some((i: any) => i.origin === 'CATALOGUE' && i.severity === 'FAIL')).toBe(true);
    const mk = async (from: any, name: string) =>
      (await http().post('/api/products').set(P_AUTHOR).send({ name, description: '26580 막힘 회귀', country: from.country, vehicleModel: from.vehicleModel, trim: from.trim, saleType: from.saleType, type: from.type, baselineIds: from.baselineIds, validFrom: from.validFrom, validTo: from.validTo, ownerId: from.ownerId }).expect(201)).body.product;
    const p = await mk(src, '26580 막힘 회귀 상품');
    const d = (await http().get(`/api/products/${p.catalogId}/versions/${p.version}`).expect(200)).body;
    const cfg = d.transitions.find((t: any) => t.to === 'APPROVED');
    const sentence = cfg.blockers.find((b: string) => b.startsWith('카탈로그 제약 위반'));
    expect(sentence).toBeTruthy();
    const r = await http().post(`/api/products/${p.catalogId}/versions/${p.version}/transitions`).set(P_APPROVER).send({ to: 'APPROVED', reason: '구성 확인' }).expect(422);
    expect(r.body.error.code).toBe('GUARD_FAILED');
    expect(r.body.error.details.code).toBe('CATALOGUE_CONSTRAINT');
    expect(r.body.error.message).toContain(sentence);
    expect(r.body.error.details.catalogue.length).toBeGreaterThan(0);
    // 위반이 없는 구성(CAT-00019, 경고만)은 그대로 승인된다
    const okSrc = (await http().get('/api/products/CAT-00019/versions/1.0.0').expect(200)).body.product;
    const ok = await mk(okSrc, '26580 통과 회귀 상품');
    const okD = (await http().get(`/api/products/${ok.catalogId}/versions/${ok.version}`).expect(200)).body;
    expect(okD.transitions.find((t: any) => t.to === 'APPROVED').blockers).toEqual([]);
    await http().post(`/api/products/${ok.catalogId}/versions/${ok.version}/transitions`).set(P_APPROVER).send({ to: 'APPROVED', reason: '구성 확인' }).expect(200);
  });

  it('제어점을 줄여 등록하면 이력은 제어점만 고침, 프로필은 그대로 — 저장된 변이점은 최종 제어점을 따른다', async () => {
    const { refId, af } = await richRef();
    const { variationPoints, ...profile } = af.variability;
    // 화면과 같이 — 고른 제어점(Flag만)의 변이점만 보낸다
    const vps = variationPoints.filter((v: any) => !CP_KINDS[v.assetKind] || v.assetKind === 'FLAG');
    const c = (await http().post('/api/features').set(AUTHOR).send(body(refId, af, { controlPoints: ['Flag'], variability: { ...profile, variationPoints: vps } })).expect(201)).body;
    const v = (await http().get(`/api/features/${c.featureId}/versions/0.1.0/variability`).expect(200)).body;
    const d = Object.fromEntries(v.history.map((h: any) => [h.field, h.decision]));
    expect(d.controlPoints).toBe('EDITED');
    expect(d.variability).toBe('ACCEPTED');
    expect(v.source).toBe('AUTO');
    // 프로필 없이 등록해도 저장된 변이점에 등록하지 않은 제어점이 없다
    const c2 = (await http().post('/api/features').set(AUTHOR).send(body(refId, af, { controlPoints: ['Flag'] })).expect(201)).body;
    const kinds = repo.variability(c2.featureId, '0.1.0')!.variability.variationPoints.map((x) => x.assetKind);
    expect(kinds.filter((k) => CP_KINDS[k] && CP_KINDS[k] !== 'Flag')).toEqual([]);
  });

  it('초안에서 제어점을 바꾸면 자동 프로필의 변이점이 따라가고, 사람이 고친 프로필 칸은 덮어쓰지 않는다', async () => {
    const { refId, af } = await richRef();
    const extra = (af.fields.find((x: any) => x.key === 'controlPoints').value as string[]).find((x) => x !== 'Flag')!;
    const c = (await http().post('/api/features').set(AUTHOR).send(body(refId, af, { controlPoints: ['Flag'] })).expect(201)).body;
    const path = `/api/features/${c.featureId}/versions/0.1.0`;
    await http().patch(path).set(AUTHOR).send({ controlPoints: ['Flag', extra] }).expect(200);
    const auto = repo.variability(c.featureId, '0.1.0')!;
    expect(auto.source).toBe('AUTO');
    expect(auto.variability.variationPoints.some((x) => CP_KINDS[x.assetKind] === extra)).toBe(true);
    // 사람이 변이성을 '다중 선택'으로 고친 뒤 제어점을 다시 줄이면 — 고친 칸은 그대로, 변이점만 제어점을 따른다
    await http().patch(path).set(AUTHOR).send({ variability: { ...auto.variability, variability: 'OR' } }).expect(200);
    await http().patch(path).set(AUTHOR).send({ controlPoints: ['Flag'] }).expect(200);
    const kept = repo.variability(c.featureId, '0.1.0')!;
    expect(kept.source).toBe('EDITED');
    expect(kept.variability.variability).toBe('OR');
    expect(kept.variability.variationPoints.some((x) => CP_KINDS[x.assetKind] === extra)).toBe(false);
    // 새 Version에서 제어점을 바꿔도 같은 규칙(사람이 고친 칸 유지)
    const nv = (await http().post(`/api/features/${c.featureId}/versions`).set(AUTHOR).send({ baseVersion: '0.1.0', reason: '제어점 변경 시험', changes: { controlPoints: ['Flag', extra] } }).expect(201)).body;
    const next = repo.variability(c.featureId, nv.feature.version)!;
    expect(next.variability.variability).toBe('OR');
    expect(next.variability.variationPoints.some((x) => CP_KINDS[x.assetKind] === extra)).toBe(true);
  });

  it('추천 입력 경계 — 공백·특수문자·아주 긴 입력·한/영 붙여 쓰기', async () => {
    for (const q of ['', '   ', '%%', "'; DROP TABLE x; --", '()[]{}*+?.\\', '😀😀']) {
      const r = await http().get('/api/ple/ref-suggestions?q=' + encodeURIComponent(q)).expect(200);
      expect(r.body.items).toEqual([]);
    }
    const long = 'SCC '.repeat(400);
    const l = (await http().get('/api/ple/ref-suggestions?q=' + encodeURIComponent(long)).expect(200)).body;
    expect(l.q.length).toBeLessThanOrEqual(500);
    expect(l.items[0].refId).toBe('AD-LON-002');
  });

  it('시드 등록(정의 승인 전)도 자동 채움 이력이 있다 — 등록 현황 자동 채움 칸이 비지 않는다', async () => {
    const reg = (await http().get('/api/ple/registrations').set(AUTHOR).expect(200)).body;
    const seeded = reg.items.filter((x: any) => x.primaryRef && !x.createdBy); // 시드 등록(등록자 기록 없음)
    expect(seeded.length).toBeGreaterThan(5);
    expect(seeded.every((x: any) => x.autofill && x.autofill.ACCEPTED + x.autofill.EDITED + x.autofill.ADDED > 0)).toBe(true);
    const one = seeded.find((x: any) => !x.mine)!;
    const v = (await http().get(`/api/features/${one.featureId}/versions/${one.version}/variability`).expect(200)).body;
    expect(v.history.length).toBeGreaterThan(5);
    // 시드 Feature는 등록자 기록이 없어 시드 계정으로(화면 '시스템(자동)'), 등록자가 있으면 그 사람
    expect(v.history.every((h: any) => h.actorId === (one.createdBy ?? 'system:ple-seed'))).toBe(true);
  });
});

// 저장 없는 점검 — 앞 시험의 쓰기(이벤트 전달 등)가 섞이지 않게 따로 띄운다
describe('26580 하네스 리뷰 — 저장 없는 조회·점검', () => {
  let app: INestApplication;
  let http: () => any;
  let db: Db;
  let scheduler: Scheduler;
  beforeAll(async () => {
    // 부팅 회신 타이머가 조회 사이에 기록하면 조회의 쓰기로 오인한다.
    // 실제 부팅 대상·회신 경로는 남겨두고 이 독립 앱의 시간 진행만 수동으로 고정한다.
    const previousMode = process.env.FF_SCHEDULER;
    process.env.FF_SCHEDULER = 'manual';
    try {
      const b = await bootApp({ at: AT });
      ({ app, http } = b);
      db = b.get<Db>(DB);
      scheduler = b.get(Scheduler);
    } finally {
      if (previousMode === undefined) delete process.env.FF_SCHEDULER;
      else process.env.FF_SCHEDULER = previousMode;
    }
  });
  afterAll(() => app.close());

  it('구성 점검·구성기·자동 채움·추천은 저장하지 않는다(모든 표의 행 수 그대로)', async () => {
    expect(scheduler.manual).toBe(true);
    const pending = scheduler.pending;
    expect(pending).toBeGreaterThan(0);
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((t) => t.name);
    const counts = () => Object.fromEntries(tables.map((t) => [t, db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`)!.n]));
    const p = (await http().get('/api/ple/bill-of-features').expect(200)).body.items[0];
    const prod = (await http().get(`/api/products/${p.catalogId}/versions/${p.version}`).expect(200)).body.product;
    const before = counts();
    await http().post('/api/ple/bill-of-features/check').set(P_AUTHOR).send({ country: prod.country, vehicleModel: prod.vehicleModel, trim: prod.trim, type: prod.type, baselineIds: prod.baselineIds }).expect(200);
    await http().get(`/api/ple/configure/${p.catalogId}/${p.version}`).expect(200);
    await http().get('/api/ple/autofill/BC-SEAT-001?name=x&country=KR&vehicleModel=NX4%20PE&trim=Premium').expect(200);
    await http().get('/api/ple/ref-suggestions?q=' + encodeURIComponent('시트 통풍')).expect(200);
    await http().get('/api/ple/catalogue').expect(200);
    const after = counts();
    expect(Object.keys(before).filter((t) => before[t] !== after[t]).map((t) => `${t} ${before[t]}→${after[t]}`)).toEqual([]);
    expect(scheduler.pending).toBe(pending);
  });

  it('격리한 부팅 회신은 스케줄러를 진행하면 실제로 기록된다', () => {
    const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM readback')!.n;
    expect(scheduler.flush()).toBeGreaterThan(0);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM readback')!.n).toBeGreaterThan(before);
  });

});
