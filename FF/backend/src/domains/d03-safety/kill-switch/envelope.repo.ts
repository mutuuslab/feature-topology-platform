// 차량별 봉투 조회 (D03-03) — 차량 런타임(전달)과 상태 보고 수신 검사(명령 이력 일관성)가 쓴다. 쓰기는 KillService.issueCommand만.
import { Inject, Injectable } from '@nestjs/common';
import type { KillCommandV2 } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';

export interface LastCommand {
  killId: string;
  commandId: string;
  request: 'deactivate' | 'restore' | 'activate' | 'sync';
  vehicleSeq: number;
  keyEpoch: number;
  version: string;
}

@Injectable()
export class EnvelopeRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** 이 차단의 이 차량용 봉투(요청 유형별 가장 최근) */
  forVehicle(killId: string, vin: string, request: string): KillCommandV2 | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM vehicle_envelope WHERE kill_id = ? AND vin = ? AND request = ? ORDER BY created_at DESC, vehicle_seq DESC LIMIT 1', killId, vin, request);
    return r ? (JSON.parse(r.doc) as KillCommandV2) : null;
  }

  /** 이 차량·Feature에 마지막으로 발급한 명령 */
  last(vin: string, featureId: string): LastCommand | null {
    const r = this.db.get<{ kill_id: string; command_id: string; request: LastCommand['request']; vehicle_seq: number; key_epoch: number; doc: string }>(
      'SELECT kill_id, command_id, request, vehicle_seq, key_epoch, doc FROM vehicle_envelope WHERE vin = ? AND feature_id = ? ORDER BY key_epoch DESC, vehicle_seq DESC LIMIT 1',
      vin,
      featureId,
    );
    return r
      ? { killId: r.kill_id, commandId: r.command_id, request: r.request, vehicleSeq: r.vehicle_seq, keyEpoch: r.key_epoch, version: (JSON.parse(r.doc) as KillCommandV2).feature.version }
      : null;
  }
}
