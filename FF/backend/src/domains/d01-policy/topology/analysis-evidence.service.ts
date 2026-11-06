// 분석 근거(D01-02, 담당자 웨이브 P3-3) — Feature Version마다 HARA(SM)·TARA(CSM)·SOTIF(아키텍트)·형식승인 영향(법규 담당)을 담당 역할이 개인 서명으로 남긴다.
// 추가만 한다 — 같은 종류를 다시 쓰면 새 기록이 지금 근거가 된다. G7 서명(SM·CSM)은 서명할 때의 HARA·TARA 기록에 묶이고, 분석을 다시 쓰면 효력이 없다.
// Gate(G2·G7) PASS 조건은 contracts gateEvidenceBlockers — 화면이 판정 전에 같은 함수로 보인다.
import { Body, Controller, Get, Inject, Injectable, OnApplicationBootstrap, Param, Post } from '@nestjs/common';
import {
  ANALYSIS_AUTHOR_ROLE,
  ANALYSIS_LABEL,
  G7SignoffBody,
  HaraBody,
  HomologationBody,
  jcs,
  LIFECYCLE_RANK,
  securityRelevance,
  SotifBody,
  TaraBody,
  gateEvidenceBlockers,
  type AnalysisKind,
  type AnalysisRecord,
  type AnalysisView,
  type AsilDeviationView,
  type FeatureVersionRow,
  type G7Signoff,
  type G7SignoffRole,
  type JudgeGateBody,
} from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { HsmService } from '../../d06-qsec/pki-kms/hsm.service';
import { FeatureRefLinker } from '../registry/feature-refs';
import { SafetyProfileService } from '../registry/safety-profile.service';
import { FeatureRepo } from '../repos';

const pad = (n: number) => String(n).padStart(5, '0');
const ACTION: Record<AnalysisKind, string> = { HARA: 'ANALYSIS_HARA', TARA: 'ANALYSIS_TARA', SOTIF: 'ANALYSIS_SOTIF', HOMOLOGATION: 'ANALYSIS_HOMOLOGATION' };

/** 데모 이관 기록 — 시드 Feature 몇 개의 분석 근거(플랫폼 봉인, provenance IMPORT). 대표 ASIL 변경(A→C·B→C) Version을 포함한다 */
const DEMO: { featureId: string; version: string; kind: AnalysisKind; by: string; docId: string | null; content: Record<string, unknown>; reason: string }[] = [
  { featureId: 'FEAT-00010', version: '2.0.0', kind: 'HARA', by: 'usr-quality', docId: 'HARA-DMS-2026-004', reason: '운전자 이상 미감지 위험 재평가', content: { asil: 'C', safetyGoals: [{ id: 'SG-DMS-01', text: '운전자 졸음·주의 분산을 놓쳐 경고가 늦는 일을 막는다', asil: 'C' }, { id: 'SG-DMS-02', text: '오경보로 운전자가 경고를 무시하게 되는 일을 막는다', asil: 'B' }] } },
  { featureId: 'FEAT-00010', version: '2.0.0', kind: 'TARA', by: 'usr-integrator', docId: 'TARA-DMS-2026-002', reason: '카메라 영상 경로 위협 분석', content: { threats: [{ id: 'TS-DMS-01', text: '카메라 영상 위·변조로 운전자 상태를 속인다', cal: 'CAL3' }, { id: 'TS-DMS-02', text: '진단 포트로 감지 임계값을 바꾼다', cal: 'CAL2' }] } },
  { featureId: 'FEAT-00010', version: '2.0.0', kind: 'SOTIF', by: 'usr-integrator', docId: 'SOTIF-DMS-2026-001', reason: '조명·착용물 유발 조건 정리', content: { triggeringConditions: ['역광·터널 출구의 급격한 조도 변화', '선글라스·마스크 착용', '야간 적외선 반사'] } },
  { featureId: 'FEAT-00010', version: '2.0.0', kind: 'HOMOLOGATION', by: 'usr-steward', docId: null, reason: 'GSR 운전자 졸음 경고 요건 대조', content: { regulations: ['GSR', 'R155'], decision: 'NOTIFY', rxswin: ['RX-NX4-DMS-02'] } },
  { featureId: 'FEAT-00005', version: '5.5.0', kind: 'HARA', by: 'usr-quality', docId: 'HARA-SCC-2026-011', reason: '정체 구간 재출발 위험 포함', content: { asil: 'C', safetyGoals: [{ id: 'SG-SCC-01', text: '의도하지 않은 가속을 막는다', asil: 'C' }, { id: 'SG-SCC-02', text: '앞차 정지 때 감속 부족을 막는다', asil: 'C' }] } },
  { featureId: 'FEAT-00005', version: '5.5.0', kind: 'TARA', by: 'usr-integrator', docId: 'TARA-SCC-2026-006', reason: '레이더 신호 경로 위협', content: { threats: [{ id: 'TS-SCC-01', text: '레이더 거리 신호 재전송 공격', cal: 'CAL3' }] } },
  { featureId: 'FEAT-00005', version: '5.5.0', kind: 'HOMOLOGATION', by: 'usr-steward', docId: null, reason: 'CSMS·SUMS 대상 변경 확인', content: { regulations: ['R155', 'R156'], decision: 'NOTIFY', rxswin: ['RX-NX4-SCC-05'] } },
  { featureId: 'FEAT-00022', version: '1.0.0', kind: 'HARA', by: 'usr-quality', docId: 'HARA-CARE-2025-031', reason: '출시 Version 이관', content: { asil: 'B', safetyGoals: [{ id: 'SG-CARE-01', text: '차간 거리 제어 중 급감속 누락을 막는다', asil: 'B' }] } },
  { featureId: 'FEAT-00022', version: '1.0.0', kind: 'TARA', by: 'usr-integrator', docId: 'TARA-CARE-2025-012', reason: '출시 Version 이관', content: { threats: [{ id: 'TS-CARE-01', text: 'OTA 정책 위·변조로 기능 범위를 넓힌다', cal: 'CAL2' }] } },
  { featureId: 'FEAT-00022', version: '1.0.0', kind: 'HOMOLOGATION', by: 'usr-steward', docId: null, reason: '출시 Version 이관', content: { regulations: [], decision: 'NO_IMPACT', rxswin: [] } },
];

@Injectable()
@PlatformComponent('D01-02')
export class AnalysisEvidenceService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly features: FeatureRepo,
    private readonly refs: FeatureRefLinker,
    private readonly safety: SafetyProfileService,
    private readonly hsm: HsmService,
  ) {}

  /** 데모 이관 기록 — 빈 표일 때 한 번(플랫폼 gate 키로 봉인, 개인 키를 만들지 않는다) */
  onApplicationBootstrap() {
    if (process.env.FF_SEED === 'none' || this.db.get('SELECT 1 FROM analysis_record LIMIT 1')) return;
    const rows = DEMO.filter((d) => this.features.get(d.featureId, d.version));
    if (!rows.length) return;
    this.db.tx(() => {
      for (const d of rows) {
        const unsigned = this.draft(d.kind, d.featureId, d.version, d.docId, d.content, d.reason, { id: d.by, role: ANALYSIS_AUTHOR_ROLE[d.kind] }, 'IMPORT');
        const s = this.hsm.signDetached('gate', jcs(unsigned));
        this.insert({ ...unsigned, kid: s.kid, sig: s.value });
      }
    });
  }

  private nextId(table: 'analysis_record' | 'gate_signoff', prefix: string): string {
    const col = table === 'analysis_record' ? 'record_id' : 'signoff_id';
    const r = this.db.get<{ m: number | null }>(`SELECT max(CAST(substr(${col}, ${prefix.length + 2}) AS INTEGER)) AS m FROM ${table}`);
    return `${prefix}-${pad((r?.m ?? 0) + 1)}`;
  }

  private draft(kind: AnalysisKind, featureId: string, version: string, docId: string | null, content: Record<string, unknown>, reason: string, by: { id: string; role: AnalysisRecord['signedRole'] }, provenance: AnalysisRecord['provenance']): AnalysisRecord {
    const prev = this.latest(featureId, version)[kind];
    return { recordId: this.nextId('analysis_record', 'ANL'), kind, featureId, version, docId, content, reason, signedBy: by.id, signedRole: by.role, signedAt: this.clock.iso(), provenance, supersedes: prev?.recordId ?? null, kid: '', sig: null };
  }

  private insert(r: AnalysisRecord) {
    this.db.run('INSERT INTO analysis_record (record_id, feature_id, feature_version, kind, signed_by, signed_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', r.recordId, r.featureId, r.version, r.kind, r.signedBy, r.signedAt, JSON.stringify(r));
  }

  history(featureId: string, version: string): AnalysisRecord[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM analysis_record WHERE feature_id = ? AND feature_version = ? ORDER BY record_id', featureId, version).map((r) => JSON.parse(r.doc) as AnalysisRecord);
  }

  /** 종류별 지금 기록 — 가장 늦은 것 */
  latest(featureId: string, version: string): Partial<Record<AnalysisKind, AnalysisRecord>> {
    const out: Partial<Record<AnalysisKind, AnalysisRecord>> = {};
    for (const r of this.history(featureId, version)) out[r.kind] = r;
    return out;
  }

  get(recordId: string): AnalysisRecord | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM analysis_record WHERE record_id = ?', recordId);
    return r ? (JSON.parse(r.doc) as AnalysisRecord) : null;
  }

  /** 대기열용 일괄 조회 — 최신 형식승인 판단의 서명까지 유효한 Version만. 무효 최신을 과거 기록으로 대체하지 않는다. */
  validHomologations(): Set<string> {
    const latest = new Map<string, AnalysisRecord>();
    for (const row of this.db.all<{ doc: string }>("SELECT doc FROM analysis_record WHERE kind = 'HOMOLOGATION' ORDER BY record_id")) {
      const record = JSON.parse(row.doc) as AnalysisRecord;
      latest.set(`${record.featureId}@${record.version}`, record);
    }
    return new Set([...latest].filter(([, record]) => this.valid(record, record.signedBy, record.provenance)).map(([key]) => key));
  }

  /** 서명 검증 — 개인 서명은 서명자 승인 키, 이관 기록은 플랫폼 gate 키. 서명 뒤 본문이 바뀌면 무효 */
  private valid(r: AnalysisRecord | G7Signoff, by: string, provenance: AnalysisRecord['provenance'] = 'PERSONAL'): boolean {
    if (!r.sig) return false;
    const canonical = jcs({ ...r, kid: '', sig: null });
    return provenance === 'IMPORT' ? this.hsm.verifyDetached('gate', canonical, { alg: 'EdDSA', kid: r.kid, value: r.sig }).valid : this.hsm.verifyApproval(by, canonical, r.sig);
  }

  private signoffs(featureId: string, version: string): G7Signoff[] {
    return this.db.all<{ doc: string }>("SELECT doc FROM gate_signoff WHERE feature_id = ? AND feature_version = ? AND gate = 'G7' ORDER BY signoff_id", featureId, version).map((r) => JSON.parse(r.doc) as G7Signoff);
  }

  /** 역할별 최신 G7 서명과 효력 — 지금의 HARA·TARA 기록에 묶인 것만 유효 */
  g7(featureId: string, version: string): AnalysisView['g7'] {
    const cur = this.latest(featureId, version);
    const last = new Map<G7SignoffRole, G7Signoff>();
    for (const s of this.signoffs(featureId, version)) last.set(s.role, s);
    return [...last.values()].map((s) => {
      const stale = s.bound.HARA !== (cur.HARA?.recordId ?? null) || s.bound.TARA !== (cur.TARA?.recordId ?? null);
      // ID가 그대로라도 묶인 분석의 본문·서명이 변조되면 그 분석을 확인한 G7 서명도 근거가 아니다.
      const boundValid = (['HARA', 'TARA'] as const).every((kind) => {
        if (s.bound[kind] === null) return true;
        const record = cur[kind];
        return !!record && record.recordId === s.bound[kind] && this.valid(record, record.signedBy, record.provenance);
      });
      return { ...s, stale, valid: !stale && boundValid && this.valid(s, s.signedBy) };
    });
  }

  /** 대표 ASIL 변경 — 대표 기준 행의 대표 ASIL과 Feature ASIL이 다르면(등록 사유와 함께) */
  asilDeviation(f: FeatureVersionRow): AsilDeviationView | null {
    const primary = this.refs.primaryOf(f);
    if (primary && primary.asilRep !== f.asil) return { from: primary.asilRep, to: f.asil, reason: f.asilDeviation?.reason ?? '등록 때 남긴 사유가 없습니다', refId: primary.refId };
    if (f.asilDeviation) return { from: f.asilDeviation.from, to: f.asilDeviation.to, reason: f.asilDeviation.reason, refId: this.refs.primaryRefIdOf(f) ?? null };
    return null;
  }

  private require(featureId: string, version: string): FeatureVersionRow {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}이(가) 없습니다.`);
    return f;
  }

  view(featureId: string, version: string): AnalysisView {
    const f = this.require(featureId, version);
    const p = this.safety.ensure(featureId, version);
    const latest = this.latest(featureId, version);
    const current = Object.fromEntries(Object.entries(latest).map(([k, r]) => [k, { ...r!, valid: this.valid(r!, r!.signedBy, r!.provenance) }])) as AnalysisView['current'];
    return {
      featureId,
      version,
      lifecycle: f.lifecycle,
      asil: f.asil,
      security: securityRelevance(p),
      asilDeviation: this.asilDeviation(f),
      current,
      history: this.history(featureId, version),
      g7: this.g7(featureId, version),
    };
  }

  /** Gate 판정 전제 — G2·G7 PASS의 분석 근거(contracts gateEvidenceBlockers). 서명이 맞지 않는 기록은 근거가 아니다 */
  gateBlockers(f: FeatureVersionRow, body: Pick<JudgeGateBody, 'gate' | 'inputResult' | 'asilReasonReviewed'>): string[] {
    if (body.inputResult !== 'PASS' || (body.gate !== 'G2' && body.gate !== 'G7')) return [];
    const v = this.view(f.featureId, f.version);
    const current = Object.fromEntries(Object.entries(v.current).filter(([, r]) => r!.valid)) as AnalysisView['current'];
    return gateEvidenceBlockers({ gate: body.gate, inputResult: body.inputResult, current, securityRelevant: v.security.relevant, asilDeviation: v.asilDeviation, asilReasonReviewed: !!body.asilReasonReviewed, g7: v.g7.filter((s) => s.valid) });
  }

  private writable(actor: Actor, action: string, target: string, f: FeatureVersionRow) {
    if (LIFECYCLE_RANK[f.lifecycle] >= LIFECYCLE_RANK.RELEASED) {
      const msg = `${f.lifecycle} 버전의 분석 근거는 바꿀 수 없습니다 — 새 Version에서 다시 분석합니다.`;
      this.audit.failed(actor, action, target, msg, 'D01-02');
      throw new DomainError('IMMUTABLE', msg);
    }
  }

  /** 분석 기록 — 담당 역할의 개인 서명(기록 본문 JCS 바이트) */
  record(actor: Actor, kind: AnalysisKind, featureId: string, version: string, body: HaraBody | TaraBody | SotifBody | HomologationBody): AnalysisRecord {
    const f = this.require(featureId, version);
    const target = `${featureId}@${version}#${kind.toLowerCase()}`;
    this.writable(actor, ACTION[kind], target, f);
    const { reason, ...rest } = body as { reason: string } & Record<string, unknown>;
    const docId = typeof rest.docId === 'string' ? rest.docId : null;
    delete rest.docId;
    return this.db.tx(() => {
      const unsigned = this.draft(kind, featureId, version, docId, rest, reason, { id: actor.id, role: ANALYSIS_AUTHOR_ROLE[kind] }, 'PERSONAL');
      const sig = this.hsm.approve(actor.id, jcs(unsigned));
      const r: AnalysisRecord = { ...unsigned, kid: sig.kid, sig: sig.value };
      this.insert(r);
      this.audit.record(actor, ACTION[kind], target, { before: unsigned.supersedes ? { recordId: unsigned.supersedes } : null, after: { recordId: r.recordId, docId, kid: sig.kid }, reason, componentId: 'D01-02' });
      this.events.publish('analysis.recorded', `${featureId}@${version}`, { recordId: r.recordId, kind, by: actor.id }, { componentId: 'D01-02', correlationId: actor.correlationId });
      return r;
    });
  }

  /**
   * 이관 기록 — 기존 시스템에서 옮긴 분석 문서(provenance IMPORT, 플랫폼 gate 키로 봉인). 출시 뒤 Version도 받는다 — 새로 쓰는 것이 아니라
   * 그때의 기록을 옮긴 것이다(개인 서명 기록은 record). 이미 지금 기록이 있는 종류는 덮지 않는다. 감사·이벤트는 record와 같은 경로.
   */
  importRecord(actor: Actor, kind: AnalysisKind, featureId: string, version: string, body: HaraBody | TaraBody | SotifBody | HomologationBody): AnalysisRecord | null {
    this.require(featureId, version);
    if (this.latest(featureId, version)[kind]) return null;
    const target = `${featureId}@${version}#${kind.toLowerCase()}`;
    const { reason, ...rest } = body as { reason: string } & Record<string, unknown>;
    const docId = typeof rest.docId === 'string' ? rest.docId : null;
    delete rest.docId;
    return this.db.tx(() => {
      const unsigned = this.draft(kind, featureId, version, docId, rest, reason, { id: actor.id, role: ANALYSIS_AUTHOR_ROLE[kind] }, 'IMPORT');
      const s = this.hsm.signDetached('gate', jcs(unsigned));
      const r: AnalysisRecord = { ...unsigned, kid: s.kid, sig: s.value };
      this.insert(r);
      this.audit.record(actor, ACTION[kind], target, { after: { recordId: r.recordId, docId, kid: s.kid, provenance: 'IMPORT' }, reason, componentId: 'D01-02' });
      this.events.publish('analysis.recorded', `${featureId}@${version}`, { recordId: r.recordId, kind, by: actor.id, provenance: 'IMPORT' }, { componentId: 'D01-02', correlationId: actor.correlationId });
      return r;
    });
  }

  /**
   * G7 서명 — SM은 지금의 HARA가, CSM은 보안 관련이면 지금의 TARA가 있어야 한다. 다른 역할의 유효한 서명과 같은 사람이면 거부(두 사람 원칙).
   * @rule FFG-LCY-001 — G7 Safety/Security Gate 결정의 승인자 두 역할
   */
  signG7(actor: Actor, role: G7SignoffRole, featureId: string, version: string, reason: string): G7Signoff {
    const f = this.require(featureId, version);
    const action = role === 'SAFETY_OFFICER' ? 'G7_SIGNOFF_SAFETY' : 'G7_SIGNOFF_SECURITY';
    const target = `${featureId}@${version}#G7`;
    const fail = (msg: string): never => {
      this.audit.failed(actor, action, target, msg, 'D01-02');
      throw new DomainError('GUARD_FAILED', msg);
    };
    this.writable(actor, action, target, f);
    const v = this.view(featureId, version);
    const hara = v.current.HARA?.valid ? v.current.HARA : undefined;
    const tara = v.current.TARA?.valid ? v.current.TARA : undefined;
    if (role === 'SAFETY_OFFICER' && !hara) fail(`G7 기능안전 서명 전에 이 Version의 ${ANALYSIS_LABEL.HARA} 기록이 있어야 합니다.`);
    if (role === 'SECURITY_OFFICER' && v.security.relevant && !tara) fail(`보안 관련 Feature(${v.security.why})라 G7 사이버보안 서명 전에 ${ANALYSIS_LABEL.TARA} 기록이 있어야 합니다.`);
    const other = v.g7.find((s) => s.valid && s.role !== role);
    if (other && other.signedBy === actor.id) fail('기능안전 서명과 사이버보안 서명은 서로 다른 사람이 합니다 — 이미 다른 쪽에 서명했습니다.');
    const mine = v.g7.find((s) => s.valid && s.role === role);
    if (mine) {
      const msg = '이 역할의 G7 서명이 이미 있습니다 — 분석 근거가 바뀌면 다시 서명합니다.';
      this.audit.failed(actor, action, target, msg, 'D01-02');
      throw new DomainError('CONFLICT', msg);
    }
    return this.db.tx(() => {
      const unsigned: G7Signoff = { signoffId: this.nextId('gate_signoff', 'G7S'), featureId, version, role, signedBy: actor.id, signedAt: this.clock.iso(), reason, bound: { HARA: v.current.HARA?.recordId ?? null, TARA: v.current.TARA?.recordId ?? null }, kid: '', sig: null };
      const sig = this.hsm.approve(actor.id, jcs(unsigned));
      const s: G7Signoff = { ...unsigned, kid: sig.kid, sig: sig.value };
      this.db.run('INSERT INTO gate_signoff (signoff_id, feature_id, feature_version, gate, role, signed_by, signed_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', s.signoffId, featureId, version, 'G7', role, actor.id, s.signedAt, JSON.stringify(s));
      this.audit.record(actor, action, target, { after: { signoffId: s.signoffId, bound: s.bound, kid: sig.kid }, reason, componentId: 'D01-02' });
      this.events.publish('gate.signed', `${featureId}@${version}`, { signoffId: s.signoffId, gate: 'G7', role, by: actor.id }, { componentId: 'D01-02', correlationId: actor.correlationId });
      return s;
    });
  }

  /** Evidence Ref에 적힌 분석 기록 ID(ANL-NNNNN)는 이 Feature Version의 것이어야 한다 — 없는 ID는 거부 */
  unknownRefs(featureId: string, version: string, evidenceRef: string | null): string | null {
    for (const id of (evidenceRef ?? '').match(/\bANL-\d{5}\b/g) ?? []) {
      const r = this.get(id);
      if (!r) return `${id}: 분석 근거 기록이 없습니다 — 분석 근거 패널의 기록 번호를 적습니다.`;
      if (r.featureId !== featureId || r.version !== version) return `${id}: ${r.featureId} ${r.version}의 분석 근거입니다 (판정 대상 ${featureId} ${version}).`;
    }
    return null;
  }
}

@Controller('api/features/:id/versions/:ver/analysis')
export class AnalysisEvidenceController {
  constructor(private readonly svc: AnalysisEvidenceService) {}

  @Get()
  view(@Param('id') id: string, @Param('ver') ver: string) {
    return this.svc.view(id, ver);
  }

  @Post('hara')
  @Roles('SAFETY_OFFICER')
  @AuditAction('ANALYSIS_HARA')
  hara(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(HaraBody)) body: HaraBody) {
    return this.svc.record(actor, 'HARA', id, ver, body);
  }

  @Post('tara')
  @Roles('SECURITY_OFFICER')
  @AuditAction('ANALYSIS_TARA')
  tara(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(TaraBody)) body: TaraBody) {
    return this.svc.record(actor, 'TARA', id, ver, body);
  }

  @Post('sotif')
  @Roles('IMPLEMENTER')
  @AuditAction('ANALYSIS_SOTIF')
  sotif(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(SotifBody)) body: SotifBody) {
    return this.svc.record(actor, 'SOTIF', id, ver, body);
  }

  @Post('homologation')
  @Roles('REGULATORY_OWNER')
  @AuditAction('ANALYSIS_HOMOLOGATION')
  homologation(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(HomologationBody)) body: HomologationBody) {
    return this.svc.record(actor, 'HOMOLOGATION', id, ver, body);
  }

  @Post('g7-safety')
  @Roles('SAFETY_OFFICER')
  @AuditAction('G7_SIGNOFF_SAFETY')
  g7Safety(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(G7SignoffBody)) body: G7SignoffBody) {
    return this.svc.signG7(actor, 'SAFETY_OFFICER', id, ver, body.reason);
  }

  @Post('g7-security')
  @Roles('SECURITY_OFFICER')
  @AuditAction('G7_SIGNOFF_SECURITY')
  g7Security(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(G7SignoffBody)) body: G7SignoffBody) {
    return this.svc.signG7(actor, 'SECURITY_OFFICER', id, ver, body.reason);
  }
}
