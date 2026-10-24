// Idempotency-Key — 같은 키·같은 본문의 변경 요청은 처음 응답을 그대로 돌려준다(재전송 안전).
// 같은 키에 다른 본문이면 422. 키가 없으면 그냥 통과(프론트 API 클라이언트는 항상 붙인다).
// 처리 전에 키를 예약한다(출시 준비 RD-OPS-13) — 비동기 처리(외부 연계·가상 검증) 중에 같은 키가 또 오면 두 번 실행하지 않고 409.
// 처리가 실패하면 예약을 풀어 같은 키로 다시 보낼 수 있다(저장된 응답이 없으니 재실행). 예약은 공유 상태(DB 행, shared-state.ts) —
// 같은 DB를 쓰는 다른 인스턴스에 같은 키가 와도 409다(RD-OPS-14 1단계, 20-92 §3). 주인이 죽으면 RESERVE_TTL_MS 뒤 풀린다.
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { finalize, Observable, of, tap } from 'rxjs';
import { Clock } from './clock';
import { DB, type Db } from './db';
import { DomainError } from './errors';
import { SHARED_STATE, type SharedStateStore } from './shared-state';

/** 처리 중 예약의 수명 — 비동기 처리(외부 연계·가상 검증)보다 길게. 주인 인스턴스가 죽어도 이 뒤에는 같은 키를 다시 받는다 */
const RESERVE_TTL_MS = 10 * 60_000;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    @Inject(SHARED_STATE) private readonly shared: SharedStateStore,
  ) {}

  private stored(key: string, route: string) {
    return this.db.get<{ req_hash: string; status: number; response: string }>('SELECT req_hash, status, response FROM idempotency WHERE key = ? AND route = ?', key, route);
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (!key || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next.handle();

    const route = `${req.method} ${req.path}`;
    const hash = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');
    const replay = (prev: { req_hash: string; status: number; response: string }) => {
      if (prev.req_hash !== hash) throw new DomainError('IDEMPOTENCY_KEY_REUSED', '같은 Idempotency-Key로 다른 내용의 요청을 보냈습니다. 새 키를 사용하세요.');
      res.status(prev.status).setHeader('Idempotent-Replayed', 'true');
      return of(JSON.parse(prev.response));
    };
    const prev = this.stored(key, route);
    if (prev) return replay(prev);
    const slot = `idem:${JSON.stringify([route, key])}`;
    const r = this.shared.reserve(slot, hash, RESERVE_TTL_MS);
    if (!r.ok) {
      if (r.value !== hash) throw new DomainError('IDEMPOTENCY_KEY_REUSED', '같은 Idempotency-Key로 다른 내용의 요청을 보냈습니다. 새 키를 사용하세요.');
      throw new DomainError('IDEMPOTENCY_IN_PROGRESS', '같은 요청을 아직 처리하고 있습니다. 잠시 뒤 같은 키로 다시 보내면 처음 결과를 받습니다.');
    }
    // 예약 직전에 다른 인스턴스가 끝내고 풀었을 수 있다 — 다시 보고 있으면 저장된 응답
    const done = this.stored(key, route);
    if (done) {
      this.shared.release(slot);
      return replay(done);
    }
    return next.handle().pipe(
      tap((body) => {
        this.db.tx(() =>
          this.db.run(
            'INSERT OR IGNORE INTO idempotency (key, route, req_hash, status, response, at) VALUES (?, ?, ?, ?, ?, ?)',
            key,
            route,
            hash,
            res.statusCode,
            JSON.stringify(body ?? null),
            this.clock.iso(),
          ),
        );
      }),
      // 성공(저장 뒤)·실패·취소 모두 예약을 푼다
      finalize(() => this.shared.release(slot)),
    );
  }
}
