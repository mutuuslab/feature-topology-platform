// Feature 등록 ↔ Feature DB 기준 기능 연결(30-95 §5.3·§6.2·§6.3·§6.4·§5.4, D-REF-2·3·4·6·7)
//   연결 필수(400 REFDB_LINK_REQUIRED) · 없는 행·폐기 행 거부 · 요청 중·검토 필요·폐기 예정은 경고와 함께 등록 · 대표 ASIL 차이는 사유 필수
//   같은 범위 같은 대표 행 409(확인·사유면 허용) · 연결 색인(feature_ref_link)·refVersion · 초안 수정·새 Version의 연결
//   요청 중·폐기 행이면 정의 승인(PROPOSED→APPROVED) 막힘 · 추가 요청은 정식 ID를 바로 부여(다시 쓰지 않음) · 선행 기준 행 경고
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RefdbRepository } from '../../src/domains/d01-policy/refdb/refdb.repository';
import { FeatureRepo } from '../../src/domains/d01-policy/repos';
import { actor, bootApp, confirmSafety, nextRefId } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const AT = '2026-11-04T01:00:00.000Z';

describe('Feature 등록 — Feature DB 기준 기능 연결', () => {
  let app: INestApplication;
  let http: () => any;
  let repo: RefdbRepository;
  let features: FeatureRepo;
  beforeAll(async () => {
    const b = await bootApp({ at: AT });
    ({ app, http } = b);
    repo = b.get(RefdbRepository);
    features = b.get(FeatureRepo);
  });
  afterAll(() => app.close());

  // 시험마다 다른 차종 — 같은 범위 중복·선행 판정이 시험끼리 섞이지 않게
  let n = 0;
  const body = (patch: Record<string, unknown> = {}) => ({
    name: `기준 연결 시험 ${++n}`,
    description: '기준 기능 연결 시험',
    requirementIds: ['REQ-REF-1'],
    country: 'KR',
    vehicleModel: `RDB-${n}`,
    trim: 'Base',
    ownerId: 'ADAS상품기획팀',
    asil: 'QM',
    upgVc: ['F111A114001'],
    controlPoints: ['Flag'],
    ...patch,
  });
  const primary = (refId: string, ...included: string[]) => [{ refId, role: 'PRIMARY' }, ...included.map((r) => ({ refId: r, role: 'INCLUDED' }))];
  const create = (b: Record<string, unknown>) => http().post('/api/features').set(AUTHOR).send(b);
  const auditOf = async (target: string, action = 'FEATURE_CREATE') => (await http().get(`/api/audit?target=${encodeURIComponent(target)}`).expect(200)).body.items.find((a: any) => a.action === action);
  const setStatus = (refId: string, status: 'RETIRED' | 'PENDING' | 'ACTIVE') => repo.updateRef({ ...repo.getRef(refId)!, status }, AT);

  describe('연결 필수(400 REFDB_LINK_REQUIRED)', () => {
    it('featureRefs가 없거나 비었거나 대표(PRIMARY)가 없으면 400 REFDB_LINK_REQUIRED, 거부 감사', async () => {
      const b = body();
      for (const featureRefs of [undefined, [], [{ refId: nextRefId(), role: 'INCLUDED' }]]) {
        const r = await create({ ...b, ...(featureRefs ? { featureRefs } : {}) }).expect(400);
        expect(r.body.error.code).toBe('REFDB_LINK_REQUIRED');
      }
      const failed = (await http().get(`/api/audit?result=FAILED`).expect(200)).body.items;
      expect(failed.some((a: any) => a.action === 'FEATURE_CREATE' && a.target === b.name)).toBe(false); // 본문 검증 단계 거부는 서비스에 닿지 않는다
    });

    it('대표가 둘이거나 같은 행을 두 번 연결하면 400', async () => {
      const [a, c] = [nextRefId(), nextRefId()];
      expect((await create({ ...body(), featureRefs: [{ refId: a, role: 'PRIMARY' }, { refId: c, role: 'PRIMARY' }] }).expect(400)).body.error.code).toBe('VALIDATION');
      expect((await create({ ...body(), featureRefs: primary(a, a) }).expect(400)).body.error.code).toBe('VALIDATION');
    });

    it('Feature DB에 없는 기준 행 ID는 400', async () => {
      const r = await create({ ...body(), featureRefs: primary('CH-BRK-999') }).expect(400);
      expect(r.body.error).toMatchObject({ code: 'VALIDATION', details: { field: 'featureRefs', refIds: ['CH-BRK-999'] } });
    });

    it('대표·포함 행이 폐기(RETIRED)면 400 — 거부 감사', async () => {
      const retired = nextRefId();
      setStatus(retired, 'RETIRED');
      const b = body({ featureRefs: primary(retired) });
      const r = await create(b).expect(400);
      expect(r.body.error.message).toContain('폐기');
      expect((await create({ ...body(), featureRefs: primary(nextRefId(), retired) }).expect(400)).body.error.details.refIds).toEqual([retired]);
      const failed = (await http().get(`/api/audit?result=FAILED`).expect(200)).body.items;
      expect(failed.some((a: any) => a.action === 'FEATURE_CREATE' && a.target === b.name)).toBe(true);
    });

    it('현행 이름 유사 거부(409 CONFLICT)는 그대로', async () => {
      const r = await create(body({ name: '전방 안전거리 3단계', vehicleModel: 'NX4 PE', trim: 'Premium', asil: 'B', featureRefs: primary(nextRefId('B')) })).expect(409);
      expect(r.body.error.code).toBe('CONFLICT');
    });
  });

  describe('저장·경고·미리 채움', () => {
    it('대표 1 + 포함 N 연결을 doc.featureRefs와 연결 색인에 같이 저장한다 — refVersion은 지금 발행 버전', async () => {
      const [p, i] = [nextRefId(), nextRefId()];
      const r = await create(body({ featureRefs: [{ refId: i, role: 'INCLUDED' }, { refId: p, role: 'PRIMARY' }] })).expect(201);
      const release = repo.latestRelease()!.release;
      expect(release).toBe('v1.3');
      expect(r.body.featureRefs).toEqual([
        { refId: p, role: 'PRIMARY', refVersion: release },
        { refId: i, role: 'INCLUDED', refVersion: release },
      ]);
      expect(r.body.warnings).toEqual([]);
      expect(repo.linksOf(r.body.featureId, '0.1.0')).toEqual(r.body.featureRefs);
      expect(repo.usersOf(p).map((u) => u.featureId)).toEqual([r.body.featureId]);
      const detail = (await http().get(`/api/features/${r.body.featureId}/versions/0.1.0`).expect(200)).body.feature;
      expect(detail.featureRefs).toEqual(r.body.featureRefs);
    });

    it('검토 필요(REVIEW)·폐기 예정(DEPRECATED)·요청 중(PENDING) 행은 등록하되 응답 warnings와 감사에 남긴다', async () => {
      const pending = nextRefId();
      setStatus(pending, 'PENDING');
      // AD-ADS-030 검토 필요(QM, 선행 AD-LAT-004) · PL-CP-023 폐기 예정(B)
      const r = await create(body({ featureRefs: primary('AD-ADS-030', 'PL-CP-023', pending) })).expect(201);
      const status = r.body.warnings.filter((w: any) => w.code === 'REF_STATUS').map((w: any) => [w.refId, w.status]);
      expect(status).toEqual([
        ['AD-ADS-030', 'REVIEW'],
        ['PL-CP-023', 'DEPRECATED'],
        [pending, 'PENDING'],
      ]);
      const audit = await auditOf(`${r.body.featureId}@0.1.0`);
      expect(audit.after.refWarnings.map((w: any) => w.refId)).toEqual(expect.arrayContaining(['AD-ADS-030', 'PL-CP-023', pending]));
    });

    it('ASIL이 대표 행의 대표 ASIL과 다르면 사유 필수(400) — 사유가 있으면 저장하고 G2 검토 표시', async () => {
      const ref = nextRefId('B');
      const b = body({ asil: 'C', featureRefs: primary(ref) });
      const r = await create(b).expect(400);
      expect(r.body.error.details).toMatchObject({ field: 'asilDeviation', from: 'B', to: 'C' });
      // from/to가 대표 행과 맞지 않으면 다시 400
      await create({ ...b, asilDeviation: { from: 'QM', to: 'C', reason: '고속 영역 확장' } }).expect(400);
      const ok = await create({ ...b, asilDeviation: { from: 'B', to: 'C', reason: '고속 영역까지 확장해 HARA 재평가' } }).expect(201);
      expect(ok.body.asilDeviation).toEqual({ from: 'B', to: 'C', reason: '고속 영역까지 확장해 HARA 재평가' });
      expect((await auditOf(`${ok.body.featureId}@0.1.0`)).after.asilDeviationReview).toBe('G2');
      // 같은 ASIL이면 사유는 남기지 않는다
      const same = await create(body({ asil: 'B', featureRefs: primary(nextRefId('B')), asilDeviation: { from: 'B', to: 'B', reason: '같음' } })).expect(201);
      expect(same.body.asilDeviation).toBeUndefined();
    });

    it('규제·표준 조항은 refRegulations로 따로 보존 — 주지 않으면 대표 행에서 미리 채운다(요구사항 ID와 섞지 않음)', async () => {
      const ref = nextRefId();
      const given = await create(body({ featureRefs: primary(ref), refRegulations: ['UN R79 5.1.6'] })).expect(201);
      expect(given.body.refRegulations).toEqual(['UN R79 5.1.6']);
      expect(given.body.requirementIds).toEqual(['REQ-REF-1']);
      const row = repo.getRef('AD-ADS-030')!;
      const filled = await create(body({ featureRefs: primary('AD-ADS-030') })).expect(201);
      expect(filled.body.refRegulations).toEqual([row.definition?.regulations, row.sourceDetail].filter((s) => s?.trim()));
      expect(filled.body.refRegulations.length).toBeGreaterThan(0);
    });
  });

  describe('같은 범위 같은 대표 기준 행(409 REFDB_DUPLICATE_IN_SCOPE)', () => {
    it('같은 국가·차종·트림에 같은 대표 행이면 409 — confirmDuplicate와 사유가 있으면 등록하고 감사에 사유를 남긴다', async () => {
      const ref = nextRefId();
      const scope = { vehicleModel: 'RDB-DUP', trim: 'Base' };
      const first = await create(body({ ...scope, name: '하드웨어 변형 A', featureRefs: primary(ref) })).expect(201);
      const r = await create(body({ ...scope, name: '하드웨어 변형 B', featureRefs: primary(ref) })).expect(409);
      expect(r.body.error).toMatchObject({ code: 'REFDB_DUPLICATE_IN_SCOPE', details: { refId: ref, features: [expect.objectContaining({ featureId: first.body.featureId })] } });
      // 사유 없이 확인만은 여전히 409
      await create(body({ ...scope, name: '하드웨어 변형 B', featureRefs: primary(ref), confirmDuplicate: true })).expect(409);
      const ok = await create(body({ ...scope, name: '하드웨어 변형 B', featureRefs: primary(ref), confirmDuplicate: true, duplicateReason: '센서 하드웨어가 다른 변형' })).expect(201);
      expect(ok.body.warnings).toEqual([expect.objectContaining({ code: 'REF_DUPLICATE_CONFIRMED', refId: ref })]);
      const audit = await auditOf(`${ok.body.featureId}@0.1.0`);
      expect(audit.after.duplicateConfirmed).toEqual({ reason: '센서 하드웨어가 다른 변형', of: [expect.objectContaining({ featureId: first.body.featureId })] });
      // 포함(INCLUDED)으로 쓰는 것과 다른 트림은 중복이 아니다
      await create(body({ ...scope, name: '다른 기능 포함 연결', featureRefs: primary(nextRefId(), ref) })).expect(201);
      await create(body({ vehicleModel: 'RDB-DUP', trim: 'Premium', name: '다른 트림', featureRefs: primary(ref) })).expect(201);
    });

    it('시드 Feature가 대표로 쓰는 행도 같은 범위면 409(시드 대응표 연결)', async () => {
      const seedDoc = features.all().find((f) => f.lifecycle !== 'RETIRED' && f.featureRefs?.length)!;
      const p = seedDoc.featureRefs!.find((l) => l.role === 'PRIMARY')!.refId;
      const r = await create(body({ name: '시드와 같은 대표 행', country: seedDoc.country, vehicleModel: seedDoc.vehicleModel, trim: seedDoc.trim, asil: repo.getRef(p)!.asilRep, featureRefs: primary(p) })).expect(409);
      expect(r.body.error.code).toBe('REFDB_DUPLICATE_IN_SCOPE');
    });
  });

  describe('선행 기준 행(requires) — 경고만', () => {
    it('선행 행을 같은 범위 어떤 Feature도 쓰지 않으면 경고, 선행 행 Feature가 있으면 경고 없음', async () => {
      // AD-ADS-029(QM) → 선행 AD-ADS-020(QM)
      const lone = await create(body({ vehicleModel: 'RDB-REQ-1', featureRefs: primary('AD-ADS-029') })).expect(201);
      expect(lone.body.warnings).toEqual([expect.objectContaining({ code: 'REF_PREREQUISITE', refId: 'AD-ADS-029', message: expect.stringContaining('AD-ADS-020') })]);
      await create(body({ vehicleModel: 'RDB-REQ-2', name: '선행 기능', featureRefs: primary('AD-ADS-020') })).expect(201);
      const ok = await create(body({ vehicleModel: 'RDB-REQ-2', name: '후속 기능', featureRefs: primary('AD-ADS-029') })).expect(201);
      expect(ok.body.warnings).toEqual([]);
      // 같은 Feature가 선행 행을 포함으로 연결해도 된다
      const self = await create(body({ vehicleModel: 'RDB-REQ-3', featureRefs: primary('AD-ADS-029', 'AD-ADS-020') })).expect(201);
      expect(self.body.warnings).toEqual([]);
    });
  });

  describe('초안 수정·새 Version', () => {
    it('PROPOSED 초안에서 연결을 바꾸면 다시 판정하고 색인을 바꾼다 — 남은 연결은 refVersion을 잇는다', async () => {
      const [a, b2, c] = [nextRefId(), nextRefId(), nextRefId()];
      const f = (await create(body({ featureRefs: primary(a, b2) })).expect(201)).body;
      // 앞 발행(v1.2) 때 연결한 것처럼 — 바꾸지 않은 연결은 이 값을 잇는다(기준 행이 바뀌어도 자동으로 따라가지 않음)
      const doc = features.get(f.featureId, '0.1.0')!;
      features.update({ ...doc, featureRefs: doc.featureRefs!.map((l) => (l.refId === a ? { ...l, refVersion: 'v1.2' } : l)) });
      await http().patch(`/api/features/${f.featureId}/versions/0.1.0`).set(AUTHOR).send({ featureRefs: primary('CH-BRK-999') }).expect(400);
      await http().patch(`/api/features/${f.featureId}/versions/0.1.0`).set(AUTHOR).send({ featureRefs: [] }).expect(400);
      const u = (await http().patch(`/api/features/${f.featureId}/versions/0.1.0`).set(AUTHOR).send({ featureRefs: primary(c, a) }).expect(200)).body;
      expect(u.featureRefs).toEqual([
        { refId: c, role: 'PRIMARY', refVersion: 'v1.3' },
        { refId: a, role: 'INCLUDED', refVersion: 'v1.2' },
      ]);
      expect(repo.linksOf(f.featureId, '0.1.0')).toEqual(u.featureRefs);
      expect(repo.usersOf(b2)).toEqual([]);
      // ASIL만 바꿔도 대표 행과 다시 비교한다
      const asil = await http().patch(`/api/features/${f.featureId}/versions/0.1.0`).set(AUTHOR).send({ asil: 'D' }).expect(400);
      expect(asil.body.error.details.field).toBe('asilDeviation');
    });

    it('새 Version은 앞 버전 연결(refVersion 포함)을 복사하고 색인도 만든다', async () => {
      const [a, b2] = [nextRefId(), nextRefId()];
      const f = (await create(body({ featureRefs: primary(a, b2) })).expect(201)).body;
      const v = (await http().post(`/api/features/${f.featureId}/versions`).set(AUTHOR).send({ baseVersion: '0.1.0', bump: 'minor', reason: '설명 보완', changes: { description: '설명 보완' } }).expect(201)).body;
      expect(v.feature.version).toBe('0.2.0');
      expect(v.feature.featureRefs).toEqual(f.featureRefs);
      expect(repo.linksOf(f.featureId, '0.2.0')).toEqual(f.featureRefs);
      expect(repo.linksOf(f.featureId, '0.1.0')).toEqual(f.featureRefs);
    });
  });

  describe('정의 승인(PROPOSED→APPROVED) — 요청 중·폐기 행이면 막힘(REFDB_LINK_BLOCKED)', () => {
    const judge = (id: string, gate: string) => http().post(`/api/features/${id}/versions/0.1.0/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${gate}` }).expect(201);
    const readyToApprove = async (featureRefs: unknown) => {
      const f = (await create(body({ featureRefs })).expect(201)).body;
      await judge(f.featureId, 'G1');
      await confirmSafety(http, f.featureId, '0.1.0');
      await judge(f.featureId, 'G2');
      await judge(f.featureId, 'G3');
      return f.featureId as string;
    };
    const approve = (id: string) => http().post(`/api/features/${id}/versions/0.1.0/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '정의 검토 완료' });

    it('요청 중(PENDING) 행이 연결돼 있으면 막고 막힌 사유를 돌려준다 — 활성 행으로 다시 연결하면 승인된다', async () => {
      const req = await http()
        .post('/api/refdb/requests')
        .set(AUTHOR)
        .send({ domain: 'Chassis & Vehicle Dynamics', component: 'Brake control (ESC/ABS)', nameEn: 'Brake test assist', nameKo: '제동 점검 보조', tshirt: 'S', asilRep: 'QM', basisNote: '사내 기획서 3장' })
        .expect(201);
      const pending = req.body.ref.refId;
      const id = await readyToApprove(primary(nextRefId(), pending));
      const options = (await http().get(`/api/features/${id}/versions/0.1.0`).set(APPROVER).expect(200)).body.transitions;
      expect(options.find((o: any) => o.to === 'APPROVED').blockers).toEqual([expect.objectContaining({ code: 'REFDB_LINK_BLOCKED', ref: pending })]);
      const r = await approve(id).expect(422);
      expect(r.body.error).toMatchObject({ code: 'GUARD_FAILED', details: { blockers: [expect.objectContaining({ code: 'REFDB_LINK_BLOCKED', ref: pending, message: expect.stringContaining('요청 중') })] } });
      const failed = (await http().get(`/api/audit?target=${id}@0.1.0&result=FAILED`).expect(200)).body.items;
      expect(failed.some((a: any) => a.action === 'FEATURE_TRANSITION PROPOSED→APPROVED')).toBe(true);
      // 요청 중 행을 빼고 다시 연결
      const ref = (await http().get(`/api/features/${id}/versions/0.1.0`).expect(200)).body.feature.featureRefs[0].refId;
      await http().patch(`/api/features/${id}/versions/0.1.0`).set(AUTHOR).send({ featureRefs: primary(ref) }).expect(200);
      expect((await approve(id).expect(200)).body.lifecycle).toBe('DEVELOPING');
    });

    it('연결 뒤 기준 행이 폐기(RETIRED)되면 막는다', async () => {
      const ref = nextRefId();
      const id = await readyToApprove(primary(ref));
      setStatus(ref, 'RETIRED');
      const r = await approve(id).expect(422);
      expect(r.body.error.details.blockers).toEqual([expect.objectContaining({ code: 'REFDB_LINK_BLOCKED', ref, message: expect.stringContaining('폐기') })]);
    });
  });

  describe('Feature DB에 없는 기능 — 추가 요청(정식 ID 즉시 부여)', () => {
    const request = (patch: Record<string, unknown> = {}) =>
      http()
        .post('/api/refdb/requests')
        .set(AUTHOR)
        .send({ domain: 'Chassis & Vehicle Dynamics', component: 'Brake control (ESC/ABS)', nameEn: 'Brake pad wear notice', nameKo: '브레이크 패드 마모 알림', tshirt: 'S', asilRep: 'QM', sourceIds: ['S01'], ...patch });

    it('다음 번호로 정식 ID를 부여해 요청 중 행 + 추가 변경 요청(검토 중)을 만들고, 바로 대표로 연결해 등록할 수 있다', async () => {
      const before = repo.usedRefIds().filter((id) => id.startsWith('CH-BRK-'));
      const max = Math.max(...before.map((id) => Number(id.slice(-3))));
      const r = (await request().expect(201)).body;
      const expected = `CH-BRK-${String(max + 1).padStart(3, '0')}`;
      expect(r.ref).toMatchObject({ refId: expected, status: 'PENDING', domain: 'Chassis & Vehicle Dynamics', cluster: expect.any(String), component: 'Brake control (ESC/ABS)', nameKo: '브레이크 패드 마모 알림', asilRep: 'QM', tshirt: 'S', sourceIds: ['S01'] });
      expect(r.change).toMatchObject({ kind: 'ADD', refId: expected, status: 'REVIEW', before: null, requestedBy: 'kim.author', fromRegistration: true, release: null, decision: null });
      expect(r.change.changeId).toMatch(/^CR-2026-\d{3}$/);
      expect(r.change.checks.find((c: any) => c.id === 'ID_REUSE')).toMatchObject({ ok: true });
      expect(repo.getRef(expected)?.status).toBe('PENDING');
      expect(repo.getChange(r.change.changeId)?.kind).toBe('ADD');
      const f = await create(body({ featureRefs: primary(expected) })).expect(201);
      expect(f.body.warnings).toEqual([expect.objectContaining({ refId: expected, status: 'PENDING' })]);
      expect(await auditOf(expected, 'REFDB_ADD_REQUEST')).toBeTruthy();
    });

    it('한 번 쓴 ID는 다시 쓰지 않는다 — 앞 요청 행이 폐기돼도 다음 번호', async () => {
      const first = (await request({ nameEn: 'Brake fluid notice', nameKo: '브레이크 오일 알림' }).expect(201)).body.ref.refId;
      setStatus(first, 'RETIRED');
      const second = (await request({ nameEn: 'Brake fluid notice 2', nameKo: '브레이크 오일 알림 2' }).expect(201)).body.ref.refId;
      expect(Number(second.slice(-3))).toBe(Number(first.slice(-3)) + 1);
    });

    it('분류 표에 없는 컴포넌트는 약어 제안이 있어야 하고(400), 제안하면 새 접두 001부터', async () => {
      const r = await request({ component: 'Brake by wire', cluster: 'Brake control' }).expect(400);
      expect(r.body.error.details.field).toBe('componentAbbr');
      await request({ component: 'Brake by wire', componentAbbr: 'STR', cluster: 'Brake control' }).expect(409); // 다른 컴포넌트 약어
      const ok = (await request({ component: 'Brake by wire', componentAbbr: 'BBW', cluster: 'Brake control' }).expect(201)).body;
      expect(ok.ref.refId).toBe('CH-BBW-001');
      expect(ok.change.reason).toContain('BBW');
    });

    it('출처 ID나 근거 메모 중 하나는 필요하고, 공식 도메인이 아니면 400', async () => {
      await request({ sourceIds: [], basisNote: '' }).expect(400);
      await request({ domain: 'Body' }).expect(400);
      // 약어로도 받는다
      expect((await request({ domain: 'CH', nameEn: 'Brake disc notice', nameKo: '디스크 알림' }).expect(201)).body.ref.domain).toBe('Chassis & Vehicle Dynamics');
    });

    it('Feature 작성 권한이 없으면 요청할 수 없다', async () => {
      await http().post('/api/refdb/requests').set(APPROVER).send({ domain: 'CH', component: 'BRK', nameEn: 'x', nameKo: 'x', tshirt: 'S', asilRep: 'QM', basisNote: '메모' }).expect(403);
    });
  });
});
