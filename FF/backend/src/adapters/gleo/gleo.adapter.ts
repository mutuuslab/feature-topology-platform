// GLEO Broker 어댑터 — FF_IMP 영상 키트 차량(ego-01·lead-01)을 플랫폼이 실제로 구동한다.
// GLEO_MODE: internal(기본, 내부 시뮬레이터가 대신 회신) | ws(실제 브로커 ws://127.0.0.1:8765) | off(영상 키트 차량 미연결).
// 보내기 전 contracts 스키마로 검사한다 — 브로커는 잘못된 메시지를 조용히 버린다.
// 와이어 v2(보고서 v1.1 부록 D, FF_IMP 5a1138c): 차단·복원은 차량마다 서명된 kill_command v2 봉투(차량 1대)를 보내고, 차량 Safety Guard가
// state_auth로 서명한 status_report v2를 받아 수신 검사(D04-03) 6단계에 넘긴다 — 확인 집계는 검사를 통과해 끝 상태에 닿은 보고만.
// policy_push는 차량 정책 캐시 알림(회신 없음)이다 — 기능을 끄는 일은 서명된 kill_command만 한다.
import { Controller, Get, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { gleoMessageErrors, type Publication } from '@ff/contracts';
import { vehiclePseudonym } from '../../kernel/crypto';
import { EnvelopeRepo } from '../../domains/d03-safety/kill-switch/envelope.repo';
import { StatusIngestService } from '../../domains/d04-ops/telemetry-ingest/status-ingest.service';
import { FleetRepo } from '../../domains/d01-policy/policy-repos';
import { Clock } from '../../kernel/clock';
import { RuntimeRepo } from '../../domains/d06-qsec/secure-deploy/publication.repo';

export type GleoMode = 'off' | 'internal' | 'ws';

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
  readonly messages: { dir: 'out' | 'in'; at: string; msg: unknown }[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly runtime: RuntimeRepo,
    private readonly envelopes: EnvelopeRepo,
    private readonly statusIngest: StatusIngestService,
    private readonly fleet: FleetRepo,
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
    return { mode: this.mode, wire: 'v2', url: this.mode === 'ws' ? this.url : null, connected: this.connected, lastError: this.lastError, messages: this.messages.slice(-30) };
  }

  /** 게시본 → GLEO 메시지. 회신 의무가 없는(ack만) 차량 목록을 돌려준다. */
  send(pub: Publication, vins: string[]): string[] {
    const p = pub.payload;
    if ((p.kind === 'KILL' || p.kind === 'RESTORE') && p.kill) return this.sendV2(pub, vins);
    // 정책 배포는 policy_push — 차량은 캐시만 하고 회신하지 않는다, 회신 집계 분모에서 뺀다(ackOnly)
    const action = p.kind === 'RESTORE' ? 'enable' : p.policy?.enabled ? 'enable' : 'disable';
    const msg = { type: 'policy_push', feature_id: p.featureId, action, scope: { vehicle_ids: vins }, issued_at: p.issuedAt, reason: `${pub.publicationId} ${p.flagKey ?? p.kind}` };
    const errors = gleoMessageErrors(msg);
    if (errors.length) throw new Error(`GLEO 메시지 계약 위반: ${errors.join('; ')}`);
    this.push('out', msg);
    if (this.connected && this.ws) this.ws.send(JSON.stringify(msg));
    else this.lastError = '미연결 상태에서 policy_push 전송 실패';
    return vins;
  }

  /**
   * 차량마다 서명된 봉투(차량 1대) 한 통씩. 봉투가 없는(레거시 v1) 차단은 보내지 않고 회신 없음으로 남는다.
   * @rule FFG-PLT-012 — 전달 규칙: 차량 단위 봉투만 브로커로, 보내기 전 v2 스키마 검사(브로커 보안·mTLS는 운영)
   */
  private sendV2(pub: Publication, vins: string[]): string[] {
    const p = pub.payload;
    const request = p.kind === 'KILL' ? 'deactivate' : 'restore';
    for (const vin of vins) {
      const env = this.envelopes.forVehicle(p.kill!.killId, vin, request);
      if (!env) {
        this.lastError = `${vin} 봉투 없음(${p.kill!.killId}) — v1 차단은 v2 와이어로 보내지 않습니다`;
        continue;
      }
      const errors = gleoMessageErrors(env);
      if (errors.length) throw new Error(`kill_command v2 계약 위반: ${errors.join('; ')}`);
      this.push('out', env);
      if (this.connected && this.ws) this.ws.send(JSON.stringify(env));
      else this.lastError = `미연결 상태에서 kill_command v2 전송 실패(${vin}) — 차량 회신 없음(TIMEOUT 예상)`;
    }
    return [];
  }

  /** 가명 → VIN(영상 키트 차량 중) — 보고 본문에는 VIN을 싣지 않는다 */
  private vinOf(pseudonym: string): string | null {
    return this.fleet.vehicles().find((v) => v.gleo && vehiclePseudonym(v.vin) === pseudonym)?.vin ?? null;
  }

  /** 브로커가 중계한 메시지 — 차량 status_report v2만 받는다 (자기가 보낸 명령은 브로커가 되돌려 주지 않는다, v1 보고는 버린다) */
  onRaw(raw: string) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const v2 = data as { type?: string; schema_version?: string; vehicle_pseudonym?: string; feature?: { id?: string } };
    if (v2?.type === 'status_report' && v2.schema_version === '2.0') {
      this.push('in', data);
      const vin = typeof v2.vehicle_pseudonym === 'string' ? this.vinOf(v2.vehicle_pseudonym) : null;
      if (!vin) return void (this.lastError = '알 수 없는 차량 가명의 status_report v2 — 버림');
      const r = this.statusIngest.ingest(vin, data, 'GLEO');
      if (r.accepted && r.featureId) {
        const s = this.runtime.get(vin);
        s.featureState[r.featureId] = (data as { state: string }).state;
        s.log.push({ at: this.clock.iso(), publicationId: '-', kind: 'GLEO', result: 'APPLIED', detail: `status_report v2 ${(data as { state: string }).state}` });
        this.runtime.save(s);
      }
    }
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
