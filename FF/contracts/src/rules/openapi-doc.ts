// 런타임 API 명세(D05-01, FR-AGW-001-006) — contracts ROUTES + zod 본문 스키마 → OpenAPI 3.0.3. 서버가 GET /api/openapi.json으로 돌려준다.
// 실행 중인 서버의 경로 표에서 만들므로 그 서버의 최신 명세다(커밋 사본 docs/80-integration/openapi.json은 tools/openapi.ts가 만든다).
// zod 내장 JSON Schema 변환(openapi-3.0 대상)만 쓴다 — 운영 이미지에 개발 의존성이 없어도 된다. 화면 묶음(web.ts)에는 넣지 않는다.
import { z, type ZodTypeAny } from 'zod';
import { ROLE_LABEL } from '../enums';
import { ROUTES, type RouteDef } from '../routes';
import { API_KEY_HEADER, API_VERSION_HEADER, ApiKeyView, ApiVersionsView, IssuedApiKey, apiVersionsAt, currentApiVersion } from './api-gateway';
import { LegacyLinkView, LegacyMessageLogView } from './legacy-link';
import { SettlementTransmissionView, SettlementUsageView } from './settlement';

export const ErrorEnvelopeSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) });

const list = (s: ZodTypeAny) => z.object({ items: z.array(s) });
/** 경로별 200·201 본문 스키마 — 응답 계약이 있는 경로. 없으면 일반 JSON 객체로 적는다 */
export const ROUTE_RESPONSES: Record<string, ZodTypeAny> = {
  apiKeys: list(ApiKeyView),
  issueApiKey: IssuedApiKey,
  revokeApiKey: ApiKeyView,
  apiVersions: ApiVersionsView,
  legacyLinks: list(LegacyLinkView),
  createLegacyLink: LegacyLinkView,
  updateLegacyLink: LegacyLinkView,
  deleteLegacyLink: z.object({ linkId: z.string(), deleted: z.literal(true) }),
  runLegacyBridge: LegacyLinkView,
  legacyMessages: list(LegacyMessageLogView),
  receiveLegacyMessage: LegacyMessageLogView,
  settlementUsage: SettlementUsageView,
  settlementTransmissions: list(SettlementTransmissionView),
  sendSettlement: SettlementTransmissionView,
  health: z.object({ status: z.string() }).passthrough(),
};
/** JSON이 아닌 응답 */
const TEXT_ROUTES: Record<string, string> = { healthMetrics: 'text/plain' };

type Json = Record<string, unknown>;

/** zod → OpenAPI 3.0 스키마. 표현할 수 없는 타입은 제약 없는 스키마, 재귀 정의는 components로 올린다 */
function toSchema(s: ZodTypeAny, defs: Record<string, Json>, prefix: string): Json {
  const out = z.toJSONSchema(s, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' }) as Json;
  delete out.$schema;
  const local = out.$defs as Record<string, Json> | undefined;
  delete out.$defs;
  if (!local) return out;
  const rename = (k: string) => `${prefix}_${k}`;
  const rewrite = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rewrite);
    if (v && typeof v === 'object') {
      const o: Json = {};
      for (const [k, x] of Object.entries(v as Json)) o[k] = k === '$ref' && typeof x === 'string' && x.startsWith('#/$defs/') ? `#/components/schemas/${rename(x.slice(8))}` : rewrite(x);
      return o;
    }
    return v;
  };
  for (const [k, d] of Object.entries(local)) defs[rename(k)] = rewrite(d) as Json;
  return rewrite(out) as Json;
}

const errorRef = (description: string) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } });

export interface OpenApiOptions {
  /** 명세를 만든 시각 — 버전 상태(현재·폐기 예고) 기준 */
  now: string;
  serverUrl?: string;
}

export function buildOpenApiDocument(opts: OpenApiOptions, routes: RouteDef[] = ROUTES) {
  const defs: Record<string, Json> = { ErrorEnvelope: toSchema(ErrorEnvelopeSchema, {}, 'ErrorEnvelope') };
  const paths: Record<string, Record<string, Json>> = {};
  for (const r of routes) {
    const path = r.path.replace(/:(\w+)/g, '{$1}');
    const params = [...r.path.matchAll(/:(\w+)/g)].map((m) => m[1]);
    const api = r.path.startsWith('/api/');
    const ok = r.stream
      ? { description: '이벤트 스트림', content: { 'text/event-stream': { schema: { type: 'string' } } } }
      : TEXT_ROUTES[r.name]
        ? { description: '성공', content: { [TEXT_ROUTES[r.name]]: { schema: { type: 'string' } } } }
        : { description: '성공', content: { 'application/json': { schema: ROUTE_RESPONSES[r.name] ? toSchema(ROUTE_RESPONSES[r.name], defs, r.name) : { type: 'object', description: '경로 요약의 본문(JSON 객체)' } } } };
    const op: Json = {
      operationId: r.name,
      summary: r.summary,
      tags: [r.component],
      ...(r.roles?.length && { description: `허용 역할: ${r.roles.map((x) => ROLE_LABEL[x]).join(', ')}` }),
      parameters: [
        ...params.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
        ...(r.query ?? []).map((name) => ({ name, in: 'query', required: (r.requiredQuery ?? []).includes(name), schema: { type: 'string' } })),
        ...(api ? [{ name: 'X-Api-Version', in: 'header', required: false, description: '요청 API 버전(없으면 현재 버전) — 지원 종료 버전은 410', schema: { type: 'string' } }] : []),
      ],
      ...(r.body && { requestBody: { required: true, content: { 'application/json': { schema: toSchema(r.body, defs, `${r.name}_body`) } } } }),
      responses: {
        [r.method === 'POST' && !r.public ? '201' : '200']: ok,
        ...(r.method === 'POST' && !r.public && { 200: ok }),
        400: errorRef('입력 검증 실패'),
        ...(!r.public && { 401: errorRef('신원 없음·API 키 틀림·폐기·만료') }),
        ...(r.roles?.length && { 403: errorRef('역할·직무 분리 위반') }),
        404: errorRef('없음'),
        ...(r.method !== 'GET' && { 409: errorRef('중복·상태 충돌'), 422: errorRef('업무 규칙 미충족') }),
        ...(api && { 410: errorRef('지원이 끝난 API 버전(Sunset 머리글)') }),
      },
      ...(!r.public && api && { security: [{ ApiKey: [] }, { ActorId: [], ActorRole: [] }, { Session: [] }] }),
    };
    (paths[path] ??= {})[r.method.toLowerCase()] = op;
  }
  const cur = currentApiVersion(opts.now);
  return {
    openapi: '3.0.3',
    info: {
      title: 'Feature Flag Platform API',
      version: cur.version,
      description: '실행 중인 서버의 경로 표(contracts ROUTES)에서 만든 명세. 버전은 X-Api-Version 머리글로 고른다 — 정책은 GET /api/api-versions.',
      'x-api-versions': apiVersionsAt(opts.now).map((v) => ({ version: v.version, state: v.state, deprecatedAt: v.deprecatedAt, sunsetAt: v.sunsetAt })),
    },
    servers: [{ url: opts.serverUrl ?? '/' }],
    components: {
      securitySchemes: {
        ApiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key', description: `외부 시스템 API 키(${API_KEY_HEADER}) — 발급은 보안 담당, 역할은 키에 묶인다` },
        ActorId: { type: 'apiKey', in: 'header', name: 'X-Actor-Id', description: '데모 인증 — 사람 행위자 ID' },
        ActorRole: { type: 'apiKey', in: 'header', name: 'X-Actor-Role', description: `데모 인증 — 맡은 역할. 버전 머리글은 ${API_VERSION_HEADER}` },
        Session: { type: 'apiKey', in: 'cookie', name: 'ff_session', description: '로그인 세션(SSO·공개 데모 게이트)' },
      },
      schemas: defs,
    },
    paths,
  };
}
export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;

/** 명세 요약 — 경로·연산 수 */
export function openApiSummary(doc: OpenApiDocument) {
  const paths = Object.keys(doc.paths).length;
  const operations = Object.values(doc.paths).reduce((t, p) => t + Object.keys(p).length, 0);
  return { openapi: doc.openapi, version: doc.info.version, paths, operations };
}
