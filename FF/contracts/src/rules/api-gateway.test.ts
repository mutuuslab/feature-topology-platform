// 외부 API 게이트웨이 규칙(FR-AGW-001-003~007) — 키 모양·상태·만료일, 버전 상태·머리글·지원 종료 410, 런타임 명세 생성
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../routes';
import { API_KEY_ROLES, API_VERSION_POLICY, API_VERSIONS, apiKeyExpiry, apiKeyPrefix, apiKeyState, apiVersionStatus, apiVersionsAt, currentApiVersion, IssueApiKeyBody, parseApiKey, resolveApiVersion } from './api-gateway';
import { buildOpenApiDocument, openApiSummary, ROUTE_RESPONSES } from './openapi-doc';

const KEY = `ffk_AK-0001_${'a'.repeat(43)}`;

describe('API 키 (FR-AGW-001-003~005)', () => {
  it('원문 모양 ffk_<키 ID>_<비밀 43자> — 다른 모양은 키가 아니다', () => {
    expect(parseApiKey(KEY)).toEqual({ keyId: 'AK-0001', secret: 'a'.repeat(43) });
    expect(parseApiKey(` ${KEY} `)?.keyId).toBe('AK-0001');
    for (const bad of ['', 'ffk_AK-1_' + 'a'.repeat(43), `ffk_AK-0001_${'a'.repeat(42)}`, `xfk_AK-0001_${'a'.repeat(43)}`, `ffk_AK-0001_${'a'.repeat(42)}!`]) expect(parseApiKey(bad)).toBeNull();
    expect(apiKeyPrefix(KEY)).toBe('ffk_AK-0001_aaaa');
    // 비밀(base64url)에 '_'가 섞여도 앞부분은 키 ID 뒤 4자 — 마지막 '_' 기준이면 비밀 대부분이 목록에 드러난다(통합 15단계 결함)
    expect(apiKeyPrefix(`ffk_AK-0001_dQTmUPF7_LG71${'a'.repeat(23)}`)).toBe('ffk_AK-0001_dQTm');
    expect(apiKeyPrefix(`ffk_AK-0012_ab_${'c'.repeat(40)}`)).toBe('ffk_AK-0012_ab_c');
  });

  it('역할은 외부 시스템·조회 전용만 — 사람 역할을 키로 받지 않는다', () => {
    expect([...API_KEY_ROLES]).toEqual(['SYSTEM', 'AUDITOR']);
    expect(IssueApiKeyBody.safeParse({ name: '고객센터 VOC', system: 'VOC 수집기', role: 'RELEASE_MANAGER', reason: '연계' }).success).toBe(false);
    expect(IssueApiKeyBody.safeParse({ name: '고객센터 VOC', system: 'VOC 수집기', role: 'SYSTEM', reason: '연계' }).success).toBe(true);
  });

  it('상태 — 폐기가 먼저, 만료일(포함) 다음 날부터 만료', () => {
    expect(apiKeyState({ revokedAt: null, expiresOn: '2026-11-07' }, '2026-11-07T23:59:00Z')).toBe('ACTIVE');
    expect(apiKeyState({ revokedAt: null, expiresOn: '2026-11-07' }, '2026-11-08T00:00:00Z')).toBe('EXPIRED');
    expect(apiKeyState({ revokedAt: '2026-11-01T00:00:00Z', expiresOn: '2027-01-01' }, '2026-11-07T00:00:00Z')).toBe('REVOKED');
  });

  it('만료일 — 비우면 1년, 지난 날·1년 넘는 날은 거부', () => {
    expect(apiKeyExpiry(undefined, '2026-11-07T01:00:00Z')).toEqual({ ok: true, expiresOn: '2027-11-07' });
    expect(apiKeyExpiry('2026-12-31', '2026-11-07T01:00:00Z')).toEqual({ ok: true, expiresOn: '2026-12-31' });
    expect(apiKeyExpiry('2026-11-06', '2026-11-07T01:00:00Z')).toMatchObject({ ok: false });
    expect(apiKeyExpiry('2027-11-08', '2026-11-07T01:00:00Z')).toMatchObject({ ok: false });
  });
});

describe('API 버전 정책 (FR-AGW-001-007)', () => {
  const now = '2026-11-07T01:00:00.000Z';
  it('표 — 날짜 순, 폐기 예고부터 종료까지 최소 기간 이상', () => {
    for (const [a, b] of API_VERSIONS.slice(0, -1).map((v, i) => [v, API_VERSIONS[i + 1]] as const)) expect(a.releasedAt < b.releasedAt).toBe(true);
    for (const v of API_VERSIONS.filter((x) => x.deprecatedAt && x.sunsetAt)) expect((Date.parse(v.sunsetAt!) - Date.parse(v.deprecatedAt!)) / 86_400_000).toBeGreaterThanOrEqual(API_VERSION_POLICY.minNoticeDays);
  });

  it('상태는 시계로 — 종료일 지남 RETIRED, 예고일 지남 DEPRECATED, 가장 새 지원 버전 CURRENT', () => {
    const st = Object.fromEntries(API_VERSIONS.map((v) => [v.version, apiVersionStatus(v, now)]));
    expect(st).toEqual({ '2025-12': 'RETIRED', '2026-06': 'DEPRECATED', '2026-11': 'CURRENT' });
    // 한 달 전에는 2026-11이 아직 나오지 않았고 2026-06이 현재
    expect(currentApiVersion('2026-10-07T00:00:00Z').version).toBe('2026-06');
    expect(apiVersionsAt('2026-10-07T00:00:00Z').map((v) => v.version)).toEqual(['2026-06', '2025-12']);
  });

  it('머리글 없음 → 현재 버전, 폐기 예고 버전 → 같은 응답 + Deprecation·Sunset·Link', () => {
    expect(resolveApiVersion(undefined, now)).toEqual({ ok: true, version: '2026-11', state: 'CURRENT', headers: { 'X-Api-Version': '2026-11' } });
    const old = resolveApiVersion('2026-06', now);
    expect(old).toMatchObject({ ok: true, version: '2026-06', state: 'DEPRECATED' });
    if (!old.ok) throw new Error('호환 응답이어야 한다');
    expect(old.headers.Deprecation).toBe(`@${Date.parse('2026-11-01T00:00:00Z') / 1000}`);
    expect(old.headers.Sunset).toBe('Sat, 01 May 2027 00:00:00 GMT');
    expect(old.headers.Link).toContain('rel="deprecation"');
  });

  it('지원 종료 버전 → 410 + Sunset + 옮길 버전 안내, 모르는 버전 → 400', () => {
    const gone = resolveApiVersion('2025-12', now);
    expect(gone).toMatchObject({ ok: false, status: 410, code: 'API_VERSION_RETIRED', headers: { Sunset: 'Thu, 01 Oct 2026 00:00:00 GMT' }, details: { current: '2026-11', sunsetAt: '2026-10-01' } });
    if (gone.ok) throw new Error('410이어야 한다');
    expect(gone.message).toMatch(/2026-10-01에 지원이 끝났습니다.*2026-11/);
    expect(resolveApiVersion('v9', now)).toMatchObject({ ok: false, status: 400, code: 'VALIDATION', details: { supported: ['2026-06', '2026-11'] } });
  });
});

describe('런타임 명세 (FR-AGW-001-006)', () => {
  const doc = buildOpenApiDocument({ now: '2026-11-07T01:00:00Z' });
  it('OpenAPI 3.0.3 — 경로 표의 모든 연산, operationId = 경로 이름, 버전 = 현재 API 버전', () => {
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info.version).toBe('2026-11');
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
    expect(ops.sort()).toEqual(ROUTES.map((r) => r.name).sort());
    expect(openApiSummary(doc).operations).toBe(ROUTES.length);
  });

  it('본문·응답 스키마 — zod에서, 오류는 공통 봉투, 지원 종료 410·API 키 보안 방식', () => {
    const issue = doc.paths['/api/api-keys'].post as any;
    expect(issue.requestBody.content['application/json'].schema).toMatchObject({ type: 'object', required: expect.arrayContaining(['name', 'system', 'role', 'reason']) });
    expect(issue.responses['201'].content['application/json'].schema.properties.secret).toEqual({ type: 'string' });
    expect(issue.responses['403'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/ErrorEnvelope' });
    expect(issue.responses['410']).toBeDefined();
    expect(issue.security).toContainEqual({ ApiKey: [] });
    expect(doc.components.securitySchemes.ApiKey).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-Api-Key' });
    for (const name of Object.keys(ROUTE_RESPONSES)) expect(ROUTES.some((r) => r.name === name)).toBe(true);
  });

  it('모든 스키마가 OpenAPI 3.0 모양 — $defs·$schema가 남지 않고 참조는 components 안을 가리킨다', () => {
    const text = JSON.stringify(doc);
    expect(text).not.toContain('"$defs"');
    expect(text).not.toContain('"$schema"');
    for (const m of text.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)) expect(doc.components.schemas).toHaveProperty([m[1]]);
  });
});
