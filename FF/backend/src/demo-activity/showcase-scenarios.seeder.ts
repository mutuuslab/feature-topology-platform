// 전시 전용 확장. 기준 데이터/원장/승인 상태를 직접 고치지 않고 담당자의 실제 서비스 경로로 만든다.
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AnswerConsultationBody, BaselineDecisionBody, BaselineRequestBody, CreateConsultationBody, CreateDependencyBody, CreateFeatureBody, CreatePolicyBody, HaraBody, JudgeGateBody, PolicyDecisionBody, TaraBody, UpdateDraftBody, type Role } from '@ff/contracts';
import type { Actor } from '../kernel/actor';
import { Clock } from '../kernel/clock';
import { DB, type Db } from '../kernel/db';
import { isProduction, seedOf } from '../kernel/runtime-config';
import { FeatureRepo } from '../domains/d01-policy/repos';
import { RefdbRepository } from '../domains/d01-policy/refdb/refdb.repository';
import { RegistryService } from '../domains/d01-policy/registry/registry.service';
import { SafetyProfileService } from '../domains/d01-policy/registry/safety-profile.service';
import { LifecycleService } from '../domains/d01-policy/registry/lifecycle.service';
import { BaselineService } from '../domains/d01-policy/registry/baseline.service';
import { AnalysisEvidenceService } from '../domains/d01-policy/topology/analysis-evidence.service';
import { GateService } from '../domains/d01-policy/topology/gate.service';
import { TopologyService } from '../domains/d01-policy/topology/topology.service';
import { DomainError } from '../kernel/errors';
import { PolicyService } from '../domains/d01-policy/policy-store/policy.service';
import { ConsultService } from '../workflows/consult.service';
import { DEMO_ACTIVITY_META, DemoActivitySeeder } from './demo-activity.seeder';
import { ShowcaseOperations } from './showcase-operations';
import { ExtSyncService } from '../domains/d05-ext/api-gateway/ext-sync/ext-sync.service';

export const SHOWCASE_SCENARIOS_META = 'seed:showcase-scenarios:double';
export const SHOWCASE_FEATURE_VERSIONS = 184;
export const showcaseScenariosEnabled = (env: NodeJS.ProcessEnv = process.env) => env.FF_SHOWCASE === '1' && !isProduction(env) && seedOf(env) !== 'none' && env.FF_DATASET !== 'ops5y';
const who = (id: string, role: Role): Actor => ({ id: `usr-${id}`, role, correlationId: 'seed:showcase-scenarios' });
const author = who('author', 'FEATURE_AUTHOR');
const approver = who('approver', 'FEATURE_APPROVER');
const fsm = who('quality', 'SAFETY_OFFICER');
const csm = who('integrator', 'SECURITY_OFFICER');
const judge = who('quality', 'GATE_JUDGE');
const STATES = ['초안 작성', '검토 보완', '정의 승인 대기', '정책·기준선 검토'] as const;

/** 기준 행 도메인 약어(30-95 domain-alias) → 차량 SW 패키지 — Flag 코드 생성기(flag-coverage DOMAIN_PACKAGE)와 같은 표 */
const FLAG_PACKAGE: Record<string, string> = { AD: 'adas', IN: 'ivi', BC: 'body', CH: 'chassis', PC: 'powertrain', PE: 'powertrain', SF: 'safety', CO: 'connectivity', PL: 'platform', BE: 'connectivity' };
/** 전시 정책 Flag 키의 끝말 — 기준 행이 뜻하는 기능(영문 한 낱말). 없는 행은 하위 도메인 약어 */
export const SHOWCASE_FLAG_WORD: Readonly<Record<string, string>> = {
  'AD-ADS-020': 'dssad', 'AD-ADS-026': 'siren', 'AD-DMS-006': 'faceid', 'AD-LON-019': 'isla', 'AD-PRK-014': 'curb',
  'BC-ACC-006': 'rke', 'BC-ACC-010': 'trunk', 'BC-ACC-016': 'fueldoor', 'BC-ACC-020': 'panic', 'BC-BCM-002': 'console', 'BC-BCM-006': 'drivemode',
  'BC-BCM-010': 'nearpark', 'BC-BCM-015': 'trailer', 'BC-BCX-005': 'coding', 'BC-BCX-009': 'puddle', 'BC-BCX-016': 'tailgate', 'BC-HVAC-004': 'hvachmi',
  'BC-HVAC-008': 'defog', 'BC-HVAC-012': 'bootloader', 'BC-HVX-004': 'recirc', 'BC-HVX-011': 'airquality', 'BC-ILT-002': 'readlamp', 'BC-ILT-006': 'dimming',
};
/** 전시 정책 Flag 키 — 다른 Flag와 같은 규칙 `<패키지>_<번호5>_<낱말>`(예: adas_00004_assist). 같은 키를 Grafana 시연 카탈로그·Flag 코드 생성기가 쓴다 */
export function showcaseFlagKey(featureId: string, refId: string): string {
  const [domain, sub = ''] = refId.split('-');
  const word = SHOWCASE_FLAG_WORD[refId] ?? (sub.toLowerCase().replace(/[^a-z0-9]/g, '') || 'feature');
  return `${FLAG_PACKAGE[domain] ?? 'platform'}_${featureId.slice(5)}_${word}`;
}

@Injectable()
export class ShowcaseScenariosSeeder implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Showcase');
  private stopped = false;
  continuation: Promise<{ plans: string[] } | { error: string } | null> | null = null;
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly moduleRef: ModuleRef,
    private readonly clock: Clock,
  ) {}

  private get features() { return this.moduleRef.get(FeatureRepo, { strict: false }); }
  private get refs() { return this.moduleRef.get(RefdbRepository, { strict: false }); }
  private get registry() { return this.moduleRef.get(RegistryService, { strict: false }); }
  private get profiles() { return this.moduleRef.get(SafetyProfileService, { strict: false }); }
  private get analysis() { return this.moduleRef.get(AnalysisEvidenceService, { strict: false }); }
  private get gates() { return this.moduleRef.get(GateService, { strict: false }); }
  private get lifecycle() { return this.moduleRef.get(LifecycleService, { strict: false }); }
  private get baselines() { return this.moduleRef.get(BaselineService, { strict: false }); }
  private get policies() { return this.moduleRef.get(PolicyService, { strict: false }); }
  private get consult() { return this.moduleRef.get(ConsultService, { strict: false }); }
  private get topology() { return this.moduleRef.get(TopologyService, { strict: false }); }

  async onApplicationBootstrap() {
    if (!showcaseScenariosEnabled()) return;
    // Nest는 같은 모듈 공급자의 bootstrap을 함께 호출한다. 기본 활동의 새 Version 2개까지 먼저 포함한다.
    await this.moduleRef.get(DemoActivitySeeder, { strict: false }).bootstrapCompletion;
    const prior = this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', SHOWCASE_SCENARIOS_META);
    if (prior) {
      const state = JSON.parse(prior.value);
      if (!state.enrichmentComplete) this.guardRetry(state.created);
      this.operations();
      await this.moduleRef.get(ExtSyncService, { strict: false }).repairShowcaseRequirements();
      return;
    }
    const before = this.features.all().length;
    const refs = this.refs.listRefs({ status: 'ACTIVE' }).filter((r) => r.asilRep === 'QM' && !r.requires.length);
    if (!refs.length) throw new Error('전시 시나리오에 연결할 발행된 QM 기준 기능이 없습니다.');
    const created: string[] = [];
    // 한 묶음이 실패하면 marker와 함께 전체를 되돌린다. 같은 DB를 재기동해도 중복 생성하지 않는다.
    this.db.tx(() => {
      for (let i = 0; i < Math.max(0, SHOWCASE_FEATURE_VERSIONS - before); i++) {
        const mode = i % STATES.length;
        const ref = refs[i % refs.length];
        const variant = String(i + 1).padStart(3, '0');
        const scopeGroup = Math.floor(i / STATES.length);
        const f = this.registry.create(author, CreateFeatureBody.parse({
          name: `${ref.nameKo} · 전시 ${variant}`,
          description: `가상 전시 데이터 — ${STATES[mode]}. 실제 고객 요청·검증 결과가 아닙니다.`,
          requirementIds: [`DEMO-REQ-${variant}`], country: ['KR', 'EU', 'US'][scopeGroup % 3],
          vehicleModel: ['NX4 PE', 'MX5', 'GN7', 'EV9'][scopeGroup % 4], trim: `전시 사양 ${String(scopeGroup + 1).padStart(3, '0')}`,
          ownerId: author.id, asil: 'QM', tags: ['가상 전시', STATES[mode]], upgVc: ['F111A114001'], controlPoints: ['Flag'],
          featureRefs: [{ refId: ref.refId, role: 'PRIMARY' }],
        }));
        created.push(`${f.featureId}@${f.version}`);
        if (mode === 0) continue;
        if (mode === 1) {
          this.gates.judge(judge, f.featureId, f.version, JudgeGateBody.parse({ gate: 'G1', inputResult: 'FAIL', rationale: '전시 — 적용 범위별 요구사항 누락을 찾아 작성자 보완 요청', evidenceRef: `EV-DEMO-SHOWCASE-${variant}-G1` }));
          this.consultation(f.featureId, f.version, f.name, i);
          continue;
        }
        this.profiles.confirm(fsm, f.featureId, f.version, '전시 — QM 정의 검토, 제품 배포 근거로 사용하지 않음');
        this.analysis.record(fsm, 'HARA', f.featureId, f.version, HaraBody.parse({ docId: `DEMO-HARA-SHOWCASE-${variant}`, asil: 'QM', safetyGoals: [{ id: 'DEMO-SG-01', text: '전시 정의의 변경 영향을 검토한다', asil: 'QM' }], reason: '가상 전시 시나리오의 정의 검토' }));
        if (this.analysis.view(f.featureId, f.version).security.relevant)
          this.analysis.record(csm, 'TARA', f.featureId, f.version, TaraBody.parse({ docId: `DEMO-TARA-SHOWCASE-${variant}`, threats: [{ id: 'DEMO-TS-01', text: '전시 입력 변조 경로 검토', cal: 'CAL1' }], reason: '가상 전시 시나리오의 위협 검토' }));
        for (const gate of ['G1', 'G2', 'G3'] as const)
          this.gates.judge(judge, f.featureId, f.version, JudgeGateBody.parse({ gate, inputResult: 'PASS', rationale: '전시 — 정의 단계 검토, 출시·차량 활성화 판정 아님', evidenceRef: `EV-DEMO-SHOWCASE-${variant}-${gate}` }));
        this.consultation(f.featureId, f.version, f.name, i);
        if (mode === 2) continue;
        this.lifecycle.transition(approver, f.featureId, f.version, 'APPROVED', '전시 — 작성자와 다른 승인자의 정의 검토 완료');
        const q = this.baselines.request(author, BaselineRequestBody.parse({ featureId: f.featureId, version: f.version, reason: '전시 — 사양 확정 요청, 출시·배포 승인과 별개' }));
        const rejected = Math.floor(i / STATES.length) % 2 === 1;
        if (rejected) this.baselines.decide(who('bom', 'BOM_APPROVER'), q.requestId, BaselineDecisionBody.parse({ decision: 'REJECT', reason: '전시 — 구매 검토 의견 반영 후 다시 요청' }));
        const p = this.policies.create(who('integrator', 'IMPLEMENTER'), CreatePolicyBody.parse({ featureId: f.featureId, featureVersion: f.version, controlPoint: 'Flag', flagKey: showcaseFlagKey(f.featureId, ref.refId), description: `${ref.nameKo} — 배포 전 담당자 정책 검토(전시)`, enabled: false, safeDefault: false, rollout: { mode: 'NONE', basisPoints: 0 } }));
        if (rejected) this.policies.decide(approver, p.policyId, PolicyDecisionBody.parse({ decision: 'REJECT', reason: '전시 — 적용 범위 보완 후 재검증 요청' }));
      }
      const dependencies = this.dependencies(created);
      this.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', SHOWCASE_SCENARIOS_META, JSON.stringify({ at: this.clock.iso(), before, after: this.features.all().length, created, dependencies }));
    });
    this.guardRetry(created);
    this.operations();
    await this.moduleRef.get(ExtSyncService, { strict: false }).repairShowcaseRequirements();
  }

  onApplicationShutdown() { this.stopped = true; }

  private operations() {
    const operations = new ShowcaseOperations(this.db, this.moduleRef);
    operations.immediate();
    const pending = this.moduleRef.get(DemoActivitySeeder, { strict: false }).continuation;
    const saved = this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', DEMO_ACTIVITY_META);
    const activity = saved ? JSON.parse(saved.value) : null;
    const note = activity?.steps?.rollback ?? activity?.steps?.policies;
    const completed = activity?.state !== 'RUNNING' && typeof note === 'string' && note.includes('REQUESTED') && !note.includes('실패');
    // 재기동에는 메모리 Promise가 없다. 실제 완료 기록이 있으면 미완료 계획 보강만 다시 시도한다.
    if ((pending || completed) && !this.continuation) this.continuation = (pending ?? Promise.resolve()).then(() => this.stopped ? null : operations.rollbackPlans()).catch((err: Error) => {
      if (!this.stopped) this.log.warn(`전시 복구 계획 보강 실패: ${err.message}`);
      return { error: err.message };
    });
  }

  private consultation(featureId: string, version: string, name: string, i: number) {
    const dept = ['DEP-PUR', 'DEP-LEG', 'DEP-DPO'][i % 3];
    const due = new Date(this.clock.now().getTime() + (2 + i % 12) * 86_400_000).toISOString().slice(0, 10);
    const c = this.consult.create(author, CreateConsultationBody.parse({ fromDept: 'DEP-SE', toDept: dept, targetKind: 'FEATURE', targetId: `${featureId}@${version}`, targetName: name, summary: '전시 — 담당 부서 검토 의견 요청', checks: ['적용 범위·변경 영향·고지 문구를 검토해 주세요'], link: `/features/${featureId}/${version}`, dueAt: due }));
    const opinion = [null, 'AGREE', 'REVISE', 'OPPOSE'][Math.floor(i / 3) % 4];
    if (opinion) this.consult.answer(who(`showcase-reviewer-${dept}`, 'AUDITOR'), c.consultId, AnswerConsultationBody.parse({ department: dept, opinion, memo: opinion === 'AGREE' ? '가상 전시 — 담당 범위 검토 의견에 동의합니다' : '가상 전시 — 지역별 적용 범위와 안내 문구를 보완해 주세요' }));
  }

  private dependencies(created: string[]) {
    const rows = created.map((key) => { const [id, version] = key.split('@'); return this.features.get(id, version)!; });
    const added: string[] = [];
    const connect = (source: typeof rows[number], target: typeof rows[number], type: 'REQUIRES' | 'EXCLUDES', pending = false) => {
      const d = this.topology.create(author, CreateDependencyBody.parse({ sourceFeatureId: source.featureId, sourceVersion: source.version, targetFeatureId: target.featureId, targetVersion: pending ? null : target.version, type }));
      added.push(d.dependencyId);
    };
    for (let offset = 0, group = 0; offset + 3 < rows.length; offset += STATES.length, group++) {
      const [draft, revise, review, approved] = rows.slice(offset, offset + STATES.length);
      connect(draft, approved, 'REQUIRES', group % 3 === 0);
      if (group < 6) {
        connect(review, revise, group < 3 ? 'EXCLUDES' : 'REQUIRES');
        this.lifecycle.transition(approver, review.featureId, review.version, 'APPROVED', '전시 — 의존관계의 승인 뒤 PASS/선행단계미달 FAIL 재판정');
      }
    }
    return added;
  }

  private guardRetry(created: string[]) {
    if (created.length >= 2) {
      const find = (key: string) => { const [id, version] = key.split('@'); return this.features.get(id, version)!; };
      const draft = find(created[0]), target = find(created[1]);
      // 거부 감사는 원래 트랜잭션 밖에서 남긴다. 중단되면 아래 완료 marker 없이 이 단계만 다시 수행한다.
      try {
        this.topology.create(author, CreateDependencyBody.parse({ sourceFeatureId: draft.featureId, sourceVersion: draft.version, targetFeatureId: draft.featureId, targetVersion: draft.version, type: 'REQUIRES' }));
        throw new Error('전시 자기참조 가드가 거부하지 않았습니다.');
      } catch (err) {
        if (!(err instanceof DomainError) || err.code !== 'GUARD_FAILED') throw err;
      }
      const existing = this.topology.list({ featureId: draft.featureId }).find((d) => d.sourceFeatureId === draft.featureId && d.targetFeatureId === target.featureId && d.type === 'EXCLUDES');
      const relation = existing ?? this.topology.create(author, CreateDependencyBody.parse({ sourceFeatureId: draft.featureId, sourceVersion: draft.version, targetFeatureId: target.featureId, targetVersion: target.version, type: 'EXCLUDES' }));
      if (!draft.description?.includes('부서 검토 의견에 따라')) this.registry.updateDraft(author, draft.featureId, draft.version, UpdateDraftBody.parse({ description: `${draft.description}\n전시 — 부서 검토 의견에 따라 적용 범위 설명을 보완했습니다.` }));
      const row = JSON.parse(this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', SHOWCASE_SCENARIOS_META)!.value);
      this.db.tx(() => this.db.run('UPDATE meta SET value = ? WHERE key = ?', JSON.stringify({ ...row, enrichmentComplete: true, dependencies: [...new Set([...(row.dependencies ?? []), relation.dependencyId])] }), SHOWCASE_SCENARIOS_META));
    } else {
      const row = JSON.parse(this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', SHOWCASE_SCENARIOS_META)!.value);
      this.db.tx(() => this.db.run('UPDATE meta SET value = ? WHERE key = ?', JSON.stringify({ ...row, enrichmentComplete: true }), SHOWCASE_SCENARIOS_META));
    }
  }
}
