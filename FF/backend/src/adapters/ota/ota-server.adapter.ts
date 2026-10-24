// OTA 서버 어댑터(IF-05 v1, FF_VEHICLE_CHANNEL=ota) — 고객 OTA 서버가 차량에 전달하는 경로. 규격 docs/80-integration/80-45-ota-server-if05.md
//  · FF: 정책·차단·복원 게시본에 서명하고 대상을 정한다 → 이 어댑터가 OTA 작업으로 제출(POST /ota/v1/jobs, 멱등 키 = jobId).
//  · OTA 서버: 차량에 전달·진행 추적 → 차량별 전달 결과를 webhook(POST /api/ota/v1/events, HMAC)으로 알린다 — 전달 기록일 뿐 회신이 아니다.
//  · 차량 회신(적용 readback·서명된 status_report v2·확인)은 차량 → Data Lake → FF(IF-06)로 온다. 회신 집계의 끝 상태는 그것만 정한다(80-45 §7.5).
//  · 차량: 서명(신뢰 앵커)·순번을 스스로 검증한다. OTA 서버는 신뢰 경계가 아니다 — 게시본·봉투를 바꾸지 않고 전달만 한다.
// 제출은 outbox — 게시본을 만든 트랜잭션에서 QUEUED로 넣고 커밋 뒤 보낸다. 실패해도 게시본은 그대로, 전달만 RETRY_WAIT(전달 실패·재시도 가능)
// → 지수 간격 자동 재시도 → 횟수가 다하거나 고칠 수 없는 오류면 FAILED(화면에서 다시 제출). 회신 기한이 지나면 EXPIRED.
import { Body, Controller, Get, HttpCode, Inject, Injectable, OnApplicationBootstrap, Param, Post, Query, Req } from '@nestjs/common';
import { DATA_CATEGORY_ACCESS, OTA_RETRYABLE_STATES, OTA_SPEC_VERSION, OTA_WEBHOOK_TOLERANCE_SEC, OtaEvent, OtaJobActionBody, otaSpecCompatible, type OtaDeliveryState, type OtaServerJobState, type Publication } from '@ff/contracts';
import type { Request } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AuditAction, CurrentActor, Roles, WebhookEndpoint, type Actor } from '../../kernel/actor';
import { AuditService } from '../../kernel/audit.service';
import { Clock } from '../../kernel/clock';
import { DB, type Db } from '../../kernel/db';
import { DomainError } from '../../kernel/errors';
import { EventService } from '../../kernel/event.service';
import { otaConfigOf, type OtaConfig } from '../../kernel/ota-config';
import { Scheduler } from '../../kernel/scheduler';
import { ZodPipe } from '../../kernel/zod.pipe';
import { EnvelopeRepo } from '../../domains/d03-safety/kill-switch/envelope.repo';
import { PublicationRepo } from '../../domains/d06-qsec/secure-deploy/publication.repo';
import { ReadbackBus } from '../../domains/d04-ops/telemetry-ingest/telemetry.service';
import { VehicleChannelRegistry } from '../../domains/d02-runtime/vehicle-channel/vehicle-channel';
import { IfCallRepo } from '../if-call/if-call.repo';
import { OtaCallError, OtaClient } from './ota-client';
import { isFinalOutcome, OtaJobRepo, type OtaJobRow } from './ota-job.repo';

const COMPONENT = 'D04-01';
/** 재시도 간격 상한 */
const MAX_BACKOFF_MS = 5 * 60_000;
/** 받은 이벤트 ID를 두는 기간 */
const EVENT_KEEP_MS = 7 * 24 * 3600_000;
export const OTA_ACTOR: Actor = { id: 'ota-server', role: 'SYSTEM', correlationId: 'ota' };

/** OTA 서버 작업 상태 → FF 전달 상태(끝 상태만 옮긴다) */
const FINAL_FROM_SERVER: Partial<Record<OtaServerJobState, OtaDeliveryState>> = { COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', FAILED: 'FAILED' };
const CLOSED: readonly OtaDeliveryState[] = ['COMPLETED', 'CANCELLED', 'EXPIRED'];

interface SubmitResponse {
  jobId?: string;
  otaJobId?: string;
  state?: OtaServerJobState;
  acceptedTargets?: number;
  rejectedTargets?: { vin: string; code: string; message?: string }[];
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** webhook 서명 — ext-sync와 같은 'sha256=<hex>' 형식, HMAC 입력에 시각을 넣어 재전송을 막는다(규격 7.2) */
export const otaWebhookSignature = (secret: string, timestamp: string, raw: string) => `sha256=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;

@Injectable()
export class OtaServerAdapter implements OnApplicationBootstrap {
  readonly cfg: OtaConfig | null = otaConfigOf();
  private readonly client: OtaClient | null;
  private readonly inflight = new Map<string, Promise<void>>();
  private health: { at: string; ok: boolean; detail: string } | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
    private readonly registry: VehicleChannelRegistry,
    private readonly jobs: OtaJobRepo,
    private readonly publications: PublicationRepo,
    private readonly envelopes: EnvelopeRepo,
    private readonly ifCalls: IfCallRepo,
    private readonly bus: ReadbackBus,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {
    this.client = this.cfg ? new OtaClient(this.cfg, () => this.clock.now().getTime()) : null;
    // 설정(FF_OTA_URL)이 있을 때만 채널로 등록한다 — 없이 FF_VEHICLE_CHANNEL=ota면 시작 검사(otaConfigProblems)와 레지스트리가 멈춘다
    if (this.cfg)
      this.registry.register({
        id: 'ota',
        description: `고객 OTA 서버(IF-05 v${OTA_SPEC_VERSION}) — 서명 게시본을 작업으로 제출하고, 차량별 결과를 webhook으로 받는다`,
        deliver: (pub, vins) => this.enqueue(pub, vins),
        status: () => this.statusView(),
      });
  }

  /** 재시작 복구 — 대기 중 작업을 다시 건다(시각이 지났으면 바로) */
  onApplicationBootstrap() {
    if (!this.cfg) return;
    for (const j of this.jobs.waiting()) this.arm(j.next_attempt_at);
    // 연결 점검 — 실패해도 시작은 막지 않는다(OTA 서버가 잠시 내려가 있어도 게시본은 만들고 전달은 재시도)
    void this.checkHealth();
  }

  // ── 제출(outbox) ─────────────────────────────────────
  /** 게시본을 만든 트랜잭션 안 — 작업을 QUEUED로 넣고 커밋 뒤 제출. 회신 의무는 그대로(ackOnly 없음) */
  enqueue(pub: Publication, vins: string[]): { ackOnly: string[]; campaignId: string } {
    const jobId = `OTJ-${pub.publicationId}`;
    if (vins.length) {
      this.jobs.insert({ job_id: jobId, publication_id: pub.publicationId, targets: JSON.stringify(vins), created_at: this.clock.iso() });
      this.events.publish('ota.job.queued', jobId, { jobId, publicationId: pub.publicationId, kind: pub.kind, vehicles: vins.length }, { componentId: COMPONENT });
      this.db.afterCommit(() => this.kick());
    }
    return { ackOnly: [], campaignId: jobId };
  }

  /** 제출할 때가 된 작업을 보낸다 — 시험은 기다릴 수 있게 Promise를 돌려준다 */
  kick(): Promise<void> {
    if (!this.client) return Promise.resolve();
    const due = this.jobs.due(this.clock.iso());
    return Promise.all(due.map((j) => this.submitOnce(j.job_id))).then(() => undefined);
  }

  /** 같은 작업을 동시에 두 번 보내지 않는다 */
  private submitOnce(jobId: string): Promise<void> {
    const running = this.inflight.get(jobId);
    if (running) return running;
    const p = this.submit(jobId).finally(() => this.inflight.delete(jobId));
    this.inflight.set(jobId, p);
    return p;
  }

  private arm(at: string | null) {
    const ms = at ? Math.max(0, new Date(at).getTime() - this.clock.now().getTime()) : 0;
    this.scheduler.after(ms, () => void this.kick());
  }

  /** 규격 5.1 요청 본문 — 같은 작업은 언제 보내도 같은 본문(멱등 키 재사용이 안전하다) */
  request(row: OtaJobRow, pub: Publication) {
    const targets = JSON.parse(row.targets) as string[];
    const kill = pub.payload.kill;
    const envelopes: Record<string, unknown> = {};
    if ((pub.kind === 'KILL' || pub.kind === 'RESTORE') && kill)
      for (const vin of targets) {
        const env = this.envelopes.forVehicle(kill.killId, vin, pub.kind === 'KILL' ? 'deactivate' : 'restore');
        if (env) envelopes[vin] = env;
      }
    return {
      jobId: row.job_id,
      publicationId: pub.publicationId,
      kind: pub.kind,
      priority: pub.channel === 'EMERGENCY' ? 'EMERGENCY' : 'NORMAL',
      targets,
      deadlineAt: pub.deadlineAt,
      createdAt: row.created_at,
      publication: { publicationId: pub.publicationId, kind: pub.kind, payload: pub.payload, signature: pub.signature },
      ...(Object.keys(envelopes).length ? { envelopes } : {}),
    };
  }

  private async submit(jobId: string): Promise<void> {
    const row = this.jobs.get(jobId);
    if (!row || (row.state !== 'QUEUED' && row.state !== 'RETRY_WAIT')) return;
    const pub = this.publications.get(row.publication_id);
    const now = this.clock.now();
    if (!pub) return this.close(row, 'FAILED', { code: 'PUBLICATION_MISSING', status: null, retryable: false, message: `게시본 ${row.publication_id}이(가) 없습니다` });
    if (now.getTime() >= new Date(pub.deadlineAt).getTime()) return this.close(row, 'EXPIRED', { code: 'DEADLINE_PASSED', status: null, retryable: false, message: '회신 기한이 지나 제출하지 않았습니다 — 필요하면 새 게시본을 만드세요' });
    const body = this.request(row, pub);
    try {
      const res = await this.client!.submit<SubmitResponse>(body, row.job_id);
      const at = this.clock.iso();
      this.db.tx(() => {
        // 응답을 기다리는 사이 webhook(결과·끝 상태)이나 취소가 먼저 왔으면 그 상태를 되돌리지 않는다 — 접수 정보만 채운다
        const cur = this.jobs.get(row.job_id)!;
        const waiting = cur.state === 'QUEUED' || cur.state === 'RETRY_WAIT';
        this.jobs.update(row.job_id, {
          ...(waiting ? { state: 'SUBMITTED' as const, server_state: res.body.state ?? 'ACCEPTED', last_error: null, next_attempt_at: null } : {}),
          attempts: row.attempts + 1,
          ota_job_id: cur.ota_job_id ?? res.body.otaJobId ?? null,
          submitted_at: cur.submitted_at ?? at,
          updated_at: at,
        });
        // 부분 접수 — OTA 서버가 모르는 차량은 NOT_ELIGIBLE(회신 기한에 PARTIAL로 닫힌다)
        for (const r of res.body.rejectedTargets ?? []) if (body.targets.includes(r.vin)) this.jobs.setVehicle(row.job_id, r.vin, 'NOT_ELIGIBLE', r.code, at, `submit:${row.job_id}`);
        // 게시본 화면의 연계 호출(IF-05) — 실제 요청 요약과 OTA 서버 응답(첫 접수)
        this.ifCalls.call('IF-05', pub.publicationId, { channel: 'OTA_SERVER', jobId: row.job_id, priority: body.priority, targets: body.targets.length, deadlineAt: body.deadlineAt, signatureKeyId: pub.signature.keyId, specVersion: OTA_SPEC_VERSION }, () => ({ ...res.body, replayed: res.replayed }));
        this.events.publish('ota.job.submitted', row.job_id, { jobId: row.job_id, publicationId: pub.publicationId, otaJobId: res.body.otaJobId ?? null, attempts: row.attempts + 1, rejected: res.body.rejectedTargets?.length ?? 0 }, { componentId: COMPONENT });
      });
    } catch (e) {
      const err = e instanceof OtaCallError ? e : new OtaCallError('INTERNAL', (e as Error)?.message ?? String(e), null, true);
      this.failed(row, pub, err);
    }
  }

  private failed(row: OtaJobRow, pub: Publication, err: OtaCallError) {
    // 그사이 OTA 서버가 받았다고(webhook) 알렸거나 사람이 취소했으면 실패로 덮지 않는다
    const cur = this.jobs.get(row.job_id);
    if (!cur || (cur.state !== 'QUEUED' && cur.state !== 'RETRY_WAIT')) return;
    const attempts = row.attempts + 1;
    const delay = Math.max(Math.min(this.cfg!.retryBaseMs * 2 ** (attempts - 1), MAX_BACKOFF_MS), err.retryAfterMs ?? 0);
    const next = this.clock.now().getTime() + delay;
    const deadline = new Date(pub.deadlineAt).getTime();
    const lastError = err.toJSON();
    if (err.retryable && attempts <= this.cfg!.retryMax && next < deadline) {
      const at = new Date(next).toISOString();
      this.db.tx(() => {
        this.jobs.update(row.job_id, { state: 'RETRY_WAIT', attempts, last_error: JSON.stringify(lastError), next_attempt_at: at, updated_at: this.clock.iso() });
        this.events.publish('ota.job.retry', row.job_id, { jobId: row.job_id, publicationId: row.publication_id, attempts, nextAttemptAt: at, error: lastError }, { componentId: COMPONENT });
      });
      this.arm(at);
      return;
    }
    this.close(row, err.retryable && next >= deadline ? 'EXPIRED' : 'FAILED', lastError, attempts);
  }

  private close(row: OtaJobRow, state: OtaDeliveryState, lastError: { code: string; status: number | null; retryable: boolean; message: string }, attempts = row.attempts) {
    this.db.tx(() => {
      this.jobs.update(row.job_id, { state, attempts, last_error: JSON.stringify(lastError), next_attempt_at: null, updated_at: this.clock.iso() });
      this.events.publish('ota.job.failed', row.job_id, { jobId: row.job_id, publicationId: row.publication_id, state, attempts, error: lastError }, { componentId: COMPONENT });
    });
  }

  // ── 사람 조작 ─────────────────────────────────────────
  private need(jobId: string) {
    const row = this.jobs.get(jobId);
    if (!row) throw new DomainError('NOT_FOUND', `OTA 작업 ${jobId}을(를) 찾을 수 없습니다.`);
    return row;
  }

  /** 전달 실패한 작업 다시 제출 — OTA 서버가 아직 받지 않은 작업만(같은 멱등 키라 두 번 전달되지 않는다) */
  async retry(actor: Actor, jobId: string, reason: string) {
    if (!this.client) throw new DomainError('GUARD_FAILED', 'OTA 서버 연동이 설정되지 않았습니다(FF_OTA_URL).');
    const row = this.need(jobId);
    if (!OTA_RETRYABLE_STATES.includes(row.state) || row.ota_job_id) throw new DomainError('GUARD_FAILED', `OTA 작업 ${jobId}은(는) ${row.state} — 전달 실패(OTA 서버가 받기 전)일 때만 다시 제출합니다.`, { state: row.state });
    this.db.tx(() => {
      this.jobs.update(jobId, { state: 'QUEUED', attempts: 0, next_attempt_at: this.clock.iso(), updated_at: this.clock.iso() });
      this.audit.record(actor, 'OTA_JOB_RETRY', jobId, { before: { state: row.state, attempts: row.attempts }, after: { state: 'QUEUED' }, reason, componentId: COMPONENT });
    });
    await this.submitOnce(jobId);
    return this.jobs.view(this.jobs.get(jobId));
  }

  /** 취소 — 아직 전달하지 않은 차량만. 이미 적용한 차량은 새 게시본(복원·되돌리기)으로 바꾼다 */
  async cancel(actor: Actor, jobId: string, reason: string) {
    const row = this.need(jobId);
    if (CLOSED.includes(row.state)) throw new DomainError('GUARD_FAILED', `OTA 작업 ${jobId}은(는) 이미 ${row.state}입니다.`, { state: row.state });
    let serverState: string | null = row.server_state;
    if (row.ota_job_id) {
      try {
        const res = await this.client!.cancel<{ state?: OtaServerJobState }>(jobId, reason);
        serverState = res.body.state ?? 'CANCELLED';
      } catch (e) {
        const err = e instanceof OtaCallError ? e : new OtaCallError('INTERNAL', String(e), null, true);
        throw new DomainError('GUARD_FAILED', `OTA 서버가 취소를 받지 않았습니다 — ${err.message}`, { ota: err.toJSON() });
      }
    }
    this.db.tx(() => {
      this.jobs.update(jobId, { state: 'CANCELLED', server_state: serverState, next_attempt_at: null, updated_at: this.clock.iso() });
      this.audit.record(actor, 'OTA_JOB_CANCEL', jobId, { before: { state: row.state }, after: { state: 'CANCELLED', serverState }, reason, componentId: COMPONENT });
      this.events.publish('ota.job.cancelled', jobId, { jobId, publicationId: row.publication_id }, { componentId: COMPONENT, correlationId: actor.correlationId });
    });
    return this.jobs.view(this.jobs.get(jobId));
  }

  // ── webhook(OTA → FF) ────────────────────────────────
  /** 서명 확인 → 시각 창 → 본문 → 판 → 이벤트 ID(한 번만) → 차량별 결과 반영 */
  receive(headers: Record<string, string | string[] | undefined>, raw: string, body: unknown) {
    const h = (k: string) => {
      const v = headers[k];
      return (Array.isArray(v) ? v[0] : v) ?? '';
    };
    const secrets = this.cfg?.webhookSecrets ?? [];
    // 비밀이 없으면(연동 안 함) 어떤 요청도 받지 않는다 — 빈 서명과 같다고 통과시키지 않는다
    if (!secrets.length) throw new DomainError('UNAUTHENTICATED', 'OTA webhook 비밀(FF_OTA_WEBHOOK_SECRET)이 설정되지 않아 받지 않습니다.');
    const ts = h('x-ota-timestamp');
    const sig = h('x-ota-signature');
    if (!/^\d{9,12}$/.test(ts) || !sig) throw new DomainError('UNAUTHENTICATED', 'OTA webhook 서명 머리글(X-OTA-Timestamp·X-OTA-Signature)이 없습니다.');
    if (!secrets.some((s) => same(sig, otaWebhookSignature(s, ts, raw)))) throw new DomainError('UNAUTHENTICATED', 'OTA webhook 서명이 맞지 않습니다 — OTA 서버의 webhook 비밀 설정을 확인하세요.');
    const skew = Math.abs(this.clock.now().getTime() / 1000 - Number(ts));
    if (skew > OTA_WEBHOOK_TOLERANCE_SEC) throw new DomainError('UNAUTHENTICATED', `OTA webhook 서명 시각이 허용 범위(±${OTA_WEBHOOK_TOLERANCE_SEC}초) 밖입니다 — 재전송으로 보고 받지 않습니다(시계 동기화 확인).`, { skewSec: Math.round(skew) });
    const parsed = OtaEvent.safeParse(body);
    if (!parsed.success) throw new DomainError('VALIDATION', 'OTA webhook 본문이 규격(IF-05 v1 OtaEvent)과 맞지 않습니다.', { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const ev = parsed.data;
    const headerId = h('x-ota-event-id');
    if (headerId && headerId !== ev.eventId) throw new DomainError('VALIDATION', 'X-OTA-Event-Id 머리글과 본문 eventId가 다릅니다.');
    if (!otaSpecCompatible(ev.specVersion)) throw new DomainError('VALIDATION', `OTA webhook 규격 판 ${ev.specVersion} — FF는 ${OTA_SPEC_VERSION}(주 번호가 같아야 한다)`, { code: 'UNSUPPORTED_SPEC_VERSION', supported: [OTA_SPEC_VERSION] });
    const digest = createHash('sha256').update(raw).digest('hex');
    const seen = this.jobs.event(ev.eventId);
    if (seen) {
      if (seen.body_sha256 !== digest) throw new DomainError('CONFLICT', `OTA 이벤트 ${ev.eventId}은(는) 이미 다른 내용으로 받았습니다(이벤트 ID 재사용).`);
      return { eventId: ev.eventId, duplicate: true, applied: 0, ignored: 0 };
    }
    const row = this.jobs.get(ev.jobId);
    if (!row) throw new DomainError('NOT_FOUND', `OTA 작업 ${ev.jobId}을(를) 찾을 수 없습니다.`);
    const targets = new Set(JSON.parse(row.targets) as string[]);
    const now = this.clock.iso();
    let applied = 0;
    const ignored: { vin: string; reason: string }[] = [];
    this.db.tx(() => {
      for (const r of ev.results ?? []) {
        if (!targets.has(r.vin)) {
          ignored.push({ vin: r.vin, reason: 'NOT_A_TARGET' });
          continue;
        }
        // 전달 기록만 — 회신 집계(IF-06)에 넣지 않는다. 차량 회신이 없는 동안 노드 사유(OTA:<결과>)로 보인다(보안 배포 evaluate)
        if (this.jobs.setVehicle(row.job_id, r.vin, r.outcome, r.rejectReason ?? r.detail ?? null, r.at, ev.eventId)) applied++;
        else ignored.push({ vin: r.vin, reason: 'SUPERSEDED' });
      }
      const patch: Partial<OtaJobRow> = { updated_at: now };
      if (ev.otaJobId && !row.ota_job_id) patch.ota_job_id = ev.otaJobId;
      // 제출 응답을 못 받았어도(제한 시간) OTA 서버가 받았다 — 다음 재시도는 같은 멱등 키라 같은 작업을 돌려받는다
      if (row.state === 'QUEUED' || row.state === 'RETRY_WAIT' || row.state === 'FAILED') patch.state = 'SUBMITTED';
      if (ev.state) {
        patch.server_state = ev.state;
        const final = FINAL_FROM_SERVER[ev.state];
        if (final && !CLOSED.includes(row.state)) patch.state = final;
      }
      // 모든 대상이 끝 결과를 받으면 완료
      const done = this.jobs.vehicles(row.job_id).filter((v) => isFinalOutcome(v.outcome)).length;
      if ((patch.state ?? row.state) === 'SUBMITTED' && done >= targets.size) patch.state = 'COMPLETED';
      this.jobs.update(row.job_id, patch);
      this.jobs.addEvent(ev.eventId, row.job_id, digest, now, `applied=${applied};ignored=${ignored.length}`, new Date(this.clock.now().getTime() - EVENT_KEEP_MS).toISOString());
      if (applied) this.db.afterCommit(() => this.bus.next(row.publication_id));
      this.events.publish('ota.job.results', row.job_id, { jobId: row.job_id, publicationId: row.publication_id, eventId: ev.eventId, type: ev.type, applied, ignored: ignored.length, state: patch.state ?? row.state }, { componentId: COMPONENT });
    });
    return { eventId: ev.eventId, duplicate: false, applied, ignored: ignored.length, ...(ignored.length ? { ignoredResults: ignored.slice(0, 50) } : {}) };
  }

  // ── 조회 ─────────────────────────────────────────────
  forPublication(publicationId: string) {
    return this.jobs.view(this.jobs.forPublication(publicationId));
  }

  list(q: { publicationId?: string; state?: string }) {
    return this.jobs.list(q).map((r) => this.jobs.view(r)!);
  }

  private statusView() {
    const n = (state: string) => this.db.get<{ n: number }>('SELECT count(*) AS n FROM ota_job WHERE state = ?', state)!.n;
    return { specVersion: OTA_SPEC_VERSION, url: this.cfg?.url ?? null, queued: n('QUEUED'), retryWait: n('RETRY_WAIT'), failed: n('FAILED'), submitted: n('SUBMITTED'), health: this.health };
  }

  /** 상태 점검 — OTA 서버 /ota/v1/health(설치 점검·채널 화면) */
  async checkHealth() {
    if (!this.client) return null;
    try {
      const r = await this.client.health<{ status?: string; specVersions?: string[] }>();
      const ok = r.body.status === 'ok' && (r.body.specVersions ?? []).some(otaSpecCompatible);
      this.health = { at: this.clock.iso(), ok, detail: `${r.body.status ?? '?'} · ${(r.body.specVersions ?? []).join(',')}` };
    } catch (e) {
      this.health = { at: this.clock.iso(), ok: false, detail: e instanceof OtaCallError ? `${e.code} ${e.status ?? ''}`.trim() : 'ERROR' };
    }
    return this.health;
  }
}

@Controller('api/ota')
export class OtaController {
  constructor(private readonly ota: OtaServerAdapter) {}

  /** OTA 서버가 부른다 — 행위자 헤더 대신 HMAC 서명(어댑터가 원문으로 확인). 2xx면 OTA 서버는 다시 보내지 않는다 */
  @Post('v1/events')
  @HttpCode(202)
  @WebhookEndpoint()
  events(@Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    return this.ota.receive(req.headers, raw, req.body);
  }

  @Get('jobs')
  @Roles(...DATA_CATEGORY_ACCESS.SAFETY_OPERATION)
  jobs(@Query('publicationId') publicationId?: string, @Query('state') state?: string) {
    return { items: this.ota.list({ publicationId, state }) };
  }

  @Post('jobs/:jobId/retry')
  @HttpCode(200)
  @Roles('RELEASE_MANAGER', 'OPS_LEAD', 'OPERATOR')
  @AuditAction('OTA_JOB_RETRY')
  retry(@CurrentActor() actor: Actor, @Param('jobId') jobId: string, @Body(new ZodPipe(OtaJobActionBody)) body: OtaJobActionBody) {
    return this.ota.retry(actor, jobId, body.reason);
  }

  @Post('jobs/:jobId/cancel')
  @HttpCode(200)
  @Roles('RELEASE_MANAGER', 'OPS_LEAD')
  @AuditAction('OTA_JOB_CANCEL')
  cancel(@CurrentActor() actor: Actor, @Param('jobId') jobId: string, @Body(new ZodPipe(OtaJobActionBody)) body: OtaJobActionBody) {
    return this.ota.cancel(actor, jobId, body.reason);
  }
}
