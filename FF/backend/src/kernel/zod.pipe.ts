import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { DomainError } from './errors';

/** @Body(new ZodPipe(Schema)) — contracts의 zod 스키마로 요청을 검증한다. */
@Injectable()
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.infer<S> {
    const r = this.schema.safeParse(value);
    if (r.success) return r.data;
    throw new DomainError(
      'VALIDATION',
      '입력값을 확인하세요.',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
}
