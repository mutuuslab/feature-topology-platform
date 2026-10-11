// contracts ROUTES + zod 본문 스키마 → OpenAPI 3.0 (docs/80-integration/openapi.json).
// --check: 커밋된 파일이 최신이 아니면 실패 (verify 단계).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FF } from './lib.ts';

const require = createRequire(import.meta.url);
const { OpenAPIRegistry, OpenApiGeneratorV3 } = require('@asteasolutions/zod-to-openapi');
const c = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../contracts/src/index');

const registry = new OpenAPIRegistry();
for (const r of c.ROUTES) {
  const params = [...r.path.matchAll(/:(\w+)/g)].map((m) => m[1]);
  registry.registerPath({
    method: r.method.toLowerCase(),
    path: r.path.replace(/:(\w+)/g, '{$1}'),
    summary: r.summary,
    tags: [r.component],
    operationId: r.name,
    description: r.roles?.length ? `허용 역할: ${r.roles.map((x) => c.ROLE_LABEL[x]).join(', ')} (헤더 X-Actor-Id, X-Actor-Role)` : undefined,
    parameters: [
      ...params.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
      ...(r.query ?? []).map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } })),
    ],
    request: r.body ? { body: { content: { 'application/json': { schema: r.body } } } } : undefined,
    responses: {
      200: { description: '성공' },
      ...(r.method !== 'GET' && { 201: { description: '생성' }, 403: { description: '역할·직무 분리 위반 (오류 봉투)' }, 422: { description: '전이·체크리스트 조건 미충족 (오류 봉투)' } }),
      400: { description: '입력 검증 실패 (오류 봉투)' },
      404: { description: '없음 (오류 봉투)' },
    },
  });
}

const doc = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.3',
  info: { title: 'Feature Flag Platform API', version: '0.81.0', description: '통합 상세설계서 v0.81 · 42컴포넌트 PoC v0.50 기준. 생성 파일 — 직접 수정 금지 (npm run openapi).' },
  servers: [{ url: 'http://localhost:9101' }],
});
const text = JSON.stringify(doc, null, 2) + '\n';
const out = join(FF, '..', 'docs', '80-integration', 'openapi.json');

if (process.argv.includes('--check')) {
  const cur = existsSync(out) ? readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== text) {
    console.error('openapi: docs/80-integration/openapi.json이 최신이 아닙니다 — npm run openapi');
    process.exit(1);
  }
  console.log(`openapi: ✓ 최신 (${c.ROUTES.length}개 경로)`);
} else {
  writeFileSync(out, text);
  console.log(`openapi: ${c.ROUTES.length}개 경로 → docs/80-integration/openapi.json`);
}
