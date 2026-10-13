// GLEO Broker 어댑터 — FF_IMP 영상 키트 차량(ego-01·lead-01)을 플랫폼이 실제로 구동한다.
// GLEO_MODE: internal(기본, 내부 시뮬레이터가 대신 회신) | ws(실제 브로커 ws://127.0.0.1:8765) | off(영상 키트 차량 미연결).
// 보내기 전 contracts 스키마로 검사한다 — 브로커는 잘못된 메시지를 조용히 버린다.
// GLEO status_report는 차량 런타임의 실제 적용 상태이므로 READBACK으로 받고, 게시본·해시·순번은 보낸 명령과 대응시켜 채운다.
import { Controller, Get, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { GleoMessage, GleoStatusReport, type Publication } from '@ff/contracts';
import { Clock } from '../../kernel/clock';
import { DB, type Db } from '../../kernel/db';
import { EventService } from '../../kernel/event.service';
import { Inject } from '@nestjs/common';
import { TelemetryService } from '../../domains/d04-ops/telemetry-ingest/telemetry.service';
import { RuntimeRepo } from '../../domains/d06-qsec/secure-deploy/publication.repo';

export type GleoMode = 'off' | 'internal' | 'ws';

interface Pending {
  publicationId: string;
  payloadHash: string;
  sequence: number;
  featureVersion: string;
  featureIds: string[];
  /** 게시본이 기대하는 끝 상태(v2 DISABLED 등) */
  desired?: string;
}

@Injectable()
export class GleoAdapter implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('GLEO');
  readonly mode: GleoMode = (['off', 'internal', 'ws'].includes(process.env.GLEO_MODE ?? '') ? process.env.GLEO_MODE : 'internal') as GleoMode;
  readonly url = process.env.GLEO_URL ?? 'ws://127.0.0.1:8765';
  private ws: WebSocket | null = null;
  private connected = false;
  private closing = false;
  private retry: NodeJS.Timeout | null = null;
  private lastError: string | null = null;
  /** vin|featureId → 회신을 기다리는 KILL·RESTORE 게시본 */
  private pending = new Map<string, Pending>();
  readonly messages: { dir: 'out' | 'in'; at: string; msg: unknown }[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly telemetry: TelemetryService,
    private readonly runtime: RuntimeRepo,
    private readonly events: EventService,
    @Inject(DB) private readonly db: Db,
  ) {}

  onModuleInit() {
    if (this.mode === 'ws') this.connect();
  }

  onApplicationShutdown() {
    this.closing = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
  }

  private connect() {
    // Node 24 내장 WebSocket — 헤더로 브로커 로그에 플랫폼임을 남긴다
    const ws = new (WebSocket as any)(this.url, { headers: { 'X-GLEO-Client': 'ff-platform' } }) as WebSocket;
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.lastError = null;
      this.log.log(`connected ${this.url}`);
    };
    ws.onmessage = (e) => this.onRaw(String(e.data));
    ws.onerror = () => (this.lastError = `연결 실패: ${this.url}`);
    ws.onclose = () => {
      this.connected = false;
      if (!this.closing) this.retry = setTimeout(() => this.connect(), 2000);
    };
  }

  status() {
    return { mode: this.mode, url: this.mode === 'ws' ? this.url : null, connected: this.connected, lastError: this.lastError, pending: this.pending.size, messages: this.messages.slice(-30) };
  }

  /** 게시본 → GLEO 메시지. 회신 의무가 없는(ack만) 차량 목록을 돌려준다. */
  send(pub: Publication, vins: string[]): string[] {
    const p = pub.payload;
    let msg: unknown;
    let ackOnly: string[] = [];
    if (p.kind === 'KILL' && p.kill) {
      msg = { type: 'kill_command', feature_id: p.featureId, scope: { vehicle_ids: vins }, issued_at: p.issuedAt, issued_by: pub.createdBy, safe_mode: p.kill.safeMode };
      for (const vin of vins) this.pending.set(`${vin}|${p.featureId}`, { publicationId: pub.publicationId, payloadHash: pub.signature.payloadHash, sequence: p.sequence, featureVersion: p.featureVersion, featureIds: p.kill.featureIds, desired: p.desired });
    } else {
      // GLEO 영상 키트는 policy_push를 캐시만 하고 회신하지 않는다 — 회신 집계 분모에서 뺀다(ackOnly)
      const action = p.kind === 'RESTORE' ? 'enable' : p.policy?.enabled ? 'enable' : 'disable';
      msg = { type: 'policy_push', feature_id: p.featureId, action, scope: { vehicle_ids: vins }, issued_at: p.issuedAt, reason: `${pub.publicationId} ${p.flagKey ?? p.kind}` };
      ackOnly = vins;
    }
    const parsed = GleoMessage.safeParse(msg);
    if (!parsed.success) throw new Error(`GLEO 메시지 계약 위반: ${parsed.error.message}`);
    this.push('out', parsed.data);
    if (this.connected && this.ws) this.ws.send(JSON.stringify(parsed.data));
    else this.lastError = `미연결 상태에서 ${parsed.data.type} 전송 실패 — 차량 회신 없음(TIMEOUT 예상)`;
    return ackOnly;
  }

  /** 브로커가 중계한 메시지 — 차량 status_report만 받는다 (자기가 보낸 명령은 브로커가 되돌려 주지 않는다) */
  onRaw(raw: string) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const r = GleoStatusReport.safeParse(data);
    if (!r.success) return;
    const m = r.data;
    this.push('in', m);
    this.db.tx(() => this.events.publish('vehicle.status.reported', m.vehicle_id, { vehicleId: m.vehicle_id, featureId: m.feature_id, state: m.state, offline: m.offline, latencyMs: (m as any).latency_ms ?? null }, { componentId: 'D02-03' }));
    const key = `${m.vehicle_id}|${m.feature_id}`;
    const p = this.pending.get(key);
    if (!p) return;
    this.pending.delete(key);
    // 차량 런타임 상태도 GLEO 보고로 갱신한다 (차량별 적용 상태 화면)
    const s = this.runtime.get(m.vehicle_id);
    // v1 영상 키트(safe_mode·SAFE_*)는 v2 끝 상태(DISABLED)를 보고하지 못한다 — 끝 상태로 해석하되 state_auth 없는 미증명 보고로 남긴다(FF_IMP v2 전환 전, WP5b)
    const v1Safe = /^SAFE_/.test(m.state) && !!p.desired && !/^SAFE_/.test(p.desired);
    const observed = v1Safe ? p.desired! : m.state;
    for (const f of p.featureIds) s.featureState[f] = observed;
    s.log.push({ at: this.clock.iso(), publicationId: p.publicationId, kind: 'GLEO', result: 'APPLIED', detail: `status_report ${m.state}${v1Safe ? ` → ${observed} (v1 미증명)` : ''}` });
    this.runtime.save(s);
    this.telemetry.ingest({ vin: m.vehicle_id, publicationId: p.publicationId, metricType: 'READBACK', policyHash: p.payloadHash, featureVersion: p.featureVersion, bootId: s.bootId, sequence: p.sequence, observed }, 'GLEO');
  }

  private push(dir: 'out' | 'in', msg: unknown) {
    this.messages.push({ dir, at: this.clock.iso(), msg });
    if (this.messages.length > 100) this.messages.shift();
  }
}

@Controller('api/gleo')
export class GleoController {
  constructor(private readonly gleo: GleoAdapter) {}
  @Get('status')
  status() {
    return this.gleo.status();
  }
}
