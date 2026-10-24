// 도메인 오류 → 공통 오류 봉투 {error:{code,message,details}}. 프론트는 code로 분기하고 message(한글)를 그대로 보여 준다.
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { VEHICLE_REJECT, type VehicleReject } from '@ff/contracts';
import type { Response } from 'express';

export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'SEPARATION_OF_DUTY'
  | 'CONFLICT'
  | 'IMMUTABLE'
  | 'GUARD_FAILED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | VehicleReject
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  SEPARATION_OF_DUTY: 403,
  CONFLICT: 409,
  IMMUTABLE: 409,
  GUARD_FAILED: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  IDEMPOTENCY_IN_PROGRESS: 409,
  ...VEHICLE_REJECT,
  INTERNAL: 500,
};

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details?: unknown };
}

/** body-parser 오류 — expose가 켜진 4xx */
const isClientBodyError = (e: unknown): e is { status: number; type?: string } =>
  !!e && typeof e === 'object' && (e as { expose?: unknown }).expose === true && typeof (e as { status?: unknown }).status === 'number' && (e as { status: number }).status >= 400 && (e as { status: number }).status < 500;

@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorEnvelope;
    if (err instanceof DomainError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) } };
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      const code: ErrorCode = status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : status === 401 ? 'UNAUTHENTICATED' : status < 500 ? 'VALIDATION' : 'INTERNAL';
      body = { error: { code, message: status === 404 ? '요청한 경로를 찾을 수 없습니다.' : err.message } };
    } else if (isClientBodyError(err)) {
      // 요청 본문 읽기 실패(본문 너무 큼 413, JSON 깨짐 400) — 서버 오류(500)가 아니라 요청 쪽 문제로 돌려준다
      status = err.status;
      body = { error: { code: 'VALIDATION', message: err.type === 'entity.too.large' ? '요청 본문이 너무 큽니다. 나눠서 보내세요.' : '요청 본문을 읽을 수 없습니다(JSON 형식 확인).' } };
    } else {
      // eslint-disable-next-line no-console
      console.error(err);
      body = { error: { code: 'INTERNAL', message: '서버 내부 오류입니다. 잠시 후 다시 시도하고, 반복되면 감사 이력의 상관 ID로 문의하세요.' } };
    }
    res.status(status).json(body);
  }
}
