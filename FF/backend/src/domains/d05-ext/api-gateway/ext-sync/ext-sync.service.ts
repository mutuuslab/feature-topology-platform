// GitLab · JIRA · codeBeamer 양방향 연계 (D05-01 API Gateway · IF-01·IF-13·IF-14) — 사용자 결정 2026-10-18 "양방향이 되게끔".
// 보내기: 플랫폼 이벤트(Lifecycle·게이트·정책·확대·긴급 차단)를 같은 트랜잭션에서 보낼 함에 쌓고, drain이 외부로 쓴다.
//   쓰기 전에 외부 값을 다시 읽어 마지막으로 본 개정과 다르면 덮어쓰지 않고 충돌로 둔다(사람이 고름).
// 받기: webhook(서명 확인 → 정규화 → 중복 버림)을 주인 규칙(contracts SYNC_OWNERSHIP)으로 처리한다.
//   주인이 외부인 사실(요구 내용·CR 흐름·MR·파이프라인)은 그대로 반영, 주인이 플랫폼인 사실(Lifecycle·정책 승인)은
//   매핑된 플랫폼 행위자의 "요청"으로 같은 서비스 경로(가드·직무 분리·감사)를 탄다. 거부되면 외부 값을 되돌리고 사유를 댓글로 남긴다.
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import {
  CreateFeatureBody,
  EPIC_FIELD,
  EPIC_SCOPE_LABEL,
  epicFieldDiff,
  nameOfEpicSummary,
  sameEpicValue,
  type EpicDesired,
  type EpicFieldKey,
  ExtIdentitySchema,
  EXT_SYSTEM_IF,
  EXT_SYSTEMS,
  FEATURE_TRANSITIONS,
  JIRA_CR_STATUS,
  JIRA_EPIC_STATUS,
  lifecycleOfEpicStatus,
  missingEpicScope,
  parseRefs,
  SYNC_OWNERSHIP,
  type ExtChange,
  type ExtIdentity,
  type ExtKind,
  type ExtLink,
  type ExtRef,
  type ExtSystem,
  type ExtSystemSummary,
  type FeatureVersionRow,
  type MockExtActionBody,
  type MockExtCreateBody,
  type Policy,
  type Role,
} from '@ff/contracts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Actor } from '../../../../kernel/actor';
import { AuditService } from '../../../../kernel/audit.service';
import { Clock } from '../../../../kernel/clock';
import { PlatformComponent } from '../../../../kernel/components';
import { DB, type Db } from '../../../../kernel/db';
import { DomainError } from '../../../../kernel/errors';
import { EventService, type PlatformEvent } from '../../../../kernel/event.service';
import { Scheduler } from '../../../../kernel/scheduler';
import { EXT_FIXTURES } from '../../../../adapters/if-mocks/external-systems';
import { PolicyRepo } from '../../../d01-policy/policy-repos';
import { PolicyService } from '../../../d01-policy/policy-store/policy.service';
import { LifecycleService } from '../../../d01-policy/registry/lifecycle.service';
import { RegistryService } from '../../../d01-policy/registry/registry.service';
import { FeatureRepo } from '../../../d01-policy/repos';
import { ChangeRecordService } from '../../../d04-ops/pipeline-link/change-record.service';
import { ExtAdapters, ExtPartialWriteError, modeOf, PLATFORM_USER, type RemoteItem, type WritePatch, type WriteResult } from './adapters';
import { ExtSyncRepo, type ConflictRow, type InboxRow, type OutboxJob, type OutboxOp } from './ext-sync.repo';
import { extUrl, MockExtStore } from './mock-ext.store';
import { isProduction, seedOf } from '../../../../kernel/runtime-config';
import { applyExtLiveConfig } from './live-config';
import { isServiceAccount } from './live-adapters';
import { deliveryIdOf, hmac, normalize, verifyWebhook } from './normalize';
import { demoChangeRequestContent, demoEpicContent, demoRequirementContent } from './demo-seed-content';
import { FeatureEpics } from './feature-epic';

/** 외부 drain 주기(실시간 모드) */
const DRAIN_MS = 3_000;
/** 정책 상태 → JIRA CR 상태(거울) */
//   상태 이름은 시작 때 JIRA_CR_STATUS 환경 변수로 바뀔 수 있어(live-config) 부를 때마다 읽는다
const CR_OF_POLICY_STATE: Record<string, keyof typeof JIRA_CR_STATUS> = { DRAFT: 'OPEN', VALIDATED: 'IN_REVIEW', APPROVED: 'APPROVED', DEPLOYED: 'DEPLOYED', REJECTED: 'REJECTED', RETIRED: 'CLOSED' };
const crOfPolicy = (status: string): string | undefined => {
  const s = CR_OF_POLICY_STATE[status];
  return s ? JIRA_CR_STATUS[s] : undefined;
};
/** codeBeamer에 검증 결과를 쓰는 게이트 — 요구(G2)·SW 검증(G5)·통합 검증(G6) */
const VERIFY_GATES = new Set(['G2', 'G5', 'G6']);

const fid = (featureId: string, version: string) => `${featureId}@${version}`;
const splitFid = (id: string) => {
  const [featureId, version] = id.split('@');
  return { featureId, version };
};

export type Outcome = Pick<InboxRow, 'outcome' | 'summary'>;
/** 80-50 확장(alm-*.service.ts) — 새 연결 종류의 받기·새 보낼 일·이벤트·초기 상태를 이 파일 밖에서 더한다(병합 충돌을 줄이려고) */
export type KindHandler = (c: ExtChange, prev: ExtRef | null, ref: ExtRef, correlationId: string, actorOverride?: Actor) => Outcome;
export type OpHandler = (j: OutboxJob) => Promise<'done' | 'failed' | 'conflicts'>;
export interface ExtSyncExtension {
  kinds?: Partial<Record<ExtKind, KindHandler>>;
  ops?: Record<string, OpHandler>;
  /** 발행 훅(변경과 같은 트랜잭션) — 조회·적재만 */
  onEvent?: (ev: PlatformEvent) => void;
  /** 모의 초기 상태(seed 트랜잭션 안) */
  onSeed?: () => void;
}

/**
 * JIRA Epic에 기준 기능 ID가 없거나 쓸 수 없을 때 댓글 안내(30-95 §7, 80-50 §4) — Epic 화면의 FF 패널에서 Feature DB 기준 행을 고르게 한다.
 * 라벨(ref-primary:·ref:)은 모의·데모 연결에서만 읽으므로 안내하지 않는다.
 */
export const EPIC_REF_HINT = 'Epic 화면의 Feature Platform 패널에서 Feature DB 기준 기능을 골라 주세요(첫 번째가 대표 기준 행). 맞는 기준 행이 없으면 플랫폼 Feature 등록 화면에서 추가를 요청하세요.';

@PlatformComponent('D05-01')
@Injectable()
export class ExtSyncService implements OnModuleInit, OnApplicationBootstrap {
  private identities: ExtIdentity[] | null = null;
  private draining: Promise<{ done: number; failed: number; conflicts: number }> | null = null;
  private readonly extensions: ExtSyncExtension[] = [];

  /** 80-50 확장 등록(모듈 초기화 때) */
  extend(x: ExtSyncExtension) {
    this.extensions.push(x);
  }
  private kindHandler(kind: ExtKind): KindHandler | undefined {
    return this.extensions.map((x) => x.kinds?.[kind]).find((h) => !!h);
  }
  private opHandler(op: string): OpHandler | undefined {
    return this.extensions.map((x) => x.ops?.[op]).find((h) => !!h);
  }

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: ExtSyncRepo,
    private readonly store: MockExtStore,
    private readonly adapters: ExtAdapters,
    private readonly events: EventService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
    private readonly features: FeatureRepo,
    private readonly policies: PolicyRepo,
    private readonly lifecycle: LifecycleService,
    private readonly registry: RegistryService,
    private readonly policyService: PolicyService,
    private readonly changeRecords: ChangeRecordService,
    private readonly epics: FeatureEpics,
  ) {}

  onModuleInit() {
    // 실제 연결 설정 — live인데 필수 값이 빠졌으면 여기서 시작을 멈춘다(빠진 변수 이름을 알려 줌)
    applyExtLiveConfig();
    this.events.onPublish((ev) => this.onEvent(ev));
  }

  onApplicationBootstrap() {
    // 운영 모드는 예시 항목을 넣지 않는다(출시 준비 RD-OPS-01)
    if ((process.env.FF_EXT_SYNC_SEED ?? (isProduction() ? '0' : '1')) !== '0' && this.repo.itemCount() === 0) this.seed();
    if (!this.scheduler.manual && process.env.FF_EXT_SYNC_DRAIN !== 'off') this.scheduler.after(DRAIN_MS, () => void this.pollTick());
  }

  private readonly log = new Logger('ExtSync');
  /** 주기 drain 한 번 — 예상 못 한 거부도 여기서 끝낸다(처리되지 않은 거부는 프로세스를 죽인다). 다음 주기는 늘 잡는다 */
  pollTick(): Promise<void> {
    return this.drain()
      .then(() => undefined)
      .catch((e: unknown) => this.log.error(`보낼 함 주기 처리 실패 — 다음 주기에 다시 봅니다: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => this.scheduler.after(DRAIN_MS, () => void this.pollTick()));
  }

  // ───────────────────────── 외부 계정 ─────────────────────────
  identityMap(): ExtIdentity[] {
    if (!this.identities) {
      const raw = JSON.parse(readFileSync(join(process.env.FF_EXT_FIXTURES ?? EXT_FIXTURES, 'ext-identities.json'), 'utf8')) as unknown[];
      this.identities = raw.map((x) => ExtIdentitySchema.parse(x));
    }
    return this.identities;
  }
  identity(system: ExtSystem, externalId: string): ExtIdentity | null {
    return this.identityMap().find((i) => i.system === system && i.externalId === externalId) ?? null;
  }
  /** 외부 사람 → 이 작업이 허용하는 역할 중 그 사람이 맡은 것(없으면 null) */
  actorFor(id: ExtIdentity, allowed: readonly Role[], correlationId: string): Actor | null {
    const role = allowed.find((r) => id.roles.includes(r));
    return role ? { id: id.actorId, role, correlationId } : null;
  }
  private systemActor(system: ExtSystem, correlationId: string): Actor {
    return { id: `${system.toLowerCase()}-webhook`, role: 'SYSTEM', correlationId };
  }

  // ───────────────────────── 보내기: 이벤트 → 보낼 함 ─────────────────────────
  enqueue(system: ExtSystem, op: OutboxOp, idem: string) {
    if (modeOf(system) === 'off') return;
    this.repo.enqueue(system, op, idem);
    const key = 'key' in op ? op.key : null;
    if (key) this.repo.setState(system, key, 'PENDING');
  }
  private linkedKeys(entity: 'FEATURE' | 'POLICY', id: string, system: ExtSystem, kind: ExtKind): string[] {
    return this.repo.linksOf(entity, id, system).filter((l) => l.kind === kind).map((l) => l.key);
  }

  /** 발행 훅 — 변경과 같은 트랜잭션. 여기서 던지면 변경이 롤백되므로 조회·적재만 한다 */
  private onEvent(ev: PlatformEvent) {
    for (const x of this.extensions) x.onEvent?.(ev);
    const p = (ev.payload ?? {}) as Record<string, any>;
    switch (ev.type) {
      case 'feature.created':
      case 'feature.version.created': {
        this.enqueue('JIRA', { op: 'EPIC_MIRROR', featureId: p.featureId, version: p.version, comment: null }, `epic:${ev.id}`);
        this.enqueue('CODEBEAMER', { op: 'REQ_LINK', featureId: p.featureId, version: p.version }, `req:${ev.id}`);
        return;
      }
      case 'feature.lifecycle.changed':
        this.enqueue('JIRA', { op: 'EPIC_MIRROR', featureId: p.featureId, version: p.version, comment: `플랫폼 Lifecycle ${p.version} ${p.from} → ${p.to} (${p.by})${p.reason ? ` — ${p.reason}` : ''}` }, `epic:${ev.id}`);
        return;
      // 초안 수정(이름·담당·기준 행)도 Epic 필드에 — 주인은 FF(80-50 §4.2)
      case 'feature.updated':
        this.enqueue('JIRA', { op: 'EPIC_MIRROR', featureId: p.featureId, version: p.version, comment: null }, `epic:${ev.id}`);
        return;
      case 'gate.judged': {
        const { featureId, version } = splitFid(ev.aggregate);
        // Epic의 게이트 칸(읽기 전용)
        this.enqueue('JIRA', { op: 'EPIC_MIRROR', featureId, version, comment: null }, `epic:${ev.id}`);
        if (VERIFY_GATES.has(p.gate))
          for (const key of this.linkedKeys('FEATURE', ev.aggregate, 'CODEBEAMER', 'REQUIREMENT'))
            this.enqueue('CODEBEAMER', { op: 'VERIFICATION', key, featureId, version, gate: p.gate, status: p.status, evidenceRef: p.gateRecordId ?? null }, `ver:${ev.id}:${key}`);
        for (const key of this.linkedKeys('FEATURE', ev.aggregate, 'GITLAB', 'MERGE_REQUEST'))
          this.enqueue('GITLAB', { op: 'COMMIT_STATUS', key, name: `ff/gate-${p.gate}`, state: p.status === 'PASS' ? 'success' : p.status === 'FAIL' ? 'failed' : 'pending', description: `Feature Platform ${p.gate} ${p.status} (${p.by})` }, `cs:${ev.id}:${key}`);
        // G2를 다시 판정하면 요구 개정 표시를 내린다(재검토 끝)
        if (p.gate === 'G2') for (const l of this.repo.linksOf('FEATURE', ev.aggregate, 'CODEBEAMER')) if (l.stale) this.repo.putItem({ ...strip(l), stale: false });
        return;
      }
      case 'policy.validated':
        for (const key of this.linkedKeys('POLICY', ev.aggregate, 'JIRA', 'CHANGE_REQUEST'))
          this.enqueue('JIRA', { op: 'CR_STATUS', key, status: p.decision === 'GO' ? JIRA_CR_STATUS.IN_REVIEW : JIRA_CR_STATUS.OPEN, comment: `플랫폼 검증 ${p.decision} (${p.runId}) — 정책 ${ev.aggregate}` }, `cr:${ev.id}:${key}`);
        return;
      case 'policy.approved':
      case 'policy.rejected':
        for (const key of this.linkedKeys('POLICY', ev.aggregate, 'JIRA', 'CHANGE_REQUEST'))
          this.enqueue('JIRA', { op: 'CR_STATUS', key, status: ev.type === 'policy.approved' ? JIRA_CR_STATUS.APPROVED : JIRA_CR_STATUS.REJECTED, comment: `플랫폼 정책 ${ev.type === 'policy.approved' ? '승인' : '반려'} — ${ev.aggregate}` }, `cr:${ev.id}:${key}`);
        return;
      case 'policy.deployed': {
        const rollback = typeof p.reason === 'string' && p.reason.startsWith('롤백');
        for (const key of this.linkedKeys('POLICY', ev.aggregate, 'JIRA', 'CHANGE_REQUEST'))
          this.enqueue('JIRA', { op: 'CR_STATUS', key, status: rollback ? JIRA_CR_STATUS.ROLLED_BACK : JIRA_CR_STATUS.DEPLOYED, comment: `플랫폼 ${rollback ? '롤백 재배포' : '배포'} ${p.publicationId ?? ''}${p.stage !== undefined ? ` · 효력 ${p.stage / 100}%` : ''}` }, `cr:${ev.id}:${key}`);
        return;
      }
      case 'rollout.staged':
        for (const key of this.linkedKeys('POLICY', ev.aggregate, 'JIRA', 'CHANGE_REQUEST')) this.enqueue('JIRA', { op: 'COMMENT', key, text: `플랫폼 단계 확대 ${p.from / 100}% → ${p.to / 100}%` }, `cm:${ev.id}:${key}`);
        return;
      case 'kill.issued': {
        const featureId = String(p.featureId ?? '');
        const f = this.epics.key(featureId) ? this.features.versions(featureId).at(-1) : undefined;
        if (f) this.enqueue('JIRA', { op: 'CREATE_DEFECT', featureId, version: f.version, killId: ev.aggregate, title: `긴급 차단 ${ev.aggregate} — ${featureId}`, body: `플랫폼 긴급 차단 ${ev.aggregate}: 차량 ${p.vins ?? 0}대, 게시본 ${p.publicationId ?? '—'}. 원인 분석·조치는 이 결함에서.` }, `defect:${ev.id}`);
        return;
      }
    }
  }

  // ───────────────────────── 보내기: drain ─────────────────────────
  /** 보낼 함을 비운다 — 실시간 모드는 주기적으로, 수동 스케줄러(시험·재생)는 직접 부른다. 겹쳐 부르면 같은 실행을 기다린다 */
  drain(): Promise<{ done: number; failed: number; conflicts: number }> {
    this.draining ??= this.drainOnce().finally(() => (this.draining = null));
    return this.draining;
  }
  private async drainOnce() {
    const out = { done: 0, failed: 0, conflicts: 0 };
    for (let round = 0; round < 5; round++) {
      const due = this.repo.due();
      if (!due.length) break;
      for (const j of due) {
        const r = await this.run(j);
        out[r]++;
      }
    }
    return out;
  }

  private async run(j: OutboxJob): Promise<'done' | 'failed' | 'conflicts'> {
    const a = this.adapters.of(j.system);
    try {
      const op = j.job;
      const ext = this.opHandler(op.op);
      if (ext) return await ext(j);
      switch (op.op) {
        case 'EPIC_MIRROR': {
          // Epic = Feature(80-50 §4.1) — 작업 중 버전 상태·FF 필드. 버전은 Epic 필드(작업 중·출시 버전)
          const d = this.epics.desired(op.featureId);
          if (!d) return this.skip(j, 'Feature 없음');
          const f = this.features.get(op.featureId, d.version)!;
          const desired = JIRA_EPIC_STATUS[d.lifecycle];
          const key = this.epics.key(op.featureId);
          if (!key) {
            const it = await a.create('EPIC', { title: d.summary, body: `${f.description}\n\nFeature Platform: ${f.featureId}`, status: desired, fields: { featureId: f.featureId, version: d.version, epic: d.fields } });
            this.db.tx(() => {
              this.observe(it, 'SYNCED');
              this.epics.linkAll(it.key, f.featureId, PLATFORM_USER);
            });
            // 만들었지만 원하는 상태까지 못 갔으면(live 워크플로 거부) 연결한 뒤 거울 쓰기로 이어 간다 — 실패는 재시도, 다시 만들지 않음
            if (it.status.toLowerCase() !== desired.toLowerCase()) return await this.mirrorEpic(j, it.key, d, op.comment);
            return this.done(j);
          }
          // 새 버전이 생겼으면 그 버전에도 연결한다
          this.epics.linkAll(key, f.featureId, PLATFORM_USER);
          // await — 그냥 돌려주면 거부가 아래 catch를 빠져나가 drain이 거부되고 프로세스가 죽는다(2026-11-05 회귀)
          return await this.mirrorEpic(j, key, d, op.comment);
        }
        case 'CR_STATUS':
          return await this.mirrorStatus(j, op.key, op.status, op.comment);
        case 'LEGACY_EPIC': {
          const r = await a.write(op.key, { labelsAdd: ['ff-legacy-epic'], duplicateOf: op.keep, comment: `이 Epic은 Feature 단위 Epic ${op.keep}(으)로 합쳤습니다. 이후 상태·필드는 ${op.keep}에서 관리합니다.` }, null);
          if (r.ok) this.observe(r.item, 'SYNCED', { supersededBy: op.keep });
          return this.done(j);
        }
        case 'COMMENT': {
          const r = await a.write(op.key, { comment: op.text }, null);
          if (r.ok) this.observe(r.item, 'SYNCED');
          return this.done(j);
        }
        case 'CREATE_DEFECT': {
          const epic = this.epics.key(op.featureId);
          const it = await a.create('DEFECT', { title: op.title, body: op.body, status: 'Open', fields: { parentKey: epic, killId: op.killId, featureId: op.featureId, version: op.version } });
          this.db.tx(() => {
            this.observe(it, 'SYNCED');
            this.repo.link('JIRA', it.key, 'KILL', op.killId, PLATFORM_USER);
            this.repo.link('JIRA', it.key, 'FEATURE', fid(op.featureId, op.version), PLATFORM_USER);
          });
          return this.done(j);
        }
        case 'VERIFICATION': {
          const r = await a.write(op.key, { append: { field: 'verifications', value: { gate: op.gate, status: op.status, featureId: op.featureId, version: op.version, evidenceRef: op.evidenceRef, at: this.clock.iso() } } }, null);
          if (r.ok) this.observe(r.item, 'SYNCED', { verified: { gate: op.gate, status: op.status } });
          return this.done(j);
        }
        case 'COMMIT_STATUS': {
          const sha = this.repo.item('GITLAB', op.key)?.extra.sha ?? null;
          const r = await a.write(op.key, { append: { field: 'commitStatuses', value: { name: op.name, state: op.state, description: op.description, sha, at: this.clock.iso() } } }, null);
          if (r.ok) this.observe(r.item, 'SYNCED');
          return this.done(j);
        }
        case 'REQ_LINK': {
          const f = this.features.get(op.featureId, op.version);
          if (!f) return this.skip(j, 'Feature 없음');
          const missing: string[] = [];
          for (const reqId of f.requirementIds ?? []) {
            const remote = await a.findRequirement(reqId);
            if (!remote) {
              missing.push(reqId);
              continue;
            }
            this.db.tx(() => {
              this.observe(remote, 'SYNCED', { reqId });
              this.repo.link('CODEBEAMER', remote.key, 'FEATURE', fid(f.featureId, f.version), PLATFORM_USER);
            });
          }
          // 요구 ID가 codeBeamer에 없다(FR-DEP-005-002 요구 존재 확인) — 재시도하다 실패로 남긴다
          if (missing.length) {
            this.repo.retry(j, `codeBeamer에 요구 ${missing.join(', ')}이(가) 없습니다 — 요구 ID를 확인하거나 codeBeamer에 등록하세요.`);
            return 'failed';
          }
          return this.done(j);
        }
      }
    } catch (e) {
      // 일부만 반영된 쓰기 — 지금 외부 모습을 마지막 관측으로 둔다(재시도가 자기 쓰기를 외부 변경으로 보고 충돌을 열지 않게)
      if (e instanceof ExtPartialWriteError) this.observe(e.item, 'PENDING');
      this.repo.retry(j, e instanceof Error ? e.message : String(e));
      // Epic 거울 작업은 외부 키 대신 Feature를 갖는다 — 연결된 Epic의 상태를 실패로
      const k = 'key' in j.job ? j.job.key : j.job.op === 'EPIC_MIRROR' ? (this.linkedKeys('FEATURE', fid(j.job.featureId, j.job.version), 'JIRA', 'EPIC')[0] ?? null) : null;
      if (k && this.repo.job(j.jobId)?.status === 'FAILED') this.repo.setState(j.system, k, 'FAILED');
      return 'failed';
    }
  }

  /**
   * Epic 거울 쓰기 — FF 주인 필드(제목·범위·Feature DB·읽기 전용 칸)는 다르면 다시 쓰고, 상태는 mirrorStatus와 같이
   * 외부가 그사이 몰래 바뀌었으면 덮어쓰지 않고 충돌로 둔다(80-50 §4.2·D-ALM-4).
   */
  private async mirrorEpic(j: OutboxJob, key: string, d: EpicDesired, comment: string | null): Promise<'done' | 'conflicts'> {
    const a = this.adapters.of('JIRA');
    const remote = await a.read(key);
    if (!remote) throw new Error(`JIRA ${key}이(가) 외부 시스템에 없습니다.`);
    const remoteFields = ((remote.fields.epic ?? {}) as Partial<Record<EpicFieldKey, unknown>>);
    const diff = epicFieldDiff(d, remoteFields);
    // 원격에 아직 없는 칸(처음 쓰기)도 채운다 — 설정된 필드만 실제로 쓰인다
    const missing = (Object.keys(d.fields) as EpicFieldKey[]).filter((k) => !(k in remoteFields) && d.fields[k] != null);
    const keys = [...new Set([...diff, ...missing])];
    const fields = keys.length ? Object.fromEntries(keys.map((k) => [k, d.fields[k]])) : undefined;
    const title = remote.title !== d.summary ? d.summary : undefined;
    const desired = JIRA_EPIC_STATUS[d.lifecycle];
    if (remote.status === desired) {
      if (fields || title !== undefined || comment) {
        const r = await a.write(key, { ...(fields ? { fields } : {}), ...(title !== undefined ? { title } : {}), ...(comment ? { comment } : {}) }, null);
        if (r.ok) this.observe(r.item, 'SYNCED');
      } else this.observe(remote, 'SYNCED');
      return this.done(j);
    }
    return this.mirrorStatus(j, key, desired, comment, { ...(fields ? { fields } : {}), ...(title !== undefined ? { title } : {}) }, remote);
  }

  /** 거울 값 쓰기 — 외부가 그사이(우리가 모르게) 바뀌었으면 덮어쓰지 않고 충돌 */
  private async mirrorStatus(j: OutboxJob, key: string, desired: string, comment: string | null, also: Pick<WritePatch, 'fields' | 'title'> = {}, read?: RemoteItem): Promise<'done' | 'conflicts'> {
    const a = this.adapters.of(j.system);
    const remote = read ?? (await a.read(key));
    if (!remote) throw new Error(`${j.system} ${key}이(가) 외부 시스템에 없습니다.`);
    const seen = this.repo.item(j.system, key);
    if (remote.status === desired) {
      if (comment) {
        const r = await a.write(key, { comment }, null);
        if (r.ok) this.observe(r.item, 'SYNCED');
      } else this.observe(remote, 'SYNCED');
      return this.done(j);
    }
    const expected = seen && seen.revision ? seen.revision : remote.revision;
    const r = await a.write(key, { ...also, status: desired, ...(comment ? { comment } : {}) }, expected);
    if (r.ok) {
      this.observe(r.item, 'SYNCED');
      return this.done(j);
    }
    const theirs = (r as Extract<WriteResult, { ok: false }>).conflict;
    this.db.tx(() => {
      this.repo.openConflict({ system: j.system, key, field: 'status', platformValue: desired, externalValue: theirs.status, jobId: j.jobId });
      this.repo.finish(j, 'CONFLICT', `외부에서 상태가 '${theirs.status}'(으)로 바뀌어 있어 '${desired}'(으)로 덮어쓰지 않았습니다.`);
      this.repo.setState(j.system, key, 'CONFLICT');
      this.events.publish('ext.sync.conflict', key, { system: j.system, key, platformValue: desired, externalValue: theirs.status }, { componentId: 'D05-01' });
    });
    return 'conflicts';
  }

  // ── 대사(alm-reconcile)가 쓰는 보낼 함 ──
  queueEpicMirror(featureId: string, version: string, comment: string | null, idem: string) {
    this.enqueue('JIRA', { op: 'EPIC_MIRROR', featureId, version, comment }, idem);
  }
  queueLegacyEpic(key: string, keep: string, idem: string) {
    this.enqueue('JIRA', { op: 'LEGACY_EPIC', key, keep }, idem);
  }
  /** 이 Feature의 Epic 거울 쓰기가 아직 보내지 않은 채 있는가(대사가 우리 쪽 차이를 충돌로 오인하지 않게) */
  pendingEpic(featureId: string): boolean {
    return this.repo.jobs({ system: 'JIRA', status: 'PENDING', limit: 2000 }).some((j) => j.job.op === 'EPIC_MIRROR' && j.job.featureId === featureId);
  }

  done(j: OutboxJob): 'done' {
    this.repo.finish(j, 'DONE');
    return 'done';
  }
  skip(j: OutboxJob, why: string): 'done' {
    this.repo.finish(j, 'SKIPPED', why);
    return 'done';
  }

  /** 외부에서 읽은 값으로 마지막 관측 값을 갱신 */
  observe(it: RemoteItem, syncState: ExtRef['syncState'], extraPatch: Record<string, unknown> = {}) {
    const prev = this.repo.item(it.system, it.key);
    const fields = it.fields as Record<string, unknown>;
    this.repo.putItem({
      system: it.system,
      kind: it.kind,
      key: it.key,
      url: it.url,
      title: it.title,
      status: it.status,
      revision: it.revision,
      syncState,
      syncedAt: this.clock.iso(),
      stale: prev?.stale ?? false,
      extra: { ...(prev?.extra ?? {}), ...pickExtra(fields), ...(fields.epic ? { epicFields: fields.epic } : {}), ...((fields.child ?? {}) as Record<string, unknown>), ...extraPatch },
    });
  }

  // ───────────────────────── 받기: webhook ─────────────────────────
  /** 외부 시스템이 보낸 webhook — 서명 확인 → 정규화 → 중복 버림 → 주인 규칙으로 처리 */
  ingest(system: ExtSystem, headers: Record<string, string | undefined>, body: unknown, raw: string, actorOverride?: Actor): InboxRow & { duplicate: boolean } {
    if (modeOf(system) === 'off') throw new DomainError('GUARD_FAILED', `${system} 연계가 꺼져 있습니다 (IF_MODE_${EXT_SYSTEM_IF[system].slice(3)}=off).`);
    verifyWebhook(system, headers, raw);
    const deliveryId = deliveryIdOf(system, headers, raw);
    return this.receive(system, deliveryId, body, actorOverride);
  }

  /**
   * 받은 변경 하나 — webhook과 대사(80-50 §4.5, 웹훅을 놓친 변경)가 같은 길: 중복 버림 → 정규화 → 서비스 계정 메아리 → 주인 규칙.
   * body는 그 도구의 webhook 본문 모양이다(대사는 이슈 JSON과 변경 이력으로 같은 모양을 만든다).
   */
  receive(system: ExtSystem, deliveryId: string, body: unknown, actorOverride?: Actor): InboxRow & { duplicate: boolean } {
    const dup = this.repo.seen(system, deliveryId);
    if (dup) return { ...dup, duplicate: true };
    const normalized = normalize(system, deliveryId, body);
    // live — 플랫폼 서비스 계정이 한 변경의 메아리는 외부 사람 이름이 아니라 그 계정의 외부 ID로 온다(JIRA Cloud accountId)
    const change = normalized && modeOf(system) === 'live' && isServiceAccount(system, normalized.externalUser) ? { ...normalized, externalUser: PLATFORM_USER } : normalized;
    const now = this.clock.iso();
    if (!change) {
      const row: InboxRow = { system, deliveryId, receivedAt: now, key: '-', outcome: 'IGNORED', summary: '이 연계와 무관한 이벤트', externalUser: '' };
      this.repo.receive(row);
      return { ...row, duplicate: false };
    }
    const r = this.apply(change, actorOverride);
    const row: InboxRow = { system, deliveryId, receivedAt: now, key: change.key, outcome: r.outcome, summary: r.summary, externalUser: change.externalUser };
    this.db.tx(() => {
      this.repo.receive(row);
      if (r.outcome === 'REJECTED' || r.outcome === 'UNMAPPED') this.events.publish('ext.change.rejected', change.key, { system, key: change.key, outcome: r.outcome, summary: r.summary, externalUser: change.externalUser }, { componentId: 'D05-01' });
    });
    return { ...row, duplicate: false };
  }

  private apply(c: ExtChange, actorOverride?: Actor): Outcome {
    const prev = this.repo.item(c.system, c.key);
    const ref: ExtRef = {
      system: c.system,
      kind: c.kind,
      key: c.key,
      url: c.url,
      title: c.title,
      status: c.status,
      revision: c.revision,
      syncState: 'SYNCED',
      syncedAt: this.clock.iso(),
      stale: prev?.stale ?? false,
      extra: { ...(prev?.extra ?? {}), ...stripUndefined(c.extra) },
    };
    // 플랫폼 서비스 계정이 쓴 것의 메아리 — 관측 값만 맞춘다
    if (c.externalUser === PLATFORM_USER) {
      this.repo.putItem(ref);
      return { outcome: 'IGNORED', summary: '플랫폼이 쓴 변경의 알림' };
    }
    const correlationId = `${c.system.toLowerCase()}:${c.deliveryId}`;
    const ext = this.kindHandler(c.kind);
    if (ext) return ext(c, prev, ref, correlationId, actorOverride);
    switch (c.kind) {
      case 'REQUIREMENT':
        return this.onRequirement(c, prev, ref, correlationId);
      case 'EPIC':
        return this.onEpic(c, prev, ref, correlationId, actorOverride);
      case 'CHANGE_REQUEST':
        return this.onChangeRequest(c, prev, ref, correlationId, actorOverride);
      case 'DEFECT':
        this.db.tx(() => {
          this.repo.putItem(ref);
          if (c.refs.epicKey) for (const e of this.repo.entitiesOf('JIRA', c.refs.epicKey, 'FEATURE')) this.repo.link('JIRA', c.key, 'FEATURE', e.entityId, c.externalUser);
        });
        return { outcome: 'APPLIED', summary: `결함 ${c.key} ${c.status}` };
      case 'MERGE_REQUEST':
        return this.onMergeRequest(c, ref, correlationId);
      case 'PIPELINE':
        return this.onPipeline(c, ref, correlationId);
    }
  }

  /** codeBeamer 요구 — 주인이 codeBeamer. 내용·상태가 개정되면 연결된 Feature에 G2 재검토 표시 */
  private onRequirement(c: ExtChange, prev: ExtRef | null, ref: ExtRef, correlationId: string): Outcome {
    const changed = !!prev && c.revision > prev.revision && (prev.title !== c.title || prev.status !== c.status || prev.extra.description !== c.extra.description);
    const features = this.repo.entitiesOf('CODEBEAMER', c.key, 'FEATURE').map((e) => e.entityId);
    this.db.tx(() => {
      this.repo.putItem({ ...ref, stale: changed && features.length > 0 ? true : ref.stale });
      if (changed) {
        this.audit.record(this.systemActor('CODEBEAMER', correlationId), 'EXT_REQUIREMENT_REVISED', c.key, { before: { title: prev!.title, status: prev!.status, revision: prev!.revision }, after: { title: c.title, status: c.status, revision: c.revision }, reason: `codeBeamer ${c.externalUser}`, componentId: 'D05-01' });
        this.events.publish('ext.requirement.changed', c.key, { key: c.key, revision: c.revision, status: c.status, features, by: c.externalUser }, { componentId: 'D05-01', correlationId });
      }
    });
    return changed ? { outcome: 'APPLIED', summary: `요구 ${c.key} 개정 r${c.revision}${features.length ? ` — Feature ${features.length}건 G2 재검토 필요` : ''}` } : { outcome: prev ? 'IGNORED' : 'APPLIED', summary: prev ? '바뀐 내용 없음' : `요구 ${c.key} 등록` };
  }

  /**
   * JIRA Epic = FF Feature(80-50 §4.1) — 상태 변경은 작업 중 버전의 Lifecycle 전이 요청(판정은 플랫폼 게이트).
   * FF 주인 필드(범위·Feature DB·담당·제목·읽기 전용 칸)를 JIRA에서 바꾸면 주인 규칙(§4.2)대로 요청·되돌림·사람이 고름.
   * 거부되면 Epic을 플랫폼 값으로 되돌리고 사유 댓글.
   */
  private onEpic(c: ExtChange, prev: ExtRef | null, ref: ExtRef, correlationId: string, actorOverride?: Actor): Outcome {
    const linkedFeature = this.epics.featureOf(c.key);
    const target = linkedFeature ?? (c.refs.featureId && c.refs.version && this.features.get(c.refs.featureId, c.refs.version) ? c.refs.featureId : null);
    this.db.tx(() => {
      this.repo.putItem(ref);
      if (target && !linkedFeature) this.epics.linkAll(c.key, target, c.externalUser);
    });
    if (!target) return this.featureFromEpic(c, correlationId, actorOverride);
    // 합쳐진 옛 버전별 Epic — Feature Epic 쪽에서 관리한다
    if (prev?.extra.supersededBy) return { outcome: 'IGNORED', summary: `${c.key}는 이전 Epic(현재 ${String(prev.extra.supersededBy)})` };
    const d = this.epics.desired(target);
    if (!d) return { outcome: 'IGNORED', summary: `${target} 없음` };
    const featureId = target;
    const version = d.version;
    const f = this.features.get(featureId, version)!;
    const fieldOutcome = this.onEpicFields(c, prev, d, f, correlationId, actorOverride);
    const statusChanged = (c.fromStatus !== null && c.fromStatus !== c.status) || (!!prev && prev.status !== c.status) || !!actorOverride;
    if (!statusChanged || JIRA_EPIC_STATUS[f.lifecycle] === c.status) return fieldOutcome ?? { outcome: 'IGNORED', summary: '상태 같음' };
    const to = lifecycleOfEpicStatus(c.status);
    const revert = (why: string): Outcome => {
      this.db.tx(() => {
        this.repo.setState('JIRA', c.key, 'REJECTED');
        this.repo.enqueue('JIRA', { op: 'EPIC_MIRROR', featureId, version, comment: `플랫폼이 이 상태 변경을 받지 않았습니다 — ${why} 상태를 '${JIRA_EPIC_STATUS[f.lifecycle]}'(으)로 되돌립니다.` }, `revert:${correlationId}`);
      });
      return { outcome: 'REJECTED', summary: `${c.key} '${c.status}' 거부 — ${why}` };
    };
    if (to === 'PROPOSED' && f.lifecycle !== 'PROPOSED') return revert(`새 Version은 플랫폼에서 만듭니다(작업 중 버전 ${version}).`);
    if (!to) return revert(`'${c.status}'은(는) 플랫폼 Lifecycle 상태가 아닙니다.`);
    const rule = FEATURE_TRANSITIONS.find((r) => r.from === f.lifecycle && r.to === to);
    if (!rule) return revert(`${f.lifecycle} → ${to}는 허용된 전이가 아닙니다.`);
    let actor: Actor | null = actorOverride ?? null;
    if (!actor) {
      const who = this.identity('JIRA', c.externalUser);
      if (!who) {
        const r = revert(`JIRA 계정 '${c.externalUser}'이(가) 플랫폼 계정에 매핑되어 있지 않습니다.`);
        return { ...r, outcome: 'UNMAPPED' };
      }
      actor = this.actorFor(who, rule.roles, correlationId);
      if (!actor) return revert(`${who.name}은(는) '${rule.ko}' 권한(${rule.roles.join('·')})이 없습니다.`);
    }
    try {
      this.lifecycle.transition(actor, featureId, version, to, `JIRA ${c.key}: ${c.fromStatus ?? prev?.status ?? '?'} → ${c.status} (${c.externalUser})`);
      return { outcome: 'APPLIED', summary: `${target} ${f.lifecycle} → ${to} (JIRA ${c.key})` };
    } catch (e) {
      return revert(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Epic 필드 변경(80-50 §4.2) — 사람이 바꾼 FF 주인 칸만 본다(관측 값과 다르고 FF 기대값과도 다른 값, 빈 칸은 거울 쓰기가 채운다).
   *   범위(국가·차종·트림)·읽기 전용 칸 → 되돌림 · 이름·담당·Feature DB → 작업 중 버전이 PROPOSED면 초안 수정 요청(작성 권한), 아니면 되돌림
   *   ASIL → 사람이 고름(검토함 '외부 연계 충돌', 기능안전 담당) — 상태 판단은 건드리지 않는다
   */
  private onEpicFields(c: ExtChange, prev: ExtRef | null, d: EpicDesired, f: FeatureVersionRow, correlationId: string, actorOverride?: Actor): Outcome | null {
    if (!prev) return null;
    const remote = (c.extra.epicFields ?? {}) as Partial<Record<EpicFieldKey, unknown>>;
    const seen = (prev.extra.epicFields ?? {}) as Partial<Record<EpicFieldKey, unknown>>;
    const touched = epicFieldDiff(d, remote).filter((k) => remote[k] != null && remote[k] !== '' && (!(k in seen) || !sameEpicValue(seen[k], remote[k])));
    const renamed = prev.title !== c.title && c.title !== d.summary ? nameOfEpicSummary(c.title) : null;
    if (!touched.length && !renamed) return null;
    const reverted: string[] = [];
    const requests: Partial<Record<'name' | 'ownerId' | 'featureRefs', unknown>> = {};
    let review: EpicFieldKey | null = null;
    for (const k of touched) {
      const rule = EPIC_FIELD[k];
      if (rule.change === 'immutable') reverted.push(`${rule.ko}은(는) 바꿀 수 없습니다 — 범위가 다르면 새 Feature로 등록하세요`);
      else if (rule.change === 'readonly') reverted.push(`${rule.ko}은(는) 플랫폼이 쓰는 칸입니다`);
      else if (rule.change === 'review') review = k;
      else if (k === 'ownerId') requests.ownerId = String(remote[k]);
      else if (k === 'featureDb') requests.featureRefs = (remote[k] as string[]).map((refId, i) => ({ refId, role: i === 0 ? 'PRIMARY' : 'INCLUDED' }));
    }
    if (renamed && renamed !== f.name) requests.name = renamed;
    const notes: string[] = [];
    if (Object.keys(requests).length) {
      const why = (() => {
        if (f.lifecycle !== 'PROPOSED') return `작업 중 버전 ${f.version}이(가) ${f.lifecycle}라 바꿀 수 없습니다 — 새 Version에서 바꾸세요`;
        let actor = actorOverride ?? null;
        if (!actor) {
          const who = this.identity('JIRA', c.externalUser);
          if (!who) return `JIRA 계정 '${c.externalUser}'이(가) 플랫폼 계정에 매핑되어 있지 않습니다`;
          actor = this.actorFor(who, ['FEATURE_AUTHOR'], correlationId);
          if (!actor) return `${who.name}은(는) Feature 작성 권한이 없습니다`;
        }
        try {
          this.registry.updateDraft(actor, f.featureId, f.version, requests as never);
          notes.push(`초안 ${f.version} 수정(${Object.keys(requests).join('·')})`);
          return null;
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      })();
      if (why) reverted.push(why);
    }
    if (review) {
      this.db.tx(() => {
        this.repo.openConflict({ system: 'JIRA', key: c.key, field: review!, platformValue: String(d.fields[review!] ?? ''), externalValue: String(remote[review!] ?? ''), jobId: null });
        this.repo.setState('JIRA', c.key, 'CONFLICT');
        this.events.publish('ext.sync.conflict', c.key, { system: 'JIRA', key: c.key, field: review, platformValue: d.fields[review!], externalValue: remote[review!] }, { componentId: 'D05-01', correlationId });
      });
      notes.push(`${EPIC_FIELD[review].ko} 변경은 기능안전 담당 확인 대기`);
    }
    if (reverted.length) {
      this.db.tx(() => {
        this.repo.setState('JIRA', c.key, 'REJECTED');
        this.repo.enqueue('JIRA', { op: 'EPIC_MIRROR', featureId: f.featureId, version: f.version, comment: `플랫폼이 이 필드 변경을 받지 않았습니다 — ${reverted.join('. ')}. 플랫폼 값으로 되돌립니다.` }, `revert-fields:${correlationId}`);
      });
      return { outcome: 'REJECTED', summary: `${c.key} 필드 변경 거부 — ${reverted.join('; ')}` };
    }
    return { outcome: 'APPLIED', summary: `${c.key} ${notes.join(' · ')}` };
  }

  /**
   * 연결된 Feature가 없는 Epic → PROPOSED Feature 자동 등록(사용자 결정 2026-10-23 "JIRA에서 Epic 만들면 Feature 자동 생성").
   * 플랫폼 등록과 같은 경로(RegistryService.create — 중복 확인·안전 분류 초안·감사·이벤트)를 매핑된 작성자 계정으로 탄다.
   * 범위 값이 빠졌거나 권한·중복으로 막히면 만들지 않고 Epic에 사유 댓글 — Epic을 고치면(편집 webhook) 다시 시도한다.
   */
  private featureFromEpic(c: ExtChange, correlationId: string, actorOverride?: Actor): Outcome {
    if (process.env.FF_EPIC_AUTOCREATE === 'off') return { outcome: 'IGNORED', summary: '연결된 Feature 없는 Epic (자동 등록 꺼짐)' };
    const refuse = (why: string, outcome: Outcome['outcome'] = 'REJECTED'): Outcome => {
      this.db.tx(() => {
        this.repo.setState('JIRA', c.key, 'REJECTED');
        this.enqueue('JIRA', { op: 'COMMENT', key: c.key, text: `플랫폼 Feature를 등록하지 않았습니다 — ${why}` }, `epic-new:${c.key}:${c.revision}`);
      });
      return { outcome, summary: `${c.key} Feature 자동 등록 안 함 — ${why}` };
    };
    let actor: Actor | null = actorOverride ?? null;
    const who = this.identity('JIRA', c.externalUser);
    if (!actor) {
      if (!who) return refuse(`JIRA 계정 '${c.externalUser}'이(가) 플랫폼 계정에 매핑되어 있지 않습니다.`, 'UNMAPPED');
      actor = this.actorFor(who, ['FEATURE_AUTHOR'], correlationId);
      if (!actor) return refuse(`${who.name}은(는) Feature 등록 권한(Feature 작성)이 없습니다.`);
    }
    const scope = (c.extra.scope ?? {}) as Record<string, string> & { refIds?: string[] };
    const missing = missingEpicScope(scope);
    if (missing.length) return refuse(`Epic에 ${missing.map((k) => EPIC_SCOPE_LABEL[k]).join('·')} 값이 없거나 형식이 틀립니다. 채우면 다시 등록을 시도합니다.`);
    // 기준 기능(Feature DB) 연결 필수(30-95 §7, D-REF-10) — FF 앱이 쓰는 사용자 필드(모의·데모만 라벨 ref-primary:·ref: 폴백). 첫 값이 대표
    const refIds = Array.isArray(scope.refIds) ? scope.refIds : [];
    if (!refIds.length) return refuse(`기준 기능 ID가 없습니다. ${EPIC_REF_HINT}`);
    const featureRefs = refIds.map((refId, i) => ({ refId, role: i === 0 ? ('PRIMARY' as const) : ('INCLUDED' as const) }));
    const body = CreateFeatureBody.safeParse({ name: c.title, description: String(c.extra.description ?? '').trim() || c.title, country: scope.country, vehicleModel: scope.vehicleModel, trim: scope.trim, asil: scope.asil, ownerId: scope.ownerId, tags: [`jira:${c.key}`], featureRefs });
    if (!body.success) {
      const refIssue = body.error.issues.some((i) => i.path[0] === 'featureRefs');
      return refuse(`Epic 값이 Feature 등록 형식에 맞지 않습니다 — ${body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}${refIssue ? ` ${EPIC_REF_HINT}` : ''}`);
    }
    // 중복 확인은 트랜잭션 밖에서 — 거부 감사는 트랜잭션 밖에 남겨야 한다(RegistryService.create와 같은 판정)
    const similar = this.features.similar(body.data.name, body.data.country, body.data.vehicleModel, body.data.trim);
    if (similar.length) {
      this.audit.failed(actor, 'FEATURE_CREATE', body.data.name, `JIRA ${c.key}: 같은 적용 범위에 유사 Feature 존재`, 'D05-01');
      return refuse(`같은 국가·차종·트림에 이름이 비슷한 Feature가 이미 있습니다. 기존 Feature: ${similar.map((s) => fid(s.featureId, s.version)).join(', ')} — 같은 기능이면 Epic 본문에 그 ID를 적어 연결하고, 새 Version이면 플랫폼에서 Version을 만드세요.`);
    }
    // 기준 행 판정도 트랜잭션 밖에서 먼저 — 없는·폐기 행, 대표 ASIL 차이, 같은 범위 같은 대표 행(JIRA에서는 확인·사유를 받을 수 없다)
    try {
      const linked = this.registry.checkRefs(body.data);
      // 요청 중(PENDING) 행은 사람이 등록 화면에서 요청·연결한다 — JIRA에서 만들 수 없다
      const pending = linked.warnings.filter((w) => w.code === 'REF_STATUS' && w.status === 'PENDING').map((w) => w.refId);
      if (pending.length) {
        this.audit.failed(actor, 'FEATURE_CREATE', body.data.name, `JIRA ${c.key}: 요청 중 기준 행 ${pending.join(', ')}`, 'D05-01');
        return refuse(`기준 행 ${pending.join(', ')}은(는) Feature DB 승인 전(요청 중)이라 JIRA에서 연결할 수 없습니다 — 플랫폼 Feature 등록 화면에서 등록하거나, 승인된 기준 기능 ID를 넣어 주세요.`);
      }
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      this.audit.failed(actor, 'FEATURE_CREATE', body.data.name, `JIRA ${c.key}: 기준 기능 연결 — ${e.message}`, 'D05-01');
      const refProblem = e.code === 'REFDB_LINK_REQUIRED' || (e.details as { field?: string } | undefined)?.field === 'featureRefs';
      return refuse(`${e.message}${refProblem ? ` ${EPIC_REF_HINT}` : ''}`);
    }
    try {
      const f = this.db.tx(() => {
        const f = this.registry.create(actor!, body.data);
        const id = fid(f.featureId, f.version);
        this.epics.linkAll(c.key, f.featureId, c.externalUser);
        this.enqueue('JIRA', { op: 'COMMENT', key: c.key, text: `플랫폼 Feature ${id} 등록(PROPOSED) — ${who?.name ?? actor!.id}. 이 Epic과 Feature Lifecycle이 양방향으로 연결되었습니다(상태 변경은 플랫폼 게이트를 거칩니다).` }, `epic-new:${c.key}:${c.revision}`);
        return f;
      });
      return { outcome: 'APPLIED', summary: `${c.key} → ${fid(f.featureId, f.version)} 자동 등록(PROPOSED)` };
    } catch (e) {
      return refuse(e instanceof Error ? e.message : String(e));
    }
  }

  /** JIRA CR — 흐름의 주인은 JIRA. CR을 승인·반려하면 연결된 정책의 승인·반려 요청(직무 분리는 플랫폼이 확인) */
  private onChangeRequest(c: ExtChange, prev: ExtRef | null, ref: ExtRef, correlationId: string, actorOverride?: Actor): Outcome {
    const epicFeature = c.refs.epicKey ? this.repo.entitiesOf('JIRA', c.refs.epicKey, 'FEATURE')[0]?.entityId : undefined;
    const feature = epicFeature ?? (c.refs.featureId && c.refs.version ? fid(c.refs.featureId, c.refs.version) : undefined);
    const policyId = this.repo.entitiesOf('JIRA', c.key, 'POLICY')[0]?.entityId ?? (c.refs.policyId && this.policies.get(c.refs.policyId) ? c.refs.policyId : undefined);
    this.db.tx(() => {
      this.repo.putItem(ref);
      if (feature) this.repo.link('JIRA', c.key, 'FEATURE', feature, c.externalUser);
      if (policyId) this.repo.link('JIRA', c.key, 'POLICY', policyId, c.externalUser);
    });
    const statusChanged = (c.fromStatus !== null && c.fromStatus !== c.status) || (!!prev && prev.status !== c.status) || !!actorOverride;
    const decision = c.status === JIRA_CR_STATUS.APPROVED ? 'APPROVE' : c.status === JIRA_CR_STATUS.REJECTED ? 'REJECT' : null;
    if (!statusChanged || !decision || !policyId) return { outcome: 'APPLIED', summary: `CR ${c.key} ${c.status}${policyId ? ` · 정책 ${policyId}` : ''}` };
    const p = this.policies.get(policyId)!;
    if (crOfPolicy(p.status) === c.status) return { outcome: 'IGNORED', summary: '정책 상태와 같음' };
    const revert = (why: string): Outcome => {
      this.db.tx(() => {
        this.repo.setState('JIRA', c.key, 'REJECTED');
        this.repo.enqueue('JIRA', { op: 'CR_STATUS', key: c.key, status: crOfPolicy(p.status) ?? JIRA_CR_STATUS.OPEN, comment: `플랫폼이 이 ${decision === 'APPROVE' ? '승인' : '반려'}를 받지 않았습니다 — ${why}` }, `revert:${correlationId}`);
      });
      return { outcome: 'REJECTED', summary: `${c.key} ${c.status} 거부 — ${why}` };
    };
    if (p.status !== 'VALIDATED') return revert(`정책 ${policyId}은(는) ${p.status} 상태입니다(검증 GO 뒤에만 승인·반려).`);
    let actor: Actor | null = actorOverride ?? null;
    if (!actor) {
      const who = this.identity('JIRA', c.externalUser);
      if (!who) return { ...revert(`JIRA 계정 '${c.externalUser}'이(가) 플랫폼 계정에 매핑되어 있지 않습니다.`), outcome: 'UNMAPPED' };
      actor = this.actorFor(who, ['FEATURE_APPROVER'], correlationId);
      if (!actor) return revert(`${who.name}은(는) 정책 승인 권한(Feature 승인자)이 없습니다.`);
    }
    try {
      this.policyService.decide(actor, policyId, { decision, reason: `JIRA ${c.key} ${c.status} (${c.externalUser})` });
      return { outcome: 'APPLIED', summary: `정책 ${policyId} ${decision === 'APPROVE' ? '승인' : '반려'} (JIRA ${c.key})` };
    } catch (e) {
      return revert(e instanceof Error ? e.message : String(e));
    }
  }

  /** GitLab MR — 주인은 GitLab. Feature 버전·CR에 연결하고 병합을 기록 */
  private onMergeRequest(c: ExtChange, ref: ExtRef, correlationId: string): Outcome {
    const feature = c.refs.featureId ? (c.refs.version ? fid(c.refs.featureId, c.refs.version) : latestOf(this.features.versions(c.refs.featureId))) : null;
    this.db.tx(() => {
      this.repo.putItem(ref);
      if (feature) this.repo.link('GITLAB', c.key, 'FEATURE', feature, c.externalUser);
      if (c.refs.crKey && feature && this.repo.item('JIRA', c.refs.crKey)) this.repo.link('JIRA', c.refs.crKey, 'FEATURE', feature, c.externalUser);
      if (c.status === 'merged') {
        this.audit.record(this.systemActor('GITLAB', correlationId), 'EXT_MR_MERGED', c.key, { after: { feature, sha: c.extra.sha, targetBranch: c.extra.targetBranch, by: c.externalUser }, componentId: 'D05-01' });
        this.events.publish('ext.mr.merged', c.key, { key: c.key, feature, sha: c.extra.sha, by: c.externalUser }, { componentId: 'D05-01', correlationId });
      }
    });
    return { outcome: 'APPLIED', summary: `MR ${c.key} ${c.status}${feature ? ` · ${feature}` : ' · Feature 참조 없음'}` };
  }

  /** GitLab 파이프라인 — 병합된 MR의 파이프라인이 성공하면 SW 변경 기록(IF-13)을 등록한다(MR 본문의 SW-…@x.y.z) */
  private onPipeline(c: ExtChange, ref: ExtRef, correlationId: string): Outcome {
    const mrKey = (c.extra.mrKey as string | null) ?? null;
    const mr = mrKey ? this.repo.item('GITLAB', mrKey) : null;
    this.db.tx(() => {
      this.repo.putItem(ref);
      if (mr) {
        this.repo.putItem({ ...mr, extra: { ...mr.extra, pipeline: { key: c.key, status: c.status, url: c.url } } });
        for (const e of this.repo.entitiesOf('GITLAB', mr.key, 'FEATURE')) this.repo.link('GITLAB', c.key, 'FEATURE', e.entityId, c.externalUser);
      }
    });
    if (c.status !== 'success' || !mr || mr.status !== 'merged') return { outcome: 'APPLIED', summary: `파이프라인 ${c.key} ${c.status}` };
    const sw = /\b(SW-[A-Z0-9-]+)@(\d+\.\d+\.\d+)\b/.exec(String(mr.extra.description ?? ''));
    const sha = String(mr.extra.sha ?? c.extra.sha ?? '');
    if (!sw || !/^[0-9a-f]{7,40}$/.test(sha)) return { outcome: 'APPLIED', summary: `파이프라인 ${c.key} 성공 · SW 변경 기록 없음(MR 본문에 SW-…@버전 없음)` };
    const iid = mr.key.split('!').pop();
    const rec = this.changeRecords.register(this.systemActor('GITLAB', correlationId), {
      changeId: `CHG-GL-${iid}`,
      swId: sw[1],
      swVersion: sw[2],
      commit: sha,
      summary: mr.title.slice(0, 300),
      aiGenerated: null,
      // 커버리지는 파이프라인이 보고한 값, 기준값은 프로젝트 설정(FF_COVERAGE_REQUIRED) — 없으면 기록 없음으로 G5가 막힌다(FFG-CODE-030)
      evidence: { review: mr.url, staticAnalysis: `${c.url}#static-analysis`, tests: c.url, coverage: typeof c.extra.coverage === 'number' && Number.isFinite(c.extra.coverage) ? { achieved: c.extra.coverage, required: Number(process.env.FF_COVERAGE_REQUIRED ?? 80) } : null },
    });
    return { outcome: 'APPLIED', summary: `파이프라인 ${c.key} 성공 → 변경 기록 ${rec.changeId} r${rec.rev}` };
  }

  // ───────────────────────── 충돌 · 연결 ─────────────────────────
  async resolve(actor: Actor, conflictId: number, choose: 'PLATFORM' | 'EXTERNAL', reason: string) {
    const c = this.repo.conflict(conflictId);
    if (!c) throw new DomainError('NOT_FOUND', `충돌 ${conflictId}을(를) 찾을 수 없습니다.`);
    if (c.status !== 'OPEN') throw new DomainError('CONFLICT', `충돌 ${conflictId}은(는) 이미 처리되었습니다.`);
    const remote = await this.adapters.of(c.system).read(c.key);
    if (!remote) throw new DomainError('NOT_FOUND', `${c.system} ${c.key}이(가) 외부 시스템에 없습니다.`);
    let result: Outcome;
    if (c.field !== 'status') return this.resolveField(actor, c, choose, reason);
    if (choose === 'PLATFORM') {
      // 외부의 지금 값을 보았다고 기록하고 플랫폼 값을 다시 보낸다
      this.db.tx(() => {
        this.observe(remote, 'PENDING');
        if (c.jobId) this.repo.requeue(c.jobId);
      });
      await this.drain();
      result = { outcome: 'APPLIED', summary: `플랫폼 값 '${c.platformValue}'을(를) 다시 보냄` };
    } else {
      // 외부 값을 이 사람의 요청으로 다시 시도한다(가드를 그대로 탄다)
      const prev = this.repo.item(c.system, c.key);
      if (prev) this.repo.putItem({ ...prev, status: c.platformValue });
      const change: ExtChange = { system: c.system, deliveryId: `resolve-${conflictId}`, kind: remote.kind, key: remote.key, url: remote.url, title: remote.title, status: remote.status, fromStatus: c.platformValue, revision: remote.revision, externalUser: actor.id, refs: {}, extra: {} };
      result = this.apply(change, actor);
      if (c.jobId) this.db.tx(() => this.repo.finish(this.repo.job(c.jobId!)!, 'SKIPPED', `충돌 ${conflictId}: 외부 값 선택`));
      await this.drain();
    }
    const done: ConflictRow = { ...c, status: 'RESOLVED', resolution: { choose, by: actor.id, at: this.clock.iso(), reason } };
    this.db.tx(() => {
      this.repo.resolveConflict(done);
      this.audit.record(actor, 'EXT_SYNC_CONFLICT_RESOLVE', `${c.system}:${c.key}`, { before: { platform: c.platformValue, external: c.externalValue }, after: { choose, outcome: result.outcome }, reason, componentId: 'D05-01' });
    });
    return { conflict: done, result };
  }

  /**
   * Epic 필드 충돌(ASIL — 80-50 §4.2) — 플랫폼 값: Epic을 다시 쓴다. 외부 값: 기능안전 담당이 작업 중 PROPOSED 초안에 반영(아니면 새 Version).
   */
  private async resolveField(actor: Actor, c: ConflictRow, choose: 'PLATFORM' | 'EXTERNAL', reason: string) {
    const featureId = this.epics.featureOf(c.key);
    const d = featureId ? this.epics.desired(featureId) : null;
    if (!featureId || !d) throw new DomainError('NOT_FOUND', `${c.key}에 연결된 Feature가 없습니다.`);
    let result: Outcome;
    if (choose === 'EXTERNAL') {
      if (c.field === 'asil' && actor.role !== 'SAFETY_OFFICER') throw new DomainError('FORBIDDEN', 'ASIL 변경은 기능안전 담당(Safety Officer)이 확인합니다.');
      const f = this.features.get(featureId, d.version)!;
      if (f.lifecycle !== 'PROPOSED') throw new DomainError('GUARD_FAILED', `작업 중 버전 ${f.version}이(가) ${f.lifecycle}라 바꿀 수 없습니다 — 새 Version에서 ASIL을 바꾸세요.`);
      this.registry.updateDraft(actor, featureId, f.version, { [c.field]: c.externalValue } as never);
      result = { outcome: 'APPLIED', summary: `${featureId}@${f.version} ${c.field} '${c.externalValue}' 반영` };
    } else result = { outcome: 'APPLIED', summary: `플랫폼 값 '${c.platformValue}'을(를) 다시 보냄` };
    const done: ConflictRow = { ...c, status: 'RESOLVED', resolution: { choose, by: actor.id, at: this.clock.iso(), reason } };
    this.db.tx(() => {
      this.repo.resolveConflict(done);
      this.enqueue('JIRA', { op: 'EPIC_MIRROR', featureId, version: d.version, comment: `플랫폼 ${choose === 'PLATFORM' ? '값 유지' : '값 반영'} — ${EPIC_FIELD[c.field as EpicFieldKey]?.ko ?? c.field} (${actor.id}: ${reason})` }, `resolve:${c.conflictId}`);
      this.audit.record(actor, 'EXT_SYNC_CONFLICT_RESOLVE', `${c.system}:${c.key}`, { before: { field: c.field, platform: c.platformValue, external: c.externalValue }, after: { choose, outcome: result.outcome }, reason, componentId: 'D05-01' });
    });
    await this.drain();
    return { conflict: done, result };
  }

  /** 정책 ↔ 근거 JIRA CR 연결(사람이) — CR은 JIRA에 있어야 한다 */
  async linkChangeRequest(actor: Actor, policyId: string, crKey: string) {
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `정책 ${policyId}을(를) 찾을 수 없습니다.`);
    const remote = await this.adapters.of('JIRA').read(crKey);
    if (!remote || remote.kind !== 'CHANGE_REQUEST') throw new DomainError('GUARD_FAILED', `JIRA에 변경요청 ${crKey}이(가) 없습니다.`);
    this.db.tx(() => {
      this.observe(remote, 'PENDING');
      this.repo.link('JIRA', crKey, 'POLICY', policyId, actor.id);
      this.repo.link('JIRA', crKey, 'FEATURE', fid(p.featureId, p.featureVersion), actor.id);
      this.audit.record(actor, 'EXT_CR_LINK', policyId, { after: { crKey }, componentId: 'D05-01' });
      this.enqueue('JIRA', { op: 'CR_STATUS', key: crKey, status: crOfPolicy(p.status) ?? JIRA_CR_STATUS.OPEN, comment: `플랫폼 정책 ${policyId}(${p.flagKey})에 연결 — ${actor.id}` }, `crlink:${policyId}:${crKey}:${this.clock.iso()}`);
    });
    await this.drain();
    return this.repo.linksOf('POLICY', policyId);
  }

  // ───────────────────────── 모의 외부 시스템(실서버 없을 때) ─────────────────────────
  private needMock(system: ExtSystem) {
    if (modeOf(system) !== 'mock') throw new DomainError('GUARD_FAILED', `${system}은(는) 모의 연결이 아닙니다 — 실제 도구에서 바꾸세요.`);
  }
  /** 모의 webhook 보내기 — 실서버와 같은 서명·정규화 경로 */
  private deliver(system: ExtSystem, it: ReturnType<MockExtStore['create']>, change: { fromStatus: string | null; created: boolean; action?: string }) {
    const d = this.store.webhook(it, change);
    const raw = JSON.stringify(d.body);
    const headers = { ...d.headers };
    if (system !== 'GITLAB') headers[system === 'JIRA' ? 'x-hub-signature' : 'x-cb-signature'] = hmac(system, raw);
    return this.ingest(system, headers, d.body, raw);
  }
  /** 바깥에서 사람이 한 일을 흉내 낸다(화면의 "외부에서 바꿔 보기"·재생) */
  async mockAct(system: ExtSystem, body: MockExtActionBody) {
    this.needMock(system);
    const it = this.store.get(system, body.key);
    if (!it) throw new DomainError('NOT_FOUND', `${system} ${body.key}이(가) 없습니다.`);
    const from = it.status;
    let next = it;
    let action: string | undefined;
    if (body.action === 'TRANSITION') {
      if (!body.status) throw new DomainError('VALIDATION', '새 상태(status)가 필요합니다.');
      next = this.store.update(system, it.key, body.externalUser, { status: body.status });
    } else if (body.action === 'COMMENT') {
      if (!body.comment?.trim() || body.comment.trim().length > 2000) throw new DomainError('VALIDATION', '댓글은 1~2000자로 입력하세요.');
      next = this.store.update(system, it.key, body.externalUser, { comment: body.comment.trim() });
    } else if (body.action === 'EDIT') {
      // Epic 범위 칸을 고치면 FF가 쓴 같은 칸(epic)도 그 값으로 — 실제 JIRA에서 필드 하나를 고친 것과 같다
      const scopeAsEpic = body.scope ? Object.fromEntries(Object.entries(body.scope).map(([k, v]) => [k === 'refIds' ? 'featureDb' : k, v])) : null;
      next = this.store.update(system, it.key, body.externalUser, { title: body.title, body: body.body, ...(body.scope ? { fields: { scope: { ...((it.fields.scope ?? {}) as Record<string, unknown>), ...body.scope }, ...(it.fields.epic ? { epic: { ...(it.fields.epic as Record<string, unknown>), ...scopeAsEpic } } : {}) } } : {}) });
    } else if (body.action === 'MERGE') {
      if (it.kind !== 'MERGE_REQUEST') throw new DomainError('VALIDATION', 'MR만 병합할 수 있습니다.');
      next = this.store.update(system, it.key, body.externalUser, { status: 'merged' });
      action = 'merge';
    } else {
      if (it.kind !== 'MERGE_REQUEST') throw new DomainError('VALIDATION', '파이프라인은 MR에 돌립니다.');
      const pl = this.store.create('GITLAB', 'PIPELINE', { title: `pipeline ${it.fields.sourceBranch}`, status: body.status ?? 'success', by: body.externalUser, fields: { sha: it.fields.sha, ref: it.fields.sourceBranch, mrKey: it.key, mrTitle: it.title, coverage: body.coverage ?? null } });
      const res = body.deliver ? this.deliver(system, pl, { fromStatus: null, created: true }) : null;
      await this.drain();
      return { item: pl, result: res };
    }
    const res = body.deliver ? this.deliver(system, next, { fromStatus: from, created: false, action }) : null;
    await this.drain();
    return { item: this.store.get(system, it.key), result: res };
  }
  async mockCreate(system: ExtSystem, body: MockExtCreateBody & { fields?: Record<string, unknown> }) {
    this.needMock(system);
    const kind = body.kind;
    const status = system === 'JIRA' ? (kind === 'EPIC' ? JIRA_EPIC_STATUS.PROPOSED : kind === 'STORY' ? 'To Do' : JIRA_CR_STATUS.OPEN) : system === 'GITLAB' ? 'opened' : 'Draft';
    const fields: Record<string, unknown> = { ...(body.fields ?? {}), ...(body.scope ? { scope: body.scope } : {}), ...(body.parentKey ? { parentKey: body.parentKey } : {}) };
    if (system === 'GITLAB') {
      fields.sha ??= createHash('sha1').update(`${body.title}:${this.clock.iso()}`).digest('hex');
      const r = parseRefs(`${body.title}\n${body.body}`);
      fields.sourceBranch ??= r.featureId ? `feature/${r.featureId.toLowerCase()}${r.version ? `-${r.version}` : ''}-${createHash('sha1').update(body.title).digest('hex').slice(0, 6)}` : `feature/${body.title.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase()}`;
      fields.targetBranch ??= 'main';
    }
    const it = this.store.create(system, kind, { title: body.title, body: body.body, status, by: body.externalUser, fields });
    const res = this.deliver(system, it, { fromStatus: null, created: true, action: 'open' });
    await this.drain();
    return { item: it, result: res };
  }
  mockItems(system: ExtSystem, kind?: ExtKind) {
    return this.store.all(system, kind);
  }

  /** 전시 Feature가 부팅 뒤 추가되는 순서도 지원한다. 실제 연계·일반 고객 요구에는 쓰지 않는다. */
  async repairShowcaseRequirements() {
    if (process.env.FF_SHOWCASE !== '1' || isProduction() || seedOf() === 'none' || EXT_SYSTEMS.some((s) => modeOf(s) !== 'mock')) return { created: 0, requeued: 0, disabled: true };
    const targets = this.features.all().filter((f) => f.tags.includes('가상 전시'));
    const featureKeys = new Set(targets.map((f) => fid(f.featureId, f.version)));
    const known = new Set(this.store.all('CODEBEAMER', 'REQUIREMENT').map((r) => r.fields.reqId));
    let created = 0, requeued = 0;
    // 먼저 전부 만들고 서명 webhook을 받는다. 문서마다 drain하면 아직 안 만든 나머지를 다시 실패시킨다.
    for (const f of targets) for (const reqId of f.requirementIds.filter((r) => /^DEMO-REQ-\d{3}$/.test(r))) {
      if (known.has(reqId)) continue;
      const content = demoRequirementContent(f, reqId);
      const item = this.store.create('CODEBEAMER', 'REQUIREMENT', { title: `${reqId} ${f.name}`, ...content, fields: { ...content.fields, requirementStatus: 'Draft' }, status: 'Draft', by: 'jung.req' });
      this.deliver('CODEBEAMER', item, { fromStatus: null, created: true });
      known.add(reqId); created++;
    }
    this.db.tx(() => {
      for (const job of this.repo.jobs({ system: 'CODEBEAMER', limit: 10000 })) {
        if ((job.status === 'FAILED' || job.status === 'PENDING') && job.job.op === 'REQ_LINK' && featureKeys.has(fid(job.job.featureId, job.job.version))) {
          this.repo.requeue(job.jobId); requeued++;
        }
      }
      if (created || requeued) this.audit.record({ id: 'system:showcase-requirements', role: 'SYSTEM', correlationId: 'seed:showcase-requirements' }, 'EXT_REQUIREMENT_DEMO_REPAIR', 'CODEBEAMER', { after: { created, requeued }, reason: '가상 시연 요구 정의·서명 webhook 등록 후 누락 링크 재시도. 검토·승인 상태 변경 없음', componentId: 'D05-01' });
    });
    await this.drain();
    return { created, requeued, disabled: false };
  }

  // ───────────────────────── 조회 ─────────────────────────
  summary(): ExtSystemSummary[] {
    return EXT_SYSTEMS.map((system) => ({
      system,
      ifId: EXT_SYSTEM_IF[system],
      mode: modeOf(system),
      baseUrl: extUrl(system, system === 'GITLAB' ? 'MERGE_REQUEST' : 'X', '').replace(/\/(browse|cb\/issue|[^/]+\/[^/]+\/-\/merge_requests)\/?$/, ''),
      links: this.repo.linkCount(system),
      pending: this.repo.countJobs(system, 'PENDING'),
      failed: this.repo.countJobs(system, 'FAILED'),
      conflicts: this.repo.countConflicts(system),
      rejected: this.repo.countInbox(system, 'REJECTED') + this.repo.countInbox(system, 'UNMAPPED'),
      lastInboundAt: this.repo.lastInbound(system),
      lastOutboundAt: this.repo.lastOutbound(system),
    }));
  }
  ownership() {
    return SYNC_OWNERSHIP;
  }
  links(entity: ExtLink['entity'], id: string) {
    return this.repo.linksOf(entity, id);
  }

  /** Feature 버전 하나의 추적 — 요구(codeBeamer) → Epic·CR(JIRA) → MR·파이프라인(GitLab) → 정책 */
  featureTrace(featureId: string, version: string) {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const id = fid(featureId, version);
    const links = this.repo.linksOf('FEATURE', id);
    const of = (kind: ExtKind) => links.filter((l) => l.kind === kind);
    const pols = this.policies.forFeature(featureId, version).map((p: Policy) => ({ policyId: p.policyId, flagKey: p.flagKey, status: p.status, changeRequests: this.repo.linksOf('POLICY', p.policyId, 'JIRA').map((l) => l.key) }));
    const missingReqs = (f.requirementIds ?? []).filter((r) => !of('REQUIREMENT').some((l) => l.extra.reqId === r));
    const conflicts = this.repo.conflicts('OPEN').filter((c) => links.some((l) => l.system === c.system && l.key === c.key));
    const d = this.epics.desired(featureId);
    const epicKey = this.epics.key(featureId);
    return {
      featureId,
      version,
      lifecycle: f.lifecycle,
      // Epic은 Feature 하나(80-50 §4.1) — 기대 상태는 작업 중 버전 상태
      epicVersion: d?.version ?? version,
      epicStatusExpected: JIRA_EPIC_STATUS[d?.lifecycle ?? f.lifecycle],
      requirements: of('REQUIREMENT'),
      missingRequirements: missingReqs,
      epic: of('EPIC').find((l) => l.key === epicKey) ?? null,
      changeRequests: of('CHANGE_REQUEST'),
      defects: of('DEFECT'),
      // 80-50 A3 — 기능 분해 Story·산출물 Task(Epic 아래)
      stories: of('STORY'),
      tasks: of('TASK'),
      mergeRequests: of('MERGE_REQUEST'),
      pipelines: of('PIPELINE'),
      policies: pols,
      conflicts,
      stale: of('REQUIREMENT').filter((l) => l.stale).map((l) => l.key),
    };
  }

  /** Feature 버전별 JIRA Epic — Registry 목록에 Lifecycle과 나란히(버전마다 부르지 않게 한 번에) */
  featureEpics() {
    const out = new Map<string, { feature: string; key: string; url: string; status: string; syncState: ExtRef['syncState']; expected: string | null }>();
    for (const e of this.repo.items('JIRA', 'EPIC'))
      for (const { entityId } of this.repo.entitiesOf('JIRA', e.key, 'FEATURE')) {
        if (out.has(entityId) || e.extra.supersededBy) continue;
        const { featureId } = splitFid(entityId);
        const d = this.epics.desired(featureId);
        out.set(entityId, { feature: entityId, key: e.key, url: e.url, status: e.status, syncState: e.syncState, expected: d ? JIRA_EPIC_STATUS[d.lifecycle] : null });
      }
    return [...out.values()];
  }

  /** 변경요청(CR) 목록 — JIRA CR과 연결된 정책 상태를 나란히 */
  changeRequests() {
    return this.repo.items('JIRA', 'CHANGE_REQUEST').map((cr) => {
      const policies = this.repo.entitiesOf('JIRA', cr.key, 'POLICY').map((e) => {
        const p = this.policies.get(e.entityId);
        return { policyId: e.entityId, flagKey: p?.flagKey ?? null, status: p?.status ?? null, stage: p?.stageBasisPoints ?? null, expectedCrStatus: p ? (crOfPolicy(p.status) ?? null) : null };
      });
      const features = this.repo.entitiesOf('JIRA', cr.key, 'FEATURE').map((e) => e.entityId);
      return { ...cr, policies, features };
    });
  }
  conflicts(status?: 'OPEN' | 'RESOLVED') {
    return this.repo.conflicts(status);
  }
  jobs(q: { system?: ExtSystem; status?: OutboxJob['status'] }) {
    return this.repo.jobs({ ...q, limit: 300 });
  }
  inbox(q: { system?: ExtSystem; outcome?: InboxRow['outcome'] }) {
    return this.repo.inbox({ ...q, limit: 300 });
  }

  // ───────────────────────── 모의 초기 상태 ─────────────────────────
  /**
   * 모의 외부 시스템 초기화 — 데이터셋의 Feature 버전마다 codeBeamer 요구·JIRA Epic, 개발 이후 버전엔 병합된 MR·파이프라인,
   * 정책마다 JIRA CR을 만들고 연결한다(이벤트·감사 없이 — 기준 데이터 적재와 같은 성격). 실제 연결이면 하지 않는다.
   */
  seed() {
    if (EXT_SYSTEMS.some((s) => modeOf(s) !== 'mock')) return;
    // 첫 webhook과 같은 본문 투영을 저장한다. 빠뜨리면 첫 댓글만으로도 요구 개정·G2 재검토로 오인한다.
    const at = (it: ReturnType<MockExtStore['create']>): ExtRef => ({ system: it.system, kind: it.kind, key: it.key, url: extUrl(it.system, it.kind, it.key), title: it.title, status: it.status, revision: it.system === 'CODEBEAMER' ? it.revision : Date.parse(it.updatedAt), syncState: 'SYNCED', syncedAt: this.clock.iso(), stale: false, extra: { ...pickExtra(it.fields), ...(it.system === 'CODEBEAMER' ? { description: it.body.slice(0, 2000) } : {}) } });
    this.db.tx(() => {
      const reqByReqId = new Map<string, string>();
      for (const f of this.features.all()) {
        const id = fid(f.featureId, f.version);
        for (const reqId of f.requirementIds ?? []) {
          let key = reqByReqId.get(reqId);
          if (!key) {
            const content = demoRequirementContent(f, reqId);
            const it = this.store.create('CODEBEAMER', 'REQUIREMENT', { title: `${reqId} ${f.name}`, ...content, status: 'Approved', by: 'jung.req' });
            this.repo.putItem(at(it));
            key = it.key;
            reqByReqId.set(reqId, key);
          }
          this.repo.link('CODEBEAMER', key, 'FEATURE', id, 'seed');
        }
        // Epic = Feature(80-50 §4.1) — Feature의 마지막 버전을 볼 때 한 번 만들고 모든 버전에 연결
        const versions = this.features.versions(f.featureId);
        if (versions.at(-1)?.version === f.version) {
          const d = this.epics.desired(f.featureId)!;
          const base = this.features.get(f.featureId, d.version)!;
          const content = demoEpicContent(base);
          const epic = this.store.create('JIRA', 'EPIC', { title: d.summary, ...content, fields: { ...content.fields, epic: d.fields }, status: JIRA_EPIC_STATUS[d.lifecycle], by: 'kim.author' });
          this.repo.putItem({ ...at(epic), extra: { ...at(epic).extra, epicFields: d.fields } });
          for (const v of versions) this.repo.link('JIRA', epic.key, 'FEATURE', fid(v.featureId, v.version), 'seed');
        }
        if (['DEVELOPING', 'VERIFIED', 'RELEASED', 'DEPRECATED', 'RETIRED'].includes(f.lifecycle)) {
          const sha = createHash('sha1').update(id).digest('hex');
          const sw = f.swIds?.[0] && f.swVersions?.[0] ? ` ${f.swIds[0]}@${f.swVersions[0]}` : '';
          const mr = this.store.create('GITLAB', 'MERGE_REQUEST', { title: `${id} ${f.name}`, body: `구현 ${id}${sw}`, status: 'merged', by: 'han.dev', fields: { sha, sourceBranch: `feature/${f.featureId.toLowerCase()}-${f.version}`, targetBranch: 'main', description: `구현 ${id}${sw}` } });
          this.repo.putItem(at(mr));
          this.repo.link('GITLAB', mr.key, 'FEATURE', id, 'seed');
          const pl = this.store.create('GITLAB', 'PIPELINE', { title: `pipeline ${mr.fields.sourceBranch}`, status: 'success', by: 'han.dev', fields: { sha, ref: mr.fields.sourceBranch, mrKey: mr.key } });
          this.repo.putItem(at(pl));
          this.repo.link('GITLAB', pl.key, 'FEATURE', id, 'seed');
          const mrRef = this.repo.item('GITLAB', mr.key)!;
          this.repo.putItem({ ...mrRef, extra: { ...mrRef.extra, pipeline: { key: pl.key, status: 'success', url: extUrl('GITLAB', 'PIPELINE', pl.key) } } });
        }
      }
      for (const p of this.policies.all()) {
        const id = fid(p.featureId, p.featureVersion);
        const epicKey = this.epics.key(p.featureId);
        const cr = this.store.create('JIRA', 'CHANGE_REQUEST', { title: `${p.flagKey} 정책 변경 — ${id}`, ...demoChangeRequestContent(p, this.features.get(p.featureId, p.featureVersion), epicKey), status: crOfPolicy(p.status) ?? JIRA_CR_STATUS.OPEN, by: 'kim.author' });
        this.repo.putItem(at(cr));
        this.repo.link('JIRA', cr.key, 'POLICY', p.policyId, 'seed');
        this.repo.link('JIRA', cr.key, 'FEATURE', id, 'seed');
      }
      for (const x of this.extensions) x.onSeed?.();
    });
  }
}

/** 외부 필드 중 화면에 쓸 것만 */
function pickExtra(fields: Record<string, unknown>): Record<string, unknown> {
  const keep = ['reqId', 'sha', 'sourceBranch', 'targetBranch', 'parentKey', 'policyId', 'featureId', 'version', 'mrKey', 'description', 'commitStatuses', 'verifications', 'killId', 'incidentId', 'ref'];
  return Object.fromEntries(Object.entries(fields).filter(([k, v]) => keep.includes(k) && v !== undefined));
}
const stripUndefined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));
const strip = (l: ExtLink): ExtRef => {
  const { linkId: _l, entity: _e, entityId: _i, createdAt: _c, ...ref } = l;
  return ref;
};
const latestOf = (vs: FeatureVersionRow[]) => {
  const v = vs.at(-1);
  return v ? fid(v.featureId, v.version) : null;
};
