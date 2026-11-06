// Safety Case 근거 지도 (D06-07, ADS-BE14) — 주장–논거–Evidence 연결과 Evidence manifest, 독립 검토 발견사항.
// 원본 Safety Case는 안전 조직 소유 — 이 서비스는 주장 ↔ Evidence 연결만 갖는다. Evidence 원장은 /verify/evidence(기존 evidence_ref)이고
// manifest는 그 참조(evidenceRef·gateRecordId)로 연결한다(같은 원장을 두 곳에 두지 않는다, P-14).
// 형상 불일치·한계(도구 유효 범위 밖)·미검토·가정값 시간 예산 결과는 주장을 뒷받침한 것으로 세지 않는다(contracts rules/ads-evidence).
// 독립 검토자 — Safety Manager 중 그 Evidence 작성자가 아닌 사람만 발견사항을 등록한다. 발견은 추가만.
import { Body, Controller, Get, HttpCode, Inject, Injectable, OnModuleInit, Param, Post } from '@nestjs/common';
import {
  AdsEvidenceFixture,
  AdsReviewFindingBody,
  reviewerIndependenceBlocker,
  safetyCaseView,
  type AdsCaseNode,
  type AdsConfigBinding,
  type AdsEvidenceManifest,
  type AdsReviewFinding,
  type AdsSafetyCaseView,
} from '@ff/contracts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FeatureRepo } from '../../d01-policy/repos';
import { isProduction, seedOf } from '../../../kernel/runtime-config';

/** ADS 증거 데모 시드 — repo 루트 기준(ADS 사건 보고 서비스와 같은 파일) */
const FIXTURE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'fixtures', 'ads', 'evidence.json');
const MIN = 60_000;

interface CaseRow {
  featureId: string;
  featureVersion: string;
  target: AdsConfigBinding;
}

@Injectable()
@PlatformComponent('D06-07')
export class AdsSafetyCaseService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** 빈 DB면 시드를 싣는다 — Feature Version이 있을 때만, 시각은 시드 시각 기준 상대값 */
  onModuleInit() {
    if (this.db.get('SELECT 1 FROM ads_safety_case LIMIT 1') || !existsSync(FIXTURE) || isProduction() || seedOf() === 'none') return;
    const fx = AdsEvidenceFixture.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    const now = this.clock.now().getTime();
    const at = (ago: number) => new Date(now - ago * MIN).toISOString();
    this.db.tx(() => {
      const loaded = new Set<string>();
      for (const c of fx.safetyCases) {
        if (!this.features.get(c.featureId, c.featureVersion)) continue;
        loaded.add(c.featureId);
        const row: CaseRow = { featureId: c.featureId, featureVersion: c.featureVersion, target: c.target };
        this.db.run('INSERT INTO ads_safety_case (feature_id, feature_version, doc) VALUES (?, ?, ?)', c.featureId, c.featureVersion, JSON.stringify(row));
        for (const n of c.nodes) this.db.run('INSERT INTO ads_case_node (feature_id, node_id, doc) VALUES (?, ?, ?)', c.featureId, n.nodeId, JSON.stringify({ nodeId: n.nodeId, kind: n.kind, parentId: n.parentId ?? null, text: n.text, manifestId: n.manifestId ?? null } satisfies AdsCaseNode));
      }
      for (const m of fx.manifests) {
        if (!loaded.has(m.featureId)) continue;
        const { authoredMinAgo, review, ...rest } = m;
        const doc: AdsEvidenceManifest = { ...rest, evidenceRef: rest.evidenceRef ?? null, gateRecordId: rest.gateRecordId ?? null, authoredAt: at(authoredMinAgo), review: { status: review.status, by: review.by, at: review.atMinAgo === null ? null : at(review.atMinAgo) } };
        this.db.run('INSERT INTO ads_evidence_manifest (manifest_id, feature_id, doc) VALUES (?, ?, ?)', doc.manifestId, doc.featureId, JSON.stringify(doc));
      }
      for (const f of fx.findings) {
        const m = this.manifest(f.manifestId);
        if (!m) continue;
        const { openedMinAgo, closedMinAgo, ...rest } = f;
        const doc: AdsReviewFinding = { ...rest, closeReason: rest.closeReason ?? null, reviewerIndependent: !reviewerIndependenceBlocker(f.reviewer, m), openedAt: at(openedMinAgo), closedAt: closedMinAgo === null ? null : at(closedMinAgo) };
        this.db.run('INSERT INTO ads_review_finding (finding_id, feature_id, manifest_id, doc) VALUES (?, ?, ?, ?)', doc.findingId, doc.featureId, doc.manifestId, JSON.stringify(doc));
      }
    });
  }

  private manifest(id: string): AdsEvidenceManifest | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ads_evidence_manifest WHERE manifest_id = ?', id);
    return r ? (JSON.parse(r.doc) as AdsEvidenceManifest) : null;
  }
  private findings(featureId: string): AdsReviewFinding[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM ads_review_finding WHERE feature_id = ? ORDER BY id', featureId).map((r) => JSON.parse(r.doc) as AdsReviewFinding);
  }
  private cases(): CaseRow[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM ads_safety_case ORDER BY feature_id').map((r) => JSON.parse(r.doc) as CaseRow);
  }

  view(featureId: string): AdsSafetyCaseView {
    const all = this.cases();
    const c = all.find((x) => x.featureId === featureId);
    if (!c) throw new DomainError('NOT_FOUND', `${featureId}에 등록된 주장이 없습니다.`);
    const nodes = this.db.all<{ doc: string }>('SELECT doc FROM ads_case_node WHERE feature_id = ?', featureId).map((r) => JSON.parse(r.doc) as AdsCaseNode);
    const manifests = this.db.all<{ doc: string }>('SELECT doc FROM ads_evidence_manifest WHERE feature_id = ?', featureId).map((r) => JSON.parse(r.doc) as AdsEvidenceManifest);
    const findings = this.findings(featureId);
    const name = (id: string, v: string) => this.features.get(id, v)?.name ?? id;
    return {
      featureId,
      featureVersion: c.featureVersion,
      featureName: name(featureId, c.featureVersion),
      target: c.target,
      findings,
      features: all.map((x) => ({ featureId: x.featureId, featureVersion: x.featureVersion, name: name(x.featureId, x.featureVersion) })),
      ...safetyCaseView(nodes, manifests, c.target, findings),
    };
  }

  manifestDetail(id: string) {
    const m = this.manifest(id);
    if (!m) throw new DomainError('NOT_FOUND', `${id}을(를) 찾을 수 없습니다.`);
    const c = this.cases().find((x) => x.featureId === m.featureId) ?? null;
    const nodes = this.db.all<{ doc: string }>('SELECT doc FROM ads_case_node WHERE feature_id = ?', m.featureId).map((r) => JSON.parse(r.doc) as AdsCaseNode);
    return {
      ...m,
      target: c?.target ?? null,
      linkedNodes: nodes.filter((n) => n.manifestId === id).map((n) => n.nodeId),
      findings: this.findings(m.featureId).filter((f) => f.manifestId === id),
    };
  }

  /** 독립 검토 발견사항 등록 — Evidence 작성자는 거부(사유와 함께 거부 기록) */
  createFinding(actor: Actor, body: AdsReviewFindingBody): AdsReviewFinding {
    const m = this.manifest(body.manifestId);
    if (!m) throw new DomainError('NOT_FOUND', `${body.manifestId}을(를) 찾을 수 없습니다.`);
    const blocker = reviewerIndependenceBlocker(actor.id, m);
    if (blocker) {
      this.audit.denied(actor, 'ADS_REVIEW_FINDING', body.manifestId, blocker, 'D06-07');
      throw new DomainError('SEPARATION_OF_DUTY', blocker);
    }
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM ads_review_finding')!.n + 1;
    const doc: AdsReviewFinding = {
      findingId: `RF-${String(n).padStart(4, '0')}`,
      featureId: m.featureId,
      manifestId: m.manifestId,
      severity: body.severity,
      summary: body.summary,
      status: 'OPEN',
      reviewer: actor.id,
      reviewerIndependent: true,
      openedAt: this.clock.iso(),
      closedAt: null,
      closeReason: null,
    };
    this.db.tx(() => {
      this.db.run('INSERT INTO ads_review_finding (finding_id, feature_id, manifest_id, doc) VALUES (?, ?, ?, ?)', doc.findingId, doc.featureId, doc.manifestId, JSON.stringify(doc));
      this.audit.record(actor, 'ADS_REVIEW_FINDING', doc.findingId, { after: { manifestId: doc.manifestId, severity: doc.severity, status: doc.status }, reason: doc.summary, componentId: 'D06-07' });
    });
    return doc;
  }
}

@Controller('api/safety-case')
export class AdsSafetyCaseController {
  constructor(private readonly svc: AdsSafetyCaseService) {}

  @Get(':featureId')
  view(@Param('featureId') featureId: string) {
    return this.svc.view(featureId);
  }
}

@Controller('api/evidence-manifests')
export class AdsEvidenceManifestController {
  constructor(private readonly svc: AdsSafetyCaseService) {}

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.manifestDetail(id);
  }
}

@Controller('api/review-findings')
export class AdsReviewFindingController {
  constructor(private readonly svc: AdsSafetyCaseService) {}

  @Post()
  @HttpCode(201)
  @Roles('SAFETY_OFFICER')
  @AuditAction('ADS_REVIEW_FINDING')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(AdsReviewFindingBody)) body: AdsReviewFindingBody) {
    return this.svc.createFinding(actor, body);
  }
}
