// EU Data Act 접근권 (D05-01 API Gateway, 보고서 v1.1 13.6 · FFG-TEL-006) — 사용자·제3자 데이터 접근 요청을 판정하고, 제공이면 그 차량의 Feature 상태·이력
// (현재 상태, 수신 검사를 통과한 상태 보고 이력, 받은 명령)을 내보낸다. 처리 기록(034, 추가만)은 제공·거부 모두 남기고 내보낸 내용은 해시만 둔다.
// OEM의 비개인 데이터 이용 계약 근거는 법무(REGULATORY_OWNER)가 등록한 문서 ID로만 기록한다 — 없으면 발견으로 보인다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Post } from '@nestjs/common';
import { ContractBasisBody, DataAccessRequestBody, dataActDecision, directAccessStatus } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FleetRepo } from '../../d01-policy/policy-repos';

const pad = (n: number) => String(n).padStart(5, '0');

@Injectable()
@PlatformComponent('D05-01')
export class DataActService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly fleet: FleetRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  /** 그 차량의 Feature 상태·이력 — 요청 범위만 */
  private exportFor(vin: string, scope: string[]) {
    const out: Record<string, unknown> = { vin, generatedAt: this.clock.iso() };
    if (scope.includes('FEATURE_STATE'))
      out.featureState = this.db.all<{ feature_id: string; state: string; report_seq: number; updated_at: string }>('SELECT feature_id, state, report_seq, updated_at FROM vehicle_feature_status WHERE vin = ? ORDER BY feature_id', vin).map((r) => ({ featureId: r.feature_id, state: r.state, reportSeq: r.report_seq, updatedAt: r.updated_at }));
    if (scope.includes('FEATURE_HISTORY')) {
      out.statusHistory = this.db
        .all<{ feature_id: string; state: string; doc: string; received_at: string }>('SELECT feature_id, state, doc, received_at FROM status_report WHERE vin = ? AND accepted = 1 ORDER BY id', vin)
        .map((r) => {
          const d = JSON.parse(r.doc) as { request_result?: string; observed_at?: string; reason?: { category: string; source: string } };
          return { featureId: r.feature_id, state: r.state, requestResult: d.request_result ?? null, reason: d.reason ?? null, observedAt: d.observed_at ?? null, receivedAt: r.received_at };
        });
      out.commands = this.db
        .all<{ command_id: string; request: string; kill_id: string; created_at: string }>('SELECT command_id, request, kill_id, created_at FROM vehicle_envelope WHERE vin = ? ORDER BY created_at', vin)
        .map((r) => ({ commandId: r.command_id, request: r.request, killId: r.kill_id, issuedAt: r.created_at }));
    }
    return out;
  }

  /**
   * 접근 요청 처리 — 판정 → 제공(내보내기) 또는 거부, 어느 쪽이든 처리 기록.
   * @rule FFG-TEL-006 — EU 차량 사용자·제3자 요청 처리 절차(Art.4·5)와 표본 처리 기록, 계약 근거·직접 접근 대상 표시
   */
  request(actor: Actor, body: DataAccessRequestBody) {
    const vehicle = this.fleet.vehicles().find((v) => v.vin === body.vin) ?? null;
    const rejections = dataActDecision(vehicle, body);
    const at = this.clock.iso();
    const requestId = `DAR-${pad((this.db.get<{ n: number }>('SELECT count(*) AS n FROM data_access_request')?.n ?? 0) + 1)}`;
    const base = { requester: body.requester, thirdParty: body.thirdParty, userAuthorizationRef: body.userAuthorizationRef, scope: body.scope, handledBy: actor.id };
    if (rejections.length) {
      // 거부도 처리 기록 — 거부 응답 전에 남긴다
      this.db.run('INSERT INTO data_access_request (request_id, vin, status, at, doc) VALUES (?, ?, ?, ?, ?)', requestId, body.vin, 'REJECTED', at, JSON.stringify({ ...base, rejections }));
      this.audit.failed(actor, 'DATA_ACCESS_REQUEST', requestId, rejections.map((r) => r.message).join(' · '), 'D05-01');
      throw new DomainError('GUARD_FAILED', rejections.map((r) => r.message).join(' · '), { rule: 'FFG-TEL-006', requestId, rejections });
    }
    const data = this.exportFor(body.vin, body.scope);
    const exportHash = 'sha256:' + createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const counts = { featureState: (data.featureState as unknown[] | undefined)?.length ?? 0, statusHistory: (data.statusHistory as unknown[] | undefined)?.length ?? 0, commands: (data.commands as unknown[] | undefined)?.length ?? 0 };
    this.db.tx(() => {
      this.db.run('INSERT INTO data_access_request (request_id, vin, status, at, doc) VALUES (?, ?, ?, ?, ?)', requestId, body.vin, 'FULFILLED', at, JSON.stringify({ ...base, exportHash, counts }));
      this.audit.record(actor, 'DATA_ACCESS_REQUEST', requestId, { after: { vin: body.vin, requester: body.requester, thirdParty: body.thirdParty?.id ?? null, scope: body.scope, exportHash, counts }, componentId: 'D05-01' });
      this.events.publish('data.access.fulfilled', requestId, { requestId, requester: body.requester, scope: body.scope }, { componentId: 'D05-01', correlationId: actor.correlationId });
    });
    return { requestId, status: 'FULFILLED' as const, exportHash, data };
  }

  recordContractBasis(actor: Actor, body: ContractBasisBody) {
    const at = this.clock.iso();
    this.db.tx(() => {
      this.db.run('INSERT INTO data_act_contract_basis (ref, note, recorded_by, recorded_at) VALUES (?, ?, ?, ?)', body.ref, body.note, actor.id, at);
      this.audit.record(actor, 'DATA_ACT_CONTRACT_BASIS', body.ref, { after: body, componentId: 'D05-01' });
    });
    return { ...body, recordedBy: actor.id, recordedAt: at };
  }

  /** 절차 현황 — 처리 기록, 계약 근거, EU 차량의 직접 접근(Art.3(1)) 대상 여부, 발견 */
  overview() {
    const requests = this.db
      .all<{ request_id: string; vin: string; status: string; at: string; doc: string }>('SELECT request_id, vin, status, at, doc FROM data_access_request ORDER BY at DESC, request_id DESC LIMIT 200')
      .map((r) => ({ requestId: r.request_id, vin: r.vin, status: r.status, at: r.at, ...(JSON.parse(r.doc) as Record<string, unknown>) }));
    const contractBasis = this.db.all<{ ref: string; note: string; recorded_by: string; recorded_at: string }>('SELECT ref, note, recorded_by, recorded_at FROM data_act_contract_basis ORDER BY id DESC').map((r) => ({ ref: r.ref, note: r.note, recordedBy: r.recorded_by, recordedAt: r.recorded_at }));
    // 플랫폼 데이터에는 차량의 EU 시장 출시일이 없다 — 판정 불가(UNKNOWN)로 남긴다
    const vehicles = this.fleet.vehicles().filter((v) => v.country === 'EU').map((v) => ({ vin: v.vin, directAccess: directAccessStatus({ country: v.country, placedOnMarketAt: null }) }));
    const findings = [
      ...(contractBasis.length ? [] : ['OEM의 비개인 데이터 이용 계약 근거가 등록되지 않았습니다(법무 검토 필요)']),
      ...(requests.some((r) => r.status === 'FULFILLED') ? [] : ['표본 요청 처리 기록이 없습니다']),
      ...vehicles.filter((v) => v.directAccess === 'UNKNOWN').map((v) => `${v.vin}: EU 시장 출시일이 없어 Art.3(1) 직접 접근 대상인지 판정할 수 없습니다`),
    ];
    return { requests, contractBasis, vehicles, findings };
  }
}

@Controller('api')
export class DataActController {
  constructor(private readonly svc: DataActService) {}

  @Get('data-access-requests')
  @Roles('REGULATORY_OWNER', 'OPERATOR', 'AUDITOR', 'SYSTEM')
  overview() {
    return this.svc.overview();
  }

  @Post('data-access-requests')
  @HttpCode(201)
  @Roles('OPERATOR', 'REGULATORY_OWNER')
  @AuditAction('DATA_ACCESS_REQUEST')
  request(@CurrentActor() actor: Actor, @Body(new ZodPipe(DataAccessRequestBody)) body: DataAccessRequestBody) {
    return this.svc.request(actor, body);
  }

  @Post('data-act/contract-basis')
  @HttpCode(201)
  @Roles('REGULATORY_OWNER')
  @AuditAction('DATA_ACT_CONTRACT_BASIS')
  contractBasis(@CurrentActor() actor: Actor, @Body(new ZodPipe(ContractBasisBody)) body: ContractBasisBody) {
    return this.svc.recordContractBasis(actor, body);
  }
}
