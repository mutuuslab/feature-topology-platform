// 전시에서 비어 있던 운영 탭도 실제 서비스로 채운다. 실행·승인 성공 근거를 만들어 넣지 않는다.
import { ModuleRef } from '@nestjs/core';
import { ChangeRecordBody, CreateRollbackPlanBody, ErasureRequestBody, RollbackDecisionBody } from '@ff/contracts';
import type { Actor } from '../kernel/actor';
import type { Db } from '../kernel/db';
import { PrivacyService } from '../kernel/privacy.service';
import { ChangeRecordService } from '../domains/d04-ops/pipeline-link/change-record.service';
import { SYNC_TARGETS, SyncService } from '../domains/d05-ext/data-sync/sync.service';
import { FeatureRepo } from '../domains/d01-policy/repos';
import { RollbackService } from '../domains/d03-safety/restore/rollback.service';

const actor = (id: string, role: Actor['role']): Actor => ({ id: `usr-${id}`, role, correlationId: 'seed:showcase-operations' });
const META = 'seed:showcase-operations';
export class ShowcaseOperations {
  constructor(private readonly db: Db, private readonly modules: ModuleRef) {}
  private get<T>(type: new (...args: any[]) => T): T { return this.modules.get(type, { strict: false }); }

  immediate() {
    if (this.db.get('SELECT 1 FROM meta WHERE key = ?', META)) return;
    this.db.tx(() => {
      const source = this.db.get<{ commit_id: string }>("SELECT commit_id FROM flag_source_manifest WHERE provenance = 'DEMO' ORDER BY id DESC LIMIT 1");
      let changes = 0;
      if (source) {
        const records = this.get(ChangeRecordService), features = this.get(FeatureRepo);
        for (const [index, featureId] of ['FEAT-00022', 'FEAT-00027'].entries()) {
          const f = features.versions(featureId).find((f) => f.version === '1.0.0');
          if (!f?.swIds.length || !f.swVersions[0]) continue;
          const body = ChangeRecordBody.parse({ changeId: `CHG-SHOWCASE-SOURCE-${index + 1}`, swId: f.swIds[0], swVersion: f.swVersions[0], commit: source.commit_id, summary: '가상 시연 — 소비 예제의 실제 Git 소스 추적, 실차 SW 변경·시험 성공을 뜻하지 않음', aiGenerated: { tool: 'Codex', toolVersion: '미정 (가상 소비 예제)', scope: 'FF/examples/feature-flag-consumer (가상 소비 예제)' }, evidence: { review: null, staticAnalysis: null, tests: null, coverage: null } });
          records.register(actor('integrator', 'IMPLEMENTER'), body);
          if (index === 0) records.register(actor('integrator', 'IMPLEMENTER'), { ...body, summary: '가상 시연 — 소스 추적 설명 보완(개정), 실제 검토·시험·커버리지 근거는 미등록' });
          changes++;
        }
      }
      const privacy = this.get(PrivacyService);
      const request = (subjectId: string) => privacy.createRequest(actor('integrator', 'SECURITY_OFFICER'), ErasureRequestBody.parse({ subjectKind: 'USER', subjectId, basis: 'DATA_SUBJECT_REQUEST', reason: '가상 시연 — 검토 포털 시연 계정의 삭제·가명 처리 검토 요청. 실행 전 담당자 확인 필요' }));
      request('usr-showcase-reviewer-DEP-PUR');
      const q = request('usr-showcase-reviewer-DEP-LEG');
      privacy.reject(actor('showcase-security-reviewer', 'SECURITY_OFFICER'), q.requestId, '가상 시연 — 대상·처리 범위를 보완한 뒤 다시 요청. 삭제·가명 처리 실행 없음');
      const sync = this.get(SyncService);
      const runs = SYNC_TARGETS.map((target) => sync.run(actor('operator', 'OPERATOR'), target.targetId));
      this.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', META, JSON.stringify({ changes, privacy: 2, runs: runs.map((run) => ({ runId: run.runId, status: run.status })) }));
    });
  }

  rollbackPlans() {
    const prior = this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', `${META}:rollback`);
    if (prior) return JSON.parse(prior.value) as { plans: string[] };
    const rollback = this.get(RollbackService);
    const deployment = rollback.deployments().items.find((d) => d.feature.featureId === 'FEAT-00027' && d.deploymentId && d.eligible > 0);
    if (!deployment?.deploymentId) throw new Error('전시 Rollback Plan의 실제 확인된 복구 후보가 없습니다.');
    const candidate = rollback.deployment(deployment.deploymentId).candidates.find((c) => c.eligible);
    if (!candidate) throw new Error('전시 Rollback Plan의 실제 검증·서명된 복구 후보가 없습니다.');
    return this.db.tx(() => {
      const body = CreateRollbackPlanBody.parse({ deploymentId: deployment.deploymentId, targetTypes: ['POLICY_VERSION'], recovery: { policyId: candidate.policyId }, conditions: { dtc: { types: ['U'] } }, scope: { featureIds: [deployment.feature.featureId] }, approvers: ['usr-opslead'], note: '가상 시연 — 네트워크 DTC 발생 시 되돌리기 조건 검토. 계획 승인·실행은 하지 않음' });
      const requested = rollback.createPlan(actor('operator', 'OPERATOR'), body);
      const rejected = rollback.createPlan(actor('operator', 'OPERATOR'), { ...body, note: '가상 시연 — 복구 조건 보완에 따른 반려 이력' });
      rollback.decidePlan(actor('opslead', 'OPS_LEAD'), rejected.planId, RollbackDecisionBody.parse({ decision: 'REJECT', comment: '가상 시연 — DTC 코드·적용 범위 상세 보완 후 재요청. 자동 실행 승인 없음' }));
      const result = { plans: [requested.planId, rejected.planId] };
      this.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', `${META}:rollback`, JSON.stringify(result));
      return result;
    });
  }
}
