// 검토 포털 협의 요청(W5, 담당자 개선 P5-1) — 요청 부서가 구매·법무·개인정보보호 부서에 의견을 구하는 건(업무 절차의 협의 C).
// 경로·역할·본문은 contracts ROUTES(listConsultations·consultationDetail·createConsultation·answerConsultation), 마이그레이션 087.
//  · 만들기: 근거 활동(activityId)이 있으면 업무 절차 모델에서 받는 부서 역할이 협의(C)·통보(I)이고 요청 부서 역할이 수행(R)·책임(A)이어야 한다.
//  · 의견: 그 요청을 받은 포털 부서만(본문 department), 요청자 본인은 낼 수 없다. 의견은 덧붙고(이력) 상태는 '의견 받음'.
//  · 감사: CONSULT_REQUEST · CONSULT_OPINION(같은 트랜잭션), 거부는 DENIED. 이벤트 consult.requested · consult.answered.
//  · 데모 시드: 포털 부서마다 실제 업무 절차 협의 활동에 묶인 요청 몇 건(빈 요청함 없음, FF_SEED=none이면 넣지 않음).
// 데모는 조회 계정(AUDITOR)이 부서를 골라 체험한다. OIDC는 신뢰할 수 있는 부서 신원 연계 전까지 쓰기를 거부한다(본문의 부서 값은 신원이 아니다).
import { Body, Controller, Get, Inject, Injectable, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import {
  AnswerConsultationBody,
  Consultation,
  consultDaysLeft,
  consultOrder,
  CreateConsultationBody,
  departmentName,
  departmentRoles,
  REFDB_CHANGE_REQUESTERS,
  type ConsultOpinion,
  type ConsultTargetKind,
} from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../kernel/actor';
import { AuditService } from '../kernel/audit.service';
import { Clock } from '../kernel/clock';
import { DB, type Db } from '../kernel/db';
import { DomainError } from '../kernel/errors';
import { authModeOf } from '../kernel/auth/auth-config';
import { EventService } from '../kernel/event.service';
import { singleQuery } from '../kernel/paging';
import { ZodPipe } from '../kernel/zod.pipe';
import { WORKFLOW_INDEX } from '../generated/workflow-index';

const COMPONENT = 'D04-04';
const one = (raw: unknown, field: string) => singleQuery(raw, field)?.trim() || undefined;

/** 화면 응답 — 부서 이름·기한까지 남은 날·근거 활동 이름(코드 대신)을 붙인다 */
export type ConsultView = Consultation & { toName: string; fromName: string; daysLeft: number; activityName: string | null };

/**
 * 근거 활동 점검 — 받는 부서 역할이 협의(C)·통보(I), 요청 부서 역할이 수행(R)·책임(A). 문제 문장 또는 null.
 * 순수 함수(시험·시드가 같이 쓴다).
 */
export function consultBasisProblem(activityId: string | null, fromDept: string, toDept: string): string | null {
  if (!activityId) return null;
  const a = WORKFLOW_INDEX.activities.find((x) => x.id === activityId);
  if (!a) return `업무 절차에 활동 ${activityId}이(가) 없습니다.`;
  const to = departmentRoles(toDept);
  const from = departmentRoles(fromDept);
  const consulted = [...(a.raci.C ?? []), ...(a.raci.I ?? [])].some((r) => to.includes(r));
  if (!consulted) return `'${a.name}' 활동은 ${departmentName(toDept)}에 협의하는 활동이 아닙니다.`;
  const owner = [...(a.raci.R ?? []), a.raci.A].some((r) => !!r && from.includes(r));
  if (!owner) return `'${a.name}' 활동은 ${departmentName(fromDept)}가 수행·책임지는 활동이 아닙니다.`;
  return null;
}

const activityName = (id: string | null) => (id ? (WORKFLOW_INDEX.activities.find((x) => x.id === id)?.name ?? null) : null);

@Injectable()
export class ConsultService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  onModuleInit() {
    if (process.env.FF_SEED === 'none' || process.env.FF_DATASET === 'ops5y') return;
    if (this.db.get('SELECT 1 FROM consultation LIMIT 1')) return;
    const seeds = demoConsultations(this.clock.iso());
    this.db.tx(() => {
      for (const c of seeds) this.insert(c);
    });
  }

  // ── 조회 ─────────────────────────────────────────────────

  private all(): Consultation[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM consultation').map((r) => JSON.parse(r.doc) as Consultation);
  }

  private view(c: Consultation): ConsultView {
    return { ...c, toName: departmentName(c.toDept), fromName: departmentName(c.fromDept), daysLeft: consultDaysLeft(c.dueAt, this.clock.iso()), activityName: activityName(c.activityId) };
  }

  list(q: { to?: string; from?: string; status?: string }) {
    if (q.status && q.status !== 'OPEN' && q.status !== 'ANSWERED') throw new DomainError('VALIDATION', '상태(status)는 OPEN 또는 ANSWERED입니다.', { field: 'status' });
    const items = this.all()
      .filter((c) => (!q.to || c.toDept === q.to) && (!q.from || c.fromDept === q.from) && (!q.status || c.status === q.status))
      .sort(consultOrder)
      .map((c) => this.view(c));
    return { items, total: items.length, open: items.filter((c) => c.status === 'OPEN').length, overdue: items.filter((c) => c.status === 'OPEN' && c.daysLeft < 0).length };
  }

  detail(id: string) {
    return { consultation: this.view(this.mustGet(id)) };
  }

  // ── 만들기 ───────────────────────────────────────────────

  /** 본문의 부서 선택은 데모용이다. SSO 역할만으로 특정 부서의 의견을 대신 남길 수 없다. */
  private requireDepartmentIdentity(actor: Actor, action: string, target: string) {
    if (authModeOf() === 'demo') return;
    const message = '협의 기록을 남기려면 회사 계정의 부서 신원 연계가 필요합니다. 관리자에게 부서 신원 연계를 요청하세요.';
    this.audit.denied(actor, action, target, message, COMPONENT);
    throw new DomainError('FORBIDDEN', message);
  }

  create(actor: Actor, body: CreateConsultationBody) {
    this.requireDepartmentIdentity(actor, 'CONSULT_REQUEST', body.targetId);
    const problem = consultBasisProblem(body.activityId, body.fromDept, body.toDept);
    if (problem) throw new DomainError('VALIDATION', problem, { field: 'activityId' });
    const today = this.clock.iso().slice(0, 10);
    if (body.dueAt < today) throw new DomainError('VALIDATION', `기한(${body.dueAt})은 오늘(${today})보다 앞일 수 없습니다.`, { field: 'dueAt' });
    return this.db.tx(() => {
      const c = Consultation.parse({ ...body, consultId: this.nextId(), requestedBy: actor.id, requestedAt: this.clock.iso(), status: 'OPEN', opinions: [] });
      this.insert(c);
      this.audit.record(actor, 'CONSULT_REQUEST', c.consultId, { after: { toDept: c.toDept, fromDept: c.fromDept, target: `${c.targetKind}:${c.targetId}`, dueAt: c.dueAt, activityId: c.activityId }, reason: c.summary, componentId: COMPONENT });
      this.events.publish('consult.requested', c.consultId, { consultId: c.consultId, toDept: c.toDept, fromDept: c.fromDept, targetId: c.targetId, dueAt: c.dueAt, by: actor.id }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return this.view(c);
    });
  }

  // ── 의견 ─────────────────────────────────────────────────

  answer(actor: Actor, id: string, body: AnswerConsultationBody) {
    this.requireDepartmentIdentity(actor, 'CONSULT_OPINION', id);
    const c = this.mustGet(id);
    if (body.department !== c.toDept) {
      const message = `이 협의 요청은 ${departmentName(c.toDept)}에 온 건입니다 — ${departmentName(body.department)}은(는) 의견을 낼 수 없습니다.`;
      this.audit.denied(actor, 'CONSULT_OPINION', id, message, COMPONENT);
      throw new DomainError('FORBIDDEN', message, { toDept: c.toDept });
    }
    if (actor.id === c.requestedBy) {
      const message = '협의를 요청한 사람은 자기 요청에 의견을 낼 수 없습니다.';
      this.audit.denied(actor, 'CONSULT_OPINION', id, message, COMPONENT);
      throw new DomainError('SEPARATION_OF_DUTY', message, { consultId: id });
    }
    return this.db.tx(() => {
      const entry = { opinion: body.opinion, memo: body.memo, by: actor.id, department: body.department, at: this.clock.iso() };
      const next = Consultation.parse({ ...c, status: 'ANSWERED', opinions: [...c.opinions, entry] });
      this.db.run('UPDATE consultation SET status = ?, doc = ? WHERE consult_id = ?', next.status, JSON.stringify(next), id);
      this.audit.record(actor, 'CONSULT_OPINION', id, { before: { status: c.status, opinions: c.opinions.length }, after: entry, reason: body.memo, componentId: COMPONENT });
      this.events.publish('consult.answered', id, { consultId: id, opinion: body.opinion, toDept: c.toDept, fromDept: c.fromDept, requestedBy: c.requestedBy, by: actor.id }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return this.view(next);
    });
  }

  // ── 공통 ─────────────────────────────────────────────────

  private mustGet(id: string): Consultation {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM consultation WHERE consult_id = ?', id);
    if (!r) throw new DomainError('NOT_FOUND', `협의 요청 ${id}이(가) 없습니다.`);
    return JSON.parse(r.doc) as Consultation;
  }

  private insert(c: Consultation) {
    this.db.run(
      'INSERT INTO consultation (consult_id, to_dept, from_dept, status, due_at, target_kind, target_id, requested_by, created_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      c.consultId,
      c.toDept,
      c.fromDept,
      c.status,
      c.dueAt,
      c.targetKind,
      c.targetId,
      c.requestedBy,
      c.requestedAt,
      JSON.stringify(c),
    );
  }

  private nextId(): string {
    const prefix = `CON-${this.clock.now().getUTCFullYear()}-`;
    const r = this.db.get<{ m: number | null }>('SELECT max(CAST(substr(consult_id, 10) AS INTEGER)) AS m FROM consultation WHERE consult_id LIKE ?', `${prefix}%`);
    return `${prefix}${String((r?.m ?? 0) + 1).padStart(3, '0')}`;
  }
}

// ── 데모 시드 ───────────────────────────────────────────────

interface SeedSpec {
  activityId: string;
  fromDept: string;
  toDept: string;
  by: string;
  targetKind: ConsultTargetKind;
  targetId: string;
  targetName: string;
  summary: string;
  checks: string[];
  link: string | null;
  /** 요청한 날(오늘 기준 며칠 전)·기한(오늘 기준 며칠 뒤, 음수 = 지남) */
  askedDaysAgo: number;
  dueIn: number;
  answer?: { opinion: ConsultOpinion; memo: string; daysAgo: number };
}

/**
 * 포털 부서가 보낸 시드 요청의 요청자 — 데모의 포털 담당은 모두 조회 계정(usr-viewer) 하나라, 그 계정을 요청자로 두면
 * 받은 부서(같은 계정)가 '자기 요청'으로 막혀 의견을 낼 수 없다. 실제 설치에서는 부서마다 다른 사람이다.
 */
const PORTAL_REQUESTER: Record<string, string> = { 'DEP-LEG': 'legal:demo-requester', 'DEP-DPO': 'dpo:demo-requester' };

const SUPPLIER = (s: string) => `/supplier/portal?supplier=${encodeURIComponent(s)}`;

/** 포털 부서마다 업무 절차 협의 활동에 묶인 요청 — 요청 부서는 그 활동의 수행·책임 부서(consultBasisProblem 통과, 시험이 본다) */
export const DEMO_CONSULT_SPECS: readonly SeedSpec[] = [
  // 구매 — 협력사 변경 영향(P5-2: 구매 요청함에 협력사 변경 영향, 협력사 이관 화면으로)
  {
    activityId: 'FPW.2-A01',
    fromDept: 'DEP-FS',
    toDept: 'DEP-PUR',
    by: 'usr-quality',
    targetKind: 'SUPPLIER_PACKAGE',
    targetId: 'ART-DMS-2-2.1.0',
    targetName: '운전자 모니터링 서비스 SW 2.1.0 (Tier1-B)',
    summary: '협력사 운전자 모니터링 SW 변경 — 계약·납품 일정에 영향이 있는지 의견을 주세요',
    checks: ['이번 변경이 Tier1-B 계약의 납품 범위 안인지', '바뀐 SW의 납품 일정이 다음 출시 계획과 맞는지', '추가 비용이 생기면 그 근거와 금액 범위'],
    link: SUPPLIER('Tier1-B'),
    askedDaysAgo: 2,
    dueIn: 3,
  },
  {
    activityId: 'FPW.2-A01',
    fromDept: 'DEP-FS',
    toDept: 'DEP-PUR',
    by: 'usr-quality',
    targetKind: 'SUPPLIER_PACKAGE',
    targetId: 'ART-ARHUD-2-1.1.0',
    targetName: 'AR HUD 길 안내 서비스 SW 1.1.0 (Tier1-E)',
    summary: 'AR HUD 협력사 SW 안전 등급 변경 — 재시험 비용을 누가 부담하는지 의견을 주세요',
    checks: ['재시험이 계약상 협력사 부담인지', '같은 협력사의 다른 납품(뒷좌석 엔터테인먼트)에도 영향이 있는지'],
    link: SUPPLIER('Tier1-E'),
    askedDaysAgo: 6,
    dueIn: -1,
  },
  {
    activityId: 'FPW.11-A06',
    fromDept: 'DEP-LEG',
    toDept: 'DEP-PUR',
    by: PORTAL_REQUESTER['DEP-LEG'],
    targetKind: 'SUPPLIER_PACKAGE',
    targetId: 'ART-PAK-2-1.1.0',
    targetName: '디지털 키 서비스 SW 1.1.0 (Tier1-C)',
    summary: '디지털 키 SW의 오픈소스 고지 의무 — 협력사 계약 조항에 들어 있는지 확인해 주세요',
    checks: ['오픈소스 목록(SBOM) 제출 의무가 계약에 있는지', '고지 의무 위반 시 책임 조항'],
    link: SUPPLIER('Tier1-C'),
    askedDaysAgo: 1,
    dueIn: 9,
  },
  {
    activityId: 'FPW.10-A06',
    fromDept: 'DEP-QA',
    toDept: 'DEP-PUR',
    by: 'usr-quality',
    targetKind: 'SUPPLIER_PACKAGE',
    targetId: 'ART-RSTART-2-1.1.0',
    targetName: '원격 시동 서비스 SW 1.1.0 (Legacy Supplier)',
    summary: '입고 검사에서 결함이 나온 원격 시동 SW — 협력사 시정 요구를 보낼지 알려 드립니다',
    checks: ['시정 요구 기한이 계약 조건과 맞는지'],
    link: SUPPLIER('Legacy Supplier'),
    askedDaysAgo: 9,
    dueIn: -4,
    answer: { opinion: 'AGREE', memo: '계약 12조 시정 요구 기한(14일) 안입니다. 구매팀이 협력사에 공문을 보냈습니다.', daysAgo: 5 },
  },
  // 법무
  {
    activityId: 'FPW.7-A07',
    fromDept: 'DEP-HOM',
    toDept: 'DEP-LEG',
    by: 'usr-steward',
    targetKind: 'FEATURE',
    targetId: 'FEAT-00145@5.4.2',
    targetName: '스마트 크루즈 컨트롤 5.4.2',
    summary: '스마트 크루즈 컨트롤 고객 고지 문구 — 형식승인 조건과 약관이 맞는지 의견을 주세요',
    checks: ['차량 화면 고지 문구가 형식승인 조건(속도 범위)과 같은지', '약관에 기능 제한(날씨·도로) 안내가 있는지'],
    link: '/features/FEAT-00145/5.4.2',
    askedDaysAgo: 1,
    dueIn: 4,
  },
  {
    activityId: 'FPW.12-A04',
    fromDept: 'DEP-HOM',
    toDept: 'DEP-LEG',
    by: 'usr-steward',
    targetKind: 'FEATURE',
    targetId: 'FEAT-00024@1.0.0',
    targetName: 'IC·JC 경로 사전안내 1.0.0',
    summary: 'EU 고객의 운행 데이터 접근 요청 — 제공해야 하는 범위와 계약 근거를 확인해 주세요',
    checks: ['EU Data Act 제공 의무 범위', '제3자 제공 시 계약 근거'],
    link: '/admin/data',
    askedDaysAgo: 3,
    dueIn: 2,
  },
  {
    activityId: 'FPW.12-A02',
    fromDept: 'DEP-DPO',
    toDept: 'DEP-LEG',
    by: PORTAL_REQUESTER['DEP-DPO'],
    targetKind: 'POLICY',
    targetId: 'POL-00003',
    targetName: 'IVI 내비 IC·JC 사전안내 표시 정책',
    summary: '기능 켜기 판단에 쓰는 차량 정보에 개인정보가 섞였는지 — 법적 근거를 검토해 주세요',
    checks: ['판단에 쓰는 정보(국가·차종·트림·위치) 중 개인정보가 있는지', '있다면 처리 근거(동의·계약)'],
    link: '/integration/openfeature',
    askedDaysAgo: 8,
    dueIn: -2,
    answer: { opinion: 'REVISE', memo: '위치 정보는 동의 근거가 필요합니다 — 동의 화면 문구를 보완한 뒤 다시 보내 주세요.', daysAgo: 4 },
  },
  {
    activityId: 'FPW.10-A02',
    fromDept: 'DEP-HOM',
    toDept: 'DEP-LEG',
    by: 'usr-steward',
    targetKind: 'SUPPLIER_PACKAGE',
    targetId: 'ART-DMS-2-2.1.0',
    targetName: '운전자 모니터링 서비스 SW 2.1.0 (Tier1-B)',
    summary: 'Tier1-B 개발 협력 계약(DIA) 개정안 — 안전 책임 조항을 검토해 주세요',
    checks: ['기능안전 책임 분담표가 계약에 붙어 있는지', '사이버보안 사고 통보 기한'],
    link: SUPPLIER('Tier1-B'),
    askedDaysAgo: 2,
    dueIn: 6,
  },
  // 개인정보보호
  {
    activityId: 'FPW.12-A01',
    fromDept: 'DEP-FS',
    toDept: 'DEP-DPO',
    by: 'usr-quality',
    targetKind: 'FEATURE',
    targetId: 'FEAT-00022@1.0.0',
    targetName: '전방 안전거리 3단계 1.0.0',
    summary: '운행 감시 지표에 넣을 수집 항목 — 개인정보가 들어가는지 의견을 주세요',
    checks: ['수집 항목(속도·거리·경고 횟수)에 차량 식별 정보가 붙는지', '보존 기간이 처리 방침과 맞는지'],
    link: '/ops/safety-kpi',
    askedDaysAgo: 1,
    dueIn: 5,
  },
  {
    activityId: 'FPW.12-A03',
    fromDept: 'DEP-LEG',
    toDept: 'DEP-DPO',
    by: PORTAL_REQUESTER['DEP-LEG'],
    targetKind: 'POLICY',
    targetId: 'POL-00002',
    targetName: '위험 단계 감속 요청 파라미터 정책',
    summary: '중국 판매 차량 데이터의 현지 처리 — 국외 이전에 해당하는지 의견을 주세요',
    checks: ['중국 차량 데이터가 국외 서버로 가는지', '현지 처리 예외 조건'],
    link: '/admin/data',
    askedDaysAgo: 4,
    dueIn: 1,
  },
  {
    activityId: 'FPW.12-A05',
    fromDept: 'DEP-HOM',
    toDept: 'DEP-DPO',
    by: 'usr-steward',
    targetKind: 'POLICY',
    targetId: 'POL-00001',
    targetName: '전방 거리 단계 판정 신호 정책',
    summary: '보존 기간이 지난 운행 기록 삭제 — 삭제 범위가 맞는지 확인해 주세요',
    checks: ['삭제 대상 기간(3년 초과)이 처리 방침과 같은지', '법정 보존 예외(사고 기록)를 뺐는지'],
    link: '/admin/data',
    askedDaysAgo: 2,
    dueIn: 7,
  },
  {
    activityId: 'FPW.12-A04',
    fromDept: 'DEP-HOM',
    toDept: 'DEP-DPO',
    by: 'usr-steward',
    targetKind: 'FEATURE',
    targetId: 'FEAT-00024@1.0.0',
    targetName: 'IC·JC 경로 사전안내 1.0.0',
    summary: 'EU 고객 데이터 접근 요청 — 제공할 항목에서 개인정보를 가렸는지 확인해 주세요',
    checks: ['제공 파일에 다른 운전자 정보가 없는지'],
    link: '/admin/data',
    askedDaysAgo: 7,
    dueIn: -3,
    answer: { opinion: 'AGREE', memo: '제공 항목에서 다른 운전자 정보가 빠진 것을 확인했습니다.', daysAgo: 3 },
  },
];

const shift = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString();

/** 데모 시드 — 오늘 기준 날짜. 번호는 요청한 날 순(오래된 것부터 001) */
export function demoConsultations(nowIso: string): Consultation[] {
  const year = new Date(nowIso).getUTCFullYear();
  return [...DEMO_CONSULT_SPECS]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.askedDaysAgo - a.s.askedDaysAgo || a.i - b.i)
    .map(({ s }, n) =>
      Consultation.parse({
        consultId: `CON-${year}-${String(n + 1).padStart(3, '0')}`,
        activityId: s.activityId,
        targetKind: s.targetKind,
        targetId: s.targetId,
        targetName: s.targetName,
        summary: s.summary,
        checks: s.checks,
        link: s.link,
        fromDept: s.fromDept,
        toDept: s.toDept,
        requestedBy: s.by,
        requestedAt: shift(nowIso, -s.askedDaysAgo),
        dueAt: shift(nowIso, s.dueIn).slice(0, 10),
        status: s.answer ? 'ANSWERED' : 'OPEN',
        opinions: s.answer ? [{ opinion: s.answer.opinion, memo: s.answer.memo, by: 'usr-viewer', department: s.toDept, at: shift(nowIso, -s.answer.daysAgo) }] : [],
      }),
    );
}

@Controller('api/consultations')
export class ConsultController {
  constructor(private readonly consults: ConsultService) {}

  @Get()
  list(@Query('to') to?: unknown, @Query('from') from?: unknown, @Query('status') status?: unknown) {
    return this.consults.list({ to: one(to, 'to'), from: one(from, 'from'), status: one(status, 'status') });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.consults.detail(id);
  }

  @Post()
  // 포털 부서도 서로 협의를 요청한다(법무 → 구매) — 조회 계정(AUDITOR) 포함, routes.ts와 같다
  @Roles(...REFDB_CHANGE_REQUESTERS, 'AUDITOR')
  @AuditAction('CONSULT_REQUEST')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateConsultationBody)) body: CreateConsultationBody) {
    return this.consults.create(actor, body);
  }

  @Post(':id/opinions')
  @Roles(...REFDB_CHANGE_REQUESTERS, 'AUDITOR')
  @AuditAction('CONSULT_OPINION')
  answer(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(AnswerConsultationBody)) body: AnswerConsultationBody) {
    return this.consults.answer(actor, id, body);
  }
}
