// 게시본(Publication)·차량 회신(readback)·차량 런타임 상태 저장소 — 보안 배포(D06-08)·운영 데이터 수집(D04-03)·차량 런타임(D02-03)이 함께 쓴다.
import { Inject, Injectable } from '@nestjs/common';
import type { Publication, ReadbackBody } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';

export interface StoredReadback extends ReadbackBody {
  at: string;
  via: 'IF-06' | 'GLEO';
}

@Injectable()
export class PublicationRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  nextId(): string {
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM publication')!.n + 1;
    return `PUB-${String(n).padStart(5, '0')}`;
  }
  /** 같은 대상(flag:… 또는 feature:…) 안의 다음 순번 — 차량 재전송 방지 기준 */
  nextSequence(scopeKey: string): number {
    return (this.db.get<{ s: number | null }>('SELECT max(sequence) AS s FROM publication WHERE scope_key = ?', scopeKey)!.s ?? 0) + 1;
  }
  insert(p: Publication, scopeKey: string) {
    this.db.run('INSERT INTO publication (publication_id, kind, status, scope_key, sequence, created_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', p.publicationId, p.kind, p.status, scopeKey, p.payload.sequence, p.createdAt, JSON.stringify(p));
  }
  update(p: Publication) {
    this.db.run('UPDATE publication SET status = ?, doc = ? WHERE publication_id = ?', p.status, JSON.stringify(p), p.publicationId);
  }
  get(id: string): Publication | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM publication WHERE publication_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  list(q: { kind?: string; status?: string } = {}): Publication[] {
    const where: string[] = [];
    const params: string[] = [];
    if (q.kind) (where.push('kind = ?'), params.push(q.kind));
    if (q.status) (where.push('status = ?'), params.push(q.status));
    return this.db.all<{ doc: string }>(`SELECT doc FROM publication ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY publication_id DESC`, ...params).map((r) => JSON.parse(r.doc));
  }

  addReadback(r: StoredReadback) {
    this.db.run('INSERT INTO readback (publication_id, vin, at, doc) VALUES (?, ?, ?, ?)', r.publicationId, r.vin, r.at, JSON.stringify(r));
  }
  readbacks(q: { publicationId?: string; vin?: string } = {}): StoredReadback[] {
    const where: string[] = [];
    const params: string[] = [];
    if (q.publicationId) (where.push('publication_id = ?'), params.push(q.publicationId));
    if (q.vin) (where.push('vin = ?'), params.push(q.vin));
    return this.db.all<{ doc: string }>(`SELECT doc FROM readback ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`, ...params).map((r) => JSON.parse(r.doc));
  }
}

/** 차량 런타임(D02-03)이 차량마다 들고 있는 상태 — 시뮬레이터가 갱신하고, 회신 집계는 bootId를 기준값으로 쓴다 */
export interface VehicleRuntimeState {
  vin: string;
  bootId: string;
  /** 대상별(flag:… / feature:…) 적용한 가장 높은 순번 */
  highest: Record<string, number>;
  bundles: Record<string, { publicationId: string; sequence: number; payloadHash: string; policy: import('@ff/contracts').Policy }>;
  kills: Record<string, { killId: string; safeMode: string; publicationId: string }>;
  featureState: Record<string, string>;
  log: { at: string; publicationId: string; kind: string; result: 'APPLIED' | 'REJECTED'; detail: string }[];
  /** v2 Guard(보고서 9.3) — Feature별 마지막으로 받은 vehicle_seq·epoch(순번 창) */
  guard?: Record<string, { lastSeq: number; epoch: number; /** 마지막으로 받아들인 명령(멱등 재시도 판별 — FFP-F019) */ commandId?: string; digest?: string }>;
  /** 시동 안 상태 보고 순번(report_seq 하위 16비트) */
  reportCounter?: number;
}

@Injectable()
export class RuntimeRepo {
  constructor(@Inject(DB) private readonly db: Db) {}
  get(vin: string): VehicleRuntimeState {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM vehicle_runtime WHERE vin = ?', vin);
    return r ? JSON.parse(r.doc) : { vin, bootId: `BOOT-${vin}-1`, highest: {}, bundles: {}, kills: {}, featureState: {}, log: [] };
  }
  save(s: VehicleRuntimeState) {
    s.log = s.log.slice(-30);
    this.db.run('INSERT INTO vehicle_runtime (vin, doc) VALUES (?, ?) ON CONFLICT(vin) DO UPDATE SET doc = excluded.doc', s.vin, JSON.stringify(s));
  }
}
