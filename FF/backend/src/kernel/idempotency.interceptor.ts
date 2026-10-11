// Idempotency-Key — 같은 키·같은 본문의 변경 요청은 처음 응답을 그대로 돌려준다(재전송 안전).
// 같은 키에 다른 본문이면 422. 키가 없으면 그냥 통과(프론트 API 클라이언트는 항상 붙인다).
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { Observable, of, tap } from 'rxjs';
import { Clock } from './clock';
import { DB, type Db } from './db';
import { DomainError } from './errors';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
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
    );
  }
}
