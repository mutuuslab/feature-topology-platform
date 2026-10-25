// OTA 서버 HTTP 클라이언트(IF-05 v1) — OAuth2 client credentials 토큰 + 규격 판 머리글 + 멱등 키 + 제한 시간.
// 규격 docs/80-integration/80-45-ota-server-if05.md. 네트워크·제한 시간·5xx·429는 재시도할 수 있는 실패로, 4xx는 고칠 때까지 같은 결과로 본다.
// 사용자 정의 CA는 Node 표준 NODE_EXTRA_CA_CERTS로 준다(코드 설정 없음). 토큰·비밀은 오류 메시지·기록에 넣지 않는다.
import { OTA_ERROR_CODES, OTA_SPEC_HEADER, OTA_SPEC_VERSION, otaSpecCompatible } from '@ff/contracts';
import type { OtaConfig } from '../../kernel/ota-config';

export class OtaCallError extends Error {
  constructor(
    /** OTA 서버 오류 코드(규격 8장) 또는 NETWORK·TIMEOUT·TOKEN_REJECTED·BAD_RESPONSE */
    readonly code: string,
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    /** Retry-After(초 → ms) */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
  toJSON() {
    return { code: this.code, status: this.status, retryable: this.retryable, message: this.message };
  }
}

export interface OtaResponse<T> {
  status: number;
  body: T;
  replayed: boolean;
  specVersion: string | null;
}

type Fetch = typeof fetch;

const retryAfter = (h: string | null): number | null => {
  if (!h) return null;
  const n = Number(h);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 3600) * 1000;
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null;
};

export class OtaClient {
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly cfg: OtaConfig,
    private readonly now: () => number = Date.now,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.cfg.timeoutMs), redirect: 'error' });
    } catch (e) {
      const timeout = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
      // 제한 시간 — 서버가 받았을 수도 있다. 같은 멱등 키로 다시 보내면 두 번 처리되지 않는다(규격 6장)
      throw new OtaCallError(timeout ? 'TIMEOUT' : 'NETWORK', timeout ? `OTA 서버가 ${this.cfg.timeoutMs}ms 안에 답하지 않았습니다` : 'OTA 서버에 연결하지 못했습니다', null, true);
    }
  }

  /** OAuth2 client credentials(RFC 6749 4.4) — 클라이언트 인증은 HTTP Basic(2.3.1). 만료 30초 전에 새로 받는다 */
  async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.until > this.now()) return this.token.value;
    const basic = Buffer.from(`${encodeURIComponent(this.cfg.clientId)}:${encodeURIComponent(this.cfg.clientSecret)}`).toString('base64');
    const res = await this.call(this.cfg.tokenUrl, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: this.cfg.scope }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || typeof body.access_token !== 'string') {
      const retryable = res.status >= 500 || res.status === 429;
      throw new OtaCallError('TOKEN_REJECTED', `OTA 토큰 끝점이 토큰을 내주지 않았습니다(HTTP ${res.status}${body.error ? ` · ${body.error}` : ''}) — FF_OTA_CLIENT_ID·FF_OTA_CLIENT_SECRET·범위 확인`, res.status, retryable, retryAfter(res.headers.get('retry-after')));
    }
    const ttl = Math.max(30, Number(body.expires_in ?? 300));
    this.token = { value: body.access_token, until: this.now() + (ttl - 30) * 1000 };
    return body.access_token;
  }

  /** API 요청 — 401이면 토큰을 한 번 새로 받아 다시 보낸다 */
  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}, retried = false): Promise<OtaResponse<T>> {
    const token = await this.accessToken(retried);
    const res = await this.call(`${this.cfg.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', [OTA_SPEC_HEADER]: OTA_SPEC_VERSION, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 401 && !retried) return this.request<T>(method, path, body, headers, true);
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const specVersion = res.headers.get(OTA_SPEC_HEADER);
    if (!res.ok) {
      const err = (parsed as { error?: { code?: string; message?: string; retryable?: boolean } } | null)?.error;
      const code = typeof err?.code === 'string' ? err.code : `HTTP_${res.status}`;
      const known = (OTA_ERROR_CODES as Record<string, { retryable: boolean }>)[code];
      const retryable = typeof err?.retryable === 'boolean' ? err.retryable : known ? known.retryable : res.status >= 500 || res.status === 429 || res.status === 408;
      throw new OtaCallError(code, `OTA 서버 ${method} ${path} → HTTP ${res.status} ${code}${err?.message ? ` — ${String(err.message).slice(0, 200)}` : ''}`, res.status, retryable, retryAfter(res.headers.get('retry-after')));
    }
    if (specVersion && !otaSpecCompatible(specVersion)) throw new OtaCallError('UNSUPPORTED_SPEC_VERSION', `OTA 서버가 다른 규격 판(${specVersion})으로 답했습니다 — FF는 ${OTA_SPEC_VERSION}`, res.status, false);
    if (parsed === null || typeof parsed !== 'object') throw new OtaCallError('BAD_RESPONSE', `OTA 서버 ${method} ${path} 응답이 JSON 객체가 아닙니다`, res.status, true);
    return { status: res.status, body: parsed as T, replayed: res.headers.get('idempotent-replayed') === 'true', specVersion };
  }

  submit<T>(job: { jobId: string }, idempotencyKey: string) {
    return this.request<T>('POST', '/ota/v1/jobs', job, { 'idempotency-key': idempotencyKey });
  }

  job<T>(jobId: string) {
    return this.request<T>('GET', `/ota/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  cancel<T>(jobId: string, reason: string) {
    return this.request<T>('POST', `/ota/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { reason }, { 'idempotency-key': `${jobId}:cancel` });
  }

  health<T>() {
    return this.request<T>('GET', '/ota/v1/health');
  }
}
