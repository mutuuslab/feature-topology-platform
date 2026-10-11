// Feature BOM Baseline — 별도 확정 승인(표 13·14). APPROVED 자동 저장 금지, 작성자≠BOM 승인자,
// 승인 시 체크리스트 8항목 재평가 → BL-NNNNN 발급 + Lifecycle 제외 해시 + Registry baseline_id 갱신 + 이벤트.
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  BASELINE_ELIGIBLE,
  canonicalJson,
  compareVersion,
  LIFECYCLE_RANK,
  snapshotContent,
  snapshotDiff,
  type BaselineDecisionBody,
  type BaselineRequestBody,
  type BomItemRow,
  type FeatureVersionRow,
} from '@ff/contracts';
import { createHash } from 'node:crypto';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { BaselineRepo, FeatureRepo, GateRepo, ProductRepo, TopologyRepo, type BaselineRecord, type BaselineRequest } from '../repos';
import { LifecycleService } from './lifecycle.service';

export type CheckState = 'PASS' | 'FAIL' | 'INFO';
export interface ChecklistItem {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  data?: unknown;
}

export const contentHash = (row: FeatureVersionRow | BomItemRow) => 'sha256:' + createHash('sha256').update(canonicalJson(snapshotContent(row))).digest('hex');

@Injectable()
@PlatformComponent('D01-01')
export class BaselineService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly baselines: BaselineRepo,
    private readonly features: FeatureRepo,
    private readonly gates: GateRepo,
    private readonly topology: TopologyRepo,
    private readonly products: ProductRepo,
    private readonly lifecycle: LifecycleService,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  /** 시드된 Baseline의 내용 해시를 채운다 (적재 시점에는 해시 규칙을 모르는 커널이 null로 둔다). */
  onModuleInit() {
    const missing = this.baselines.missingHash();
    if (missing.length) this.db.tx(() => missing.forEach((b) => this.baselines.setHash(b.baselineId, contentHash(b.snapshot))));
  }

  list() {
    return this.baselines.all().map((b) => ({ ...b, products: this.products.usingBaseline(b.baselineId).map((p) => `${p.catalogId}@${p.version}`) }));
  }

  get(baselineId: string) {
    const b = this.baselines.get(baselineId);
    if (!b) throw new DomainError('NOT_FOUND', `${baselineId}을(를) 찾을 수 없습니다.`);
    const prev = this.previous(b.featureId, b.version);
    return {
      baseline: b,
      verified: contentHash(b.snapshot) === b.contentHash,
      previous: prev ? { baselineId: prev.baselineId, version: prev.version } : null,
      diff: snapshotDiff(prev ? snapshotContent(prev.snapshot) : null, snapshotContent(b.snapshot)),
      products: this.products.usingBaseline(baselineId),
    };
  }

  private previous(featureId: string, version: string): BaselineRecord | undefined {
    return this.baselines
      .forFeature(featureId)
      .filter((x) => compareVersion(x.version, version) < 0)
      .at(-1);
  }

  /** BOM 승인자 체크리스트 (표 14) — 요청·승인 시점마다 다시 계산한다 */
  checklist(featureId: string, version: string): ChecklistItem[] {
    const f = this.lifecycle.require(featureId, version);
    const items: ChecklistItem[] = [];
    const eligible = BASELINE_ELIGIBLE.includes(f.lifecycle);
    items.push({ id: 'STATE', label: 'Lifecycle이 APPROVED 이상', state: eligible ? 'PASS' : 'FAIL', detail: `현재 ${f.lifecycle}` });

    const developing = LIFECYCLE_RANK[f.lifecycle] >= LIFECYCLE_RANK.DEVELOPING;
    const required: (keyof FeatureVersionRow)[] = ['name', 'description', 'requirementIds', 'ownerId', 'asil', ...(developing ? (['functions', 'swIds', 'swVersions', 'ecuPnos'] as const) : [])];
    const missing = required.filter((k) => { const v = f[k]; return v == null || v === '' || (Array.isArray(v) && !v.length); });
    items.push({ id: 'ATTRS', label: '단계별 필수 속성', state: missing.length ? 'FAIL' : 'PASS', detail: missing.length ? `누락: ${missing.join(', ')}` : `${required.length}개 확인${developing ? ' (Function·SW·ECU 포함)' : ''}` });

    const scopeOk = !!(f.country && f.vehicleModel && f.trim && f.upgVc.length);
    items.push({ id: 'SCOPE', label: '적용 범위·UPG-VC', state: scopeOk ? 'PASS' : 'FAIL', detail: `${f.country} · ${f.vehicleModel} · ${f.trim} · UPG-VC ${f.upgVc.join(', ') || '없음'}` });

    const deps = this.topology.outgoing(featureId, version);
    const badDeps = deps.filter((d) => d.verdict !== 'PASS');
    items.push({ id: 'DEPENDENCY', label: '최신 의존관계 판정 PASS (미판정 없음)', state: badDeps.length ? 'FAIL' : 'PASS', detail: badDeps.length ? badDeps.map((d) => `${d.dependencyId} ${d.verdict}`).join(', ') : `${deps.length}건 PASS`, data: deps });

    if (!developing) items.push({ id: 'IMPLEMENTATION', label: '구현 연결 = 기준정보', state: 'INFO', detail: 'DEVELOPING 이전 — 해당 없음' });
    else {
      const broken: string[] = [];
      if (!f.swIds.length) broken.push('Function→SW→ECU 구현 연결 없음');
      f.swIds.forEach((swId, i) => {
        const ver = f.swVersions[i];
        const ecu = f.ecuPnos[i];
        if (!this.topology.sw(swId, ver).some((s) => s.ecuPno === ecu)) broken.push(`${swId}@${ver} on ${ecu} 기준정보 없음`);
        const e = this.topology.ecu(ecu);
        if (!e) broken.push(`${ecu} ECU 기준정보 없음`);
        else if (e.lifecycle === 'RETIRED') broken.push(`${ecu} ECU RETIRED`);
      });
      items.push({ id: 'IMPLEMENTATION', label: '구현 연결 = 기준정보 (SW·ECU 활성)', state: broken.length ? 'FAIL' : 'PASS', detail: broken.length ? broken.join('; ') : `${f.swIds.length}개 SW 형상 일치` });
    }

    const latest = Object.values(this.gates.latest(featureId, version));
    const open = latest.filter((g) => g!.status !== 'PASS');
    items.push({ id: 'GATES', label: 'Gate Record PASS, 열린 CONDITIONAL 없음', state: open.length ? 'FAIL' : 'PASS', detail: open.length ? open.map((g) => `${g!.gate} ${g!.status}`).join(', ') : `${latest.length}건 PASS` });

    const prev = this.previous(featureId, version);
    const diff = snapshotDiff(prev ? snapshotContent(prev.snapshot) : null, snapshotContent(f));
    items.push({ id: 'DIFF', label: '이전 Baseline 대비 변경', state: 'INFO', detail: prev ? `${prev.baselineId}(${prev.version}) 대비 ${diff.length}개 필드 변경` : '최초 Baseline', data: diff });

    const affected = prev ? this.products.usingBaseline(prev.baselineId) : [];
    items.push({ id: 'PRODUCTS', label: '상품 Version 영향', state: 'INFO', detail: affected.length ? `이전 Baseline 사용 상품 ${affected.length}건 — 상품 재검토 필요` : '영향 상품 없음', data: affected.map((p) => `${p.catalogId}@${p.version}`) });
    return items;
  }

  requests(status?: BaselineRequest['status']) {
    return this.baselines.requests(status);
  }

  requestDetail(requestId: string) {
    const q = this.baselines.request(requestId);
    if (!q) throw new DomainError('NOT_FOUND', `${requestId}을(를) 찾을 수 없습니다.`);
    return { request: q, checklist: q.status === 'PENDING' ? this.checklist(q.featureId, q.version) : null, feature: this.features.get(q.featureId, q.version) };
  }

  request(actor: Actor, body: BaselineRequestBody): BaselineRequest {
    const f = this.lifecycle.require(body.featureId, body.version);
    const target = `${body.featureId}@${body.version}`;
    const fail = (code: 'GUARD_FAILED' | 'CONFLICT', msg: string): never => {
      this.audit.failed(actor, 'BASELINE_REQUEST', target, msg, 'D01-01');
      throw new DomainError(code, msg);
    };
    if (!BASELINE_ELIGIBLE.includes(f.lifecycle)) fail('GUARD_FAILED', `${f.lifecycle} 버전은 Baseline 확정 대상이 아닙니다 (APPROVED~RELEASED만).`);
    const existing = this.baselines.forVersion(body.featureId, body.version);
    if (existing) fail('CONFLICT', `이미 ${existing.baselineId}로 확정된 버전입니다. 상태 변경만으로는 재발급하지 않습니다.`);
    if (this.baselines.pendingFor(body.featureId, body.version)) fail('CONFLICT', '같은 버전의 확정 요청이 이미 대기 중입니다.');
    return this.db.tx(() => {
      const q: BaselineRequest = {
        requestId: this.baselines.nextRequestId(),
        featureId: body.featureId,
        version: body.version,
        status: 'PENDING',
        requestedBy: actor.id,
        requestedAt: this.clock.iso(),
        reason: body.reason,
        decidedBy: null,
        decidedAt: null,
        decisionReason: null,
        baselineId: null,
      };
      this.baselines.insertRequest(q);
      this.audit.record(actor, 'BASELINE_REQUEST', target, { after: q, reason: body.reason, componentId: 'D01-01' });
      this.events.publish('baseline.requested', target, { requestId: q.requestId, featureId: q.featureId, version: q.version, by: actor.id }, { componentId: 'D01-01', correlationId: actor.correlationId });
      return q;
    });
  }

  decide(actor: Actor, requestId: string, body: BaselineDecisionBody) {
    const q = this.baselines.request(requestId);
    if (!q) throw new DomainError('NOT_FOUND', `${requestId}을(를) 찾을 수 없습니다.`);
    const target = `${q.featureId}@${q.version}`;
    const action = `BASELINE_${body.decision}`;
    if (q.status !== 'PENDING') throw new DomainError('CONFLICT', `이미 ${q.status} 처리된 요청입니다.`);
    if (q.requestedBy === actor.id) {
      this.audit.failed(actor, action, target, '요청자 본인 승인 시도 (직무 분리)', 'D01-01');
      throw new DomainError('SEPARATION_OF_DUTY', '확정을 요청한 사람은 같은 요청을 승인·반려할 수 없습니다.');
    }
    const checklist = this.checklist(q.featureId, q.version);
    if (body.decision === 'APPROVE') {
      const failed = checklist.filter((c) => c.state === 'FAIL');
      if (failed.length) {
        this.audit.failed(actor, action, target, failed.map((c) => `${c.id}: ${c.detail}`).join('; '), 'D01-01');
        throw new DomainError('GUARD_FAILED', `체크리스트 ${failed.length}개 항목이 충족되지 않아 확정할 수 없습니다.`, { checklist });
      }
    }
    return this.db.tx(() => {
      const decided: BaselineRequest = { ...q, status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: actor.id, decidedAt: this.clock.iso(), decisionReason: body.reason };
      let baseline: BaselineRecord | null = null;
      if (body.decision === 'APPROVE') {
        const f = this.lifecycle.require(q.featureId, q.version);
        const baselineId = this.baselines.nextId();
        const snapshot = toBomItem(f, baselineId);
        baseline = { baselineId, featureId: f.featureId, version: f.version, contentHash: contentHash(snapshot), approvedBy: actor.id, approvedAt: decided.decidedAt, requestId, snapshot };
        this.baselines.insert(baseline);
        const missing = { ...f._missing };
        delete missing.baselineId;
        this.features.update({ ...f, baselineId, _missing: missing });
        decided.baselineId = baselineId;
      }
      this.baselines.decide(decided);
      this.audit.record(actor, action, target, { before: { status: 'PENDING' }, after: { status: decided.status, baselineId: decided.baselineId, contentHash: baseline?.contentHash }, reason: body.reason, componentId: 'D01-01' });
      this.events.publish(
        body.decision === 'APPROVE' ? 'baseline.confirmed' : 'baseline.rejected',
        target,
        { requestId, featureId: q.featureId, version: q.version, baselineId: decided.baselineId, contentHash: baseline?.contentHash ?? null, by: actor.id },
        { componentId: 'D01-01', correlationId: actor.correlationId },
      );
      return { request: decided, baseline, checklist };
    });
  }
}

/** Registry 행 → BOM_Item 스냅샷 (데이터셋 BOM_Item 열 구성과 같게) */
function toBomItem(f: FeatureVersionRow, baselineId: string): BomItemRow {
  const missing = { ...f._missing };
  delete missing.baselineId;
  delete missing.gateRecordIds;
  delete missing.catalogIds;
  return {
    baselineId,
    featureId: f.featureId,
    name: f.name,
    description: f.description,
    requirementIds: f.requirementIds,
    country: f.country,
    vehicleModel: f.vehicleModel,
    trim: f.trim,
    version: f.version,
    lifecycle: f.lifecycle,
    ownerId: f.ownerId,
    tags: f.tags,
    asil: f.asil,
    upgVc: f.upgVc,
    functions: f.functions,
    swIds: f.swIds,
    swVersions: f.swVersions,
    ecuPnos: f.ecuPnos,
    controlPoints: f.controlPoints,
    dependencyIds: f.dependencyIds,
    _missing: missing,
  };
}
