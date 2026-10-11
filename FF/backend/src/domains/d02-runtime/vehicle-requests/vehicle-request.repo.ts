// 차량 발신 요청 기록·보고 위치(cursor) 저장소 — (vin, bootId, sequence)가 멱등 키, 저장된 응답을 그대로 돌려준다.
import { Inject, Injectable } from '@nestjs/common';
import type { VehicleChannelCursor, VehicleRequestRecord } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';

export interface StoredVehicleRequest extends VehicleRequestRecord {
  /** 같은 멱등 키로 다른 본문이 오면 거부하려고 남기는 본문 해시 */
  bodyHash: string | null;
  /** 차량에 돌려준 응답 (ACCEPTED) 또는 거부 오류 (REJECTED) — 재시도에 그대로 돌려준다 */
  response: unknown;
}

@Injectable()
export class VehicleRequestRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  nextId(): string {
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM vehicle_request')!.n + 1;
    return `VREQ-${String(n).padStart(5, '0')}`;
  }
  /** 멱등 키가 없는 기록(조회·빈도 초과·범위 위반)은 bootId·sequence를 비워 둔다 — 재시도가 같은 거부를 받지 않게 */
  insert(r: StoredVehicleRequest, keyed: boolean) {
    this.db.run(
      'INSERT INTO vehicle_request (request_id, vin, at, boot_id, sequence, doc) VALUES (?, ?, ?, ?, ?, ?)',
      r.requestId,
      r.vin,
      r.at,
      keyed ? r.bootId : null,
      keyed ? r.sequence : null,
      JSON.stringify(r),
    );
  }
  update(r: StoredVehicleRequest) {
    this.db.run('UPDATE vehicle_request SET doc = ? WHERE request_id = ?', JSON.stringify(r), r.requestId);
  }
  byKey(vin: string, bootId: string, sequence: number): StoredVehicleRequest | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM vehicle_request WHERE vin = ? AND boot_id = ? AND sequence = ?', vin, bootId, sequence);
    return r ? JSON.parse(r.doc) : undefined;
  }
  list(vin: string, limit = 50): StoredVehicleRequest[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM vehicle_request WHERE vin = ? ORDER BY request_id DESC LIMIT ?', vin, limit).map((r) => JSON.parse(r.doc));
  }

  cursor(vin: string): VehicleChannelCursor | null {
    const r = this.db.get<{ boot_id: string; sequence: number }>('SELECT boot_id, sequence FROM vehicle_channel WHERE vin = ?', vin);
    return r ? { bootId: r.boot_id, sequence: r.sequence } : null;
  }
  setCursor(vin: string, c: VehicleChannelCursor) {
    this.db.run('INSERT INTO vehicle_channel (vin, boot_id, sequence) VALUES (?, ?, ?) ON CONFLICT(vin) DO UPDATE SET boot_id = excluded.boot_id, sequence = excluded.sequence', vin, c.bootId, c.sequence);
  }
}
