// API 표준 명세·버전 정책(D05-01, FR-AGW-001-006·007) — 실행 중인 서버의 경로 표에서 만든 OpenAPI 3.0 명세(ETag)와 버전별 상태·일정.
// 명세는 날짜가 바뀔 때만 다시 만든다(버전 상태가 날짜로 정해진다). 커밋 사본(docs/80-integration/openapi.json)과 연산 목록이 같다(시험).
import { Controller, Get, Injectable, Req, Res } from '@nestjs/common';
import { API_VERSION_POLICY, apiVersionsAt, buildOpenApiDocument, currentApiVersion, openApiSummary, type ApiVersionsView } from '@ff/contracts';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';

@Injectable()
@PlatformComponent('D05-01')
export class ApiSpecService {
  private cache: { day: string; text: string; sha256: string; summary: ReturnType<typeof openApiSummary> } | null = null;
  constructor(private readonly clock: Clock) {}

  /**
   * 최신 명세 — 경로 표(ROUTES)·본문 스키마·응답 계약에서
   * @req FR-AGW-001-006
   */
  spec() {
    const now = this.clock.iso();
    const day = now.slice(0, 10);
    if (this.cache?.day !== day) {
      const doc = buildOpenApiDocument({ now });
      const text = JSON.stringify(doc);
      this.cache = { day, text, sha256: createHash('sha256').update(text).digest('hex'), summary: openApiSummary(doc) };
    }
    return this.cache;
  }

  /**
   * 버전 정책 — 버전별 상태(현재·지원·폐기 예고·지원 종료)·일정·바뀐 것, 명세 요약
   * @req FR-AGW-001-007
   */
  versions(): ApiVersionsView {
    const now = this.clock.iso();
    const s = this.spec();
    return {
      header: 'X-Api-Version',
      current: currentApiVersion(now).version,
      policy: { compatibility: API_VERSION_POLICY.compatibility, minNoticeDays: API_VERSION_POLICY.minNoticeDays, deprecatedResponse: API_VERSION_POLICY.deprecatedResponse, retiredResponse: API_VERSION_POLICY.retiredResponse },
      versions: apiVersionsAt(now).map((v) => ({ version: v.version, state: v.state, releasedAt: v.releasedAt, deprecatedAt: v.deprecatedAt, sunsetAt: v.sunsetAt, changes: v.changes })),
      spec: { ...s.summary, sha256: s.sha256, url: '/api/openapi.json' },
    };
  }
}

@Controller('api')
export class ApiSpecController {
  constructor(private readonly svc: ApiSpecService) {}

  @Get('openapi.json')
  openapi(@Req() req: Request, @Res() res: Response) {
    const s = this.svc.spec();
    const etag = `"${s.sha256}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.header('if-none-match') === etag) return res.status(304).end();
    res.type('application/json').send(s.text);
  }

  @Get('api-versions')
  versions() {
    return this.svc.versions();
  }
}
