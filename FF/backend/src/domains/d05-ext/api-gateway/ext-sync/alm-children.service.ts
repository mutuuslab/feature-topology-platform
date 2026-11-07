// Epic 아래 이슈(80-50 §4.1, D-ALM-6) — Story = 기능 분해(FUNC), Bug = 현장 문제. ExtSyncService.extend로 받기·보내기를 더한다.
//   Story: FF에서 기능을 더하면 Story를 만들고 이름을 맞춘다. JIRA에서 Epic 아래 Story를 만들면 작업 중 버전이 PROPOSED일 때만
//     작성 권한이 있는 매핑 계정의 초안 수정 요청으로 기능을 더하고 기능 ID를 Story에 적는다(아니면 거부 + 댓글). 상태(To Do·Done)는 JIRA 주인.
//   Bug: 운영 인시던트(주의·긴급)와 조치 연결(TL-B09)이 Feature Epic 아래 Bug를 만든다. JIRA에서 만든 Bug는 현장 문제 후보로 연결만 —
//     인시던트는 자동으로 만들지 않는다(운영 판단).
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ExtChange, ExtRef, FeatureVersionRow } from '@ff/contracts';
import type { Actor } from '../../../../kernel/actor';
import { Clock } from '../../../../kernel/clock';
import { DB, type Db } from '../../../../kernel/db';
import type { PlatformEvent } from '../../../../kernel/event.service';
import { RegistryService } from '../../../d01-policy/registry/registry.service';
import { FeatureRepo } from '../../../d01-policy/repos';
import { ExtAdapters, PLATFORM_USER } from './adapters';
import type { AlmOp } from './alm-ops';
import { ExtSyncRepo, type OutboxJob } from './ext-sync.repo';
import { ExtSyncService, type Outcome } from './ext-sync.service';
import { FeatureEpics } from './feature-epic';
import { extUrl, MockExtStore } from './mock-ext.store';

const fid = (featureId: string, version: string) => `${featureId}@${version}`;
const SEVERITY_KO: Record<string, string> = { WARNING: '주의', CRITICAL: '긴급', INFO: '정보' };
const SOURCE_KO: Record<string, string> = { FIELD: '현장', VOC: '고객센터', DEALER: '대리점' };
const CATEGORY_KO: Record<string, string> = { UNEXPECTED_ACTIVATION: '의도하지 않은 작동', NO_ACTIVATION: '작동 안 함', PERFORMANCE: '성능', HMI: '화면·표시', OTHER: '기타' };

@Injectable()
export class AlmChildrenService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: ExtSyncRepo,
    private readonly adapters: ExtAdapters,
    private readonly sync: ExtSyncService,
    private readonly epics: FeatureEpics,
    private readonly features: FeatureRepo,
    private readonly registry: RegistryService,
    private readonly store: MockExtStore,
    private readonly clock: Clock,
  ) {}

  onModuleInit() {
    this.sync.extend({
      kinds: { STORY: (c, prev, ref, cid, actor) => this.onStory(c, prev, ref, cid, actor) },
      ops: {
        STORY_SYNC: (j) => this.storySync(j),
        STORY_LINK: (j) => this.storyLink(j),
        FIELD_ISSUE: (j) => this.fieldIssue(j),
      },
      onEvent: (ev) => this.onEvent(ev),
      onSeed: () => this.seed(),
    });
  }

  // ───────────────────────── 공개 함수(다른 기능이 부른다 — 조치 연결 TL-B09) ─────────────────────────
  /** 현장 문제를 Feature Epic 아래 Bug로(보낼 함 — 같은 ref는 한 번만). incidentId가 있으면 운영 인시던트와 잇는다 */
  raiseFieldIssue(x: { featureId: string; title: string; body: string; incidentId?: string | null; ref?: string | null }) {
    this.sync.enqueue('JIRA', { op: 'FIELD_ISSUE', featureId: x.featureId, incidentId: x.incidentId ?? null, ref: x.ref ?? null, title: x.title, body: x.body }, `field:${x.ref ?? x.incidentId ?? `${x.featureId}:${this.clock.iso()}`}`);
  }
  /** 연결된 codeBeamer 요구에 재검토 요청 댓글(FF는 댓글만 쓴다, 80-50 §5.7) */
  requestRequirementReview(x: { featureId: string; version: string; text: string }) {
    for (const l of this.repo.linksOf('FEATURE', fid(x.featureId, x.version), 'CODEBEAMER'))
      this.sync.enqueue('CODEBEAMER', { op: 'COMMENT', key: l.key, text: `[Feature Platform] 재검토 요청 — ${x.text}` }, `review:${l.key}:${this.clock.iso()}:${x.text.slice(0, 40)}`);
  }

  // ───────────────────────── 이벤트 → 보낼 함 ─────────────────────────
  private onEvent(ev: PlatformEvent) {
    const p = (ev.payload ?? {}) as Record<string, any>;
    if (ev.type === 'feature.version.created' || (ev.type === 'feature.updated' && Array.isArray(p.changed) && p.changed.includes('functions')))
      this.sync.enqueue('JIRA', { op: 'STORY_SYNC', featureId: p.featureId }, `story:${ev.id}`);
    // 운영 인시던트 — 정보성은 빼고 주의·긴급만 현장 문제로(80-50 §4.1 Bug)
    if (ev.type === 'incident.received' && p.featureId && p.severity !== 'INFO') {
      const doc = this.db.get<{ doc: string }>('SELECT doc FROM incident WHERE incident_id = ?', ev.aggregate)?.doc;
      const summary = doc ? String((JSON.parse(doc) as { summary?: string }).summary ?? '') : '';
      this.raiseFieldIssue({
        featureId: p.featureId,
        incidentId: ev.aggregate,
        ref: ev.aggregate,
        title: `[현장] ${summary || CATEGORY_KO[p.category] || p.category}`.slice(0, 200),
        body: `운영 인시던트 ${ev.aggregate} · 출처 ${SOURCE_KO[p.source] ?? p.source} · 심각도 ${SEVERITY_KO[p.severity] ?? p.severity} · 분류 ${CATEGORY_KO[p.category] ?? p.category}${p.vin ? ` · 차량 ${p.vin}` : ''}\n\n${summary}\n\n원인 분석·조치 기록은 이 이슈에서, 차단·정책 조치는 Feature Platform에서 합니다.`,
      });
    }
  }

  // ───────────────────────── 보내기 ─────────────────────────
  private stories(featureId: string): Map<string, ExtRef> {
    const out = new Map<string, ExtRef>();
    for (const v of this.features.versions(featureId))
      for (const l of this.repo.linksOf('FEATURE', fid(featureId, v.version), 'JIRA'))
        if (l.kind === 'STORY' && typeof l.extra.functionId === 'string' && !out.has(l.extra.functionId)) out.set(l.extra.functionId, l);
    return out;
  }

  private async storySync(j: OutboxJob): Promise<'done' | 'failed'> {
    const op = j.job as Extract<AlmOp, { op: 'STORY_SYNC' }>;
    const d = this.epics.desired(op.featureId);
    if (!d) return this.sync.skip(j, 'Feature 없음');
    const epic = this.epics.key(op.featureId);
    if (!epic) {
      this.repo.retry(j, 'Feature Epic이 아직 없습니다 — Epic을 만든 뒤 Story를 만듭니다.');
      return 'failed';
    }
    const f = this.features.get(op.featureId, d.version)!;
    const a = this.adapters.of('JIRA');
    const have = this.stories(op.featureId);
    for (const fn of f.functions ?? []) {
      const s = have.get(fn.functionId);
      if (!s) {
        const it = await a.create('STORY', { title: fn.label, body: `Feature Platform 기능 ${fn.functionId} — ${op.featureId}`, status: 'To Do', fields: { parentKey: epic, child: { functionId: fn.functionId } } });
        this.db.tx(() => {
          this.sync.observe(it, 'SYNCED', { functionId: fn.functionId });
          this.epics.linkAll(it.key, op.featureId, PLATFORM_USER);
        });
        continue;
      }
      this.epics.linkAll(s.key, op.featureId, PLATFORM_USER);
      if (s.title !== fn.label) {
        const r = await a.write(s.key, { title: fn.label }, null);
        if (r.ok) this.sync.observe(r.item, 'SYNCED');
      }
    }
    return this.sync.done(j);
  }

  private async storyLink(j: OutboxJob): Promise<'done'> {
    const op = j.job as Extract<AlmOp, { op: 'STORY_LINK' }>;
    const r = await this.adapters.of('JIRA').write(op.key, { fields: { functionId: op.functionId }, comment: op.comment }, null);
    if (r.ok) this.sync.observe(r.item, 'SYNCED', { functionId: op.functionId });
    return this.sync.done(j);
  }

  private async fieldIssue(j: OutboxJob): Promise<'done'> {
    const op = j.job as Extract<AlmOp, { op: 'FIELD_ISSUE' }>;
    const epic = this.epics.key(op.featureId);
    const version = this.epics.desired(op.featureId)?.version ?? this.features.versions(op.featureId).at(-1)?.version ?? '';
    const it = await this.adapters.of('JIRA').create('DEFECT', { title: op.title, body: op.body, status: 'Open', fields: { parentKey: epic, featureId: op.featureId, version, ...(op.incidentId ? { child: { incidentId: op.incidentId } } : {}) } });
    this.db.tx(() => {
      this.sync.observe(it, 'SYNCED', { ...(op.incidentId ? { incidentId: op.incidentId } : {}), ...(op.ref ? { ref: op.ref } : {}) });
      this.epics.linkAll(it.key, op.featureId, PLATFORM_USER);
      if (op.incidentId) this.repo.link('JIRA', it.key, 'INCIDENT', op.incidentId, PLATFORM_USER);
    });
    return this.sync.done(j);
  }

  // ───────────────────────── 받기: Story ─────────────────────────
  private onStory(c: ExtChange, prev: ExtRef | null, ref: ExtRef, correlationId: string, actorOverride?: Actor): Outcome {
    const featureId = (c.refs.epicKey ? this.epics.featureOf(c.refs.epicKey) : null) ?? this.epics.featureOf(c.key);
    this.db.tx(() => {
      this.repo.putItem(ref);
      if (featureId) this.epics.linkAll(c.key, featureId, c.externalUser);
    });
    if (!featureId) return { outcome: 'IGNORED', summary: `Story ${c.key} — 연결된 Feature Epic 아래가 아님` };
    const d = this.epics.desired(featureId)!;
    const f = this.features.get(featureId, d.version)!;
    const functionId = (c.extra.functionId as string | undefined) ?? (prev?.extra.functionId as string | undefined);
    const author = (): Actor | string => {
      if (actorOverride) return actorOverride;
      const who = this.sync.identity('JIRA', c.externalUser);
      if (!who) return `JIRA 계정 '${c.externalUser}'이(가) 플랫폼 계정에 매핑되어 있지 않습니다.`;
      return this.sync.actorFor(who, ['FEATURE_AUTHOR'], correlationId) ?? `${who.name}은(는) Feature 작성 권한이 없습니다.`;
    };
    const notProposed = f.lifecycle !== 'PROPOSED' ? `작업 중 버전 ${f.version}이(가) ${f.lifecycle}입니다 — 기능 분해는 플랫폼에서 새 Version을 만든 뒤 바꾸세요.` : null;
    if (functionId) {
      const fn = (f.functions ?? []).find((x) => x.functionId === functionId);
      // 이름 바꿈 — 기능 이름의 주인은 FF(초안이면 요청으로)
      if (prev && fn && prev.title !== c.title && c.title.trim() && c.title.trim() !== fn.label) {
        const who = notProposed ?? author();
        if (typeof who === 'string') return this.revertStory(c, featureId, who, correlationId);
        try {
          this.registry.updateDraft(who, featureId, f.version, { functions: f.functions.map((x) => (x.functionId === functionId ? { ...x, label: c.title.trim() } : x)) });
          return { outcome: 'APPLIED', summary: `${c.key} → ${functionId} 이름 '${c.title.trim()}'(초안 ${f.version})` };
        } catch (e) {
          return this.revertStory(c, featureId, e instanceof Error ? e.message : String(e), correlationId);
        }
      }
      return { outcome: prev ? 'APPLIED' : 'IGNORED', summary: `Story ${c.key} ${c.status}${fn ? ` · ${functionId}` : ''}` };
    }
    // JIRA에서 새로 만든 Story → 기능 분해에 더한다(작업 중 버전이 PROPOSED일 때만)
    const refuse = (why: string, outcome: Outcome['outcome'] = 'REJECTED'): Outcome => {
      this.db.tx(() => {
        this.repo.setState('JIRA', c.key, 'REJECTED');
        this.sync.enqueue('JIRA', { op: 'COMMENT', key: c.key, text: `플랫폼이 이 Story로 기능을 더하지 않았습니다 — ${why}` }, `story-new:${c.key}:${c.revision}`);
      });
      return { outcome, summary: `${c.key} 기능 추가 안 함 — ${why}` };
    };
    if (notProposed) return refuse(notProposed);
    const who = author();
    if (typeof who === 'string') return refuse(who, who.includes('매핑') ? 'UNMAPPED' : 'REJECTED');
    const label = c.title.trim();
    const before = new Set((f.functions ?? []).map((x) => x.functionId));
    let next: FeatureVersionRow;
    try {
      next = this.registry.updateDraft(who, featureId, f.version, { functions: [...(f.functions ?? []), { label }] }) as FeatureVersionRow;
    } catch (e) {
      return refuse(e instanceof Error ? e.message : String(e));
    }
    const added = next.functions.find((x) => !before.has(x.functionId) && x.label === label);
    if (!added) return refuse('기능 번호를 매기지 못했습니다.');
    this.db.tx(() => {
      this.repo.putItem({ ...ref, extra: { ...ref.extra, functionId: added.functionId } });
      this.sync.enqueue('JIRA', { op: 'STORY_LINK', key: c.key, featureId, functionId: added.functionId, comment: `플랫폼 Feature ${fid(featureId, f.version)} 기능 분해에 ${added.functionId}(으)로 더했습니다 — ${who.id}.` }, `story-link:${c.key}`);
    });
    return { outcome: 'APPLIED', summary: `${c.key} → ${added.functionId} 기능 추가(초안 ${f.version})` };
  }

  /** Story 변경을 받지 않음 — 제목을 FF 기능 이름으로 되돌리고 사유 댓글 */
  private revertStory(c: ExtChange, featureId: string, why: string, correlationId: string): Outcome {
    this.db.tx(() => {
      this.repo.setState('JIRA', c.key, 'REJECTED');
      this.sync.enqueue('JIRA', { op: 'STORY_SYNC', featureId }, `story-revert:${correlationId}`);
      this.sync.enqueue('JIRA', { op: 'COMMENT', key: c.key, text: `플랫폼이 이 Story 변경을 받지 않았습니다 — ${why} 기능 이름으로 되돌립니다.` }, `story-revert-c:${correlationId}`);
    });
    return { outcome: 'REJECTED', summary: `${c.key} 이름 변경 거부 — ${why}` };
  }

  // ───────────────────────── 모의 초기 상태 ─────────────────────────
  /** 데모 Feature의 기능마다 Story(Epic 아래, 진행 상태는 버전 단계에 맞춤) — 이벤트·감사 없이(기준 데이터 적재와 같은 성격) */
  private seed() {
    const done = new Set(['RELEASED', 'DEPRECATED', 'RETIRED', 'VERIFIED']);
    for (const featureId of new Set(this.features.all().map((f) => f.featureId))) {
      const epic = this.epics.key(featureId);
      const d = this.epics.desired(featureId);
      if (!epic || !d) continue;
      const f = this.features.get(featureId, d.version)!;
      for (const fn of f.functions ?? []) {
        const status = done.has(f.lifecycle) ? 'Done' : f.lifecycle === 'PROPOSED' || f.lifecycle === 'APPROVED' ? 'To Do' : 'In Progress';
        const it = this.store.create('JIRA', 'STORY', { title: fn.label, body: `Feature Platform 기능 ${fn.functionId} — ${featureId}`, status, by: 'kim.author', fields: { parentKey: epic, child: { functionId: fn.functionId } } });
        this.repo.putItem({ system: 'JIRA', kind: 'STORY', key: it.key, url: extUrl('JIRA', 'STORY', it.key), title: it.title, status: it.status, revision: Date.parse(it.updatedAt), syncState: 'SYNCED', syncedAt: this.clock.iso(), stale: false, extra: { parentKey: epic, functionId: fn.functionId, description: it.body } });
        this.epics.linkAll(it.key, featureId, 'seed');
      }
    }
  }
}
