import { Injectable, Optional } from '@nestjs/common';
import { DomainError } from '../../kernel/errors';
import { TelemetryMetrics } from '../../kernel/telemetry-metrics';

export interface EdgeFeatures { features: Array<{ name: string; enabled: boolean; strategies: any[]; dependencies?: any[]; variants?: any[] }>; }
export interface EdgeEvaluation { toggles: Array<{ name: string; enabled: boolean }>; }

/** Official OSS Edge Frontend API evaluates; Backend API exposes its exact cached definitions for drift verification. */
@Injectable()
export class UnleashEdgeClient {
  readonly url = (process.env.UNLEASH_EDGE_URL ?? '').replace(/\/$/, '');
  private readonly backendToken = process.env.UNLEASH_EDGE_BACKEND_TOKEN ?? '';
  private readonly frontendToken = process.env.UNLEASH_EDGE_FRONTEND_TOKEN ?? '';
  constructor(@Optional() private readonly metrics?: TelemetryMetrics) {}
  private configured() {
    let u: URL;
    try { u = new URL(this.url); } catch { throw new DomainError('GUARD_FAILED', 'Unleash Edge가 설정되지 않았습니다.', { code: 'EDGE_NOT_CONFIGURED' }); }
    if (process.env.UNLEASH_MODE !== 'live' || !this.backendToken || !this.frontendToken || !['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash)
      throw new DomainError('GUARD_FAILED', '실제 Unleash Edge 연결과 두 종류의 토큰이 필요합니다.', { code: 'EDGE_NOT_CONFIGURED' });
  }
  private async request<T>(path: string, token: string, body?: unknown): Promise<T> {
    this.configured();
    // 운영 지표 ff_unleash_edge_request_duration_seconds(80-80) — 결과 ok·error
    const t0 = performance.now();
    const op = path === '/api/frontend' ? 'evaluate' : 'features';
    try {
      const r = await fetch(`${this.url}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(3000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const out = await r.json() as T;
      this.metrics?.edge(op, true, (performance.now() - t0) / 1000);
      return out;
    } catch {
      this.metrics?.edge(op, false, (performance.now() - t0) / 1000);
      // Never include tokens, context, or upstream response text in an error.
      throw new DomainError('GUARD_FAILED', 'Unleash Edge가 응답하지 않아 차량 서명본을 발급하지 않았습니다.', { code: 'EDGE_UNAVAILABLE' });
    }
  }
  async features(): Promise<EdgeFeatures> {
    const r = await this.request<EdgeFeatures>('/api/client/features', this.backendToken);
    if (!Array.isArray(r.features) || r.features.some((f) => typeof f.name !== 'string' || typeof f.enabled !== 'boolean' || !Array.isArray(f.strategies)) || new Set(r.features.map((f) => f.name)).size !== r.features.length) throw new DomainError('GUARD_FAILED', 'Edge 설정 응답이 잘못되었습니다.', { code: 'EDGE_RESPONSE' });
    return r;
  }
  async evaluate(context: unknown): Promise<EdgeEvaluation> {
    const r = await this.request<EdgeEvaluation>('/api/frontend', this.frontendToken, context);
    if (!Array.isArray(r.toggles) || r.toggles.some((t) => typeof t.name !== 'string' || typeof t.enabled !== 'boolean') || new Set(r.toggles.map((t) => t.name)).size !== r.toggles.length)
      throw new DomainError('GUARD_FAILED', 'Edge 평가 응답이 잘못되었습니다.', { code: 'EDGE_RESPONSE' });
    return r;
  }
}
