// Additional synthetic cohorts. Existing examples, signatures and external approvals are never copied.
import { ModuleRef } from '@nestjs/core';
import { CreateExperimentBody, CreateIncidentBody, CreatePolicyBody, CreateProductBody, DEMO_PERSONAS, executionProduct, WorkflowArtifactBody, type Role } from '@ff/contracts';
import type { Actor } from '../kernel/actor';
import { Clock } from '../kernel/clock';
import type { Db } from '../kernel/db';
import { showcaseScale } from '../kernel/showcase-scale';
import { CatalogService } from '../domains/d01-policy/catalog/catalog.service';
import { ExperimentService } from '../domains/d01-policy/experiment/experiment.service';
import { PolicyService } from '../domains/d01-policy/policy-store/policy.service';
import { FleetRepo, PolicyRepo } from '../domains/d01-policy/policy-repos';
import { FeatureRepo, ProductRepo } from '../domains/d01-policy/repos';
import { IncidentService } from '../domains/d04-ops/incident-voc/incident.service';
import { AnomalyService } from '../domains/d06-qsec/anomaly-response/anomaly.service';
import { FeedbackService } from '../domains/d04-ops/quality-feedback/feedback.service';
import { WorkflowExecutionService } from '../workflows/workflow-execution.service';
import { WORKFLOW_EXECUTION_MODEL as MODEL } from '../generated/workflow-execution-model';
import { ShowcaseScenariosSeeder } from './showcase-scenarios.seeder';
import { captureShowcaseOriginals, compareShowcaseOriginals, type ShowcasePreservation } from './showcase-preservation';

export const SHOWCASE_EXPANSION_META = 'seed:showcase-expansion:v1';
const actor = (id: string, role: Role): Actor => ({ id: `usr-${id}`, role, correlationId: SHOWCASE_EXPANSION_META });
const SYNTHETIC = '가상 시연 — 실제 고객 요청·외부 승인·실차 검증 근거가 아님';

export class ShowcaseExpansion {
  constructor(private readonly db: Db, private readonly modules: ModuleRef, private readonly clock: Clock) {}
  private svc<T>(type: new (...args: any[]) => T): T { return this.modules.get(type, { strict: false }); }

  run() {
    if (showcaseScale() !== 2) return '추가 cohort 비활성';
    const completed = this.db.get<{ value: string }>('SELECT value FROM meta WHERE key=?', SHOWCASE_EXPANSION_META);
    if (completed) return JSON.stringify(JSON.parse(completed.value).steps);
    const originalKey = `${SHOWCASE_EXPANSION_META}:originals`;
    const savedOriginals = this.db.get<{ value: string }>('SELECT value FROM meta WHERE key=?', originalKey);
    const originals: ShowcasePreservation = savedOriginals ? JSON.parse(savedOriginals.value) : captureShowcaseOriginals(this.db);
    if (!savedOriginals) this.db.run('INSERT INTO meta(key,value) VALUES(?,?)', originalKey, JSON.stringify(originals));
    const steps: Record<string, unknown> = {};
    for (const [name, fn] of [
      ['features', () => this.svc(ShowcaseScenariosSeeder).expand()],
      ['products', () => this.products()], ['policies', () => this.policies()],
      ['experiments', () => this.experiments()], ['incidents', () => this.incidents()], ['issues', () => this.issues()],
      ['orders', () => this.orders()], ['workflow', () => this.workflow()],
    ] as const) {
      const key = `${SHOWCASE_EXPANSION_META}:${name}`;
      const prior = this.db.get<{ value: string }>('SELECT value FROM meta WHERE key=?', key);
      if (prior) { steps[name] = JSON.parse(prior.value); continue; }
      // Service changes, their audit/events and the phase marker commit together; retry cannot double a phase.
      const phase = () => {
        const result = fn();
        this.db.run('INSERT INTO meta(key,value) VALUES(?,?)', key, JSON.stringify(result));
        steps[name] = result;
      };
      // Workflow commands own their transactions so rejected attempts retain their independent audit.
      // The phase resumes by its stable case title and existing product revisions instead of duplicating work.
      if (name === 'workflow' || name === 'features') phase(); else this.db.tx(phase);
    }
    const preservation = compareShowcaseOriginals(originals, captureShowcaseOriginals(this.db));
    if (Object.values(preservation).some(r => r.changed.length || r.missing.length)) throw new Error(`기존 시연 원본이 변경됨: ${JSON.stringify(preservation)}`);
    this.db.run('INSERT INTO meta(key,value) VALUES(?,?)', SHOWCASE_EXPANSION_META, JSON.stringify({ synthetic: true, scale: 2, at: this.clock.iso(), preservation, steps }));
    return JSON.stringify(steps);
  }

  private products() {
    const catalog = this.svc(CatalogService), repo = this.svc(ProductRepo);
    const original = repo.all();
    const created: string[] = [];
    for (const [i, p] of original.entries()) {
      const body = CreateProductBody.parse({ name: `${p.name} · 가상 확장 ${i + 1}`, description: `${SYNTHETIC}. ${p.description}`.slice(0, 2000), country: p.country, vehicleModel: p.vehicleModel, trim: p.trim, tags: [...p.tags, '가상 시연 확장'], saleType: p.saleType, type: p.type, baselineIds: p.baselineIds, validFrom: p.validFrom, validTo: p.validTo, ownerId: 'usr-commerce' });
      const row = catalog.create(actor('commerce', 'PRODUCT_AUTHOR'), body).product;
      // A balanced mix of proposed and guard-checked configuration states; no imported approval history.
      const allowed = (to: string) => catalog.detail(row.catalogId, row.version).transitions.some(t => t.to === to && !t.blockers.length);
      if (i % 3 && allowed('APPROVED')) {
          const approved = catalog.transition(actor('approver', 'PRODUCT_APPROVER'), row.catalogId, row.version, 'APPROVED', `${SYNTHETIC} — 가상 구성 검토`).product;
          if (i % 3 === 2 && approved.lifecycle === 'APPROVED' && allowed('VERIFIED')) catalog.transition(actor('approver', 'PRODUCT_APPROVER'), row.catalogId, row.version, 'VERIFIED', `${SYNTHETIC} — 구성 Feature 출시 상태 확인`);
      }
      created.push(`${row.catalogId}@${row.version}`);
    }
    return { before: original.length, after: repo.all().length, created };
  }

  private policies() {
    const policies = this.svc(PolicyRepo), service = this.svc(PolicyService);
    const before = policies.all().length, created: string[] = [];
    // Scenario scaling supplies 93; the original full showcase has 47. Complete the remaining safe draft.
    for (const f of this.svc(FeatureRepo).all().filter(f => f.featureId >= 'FEAT-00289' && ['APPROVED', 'DEVELOPING', 'VERIFIED', 'RELEASED'].includes(f.lifecycle))) {
      if (policies.all().length >= 94) break;
      if (policies.all().some(p => p.flagKey === `platform_${f.featureId.slice(5)}_demo`)) continue;
      const p = service.create(actor('integrator', 'IMPLEMENTER'), CreatePolicyBody.parse({ featureId: f.featureId, featureVersion: f.version, controlPoint: 'Flag', flagKey: `platform_${f.featureId.slice(5)}_demo`, description: SYNTHETIC, enabled: false, safeDefault: false, rollout: { mode: 'NONE', basisPoints: 0 } }));
      created.push(p.policyId);
    }
    if (policies.all().length < 94) throw new Error('가상 확장 정책의 승인된 Feature가 부족합니다.');
    return { before, after: policies.all().length, created };
  }

  private experiments() {
    const service = this.svc(ExperimentService), before = service.list({}).length;
    const created: string[] = [];
    const candidates = this.svc(PolicyRepo).all().filter(p => p.featureId >= 'FEAT-00289');
    for (let i = 0; i < Math.max(before, 2); i++) {
      const p = candidates[i];
      if (!p) throw new Error('가상 확장 실험의 실제 정책이 부족합니다.');
      const e = service.create(actor('author', 'FEATURE_AUTHOR'), CreateExperimentBody.parse({ policyId: p.policyId, type: i % 2 ? 'SHADOW' : 'AB', metric: i % 2 ? 'DECISION_AGREEMENT' : 'ENGAGEMENT', treatmentBp: 5000, minSamples: 2000, hypothesis: `${SYNTHETIC} — ${i % 2 ? 'Shadow 판단 일치 검토' : 'A/B 안내 효과 검토'}` }));
      if (i % 2) service.start(actor('coordinator', 'RELEASE_MANAGER'), e.experimentId);
      created.push(e.experimentId);
    }
    return { before, after: service.list({}).length, created };
  }

  private incidents() {
    const service = this.svc(IncidentService), original = service.list(), created: string[] = [];
    for (const [i, row] of original.entries()) {
      const createdRow = service.create(actor('operator', 'OPERATOR'), CreateIncidentBody.parse({ source: ['FIELD', 'VOC', 'DEALER'][i % 3], vin: null, featureId: row.featureId, category: row.category, severity: row.severity, summary: `${SYNTHETIC} — ${row.summary}`.slice(0, 500), occurredAt: this.clock.iso() }));
      created.push(createdRow.incidentId);
    }
    return { before: original.length, after: service.list().length, created };
  }

  private orders() {
    // Only explicitly SIMULATED read models are extended. Billing/real reports/approval verdicts are excluded.
    const originals = this.db.all<{ doc: string }>('SELECT doc FROM order_link ORDER BY order_id').map(r => JSON.parse(r.doc) as Record<string, any>).filter(o => o.source === 'SIMULATED');
    const fleet = this.svc(FleetRepo), pairs = new Map<string, string>(), used = new Set<string>();
    const created: string[] = [];
    for (const [i, source] of originals.entries()) {
      const old = fleet.vehicle(source.vin);
      if (!old) throw new Error(`가상 주문 기준 차량이 없습니다: ${source.vin}`);
      if (!pairs.has(old.vin)) {
        const match = fleet.vehicles().find(v => v.vin.startsWith('SHOWCASE-') && Number(v.vin.slice(9)) > 480 && !used.has(v.vin) && v.country === old.country && v.vehicleModel === old.vehicleModel && v.trim === old.trim);
        if (!match) throw new Error(`가상 주문 확장 사양 차량이 없습니다: ${old.vin}`);
        pairs.set(old.vin, match.vin); used.add(match.vin);
      }
      const vin = pairs.get(old.vin)!;
      const originalGrant = source.entitlementId ? fleet.grant(source.entitlementId) : undefined;
      // A catalog match alone can select an OFFERED trial instead of the original issued right.
      // Only a corresponding kind/state/period is evidence for the simulated receipt; otherwise leave it unconfirmed.
      const grant = originalGrant && fleet.grants(vin).find(g =>
        !['OFFERED', 'DECLINED'].includes(g.status) && g.catalogId === source.catalogId &&
        g.kind === originalGrant.kind && g.status === originalGrant.status &&
        g.validFrom === originalGrant.validFrom && g.validTo === originalGrant.validTo);
      const doc: Record<string, any> = { ...source, orderId: `ORD-SHOWCASE-${String(i + 1).padStart(4, '0')}`, vin, entitlementId: grant?.grantId ?? null, source: 'SIMULATED' };
      if (!grant) { doc.entitlement = 'UNCONFIRMED'; doc.entitlementAt = null; }
      this.db.run('INSERT INTO order_link(order_id,idempotency_key,vin,catalog_id,entitlement_id,publication_id,activation_state,deadline_at,refund_state,doc) VALUES(?,?,?,?,?,?,?,?,?,?)', doc.orderId, doc.orderId, vin, doc.catalogId, doc.entitlementId, null, doc.readyReport?.ok ? 'READY_REPORTED' : 'UNCONFIRMED', new Date(Date.parse(doc.paidAt) + 24 * 3600_000).toISOString(), doc.refund ? doc.refund.completedAt ? 'COMPLETED' : 'REQUESTED' : null, JSON.stringify(doc));
      created.push(doc.orderId);
    }
    return { before: originals.length, created, vehiclePairs: Object.fromEntries(pairs) };
  }

  private issues() {
    const anomalies = this.svc(AnomalyService), feedback = this.svc(FeedbackService);
    const before = anomalies.list({}).length, beforeFeedback = feedback.list().length;
    const features = this.svc(FeatureRepo).all().filter(f => f.featureId >= 'FEAT-00289' && f.lifecycle === 'DEVELOPING');
    const created: string[] = [];
    const needed = Math.max(before, beforeFeedback, 2);
    for (let i = 0; i < needed; i++) {
      const f = features[i];
      if (!f) throw new Error('가상 이슈 cohort의 실제 Feature가 부족합니다.');
      anomalies.signal({ kind: 'FEATURE_FAULT', featureId: f.featureId, vin: null, code: 'DEMO-SYNTHETIC-FAULT', severity: 'WARNING', at: this.clock.iso(), ref: `SYNTHETIC-${f.featureId}` });
      const a = anomalies.list({ kind: 'FEATURE_FAULT', featureId: f.featureId }).find(a => a.status === 'OPEN');
      if (!a) throw new Error('가상 이슈가 실제 이상 건으로 접수되지 않았습니다.');
      if (i < Math.max(beforeFeedback, 2)) anomalies.close(actor('operator', 'OPERATOR'), a.anomalyId, 'MITIGATED', `${SYNTHETIC} — 가상 이슈 종료·피드백 작성 경로의 예시. 차량 조치·차단 실행 없음`);
      else if (i % 2) anomalies.acknowledge(actor('operator', 'OPERATOR'), a.anomalyId, `${SYNTHETIC} — 가상 담당자 확인 예시`);
      created.push(a.anomalyId);
    }
    return { before, after: anomalies.list({}).length, beforeFeedback, feedbackRequested: Math.max(beforeFeedback, 2), feedbackSource: 'anomaly.mitigated event consumer after phase commit', created };
  }

  private workflow() {
    const service = this.svc(WorkflowExecutionService), created: { title: string; caseId: string; artifacts: number }[] = [];
    const unavailable = new Set<string>();
    for (const process of MODEL.processes) for (let cohort = 0; cohort < 2; cohort++) {
      const entry = process.activities.find(a => !process.activities.some(prev => prev.next.includes(a.id))) ?? process.activities[0];
      const personaFor = (roles: string[]) => Object.entries(MODEL.personas).find(([, assigned]) => roles.some(r => assigned.includes(r)))?.[0];
      const owner = personaFor([...entry.raci.R, entry.raci.A]);
      if (!owner) throw new Error(`가상 업무의 실제 수행 역할 계정이 없습니다: ${entry.id}`);
      const role = DEMO_PERSONAS[owner as keyof typeof DEMO_PERSONAS]?.[0];
      if (!role) throw new Error(`가상 업무 계정의 실제 플랫폼 역할이 없습니다: ${owner}`);
      const who = actor(owner, role);
      const title = `가상 시연 ${process.id} · ${cohort ? '산출물 작성' : '초안 보완'} cohort`;
      const prior = service.list(who).items.find(c => c.title === title && c.processId === process.id);
      let detail = prior ? service.detail(who, prior.caseId) : service.create(who, { processId: process.id, title, targetRef: `FEAT-${String(289 + cohort).padStart(5, '0')}@0.1.0` });
      // Each work product is an unverified draft owned by its actual native RACI persona.
      for (const product of process.products) {
        const activity = process.activities.find(a => a.outputs.includes(product.key) && personaFor([...a.raci.R, a.raci.A]))
          ?? process.activities.find(a => a.inputs.includes(product.key) && personaFor([...a.raci.R, a.raci.A]));
        if (!activity) { unavailable.add(`${process.id}:${product.key}`); continue; }
        if (detail.item.artifacts.some(a => a.productKey === product.key && a.activityId === activity.id)) continue;
        const persona = personaFor([...activity.raci.R, activity.raci.A]);
        if (!persona) throw new Error(`가상 산출물 수행 계정이 없습니다: ${activity.id}`);
        const nativeRole = DEMO_PERSONAS[persona as keyof typeof DEMO_PERSONAS]?.[0];
        if (!nativeRole) throw new Error(`가상 산출물 계정의 실제 플랫폼 역할이 없습니다: ${persona}`);
        const by = actor(persona, nativeRole);
        detail = service.artifact(by, detail.item.caseId, WorkflowArtifactBody.parse({ version: detail.item.version, activityId: activity.id, productKey: product.key, fields: Object.fromEntries(executionProduct(MODEL, product.key).content.map((text, i) => [String(i), `${SYNTHETIC}. ${text} — 담당자 확인 전 초안`])), references: [detail.item.targetRef], files: [], reason: '가상 시연 산출물 작성 예시 — 승인·서명·실행 확인을 뜻하지 않음' }));
      }
      created.push({ title: detail.item.title, caseId: detail.item.caseId, artifacts: detail.item.artifacts.length });
    }
    return { created, artifacts: created.reduce((n, c) => n + c.artifacts, 0), approval: 'NONE', unavailable: [...unavailable], limitation: '담당 역할의 실제 데모 계정이 없는 산출물은 임의 권한 배정 없이 남김' };
  }
}
