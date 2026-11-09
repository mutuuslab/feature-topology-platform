import { CostReviewStore } from './cost-review.store';
import { canonicalJson,type CostReviewBaseline,type CreateCostReviewBody,type PutCostReviewBody,type ActCostReviewBody } from '@ff/contracts';
// SW 개발비 산정(D07-01, docs/20-architecture/20-94) — 산정 과제·줄·MBD·전이·계수 표 버전.
// 계산은 contracts 엔진(rules/cost/engine.ts, 엑셀 1원 일치)이 한다. 금액은 산정 역할만 보고(D-COST-4, 서버 투영),
// 단가가 든 계수 표와 승인 때 고정한 결과는 KEK 봉투로 봉인한다(D-COST-5). 금액을 돌려준 조회는 COST_VIEW로 감사한다.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  COST_TRANSITIONS,
  CostBasis,
  CostSettingsInput,
  canSeeCost,
  costApprovalDutyBlocker,
  costEstimateView,
  costSettingsView,
  estimate,
  anchorSamples,
  anchorSuggestion,
  costMre,
  costRefFactsOf,
  PutCostActualBody,
  type CostActualRow,
  refStatusPolicy,
  type AddCostFeatureBody,
  type AddCostReferenceBody,
  type UpdateCostReferenceBody,
  type CostBasisDraftBody,
  type CostEstimate,
  type CostLineInputs,
  type CostProjectStatus,
  type CostRefFacts,
  costEngineSettings,
  RATE_BASES,
  costCheckRate,
  type CostCheckStatus,
  type PutCostCheckBody,
  type CostTransitionBody,
  type CreateCostProjectBody,
  type PutCostMbdBody,
  type UpdateCostLineBody,
  type UpdateCostProjectBody,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { SecretVault } from '../../../kernel/kms/key-protection';
import { openFor, sealFor } from '../../../kernel/kms/secret-columns';
import { columnValues, entryData, patchWorkbook, readZip, sharedStrings, sheetPaths } from '../../../kernel/xlsx-patch';
import { exportCells, SHEET } from './cost-export';
import { FeatureRepo } from '../../d01-policy/repos';
import { CostReferenceStore } from './cost-reference.store';
import { RefdbRepository } from '../../d01-policy/refdb/refdb.repository';

/** 계수 표 첫 판 — 엑셀 산정 도구 v1.3에서 옮긴 것(npm run cost:basis). 빈 DB에 한 번 넣는다(제품 기준 정보, 데모 시드와 무관) */
export const COST_BASIS_FILE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'reference', 'cost-basis', 'v1.3.json');
/** 엑셀 내보내기 양식 — 계수 표 v1.3의 원본 엑셀(같은 SHA-256이어야 한다). Docker·데스크톱 런타임에도 복사한다 */
export const COST_TEMPLATE_FILE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'source', 'feature_db_v1.3.xlsx');

export interface CostProjectDoc {
  estId: string;
  name: string;
  target: string;
  currency: string;
  settings: CostSettingsInput;
  /** 고정한 계수 표 버전·Feature DB 발행(§6.4) — DRAFT에서 '최신 맞추기'로만 바뀐다 */
  basisVersion: string;
  refRelease: string | null;
  /** 승인된 결과 수(개정하면 다음 승인이 rev+1) */
  rev: number;
  lastReason: string | null;
}

interface LineDoc {
  featureId: string|null;
  version: string|null;
  refId: string;
  role: 'PRIMARY' | 'INCLUDED' | 'REFERENCE';
  sourceRevision?:number;
  /** 담을 때의 Feature ASIL — 적용 ASIL이 비면 이 값(20-94 §5) */
  featureAsil: string;
  inputs: CostLineInputs;
}

interface ProjectRow {
  est_id: string;
  status: CostProjectStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  doc: string;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
@PlatformComponent('D07-01')
export class CostService implements OnModuleInit {
  private readonly referenceStore:CostReferenceStore;
  private readonly reviewStore:CostReviewStore;
  private refsCache: { key: string; map: Map<string, CostRefFacts> } | null = null;
  private template: { buf: Buffer; basis: CostBasis; fdbRows: Map<string, number>; driverRows: Map<string, number> } | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly vault: SecretVault,
    private readonly features: FeatureRepo,
    private readonly refs: RefdbRepository,
  ) {this.referenceStore=new CostReferenceStore(db,refs,features,vault,clock,version=>this.openBasis(version));this.reviewStore=new CostReviewStore(db,vault,clock,audit,estId=>this.reviewBaseline(estId));}

  /** 데모 시드 중 — 줄마다 상세를 다시 계산·열람 감사하지 않는다 */
  private quiet = false;

  onModuleInit() {
    this.ensureBasis();
  }

  /** 빈 DB에 계수 표 v1.3을 발행 상태로 넣는다(제품 기준 정보) — 데모 시드도 먼저 부른다 */
  ensureBasis() {
    if (this.db.get('SELECT 1 FROM cost_basis LIMIT 1')) return;
    const basis = CostBasis.parse(JSON.parse(readFileSync(process.env.FF_COST_BASIS_FILE ?? COST_BASIS_FILE, 'utf8')));
    const at = this.clock.iso();
    const text = JSON.stringify(basis);
    this.db.run(
      "INSERT INTO cost_basis (version, status, note, created_by, created_at, published_by, published_at, content_sha256, doc_sealed) VALUES (?, 'PUBLISHED', '엑셀 산정 도구 v1.3에서 옮김', 'seed', ?, 'seed', ?, ?, ?)",
      basis.version,
      at,
      at,
      sha(text),
      sealFor(this.vault, 'cost_basis', 'doc_sealed', basis.version, text),
    );
  }

  // ── 계수 표 ─────────────────────────────────────────────

  private basisMeta(version: string) {
    const r = this.db.get<{ version: string; status: 'DRAFT' | 'PUBLISHED'; note: string; created_by: string; created_at: string; published_by: string | null; published_at: string | null; content_sha256: string; doc_sealed: string }>('SELECT * FROM cost_basis WHERE version = ?', version);
    if (!r) throw new DomainError('NOT_FOUND', `계수 표 ${version}이(가) 없습니다.`);
    return r;
  }

  private openBasis(version: string): CostBasis {
    const r = this.basisMeta(version);
    return CostBasis.parse(JSON.parse(openFor(this.vault, 'cost_basis', 'doc_sealed', version, r.doc_sealed)));
  }

  latestBasisVersion(): string {
    const r = this.db.get<{ version: string }>("SELECT version FROM cost_basis WHERE status = 'PUBLISHED' ORDER BY published_at DESC, version DESC LIMIT 1");
    if (!r) throw new DomainError('CONFLICT', '발행된 계수 표가 없습니다 — 원가 기준 관리자가 먼저 발행합니다.');
    return r.version;
  }

  basisList() {
    return {
      items: this.db
        .all<{ version: string; status: string; note: string; created_by: string; created_at: string; published_by: string | null; published_at: string | null; content_sha256: string }>(
          'SELECT version, status, note, created_by, created_at, published_by, published_at, content_sha256 FROM cost_basis ORDER BY created_at DESC, version DESC',
        )
        .map((r) => ({ version: r.version, status: r.status, note: r.note, createdBy: r.created_by, createdAt: r.created_at, publishedBy: r.published_by, publishedAt: r.published_at, contentSha256: r.content_sha256 })),
      latest: this.db.get<{ version: string }>("SELECT version FROM cost_basis WHERE status = 'PUBLISHED' ORDER BY published_at DESC, version DESC LIMIT 1")?.version ?? null,
    };
  }

  basisDetail(actor: Actor, version: string) {
    const meta = this.basisMeta(version);
    const basis = this.openBasis(version);
    this.db.tx(() => this.audit.record(actor, 'COST_VIEW', `basis:${version}`, { after: { what: '계수·단가 표' }, componentId: 'D07-01' }));
    return { version, status: meta.status, note: meta.note, publishedAt: meta.published_at, basis };
  }

  basisDraft(actor: Actor, body: CostBasisDraftBody) {
    const parsed = CostBasis.safeParse(body.basis);
    if (!parsed.success) throw new DomainError('VALIDATION', `계수 표 형식이 맞지 않습니다: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`, { field: 'basis' });
    const basis = parsed.data;
    if (!(basis.benchmark.anchorEur > 0)) throw new DomainError('VALIDATION', '포인트당 벤치마크는 양수여야 합니다.', { field: 'basis' });
    if (this.db.get('SELECT 1 FROM cost_basis WHERE version = ?', basis.version)) throw new DomainError('CONFLICT', `계수 표 ${basis.version}이(가) 이미 있습니다 — 새 버전 이름을 쓰세요.`, { field: 'basis' });
    const text = JSON.stringify(basis);
    const at = this.clock.iso();
    this.db.tx(() => {
      this.db.run(
        "INSERT INTO cost_basis (version, status, note, created_by, created_at, content_sha256, doc_sealed) VALUES (?, 'DRAFT', ?, ?, ?, ?, ?)",
        basis.version,
        body.note,
        actor.id,
        at,
        sha(text),
        sealFor(this.vault, 'cost_basis', 'doc_sealed', basis.version, text),
      );
      this.audit.record(actor, 'COST_BASIS_DRAFT', `basis:${basis.version}`, { after: { version: basis.version, contentSha256: sha(text) }, reason: body.note, componentId: 'D07-01' });
    });
    return { version: basis.version, status: 'DRAFT' as const };
  }

  basisPublish(actor: Actor, version: string, reason: string) {
    const meta = this.basisMeta(version);
    if (meta.status === 'PUBLISHED') throw new DomainError('CONFLICT', `계수 표 ${version}은(는) 이미 발행됐습니다.`);
    const at = this.clock.iso();
    this.db.tx(() => {
      this.db.run("UPDATE cost_basis SET status = 'PUBLISHED', published_by = ?, published_at = ? WHERE version = ?", actor.id, at, version);
      this.audit.record(actor, 'COST_BASIS_PUBLISH', `basis:${version}`, { before: { status: 'DRAFT' }, after: { status: 'PUBLISHED' }, reason, componentId: 'D07-01' });
    });
    return { version, status: 'PUBLISHED' as const, publishedAt: at };
  }

  // ── 과제 ───────────────────────────────────────────────

  private row(estId: string): ProjectRow {
    const r = this.db.get<ProjectRow>('SELECT * FROM cost_project WHERE est_id = ?', estId);
    if (!r) throw new DomainError('NOT_FOUND', `산정 과제 ${estId}이(가) 없습니다.`);
    return r;
  }

  private draft(estId: string, actor: Actor, action: string): { row: ProjectRow; doc: CostProjectDoc } {
    const row = this.row(estId);
    if (row.status !== 'DRAFT') {
      this.audit.failed(actor, action, estId, `${row.status} 과제 수정 시도`, 'D07-01');
      throw new DomainError('IMMUTABLE', `${row.status === 'SUBMITTED' ? '제출된' : '승인된'} 과제는 고칠 수 없습니다 — ${row.status === 'SUBMITTED' ? '반려된 뒤' : '개정한 뒤'} 고칩니다.`);
    }
    return { row, doc: JSON.parse(row.doc) as CostProjectDoc };
  }

  private lines(estId: string): ({ lineNo: number } & LineDoc)[] {
    return this.db.all<{ line_no: number; doc: string }>('SELECT line_no, doc FROM cost_line WHERE est_id = ? ORDER BY line_no', estId).map((r) => ({ lineNo: r.line_no, ...(JSON.parse(r.doc) as LineDoc) }));
  }

  private mbd(estId: string) {
    return this.db.all<{ ref_id: string; seq: number; doc: string }>('SELECT ref_id, seq, doc FROM cost_mbd_item WHERE est_id = ? ORDER BY ref_id, seq', estId).map((r) => ({ refId: r.ref_id, seq: r.seq, counts: (JSON.parse(r.doc) as { counts: (number | null)[] }).counts }));
  }

  /** Feature DB 기준 행 → 엔진 사실. 순서(ord)는 기준 ID 순 — 합계 순서만 바뀌고 값은 같다 */
  private refFacts(): Map<string, CostRefFacts> {
    const rows = this.refs.listRefs({});
    const key = `${rows.length}|${this.refs.latestRelease()?.release ?? ''}`;
    if (this.refsCache?.key === key && !this.db.inTransaction) return this.refsCache.map;
    const map = new Map<string, CostRefFacts>(
      rows.map((r, ord) => [
        r.refId,
        {
          refId: r.refId,
          ord,
          tshirt: r.tshirt,
          asilRep: r.asilRep,
          lifecycle: r.lifecycle,
          autoQuality: r.autoQuality,
          benchmarkEur: r.benchmarkEur ?? null,
          bundleId: r.bundleId || null,
          bundleRep: !!r.bundleRep,
          sizeEvidenceGrade: r.sizeEvidenceGrade || null,
          duplicateOf: r.duplicateOf || null,
          requires: r.requires ?? [],
        },
      ]),
    );
    this.refsCache = { key, map };
    return map;
  }

  private compute(doc: CostProjectDoc, estId: string): CostEstimate {
    const basis = this.openBasis(doc.basisVersion);
    const sourceLines=this.lines(estId);
    const refs=new Map(this.refFacts());
    const hashes=new Map<string,string>();
    for(const line of sourceLines) if(line.sourceRevision) for(const reference of this.referenceStore.load(estId,line.lineNo,line.sourceRevision).snapshot.relatedReferences ?? []) refs.set(reference.refId,costRefFactsOf(reference,0));
    for(const line of sourceLines) if(line.sourceRevision) {
      const captured=this.referenceStore.load(estId,line.lineNo,line.sourceRevision);
      const prior=hashes.get(line.refId);
      if(prior && prior!==captured.metadata.referenceSha256) throw new DomainError('CONFLICT','같은 기준 행의 서로 다른 원천 개정이 섞여 있습니다 — 최신 기준으로 맞추세요.');
      hashes.set(line.refId,captured.metadata.referenceSha256);refs.set(line.refId,captured.snapshot.facts);
    }
    const lines = sourceLines.map((l) => ({ refId: l.refId, ...l.inputs, asil: l.inputs.asil ?? l.featureAsil }));
    const settings = costEngineSettings(doc.settings);
    return estimate({ basis, settings, lines, mbd: this.mbd(estId), refs });
  }

  private reviewBaseline(estId:string):CostReviewBaseline {
    const row=this.row(estId),doc=JSON.parse(row.doc)as CostProjectDoc,lines=this.lines(estId);let result:CostEstimate|null=null,error:string|null=null;
    try{if(!lines.length)throw new Error('Feature DB 산정 기준 행을 먼저 연결하세요.');if(lines.some(l=>!l.sourceRevision||this.referenceStore.view(estId,l.lineNo,l.sourceRevision).stale))throw new Error('선택한 산정 원천이 변경됐습니다. 과제 원천을 먼저 갱신하세요.');result=this.resultOf(row,doc);if(doc.basisVersion!==this.latestBasisVersion()||doc.refRelease!==(this.refs.latestRelease()?.release??null))throw new Error('과제의 계수·Feature DB 발행 기준이 최신과 다릅니다. 원천 갱신 후 재계산하세요.');}catch(e){error=e instanceof Error?e.message:String(e);}
    const referenceState=lines.map(l=>({lineNo:l.lineNo,refId:l.refId,inputs:l.inputs,sourceRevision:l.sourceRevision,reference:l.sourceRevision?this.referenceStore.load(estId,l.lineNo,l.sourceRevision).metadata:null,current:this.refs.getRef(l.refId),currentFeature:l.featureId&&l.version?this.features.get(l.featureId,l.version):null}));
    const fingerprint=sha(canonicalJson({doc,referenceState,latestBasisVersion:this.latestBasisVersion(),latestRefRelease:this.refs.latestRelease()?.release??null}));
    return {fingerprint,basisVersion:doc.basisVersion,refRelease:doc.refRelease,referenceIds:[...new Set(lines.map(l=>l.refId))],estimateTotalMm:result?.totals.totalMm??null,estimateCost:result?.totals.totalCost??null,valid:!error,error};
  }
  reviews(actor:Actor,estId:string){return this.reviewStore.list(actor,estId);}
  review(actor:Actor,estId:string,caseId:string,revision?:number){return this.reviewStore.detail(actor,estId,caseId,revision);}
  createReview(actor:Actor,estId:string,body:CreateCostReviewBody){return this.reviewStore.create(actor,estId,body);}
  updateReview(actor:Actor,estId:string,caseId:string,body:PutCostReviewBody){return this.reviewStore.update(actor,estId,caseId,body);}
  actReview(actor:Actor,estId:string,caseId:string,body:ActCostReviewBody){return this.reviewStore.action(actor,estId,caseId,body);}

  /** 승인 때 고정한 결과(최신 rev) */
  private approvedResult(estId: string, rev: number): CostEstimate {
    const r = this.db.get<{ doc_sealed: string }>('SELECT doc_sealed FROM cost_result_doc WHERE est_id = ? AND rev = ?', estId, rev);
    if (!r) throw new DomainError('INTERNAL', `${estId} 승인 결과 rev ${rev}가 없습니다.`);
    return JSON.parse(openFor(this.vault, 'cost_result_doc', 'doc_sealed', `${estId}:${rev}`, r.doc_sealed)) as CostEstimate;
  }

  private resultOf(row: ProjectRow, doc: CostProjectDoc): CostEstimate {
    return row.status === 'APPROVED' ? this.approvedResult(row.est_id, doc.rev) : this.compute(doc, row.est_id);
  }

  list(actor: Actor) {
    const money = canSeeCost(actor.role);
    const refs = new Map(this.refs.listRefs({}).map((r) => [r.refId, r]));
    const items = this.db.all<ProjectRow>('SELECT * FROM cost_project ORDER BY created_at DESC, est_id DESC').map((row) => {
      const doc = JSON.parse(row.doc) as CostProjectDoc;
      const featureCount = this.db.get<{ n: number }>('SELECT count(DISTINCT feature_id || \'@\' || version) AS n FROM cost_line WHERE est_id = ?', row.est_id)?.n ?? 0;
      let totals: { totalMm: number; totalCost?: number } | null = null;
      try {
        const r = this.resultOf(row, doc);
        totals = money ? { totalMm: r.totals.totalMm, totalCost: r.totals.totalCost } : { totalMm: r.totals.totalMm };
      } catch (e) {
        // 계산 실패(계수 표에 없는 값 등)는 목록에서 비워 두고 상세에서 이유를 보인다
        if (!(e instanceof Error)) throw e;
      }
      return {
        estId: row.est_id,
        name: doc.name,
        target: doc.target,
        status: row.status,
        currency: doc.currency,
        basisVersion: doc.basisVersion,
        basisStale: doc.basisVersion !== this.latestBasisVersion(),
        featureCount,
        referenceCount:new Set(this.lines(row.est_id).map(line=>line.refId)).size,
        totals,
        scope: this.scopeOf(row.est_id, refs),
        createdBy: row.created_by,
        updatedAt: row.updated_at,
      };
    });
    if (money && items.length) this.db.tx(() => this.audit.record(actor, 'COST_VIEW', 'projects', { after: { count: items.length }, componentId: 'D07-01' }));
    return { items, view: money ? ('FULL' as const) : ('MM_ONLY' as const) };
  }

  /**
   * 목록 탐색용 적용 범위 — 산정 줄의 Feature(국가·차종·ASIL)와 Feature DB 기준 행(분류·T-shirt)에서 모은 값(중복 없이, 정렬).
   * 목록 화면의 분류 트리·다중 선택 필터가 쓴다. 금액 없음
   */
  private scopeOf(estId: string, refs: ReadonlyMap<string, { domain: string; component: string; tshirt: string }>) {
    const sets = { countries: new Set<string>(), vehicleModels: new Set<string>(), asils: new Set<string>(), tshirts: new Set<string>(), domains: new Set<string>(), components: new Set<string>() };
    for (const l of this.lines(estId)) {
      const source=l.sourceRevision?this.referenceStore.load(estId,l.lineNo,l.sourceRevision).snapshot:null;
      const f = source?.feature ?? (l.featureId && l.version ? this.features.get(l.featureId,l.version) : undefined);
      const r = source?.reference ?? refs.get(l.refId);
      if (f?.country) sets.countries.add(f.country);
      if (f?.vehicleModel) sets.vehicleModels.add(f.vehicleModel);
      const asil = l.inputs.asil ?? l.featureAsil;
      if (asil) sets.asils.add(asil);
      if (r?.tshirt) sets.tshirts.add(r.tshirt);
      if (r?.domain) sets.domains.add(r.domain);
      if (r?.domain && r.component) sets.components.add(`${r.domain}	${r.component}`);
    }
    return Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, [...v].sort()])) as Record<keyof typeof sets, string[]>;
  }

  /** 시드 중에는 계산·열람 감사 없이 — 같은 트랜잭션의 쓰기만 */
  quietly<T>(fn: () => T): T {
    this.quiet = true;
    try {
      return fn();
    } finally {
      this.quiet = false;
    }
  }

  detail(actor: Actor, estId: string) {
    if (this.quiet) return null as unknown as ReturnType<CostService['fullDetail']>;
    return this.fullDetail(actor, estId);
  }

  private fullDetail(actor: Actor, estId: string) {
    const row = this.row(estId);
    const doc = JSON.parse(row.doc) as CostProjectDoc;
    const lines = this.lines(estId);
    const actuals = this.actualRows(estId, row.status, lines);
    let result: ReturnType<typeof costEstimateView> | null = null;
    let error: string | null = null;
    try {
      result = costEstimateView(this.resultOf(row, doc), actor.role);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const facts = this.refFacts();
    const info = new Map(this.refs.listRefs({}).map((r) => [r.refId, { nameKo: r.nameKo, component: r.component, tshirt: r.tshirt, asilRep: r.asilRep }]));
    const basis = this.openBasis(doc.basisVersion);
    const featureKeys = [...new Map(lines.filter(line=>line.featureId && line.version).map((l) => [`${l.featureId}@${l.version}`, l])).values()];
    const results = this.db.all<{ rev: number; approved_by: string; approved_at: string; reason: string; basis_version: string; result_sha256: string }>(
      'SELECT rev, approved_by, approved_at, reason, basis_version, result_sha256 FROM cost_result WHERE est_id = ? ORDER BY rev',
      estId,
    );
    if (canSeeCost(actor.role)) this.db.tx(() => this.audit.record(actor, 'COST_VIEW', estId, { after: { status: row.status, rev: doc.rev }, componentId: 'D07-01' }));
    return {
      project: { ...doc, settings: costSettingsView(doc.settings, actor.role), status: row.status, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, latestBasisVersion: this.latestBasisVersion(), latestRefRelease: this.refs.latestRelease()?.release ?? null },
      lines: lines.map((l) => {
        const source=l.sourceRevision?this.referenceStore.view(estId,l.lineNo,l.sourceRevision):null;
        const r=source?.reference;
        return {...l,source,refStatus:this.refs.statusOf(l.refId) ?? null,refKnown:facts.has(l.refId),ref:r?{nameKo:r.nameKo,component:r.component,tshirt:r.tshirt,asilRep:r.asilRep}:info.get(l.refId) ?? null};
      }),
      features: featureKeys.map((l) => {
        const f = this.features.get(l.featureId, l.version);
        return { featureId: l.featureId!, version: l.version!, name: f?.name ?? null, asil: l.featureAsil, lifecycle: f?.lifecycle ?? null };
      }),
      /** 화면 입력 목록 — 계수 표의 이름들(금액 없음) */
      options: {
        aace: Object.keys(basis.aace),
        confidence: Object.keys(basis.confidence),
        presets: Object.keys(basis.presets),
        methods: Object.keys(basis.methods),
        rateBases: [...RATE_BASES],
        drivers: Object.entries(basis.cocomo).map(([key, d]) => ({ key, label: d.label, ratings: (['VL', 'L', 'N', 'H', 'VH', 'XH'] as const).filter((r) => d[r] != null) })),
        changeTypes: basis.reuse.map((r) => r.changeType),
        asil: Object.keys(basis.asil),
        currencies: Object.keys(basis.currencies),
        directExpenseItems: basis.directExpenseItems,
      },
      /** 과제 통화 표시 환율(원/단위, D-COST-10) — 금액을 보는 역할만 */
      ...(canSeeCost(actor.role) ? { fx: basis.currencies[doc.currency] ?? null } : {}),
      mbd: this.mbd(estId),
      checks: this.checks(doc.basisVersion, estId),
      actuals,
      mre: result ? costMre(result.lines, new Map(actuals.map((r) => [r.refId, r.actual]))) : null,
      result,
      error,
      approvals: results.map((r) => ({ rev: r.rev, approvedBy: r.approved_by, approvedAt: r.approved_at, reason: r.reason, basisVersion: r.basis_version, resultSha256: r.result_sha256, sources:this.db.all<{line_no:number;source_revision:number}>('SELECT line_no,source_revision FROM cost_approval_source WHERE est_id=? AND approval_rev=? ORDER BY line_no',estId,r.rev).map(source=>({lineNo:source.line_no,revision:source.source_revision})) })),
      view: canSeeCost(actor.role) ? ('FULL' as const) : ('MM_ONLY' as const),
    };
  }

  private nextEstId(): string {
    const r = this.db.get<{ m: number | null }>("SELECT max(CAST(substr(est_id, 5) AS INTEGER)) AS m FROM cost_project");
    return `EST-${String((r?.m ?? 0) + 1).padStart(4, '0')}`;
  }

  private checkSettings(basisVersion: string, s: CostSettingsInput, currency: string) {
    const b = this.openBasis(basisVersion);
    const bad: [string, boolean][] = [
      [`AACE 등급 '${s.aace}'`, !b.aace[s.aace]],
      [`신뢰수준 '${s.confidence}'`, b.confidence[s.confidence] === undefined],
      [`대가 산정 방식 '${s.method}'`, !b.methods[s.method]],
      [`프리셋 '${s.preset}'`, s.preset !== '직접 설정' && !b.presets[s.preset]],
      [`통화 '${currency}'`, !b.currencies[currency]],
      ...Object.keys(s.drivers).map((d): [string, boolean] => [`드라이버 '${d}'`, !b.cocomo[d]]),
    ];
    const hit = bad.filter(([, x]) => x).map(([w]) => w);
    if (hit.length) throw new DomainError('VALIDATION', `계수 표 ${basisVersion}에 없는 값입니다: ${hit.join(', ')}`, { field: 'settings' });
  }

  create(actor: Actor, body: CreateCostProjectBody) {
    const basisVersion = this.latestBasisVersion();
    const settings = { ...body.settings, drivers: { ...Object.fromEntries(Object.keys(this.openBasis(basisVersion).cocomo).map((d) => [d, 'N'])), ...body.settings.drivers } };
    this.checkSettings(basisVersion, settings, body.currency);
    const at = this.clock.iso();
    return this.db.tx(() => {
      const estId = this.nextEstId();
      const doc: CostProjectDoc = { estId, name: body.name, target: body.target, currency: body.currency, settings, basisVersion, refRelease: this.refs.latestRelease()?.release ?? null, rev: 0, lastReason: null };
      this.db.run("INSERT INTO cost_project (est_id, status, created_by, created_at, updated_at, doc) VALUES (?, 'DRAFT', ?, ?, ?, ?)", estId, actor.id, at, at, JSON.stringify(doc));
      for(const selection of body.references ?? []) this.appendReference(actor,estId,doc,selection,'Feature DB 기준으로 산정 시작');
      this.audit.record(actor, 'COST_PROJECT_CREATE', estId, { after: { name: doc.name, basisVersion, refRelease: doc.refRelease }, componentId: 'D07-01' });
      return { ...doc, status: 'DRAFT' as const };
    });
  }

  update(actor: Actor, estId: string, body: UpdateCostProjectBody) {
    const { doc } = this.draft(estId, actor, 'COST_PROJECT_UPDATE');
    const next: CostProjectDoc = {
      ...doc,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.target !== undefined ? { target: body.target } : {}),
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
      ...(body.settings ? { settings: { ...body.settings, drivers: { ...doc.settings.drivers, ...body.settings.drivers } } } : {}),
      ...(body.useLatestBasis ? { basisVersion: this.latestBasisVersion(), refRelease: this.refs.latestRelease()?.release ?? null } : {}),
    };
    this.checkSettings(next.basisVersion, next.settings, next.currency);
    this.db.tx(() => {
      this.db.run('UPDATE cost_project SET doc = ?, updated_at = ? WHERE est_id = ?', JSON.stringify(next), this.clock.iso(), estId);
      if(body.useLatestBasis) this.refreshReferenceSources(actor,estId,next);
      this.audit.record(actor, 'COST_PROJECT_UPDATE', estId, { before: { basisVersion: doc.basisVersion }, after: { basisVersion: next.basisVersion, changed: Object.keys(body) }, componentId: 'D07-01' });
    });
    return this.detail(actor, estId);
  }

  reference(actor:Actor,refId:string,basisVersion=this.latestBasisVersion()) {
    if(!canSeeCost(actor.role)) throw new DomainError('FORBIDDEN','산정 원천의 금액 정보는 산정 역할만 조회할 수 있습니다.');
    const result=this.referenceStore.preview(refId,basisVersion);
    this.db.tx(()=>this.audit.record(actor,'COST_VIEW',`reference:${refId}`,{after:{basisVersion,refRelease:result.refRelease},componentId:'D07-01'}));
    return result;
  }

  referenceHistory(actor:Actor,estId:string,lineNo:number,revision:number) {
    this.row(estId);
    const source=this.referenceStore.view(estId,lineNo,revision);
    if(!canSeeCost(actor.role)) return source;
    this.db.tx(()=>this.audit.record(actor,'COST_VIEW',`${estId}#${lineNo}:source:${revision}`,{componentId:'D07-01'}));
    return {...source,snapshot:this.referenceStore.load(estId,lineNo,revision).snapshot};
  }

  private referenceLine(value:ReturnType<CostReferenceStore['validate']>,revision:number,inputs:CostLineInputs={qty:1}):LineDoc {
    const f=value.feature;
    return {featureId:f?.featureId ?? null,version:f?.version ?? null,refId:value.reference.refId,role:f?(f.featureRefs ?? []).find(link=>link.refId===value.reference.refId)!.role:'REFERENCE',featureAsil:f?.asil ?? value.reference.asilRep,sourceRevision:revision,inputs};
  }

  private appendReference(actor:Actor,estId:string,project:CostProjectDoc,selection:AddCostReferenceBody,reason:string) {
    if(this.db.get('SELECT 1 FROM cost_line WHERE est_id=? AND ref_id=?',estId,selection.refId)) throw new DomainError('CONFLICT','이 기준 행은 이미 과제에 있습니다 — 기존 줄의 Feature 연결·원천을 변경하세요.',{field:'refId'});
    const value=this.referenceStore.validate(selection,project.basisVersion,project.refRelease);
    const lineNo=this.referenceStore.nextLineNo(estId);
    const captured=this.referenceStore.capture(actor,estId,lineNo,value,reason);
    const line=this.referenceLine(value,captured.revision);
    this.db.run('INSERT INTO cost_line(est_id,line_no,feature_id,version,ref_id,role,doc) VALUES(?,?,?,?,?,?,?)',estId,lineNo,line.featureId,line.version,line.refId,line.role,JSON.stringify(line));
    this.audit.record(actor,'COST_REFERENCE_ADD',`${estId}#${lineNo}`,{after:{refId:line.refId,featureId:line.featureId,version:line.version,revision:captured.revision,release:captured.release,referenceSha256:captured.referenceSha256},reason,componentId:'D07-01'});
    return lineNo;
  }

  addReference(actor:Actor,estId:string,selection:AddCostReferenceBody) {
    const {doc}=this.draft(estId,actor,'COST_REFERENCE_ADD');
    return this.db.tx(()=>{this.appendReference(actor,estId,doc,selection,'Feature DB 기준 행 추가');this.touch(estId);return this.detail(actor,estId);});
  }

  updateReference(actor:Actor,estId:string,lineNo:number,body:UpdateCostReferenceBody) {
    const {doc}=this.draft(estId,actor,'COST_REFERENCE_UPDATE');
    return this.db.tx(()=>{
      const line=this.lines(estId).find(line=>line.lineNo===lineNo);
      if(!line) throw new DomainError('NOT_FOUND','산정 기준 행이 없습니다.');
      if((line.sourceRevision ?? 0)!==body.revision) throw new DomainError('CONFLICT','다른 담당자가 원천을 변경했습니다 — 과제를 다시 불러오세요.');
      if(body.selection.refId!==line.refId) throw new DomainError('VALIDATION','원천 변경은 같은 기준 행에서만 가능합니다. 다른 기준 행은 별도로 추가하세요.',{field:'refId'});
      const value=this.referenceStore.validate(body.selection,doc.basisVersion,doc.refRelease);
      const captured=this.referenceStore.capture(actor,estId,lineNo,value,body.reason);
      const next=this.referenceLine(value,captured.revision,line.inputs);
      this.db.run('UPDATE cost_line SET feature_id=?,version=?,role=?,doc=? WHERE est_id=? AND line_no=?',next.featureId,next.version,next.role,JSON.stringify(next),estId,lineNo);
      this.touch(estId);
      this.audit.record(actor,'COST_REFERENCE_UPDATE',`${estId}#${lineNo}`,{before:{revision:line.sourceRevision ?? 0,featureId:line.featureId,version:line.version},after:{revision:captured.revision,release:captured.release,referenceSha256:captured.referenceSha256,featureId:next.featureId,version:next.version},reason:body.reason,componentId:'D07-01'});
      return this.detail(actor,estId);
    });
  }

  /** Explicit latest-basis action captures a new source revision; old source bodies and approved results remain intact. */
  private refreshReferenceSources(actor:Actor,estId:string,project:CostProjectDoc) {
    for(const line of this.lines(estId)) {
      const preview=this.referenceStore.preview(line.refId,project.basisVersion);
      const feature=line.featureId?preview.features.find(feature=>feature.featureId===line.featureId && feature.version===line.version):null;
      if(line.featureId && !feature) throw new DomainError('CONFLICT','기존 Feature가 기준 행을 더 이상 참조하지 않습니다 — 연결을 먼저 확인하세요.',{refId:line.refId});
      const selection:AddCostReferenceBody={refId:line.refId,refRelease:preview.refRelease ?? '',referenceSha256:preview.referenceSha256,feature:feature?{featureId:feature.featureId,version:feature.version,sha256:feature.sha256}:null};
      const value=this.referenceStore.validate(selection,project.basisVersion,project.refRelease);
      const captured=this.referenceStore.capture(actor,estId,line.lineNo,value,'최신 산정 기준 명시 적용');
      const next=this.referenceLine(value,captured.revision,line.inputs);
      this.db.run('UPDATE cost_line SET feature_id=?,version=?,role=?,doc=? WHERE est_id=? AND line_no=?',next.featureId,next.version,next.role,JSON.stringify(next),estId,line.lineNo);
    }
  }

  removeLine(actor:Actor,estId:string,lineNo:number) {
    this.draft(estId,actor,'COST_LINE_REMOVE');
    const line=this.lines(estId).find(line=>line.lineNo===lineNo);
    if(!line) throw new DomainError('NOT_FOUND','산정 기준 행이 없습니다.');
    return this.db.tx(()=>{
      this.db.run('DELETE FROM cost_line WHERE est_id=? AND line_no=?',estId,lineNo);
      if(!this.db.get('SELECT 1 FROM cost_line WHERE est_id=? AND ref_id=?',estId,line.refId)) this.db.run('DELETE FROM cost_mbd_item WHERE est_id=? AND ref_id=?',estId,line.refId);
      this.touch(estId);this.audit.record(actor,'COST_LINE_REMOVE',`${estId}#${lineNo}`,{before:{refId:line.refId,sourceRevision:line.sourceRevision ?? null},componentId:'D07-01'});
      return this.detail(actor,estId);
    });
  }

  addFeature(actor: Actor, estId: string, body: AddCostFeatureBody) {
    const {doc:project}=this.draft(estId, actor, 'COST_FEATURE_ADD');
    const f = this.features.get(body.featureId, body.version);
    if (!f) throw new DomainError('NOT_FOUND', `${body.featureId} ${body.version}을(를) 찾을 수 없습니다.`);
    const links = f.featureRefs ?? [];
    if (!links.length) throw new DomainError('VALIDATION', `${body.featureId} ${body.version}에 Feature DB 연결이 없습니다 — Feature에 기준 행을 먼저 연결하세요(D-COST-9).`, { field: 'featureId' });
    if (this.db.get('SELECT 1 FROM cost_line WHERE est_id = ? AND feature_id = ? AND version = ?', estId, body.featureId, body.version)) throw new DomainError('CONFLICT', `${body.featureId} ${body.version}은(는) 이미 담겨 있습니다.`);
    const blocked = links.filter((l) => {
      const s = this.refs.statusOf(l.refId);
      return !s || !refStatusPolicy(s).costUsable;
    });
    if (blocked.length) throw new DomainError('VALIDATION', `산정에 쓸 수 없는 기준 행이 있습니다(요청 중·폐기): ${blocked.map((l) => l.refId).join(', ')}`, { field: 'featureId', refs: blocked.map((l) => l.refId) });
    return this.db.tx(() => {
      let no=this.referenceStore.nextLineNo(estId)-1;
      // 대표 먼저, 그다음 포함 — 화면에서 Feature 아래 대표 줄이 위에 온다
      for (const l of [...links].sort((a, b) => (a.role === b.role ? 0 : a.role === 'PRIMARY' ? -1 : 1))) {
        const capture=this.referenceStore.capture(actor,estId,++no,this.referenceStore.fromFeature(this.refs.getRef(l.refId)!,f,project.basisVersion,project.refRelease),'등록 Feature의 기준 행 연결');
        const doc: LineDoc = { featureId: f.featureId, version: f.version, refId: l.refId, role: l.role, featureAsil: f.asil, inputs: { qty: 1 },sourceRevision:capture.revision };
        this.db.run('INSERT INTO cost_line (est_id, line_no, feature_id, version, ref_id, role, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', estId, no, f.featureId, f.version, l.refId, l.role, JSON.stringify(doc));
      }
      this.touch(estId);
      this.audit.record(actor, 'COST_FEATURE_ADD', estId, { after: { featureId: f.featureId, version: f.version, refs: links.map((l) => l.refId) }, componentId: 'D07-01' });
      return this.detail(actor, estId);
    });
  }

  removeFeature(actor: Actor, estId: string, featureId: string, version: string) {
    this.draft(estId, actor, 'COST_FEATURE_REMOVE');
    const refIds = this.db.all<{ ref_id: string }>('SELECT ref_id FROM cost_line WHERE est_id = ? AND feature_id = ? AND version = ?', estId, featureId, version).map((r) => r.ref_id);
    if (!refIds.length) throw new DomainError('NOT_FOUND', `${featureId} ${version}은(는) 이 과제에 없습니다.`);
    return this.db.tx(() => {
      this.db.run('DELETE FROM cost_line WHERE est_id = ? AND feature_id = ? AND version = ?', estId, featureId, version);
      // 다른 Feature가 쓰지 않는 기준 행의 MBD 작업도 지운다
      for (const refId of refIds) if (!this.db.get('SELECT 1 FROM cost_line WHERE est_id = ? AND ref_id = ?', estId, refId)) this.db.run('DELETE FROM cost_mbd_item WHERE est_id = ? AND ref_id = ?', estId, refId);
      this.touch(estId);
      this.audit.record(actor, 'COST_FEATURE_REMOVE', estId, { before: { featureId, version, refs: refIds }, componentId: 'D07-01' });
      return this.detail(actor, estId);
    });
  }

  updateLine(actor: Actor, estId: string, lineNo: number, body: UpdateCostLineBody) {
    const { doc } = this.draft(estId, actor, 'COST_LINE_UPDATE');
    const r = this.db.get<{ doc: string }>('SELECT doc FROM cost_line WHERE est_id = ? AND line_no = ?', estId, lineNo);
    if (!r) throw new DomainError('NOT_FOUND', `${estId}에 ${lineNo}번 줄이 없습니다.`);
    if (body.changeType && !this.openBasis(doc.basisVersion).reuse.some((x) => x.changeType === body.changeType))
      throw new DomainError('VALIDATION', `계수 표 ${doc.basisVersion}에 변경 유형 '${body.changeType}'이 없습니다.`, { field: 'changeType' });
    const line = JSON.parse(r.doc) as LineDoc;
    const next: LineDoc = { ...line, inputs: { ...line.inputs, ...body } };
    return this.db.tx(() => {
      this.db.run('UPDATE cost_line SET doc = ? WHERE est_id = ? AND line_no = ?', JSON.stringify(next), estId, lineNo);
      this.touch(estId);
      this.audit.record(actor, 'COST_LINE_UPDATE', `${estId}#${lineNo}`, { before: line.inputs, after: next.inputs, componentId: 'D07-01' });
      return this.detail(actor, estId);
    });
  }

  putMbd(actor: Actor, estId: string, refId: string, body: PutCostMbdBody) {
    this.draft(estId, actor, 'COST_MBD_PUT');
    if (!this.db.get('SELECT 1 FROM cost_line WHERE est_id = ? AND ref_id = ?', estId, refId)) throw new DomainError('NOT_FOUND', `${refId}은(는) 이 과제의 줄이 아닙니다.`);
    return this.db.tx(() => {
      this.db.run('DELETE FROM cost_mbd_item WHERE est_id = ? AND ref_id = ?', estId, refId);
      body.items.forEach((it, i) => this.db.run('INSERT INTO cost_mbd_item (est_id, ref_id, seq, doc) VALUES (?, ?, ?, ?)', estId, refId, i + 1, JSON.stringify({ counts: it.counts })));
      this.touch(estId);
      this.audit.record(actor, 'COST_MBD_PUT', `${estId}:${refId}`, { after: { items: body.items.length }, componentId: 'D07-01' });
      return this.detail(actor, estId);
    });
  }

  private touch(estId: string) {
    this.db.run('UPDATE cost_project SET updated_at = ? WHERE est_id = ?', this.clock.iso(), estId);
  }

  transition(actor: Actor, estId: string, body: CostTransitionBody) {
    const row = this.row(estId);
    const doc = JSON.parse(row.doc) as CostProjectDoc;
    const rule = COST_TRANSITIONS.find((t) => t.action === body.action && t.from === row.status);
    const action = `COST_PROJECT_${body.action}`;
    const fail = (code: 'CONFLICT' | 'FORBIDDEN' | 'SEPARATION_OF_DUTY' | 'GUARD_FAILED', message: string) => {
      this.audit.failed(actor, action, estId, message, 'D07-01');
      return new DomainError(code, message);
    };
    if (!rule) throw fail('CONFLICT', `${row.status} 과제에는 '${body.action}'을(를) 할 수 없습니다.`);
    if (!(rule.roles as readonly string[]).includes(actor.role)) throw fail('FORBIDDEN', `${body.action}은(는) ${rule.roles.join('·')} 역할만 할 수 있습니다.`);
    if (body.action === 'APPROVE' || body.action === 'REJECT') {
      const why = costApprovalDutyBlocker({ createdBy: row.created_by }, actor.id);
      if (why) throw fail('SEPARATION_OF_DUTY', why);
    }
    let result: CostEstimate | null = null;
    if (body.action === 'SUBMIT' || body.action === 'APPROVE') {
      const lines = this.lines(estId);
      if (!lines.length) throw fail('GUARD_FAILED', '산정 기준 행이 없습니다 — Feature DB에서 기준 행을 담은 뒤 제출합니다.');
      if(lines.some(line=>!line.sourceRevision)) throw fail('GUARD_FAILED','원천 기록이 없는 이전 산정 줄이 있습니다 — 최신 기준을 명시 적용한 뒤 제출하세요.');
      const blocked = lines.filter((l) => {
        const s = this.refs.statusOf(l.refId);
        return !s || !refStatusPolicy(s).costUsable;
      });
      if(lines.some(line=>line.sourceRevision && this.referenceStore.view(estId,line.lineNo,line.sourceRevision).stale)) throw fail('GUARD_FAILED','선택한 산정 원천이 변경됐습니다 — 최신 기준을 확인하고 재검토하세요.');
      if (blocked.length) throw fail('GUARD_FAILED', `산정에 쓸 수 없게 된 기준 행이 있습니다: ${[...new Set(blocked.map((l) => l.refId))].join(', ')}`);
      try {
        result = this.compute(doc, estId);
      } catch (e) {
        throw fail('GUARD_FAILED', `계산할 수 없습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const at = this.clock.iso();
    return this.db.tx(() => {
      let next: CostProjectDoc = { ...doc, lastReason: body.reason };
      if (body.action === 'REVISE') this.foldActuals(estId);
      if (body.action === 'APPROVE') {
        const rev = doc.rev + 1;
        const text = JSON.stringify(result);
        const inputs = JSON.stringify({ settings: doc.settings, lines: this.lines(estId), mbd: this.mbd(estId) });
        this.db.run(
          'INSERT INTO cost_result (est_id, rev, approved_by, approved_at, reason, basis_version, ref_release, input_sha256, result_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          estId,
          rev,
          actor.id,
          at,
          body.reason,
          doc.basisVersion,
          doc.refRelease,
          sha(inputs),
          sha(text),
        );
        this.db.run('INSERT INTO cost_result_doc (est_id, rev, doc_sealed) VALUES (?, ?, ?)', estId, rev, sealFor(this.vault, 'cost_result_doc', 'doc_sealed', `${estId}:${rev}`, text));
        for(const line of this.lines(estId)) this.db.run('INSERT INTO cost_approval_source(est_id,approval_rev,line_no,source_revision) VALUES(?,?,?,?)',estId,rev,line.lineNo,line.sourceRevision!);
        next = { ...next, rev };
      }
      this.db.run('UPDATE cost_project SET status = ?, doc = ?, updated_at = ? WHERE est_id = ?', rule.to, JSON.stringify(next), at, estId);
      this.audit.record(actor, action, estId, { before: { status: row.status }, after: { status: rule.to, rev: next.rev }, reason: body.reason, componentId: 'D07-01' });
      return { estId, status: rule.to, rev: next.rev };
    });
  }

  // ── 검토 체크리스트(07) ─────────────────────────────────

  private checkRows(estId: string) {
    return new Map(
      this.db
        .all<{ no: number; status: CostCheckStatus; memo: string; updated_by: string; updated_at: string }>('SELECT no, status, memo, updated_by, updated_at FROM cost_check WHERE est_id = ?', estId)
        .map((r) => [r.no, { status: r.status, memo: r.memo, updatedBy: r.updated_by, updatedAt: r.updated_at }]),
    );
  }

  private checks(basisVersion: string, estId: string) {
    const list = this.openBasis(basisVersion).checklist;
    const got = this.checkRows(estId);
    const items = list.map((c) => ({ ...c, status: got.get(c.no)?.status ?? ('미확인' as CostCheckStatus), memo: got.get(c.no)?.memo ?? '', updatedBy: got.get(c.no)?.updatedBy ?? null, updatedAt: got.get(c.no)?.updatedAt ?? null }));
    return { items, rate: costCheckRate(items.map((i) => i.status)), open: items.filter((i) => i.status === '보완 필요').length, unchecked: items.filter((i) => i.status === '미확인').length };
  }

  putCheck(actor: Actor, estId: string, no: number, body: PutCostCheckBody) {
    const row = this.row(estId);
    const doc = JSON.parse(row.doc) as CostProjectDoc;
    if (row.status === 'APPROVED') throw new DomainError('CONFLICT', `${estId}은(는) 승인된 과제라 검토 상태를 바꿀 수 없습니다 — 개정한 뒤 바꿉니다.`);
    if (!this.openBasis(doc.basisVersion).checklist.some((c) => c.no === no)) throw new DomainError('NOT_FOUND', `검토 항목 ${no}번이 계수 표 ${doc.basisVersion}에 없습니다.`);
    const before = this.checkRows(estId).get(no) ?? null;
    return this.db.tx(() => {
      this.db.run(
        'INSERT INTO cost_check (est_id, no, status, memo, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (est_id, no) DO UPDATE SET status = excluded.status, memo = excluded.memo, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
        estId,
        no,
        body.status,
        body.memo,
        actor.id,
        this.clock.iso(),
      );
      this.audit.record(actor, 'COST_CHECK_PUT', `${estId}:${no}`, { before: before && { status: before.status }, after: { status: body.status }, componentId: 'D07-01' });
      return this.checks(doc.basisVersion, estId);
    });
  }

  // ── 엑셀 내보내기(D-COST-13) ─────────────────────────────

  private loadTemplate() {
    if (this.template) return this.template;
    const buf = readFileSync(process.env.FF_COST_TEMPLATE ?? COST_TEMPLATE_FILE);
    const basis = CostBasis.parse(JSON.parse(readFileSync(process.env.FF_COST_BASIS_FILE ?? COST_BASIS_FILE, 'utf8')));
    const hash = createHash('sha256').update(buf).digest('hex');
    if (basis.source && basis.source.sha256 !== hash) throw new DomainError('INTERNAL', `엑셀 양식의 SHA-256(${hash.slice(0, 12)}…)이 계수 표 v1.3의 원본(${basis.source.sha256.slice(0, 12)}…)과 다릅니다.`);
    const entries = readZip(buf);
    const paths = sheetPaths(entries);
    const shared = sharedStrings(entries);
    const xml = (sheet: string) => entryData(entries.find((e) => e.name === paths.get(sheet))!).toString('utf8');
    const fdbRows = new Map<string, number>();
    for (const [row, v] of columnValues(xml(SHEET.fdb), 'A', shared)) if (row >= 5 && typeof v === 'string') fdbRows.set(v, row);
    const driverRows = new Map<string, number>();
    for (const [row, v] of columnValues(xml(SHEET.settings), 'B', shared)) if (row >= 32 && row <= 44 && typeof v === 'string' && basis.cocomo[v]) driverRows.set(v, row);
    this.template = { buf, basis, fdbRows, driverRows };
    return this.template;
  }

  export(actor: Actor, estId: string) {
    const row = this.row(estId);
    const doc = JSON.parse(row.doc) as CostProjectDoc;
    const t = this.loadTemplate();
    const facts = this.refFacts();
    const { cells, warnings } = exportCells({
      basis: this.openBasis(doc.basisVersion),
      templateBasis: t.basis,
      project: { estId, name: doc.name, target: doc.target, createdBy: row.created_by, createdAt: row.created_at, basisVersion: doc.basisVersion, settings: doc.settings },
      lines: this.lines(estId),
      mbd: this.mbd(estId),
      checks: this.checkRows(estId),
      asilRep: new Map([...facts].map(([k, v]) => [k, v.asilRep])),
      fdbRows: t.fdbRows,
      driverRows: t.driverRows,
    });
    const buf = patchWorkbook(t.buf, cells, { clearCachedResults: true });
    this.db.tx(() => this.audit.record(actor, 'COST_EXPORT', estId, { after: { status: row.status, rev: doc.rev, basisVersion: doc.basisVersion, warnings: warnings.length, bytes: buf.length }, componentId: 'D07-01' }));
    return { buf, warnings, filename: `SW_cost_${estId}.xlsx` };
  }
  /** 승인 전 줄 입력의 합, 승인 후에는 기준 행별 후속 기록이 우선한다. MRE에서 빠진 행도 입력·삭제할 수 있게 따로 반환한다. */
  private actualRows(estId: string, status: CostProjectStatus, lines: ({ lineNo: number } & LineDoc)[] = this.lines(estId)): CostActualRow[] {
    const rows = new Map<string, CostActualRow>();
    for (const line of lines) if ((line.inputs.actual ?? 0) > 0) {
      rows.set(line.refId, { refId: line.refId, actual: (rows.get(line.refId)?.actual ?? 0) + line.inputs.actual!, override: false });
    }
    if (status === 'APPROVED') for (const row of this.db.all<{ ref_id: string; actual: number }>('SELECT ref_id, actual FROM cost_actual WHERE est_id = ? ORDER BY ref_id', estId)) {
      rows.set(row.ref_id, { refId: row.ref_id, actual: row.actual, override: true });
    }
    return [...rows.values()].sort((a, b) => a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0);
  }

  /** 승인 후 실적은 개정할 때 한 번만 첫 줄로 옮긴다. 승인 원문·해시는 변경하지 않는다. */
  private foldActuals(estId: string) {
    const lines = this.lines(estId);
    for (const row of this.db.all<{ ref_id: string; actual: number }>('SELECT ref_id, actual FROM cost_actual WHERE est_id = ?', estId)) {
      lines.filter((line) => line.refId === row.ref_id).forEach(({ lineNo, ...line }, index) => {
        this.db.run('UPDATE cost_line SET doc = ? WHERE est_id = ? AND line_no = ?', JSON.stringify({ ...line, inputs: { ...line.inputs, actual: index === 0 ? row.actual : null } }), estId, lineNo);
      });
    }
    this.db.run('DELETE FROM cost_actual WHERE est_id = ?', estId);
  }

  putActual(actor: Actor, estId: string, refId: string, input: PutCostActualBody) {
    if (actor.role !== 'COST_ESTIMATOR') throw new DomainError('FORBIDDEN', '실적 공수는 산정 작성 역할만 기록할 수 있습니다.');
    const parsed = PutCostActualBody.safeParse(input);
    if (!parsed.success) throw new DomainError('VALIDATION', '실적 공수는 양수 또는 지우기 값이어야 합니다.');
    const body = parsed.data;
    return this.db.tx(() => {
      if (this.row(estId).status !== 'APPROVED') throw new DomainError('CONFLICT', '승인된 과제에만 후속 실적을 기록합니다. 작성 중에는 줄 입력을 사용하세요.');
      if (!this.db.get('SELECT 1 FROM cost_line WHERE est_id = ? AND ref_id = ?', estId, refId)) throw new DomainError('NOT_FOUND', '이 과제에 해당 기준 행이 없습니다.');
      const before = this.db.get<{ actual: number }>('SELECT actual FROM cost_actual WHERE est_id = ? AND ref_id = ?', estId, refId)?.actual ?? null;
      if (body.actual === null) this.db.run('DELETE FROM cost_actual WHERE est_id = ? AND ref_id = ?', estId, refId);
      else this.db.run('INSERT INTO cost_actual (est_id, ref_id, actual, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (est_id, ref_id) DO UPDATE SET actual = excluded.actual, updated_by = excluded.updated_by, updated_at = excluded.updated_at', estId, refId, body.actual, actor.id, this.clock.iso());
      this.audit.record(actor, 'COST_ACTUAL_PUT', `${estId}:${refId}`, { before: { actual: before }, after: { actual: body.actual }, componentId: 'D07-01' });
      return this.detail(actor, estId);
    });
  }

  /** 승인된 과제 전체의 기준 행 실적을 합친다. 공개 벤치마크가 있으므로 서버에서도 금액 역할을 검사한다. */
  calibration(actor: Actor) {
    if (!canSeeCost(actor.role)) throw new DomainError('FORBIDDEN', '교정 제안은 구매 산정 역할만 볼 수 있습니다.');
    const basisVersion = this.latestBasisVersion();
    const basis = this.openBasis(basisVersion);
    const facts = this.refFacts();
    const info = new Map(this.refs.listRefs({}).map((ref) => [ref.refId, { nameKo: ref.nameKo, component: ref.component }]));
    const samples = anchorSamples(basis, facts.values()).map((sample) => ({ ...sample, nameKo: sample.kind === 'single' ? info.get(sample.id)?.nameKo ?? null : null }));
    const suggestion = anchorSuggestion(basis, facts.values());
    const rows: { estId: string; name: string; refId: string; nameKo: string | null; component: string | null; e: number; actual: number; mre: number }[] = [];
    let projects = 0;
    let approvedProjects = 0;
    let missing = 0;
    const missingByComponent = new Map<string, number>();
    const actuals = new Map<string, Map<string, number>>();
    for (const row of this.db.all<{ est_id: string; ref_id: string; actual: number }>('SELECT est_id, ref_id, actual FROM cost_actual')) {
      const map = actuals.get(row.est_id) ?? new Map<string, number>(); map.set(row.ref_id, row.actual); actuals.set(row.est_id, map);
    }
    const baselineActuals = new Map<string, Map<string, number>>();
    for (const row of this.db.all<{ est_id: string; ref_id: string; doc: string }>("SELECT l.est_id, l.ref_id, l.doc FROM cost_line l JOIN cost_project p ON p.est_id = l.est_id WHERE p.status = 'APPROVED' ORDER BY l.est_id, l.line_no")) {
      const line = JSON.parse(row.doc) as LineDoc;
      if (!((line.inputs.actual ?? 0) > 0)) continue;
      const map = baselineActuals.get(row.est_id) ?? new Map<string, number>(); map.set(row.ref_id, (map.get(row.ref_id) ?? 0) + line.inputs.actual!); baselineActuals.set(row.est_id, map);
    }
    for (const project of this.db.all<ProjectRow>("SELECT * FROM cost_project WHERE status = 'APPROVED' ORDER BY est_id")) {
      approvedProjects++;
      const doc = JSON.parse(project.doc) as CostProjectDoc;
      const effective = new Map([...(baselineActuals.get(project.est_id) ?? []), ...(actuals.get(project.est_id) ?? [])]);
      const resultLines = this.approvedResult(project.est_id, doc.rev).lines;
      const mre = costMre(resultLines, effective);
      missing += mre.missing;
      const measured = new Set(mre.rows.map((row) => row.refId));
      for (const refId of new Set(resultLines.filter((line) => line.effQty > 0).map((line) => line.refId))) if (!measured.has(refId)) {
        const component = info.get(refId)?.component ?? '—'; missingByComponent.set(component, (missingByComponent.get(component) ?? 0) + 1);
      }
      if (mre.n) projects++;
      for (const row of mre.rows) rows.push({ ...row, estId: project.est_id, name: doc.name, nameKo: info.get(row.refId)?.nameKo ?? null, component: info.get(row.refId)?.component ?? null });
    }
    const groups = new Map<string, { n: number; sum: number }>();
    for (const row of rows) { const component = row.component ?? '—'; const group = groups.get(component) ?? { n: 0, sum: 0 }; group.n++; group.sum += row.mre; groups.set(component, group); }
    this.db.tx(() => this.audit.record(actor, 'COST_VIEW', 'calibration', { after: { basisVersion, samples: samples.length, mreRows: rows.length }, componentId: 'D07-01' }));
    const components = new Set([...groups.keys(), ...missingByComponent.keys()]);
    const byComponent = [...components].map((component) => ({ component, n: groups.get(component)?.n ?? 0, missing: missingByComponent.get(component) ?? 0, avg: groups.has(component) ? groups.get(component)!.sum / groups.get(component)!.n : null })).sort((a, b) => b.n - a.n || (a.component < b.component ? -1 : 1));
    return { basisVersion, anchorEur: basis.benchmark.anchorEur, suggestion, ratio: suggestion / basis.benchmark.anchorEur - 1, samples, mre: { projects, approvedProjects, n: rows.length, missing, avg: rows.length ? rows.reduce((sum, row) => sum + row.mre, 0) / rows.length : null, byComponent, rows } };
  }
}
