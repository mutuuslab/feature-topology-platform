// OTA 작업 저장소(049_ota_job) — 게시본마다 OTA 작업 1건, 차량별 결과, 받은 webhook 이벤트 ID.
import { Inject, Injectable } from '@nestjs/common';
import { OTA_VEHICLE_REPORTED, type OtaDeliveryState, type OtaVehicleOutcome } from '@ff/contracts';
import { DB, type Db } from '../../kernel/db';

export interface OtaJobRow {
  job_id: string;
  publication_id: string;
  state: OtaDeliveryState;
  targets: string;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  ota_job_id: string | null;
  server_state: string | null;
  created_at: string;
  submitted_at: string | null;
  updated_at: string;
}

export interface OtaJobView {
  jobId: string;
  publicationId: string;
  channel: 'ota';
  state: OtaDeliveryState;
  serverState: string | null;
  otaJobId: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: { code: string; status: number | null; retryable: boolean; message: string } | null;
  targets: number;
  createdAt: string;
  submittedAt: string | null;
  updatedAt: string;
  counts: Record<string, number>;
  vehicles: { vin: string; outcome: OtaVehicleOutcome; detail: string | null; at: string }[];
}

/** 끝 결과 — 이 결과를 받은 차량은 더 기다리지 않는다(DELIVERED만 중간 경과) */
export const isFinalOutcome = (o: OtaVehicleOutcome) => o !== 'DELIVERED';

@Injectable()
export class OtaJobRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  get(jobId: string) {
    return this.db.get<OtaJobRow>('SELECT * FROM ota_job WHERE job_id = ?', jobId) ?? null;
  }

  forPublication(publicationId: string) {
    return this.db.get<OtaJobRow>('SELECT * FROM ota_job WHERE publication_id = ?', publicationId) ?? null;
  }

  insert(row: Pick<OtaJobRow, 'job_id' | 'publication_id' | 'targets' | 'created_at'>) {
    this.db.run("INSERT OR IGNORE INTO ota_job (job_id, publication_id, state, targets, created_at, updated_at, next_attempt_at) VALUES (?, ?, 'QUEUED', ?, ?, ?, ?)", row.job_id, row.publication_id, row.targets, row.created_at, row.created_at, row.created_at);
  }

  update(jobId: string, patch: Partial<Omit<OtaJobRow, 'job_id' | 'publication_id' | 'created_at'>>) {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return;
    this.db.run(`UPDATE ota_job SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE job_id = ?`, ...keys.map((k) => patch[k] as string | number | null), jobId);
  }

  /** 제출할 때가 된 작업 */
  due(nowIso: string) {
    return this.db.all<OtaJobRow>("SELECT * FROM ota_job WHERE state IN ('QUEUED', 'RETRY_WAIT') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at, job_id", nowIso);
  }

  /** 다음 재시도 시각이 미래인 대기 작업 — 재시작 뒤 타이머를 다시 건다 */
  waiting() {
    return this.db.all<OtaJobRow>("SELECT * FROM ota_job WHERE state IN ('QUEUED', 'RETRY_WAIT')");
  }

  list(q: { publicationId?: string; state?: string } = {}) {
    const where: string[] = [];
    const params: string[] = [];
    if (q.publicationId) (where.push('publication_id = ?'), params.push(q.publicationId));
    if (q.state) (where.push('state = ?'), params.push(q.state));
    return this.db.all<OtaJobRow>(`SELECT * FROM ota_job ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, job_id DESC LIMIT 200`, ...params);
  }

  vehicles(jobId: string) {
    return this.db.all<{ vin: string; outcome: OtaVehicleOutcome; detail: string | null; at: string }>('SELECT vin, outcome, detail, at FROM ota_job_vehicle WHERE job_id = ? ORDER BY vin', jobId);
  }

  /** 게시본의 OTA 전달 결과(VIN → 결과) — OTA 작업이 없으면 빈 지도 */
  outcomes(publicationId: string): Map<string, OtaVehicleOutcome> {
    return new Map(this.db.all<{ vin: string; outcome: OtaVehicleOutcome }>('SELECT v.vin, v.outcome FROM ota_job_vehicle v JOIN ota_job j ON j.job_id = v.job_id WHERE j.publication_id = ?', publicationId).map((r) => [r.vin, r.outcome]));
  }

  /**
   * 차량별 결과 기록 — 차량이 직접 알린 결과(APPLIED·REFUSED·SIGNATURE_FAILED)는 OTA 서버의 추정(NO_RESPONSE·CANCELLED·NOT_ELIGIBLE)·경과(DELIVERED)로 덮지 않는다.
   * 늦게 온 차량 결과는 추정을 덮는다(순서가 바뀌어 와도 같은 끝 상태). 바뀌었으면 true
   */
  setVehicle(jobId: string, vin: string, outcome: OtaVehicleOutcome, detail: string | null, at: string, eventId: string): boolean {
    const prev = this.db.get<{ outcome: OtaVehicleOutcome }>('SELECT outcome FROM ota_job_vehicle WHERE job_id = ? AND vin = ?', jobId, vin);
    if (prev) {
      const prevReported = OTA_VEHICLE_REPORTED.includes(prev.outcome);
      const nextReported = OTA_VEHICLE_REPORTED.includes(outcome);
      if (prevReported && !nextReported) return false;
      if (!prevReported && !nextReported && isFinalOutcome(prev.outcome) && !isFinalOutcome(outcome)) return false;
    }
    this.db.run('INSERT INTO ota_job_vehicle (job_id, vin, outcome, detail, at, event_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (job_id, vin) DO UPDATE SET outcome = excluded.outcome, detail = excluded.detail, at = excluded.at, event_id = excluded.event_id', jobId, vin, outcome, detail, at, eventId);
    return true;
  }

  event(eventId: string) {
    return this.db.get<{ event_id: string; job_id: string; body_sha256: string; received_at: string; outcome: string }>('SELECT * FROM ota_event WHERE event_id = ?', eventId) ?? null;
  }

  addEvent(eventId: string, jobId: string, bodySha256: string, receivedAt: string, outcome: string, pruneBefore: string) {
    this.db.run('INSERT INTO ota_event (event_id, job_id, body_sha256, received_at, outcome) VALUES (?, ?, ?, ?, ?)', eventId, jobId, bodySha256, receivedAt, outcome);
    // 재전송 판정 창(±5분)보다 훨씬 오래 둔다 — OTA 서버의 webhook 재시도(규격 7.4: 최대 24시간) 동안 같은 이벤트를 한 번만 처리
    this.db.run('DELETE FROM ota_event WHERE received_at < ?', pruneBefore);
  }

  view(row: OtaJobRow | null): OtaJobView | null {
    if (!row) return null;
    const vehicles = this.vehicles(row.job_id);
    const counts: Record<string, number> = {};
    for (const v of vehicles) counts[v.outcome] = (counts[v.outcome] ?? 0) + 1;
    return {
      jobId: row.job_id,
      publicationId: row.publication_id,
      channel: 'ota',
      state: row.state,
      serverState: row.server_state,
      otaJobId: row.ota_job_id,
      attempts: row.attempts,
      nextAttemptAt: row.state === 'RETRY_WAIT' ? row.next_attempt_at : null,
      lastError: row.last_error ? JSON.parse(row.last_error) : null,
      targets: (JSON.parse(row.targets) as string[]).length,
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      updatedAt: row.updated_at,
      counts,
      vehicles,
    };
  }
}
