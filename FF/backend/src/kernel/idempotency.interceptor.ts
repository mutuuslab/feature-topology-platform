// Idempotency-Key — 같은 키·같은 본문의 변경 요청은 처음 응답을 그대로 돌려준다(재전송 안전).
// 같은 키에 다른 본문이면 422. 키가 없으면 그냥 통과(프론트 API 클라이언트는 항상 붙인다).
// 처리 전에 키를 예약한다(출시 준비 RD-OPS-13) — 비동기 처리(외부 연계·가상 검증) 중에 같은 키가 또 오면 두 번 실행하지 않고 409.
// 처리가 실패하면 예약을 풀어 같은 키로 다시 보낼 수 있다(저장된 응답이 없으니 재실행). 예약은 프로세스 메모리 —
// 단일 인스턴스 전제(RD-OPS-14). PostgreSQL 이전 때 같은 트랜잭션의 행 예약으로 옮긴다.
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { finalize, Observable, of, tap } from 'rxjs';
import { Clock } from './clock';
import { DB, type Db } from './db';
import { DomainError } from './errors';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  /** 처리 중인 키(route 포함) → 본문 해시 */
  private readonly pending = new Map<string, string>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (!key || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next.handle();

    const route = `${req.method} ${req.path}`;
    const hash = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');
    const prev = this.db.get<{ req_hash: string; status: number; response: string }>(
      'SELECT req_hash, status, response FROM idempotency WHERE key = ? AND route = ?',
      key,
      route,
    );
    if (prev) {
      if (prev.req_hash !== hash) throw new DomainError('IDEMPOTENCY_KEY_REUSED', '같은 Idempotency-Key로 다른 내용의 요청을 보냈습니다. 새 키를 사용하세요.');
      res.status(prev.status).setHeader('Idempotent-Replayed', 'true');
      return of(JSON.parse(prev.response));
    }
    const slot = JSON.stringify([route, key]);
    const busy = this.pending.get(slot);
    if (busy !== undefined) {
      if (busy !== hash) throw new DomainError('IDEMPOTENCY_KEY_REUSED', '같은 Idempotency-Key로 다른 내용의 요청을 보냈습니다. 새 키를 사용하세요.');
      throw new DomainError('IDEMPOTENCY_IN_PROGRESS', '같은 요청을 아직 처리하고 있습니다. 잠시 뒤 같은 키로 다시 보내면 처음 결과를 받습니다.');
    }
    this.pending.set(slot, hash);
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
      finalize(() => this.pending.delete(slot)),
    );
  }
}
