// 시험 전용: 작은 JSON Schema(2020-12) 검사기 — 계약 파일(docs/80-integration/datalake-if15/*.schema.json)과 zod를 대조할 때 쓴다(런타임 import 금지).
// schemas/datalake-if15.test.ts의 검사기와 같은 규칙(의존성을 늘리지 않으려고 계약이 쓰는 키워드만 안다 — 모르는 키워드면 던진다).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
export const LAKE_SCHEMA_DIR = join(ROOT, 'docs', '80-integration', 'datalake-if15');
export const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

type Schema = Record<string, any> | boolean;
const KEYWORDS = new Set([
  '$schema', '$id', '$ref', '$comment', 'title', 'description', 'examples', 'default',
  'type', 'const', 'enum', 'pattern', 'minLength', 'maxLength', 'format', 'minimum', 'maximum',
  'required', 'properties', 'additionalProperties', 'items', 'minItems', 'maxItems', 'allOf', 'if', 'then', 'else',
]);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** $id → 스키마(Lake 스키마 전부) — 처음 쓸 때 읽는다(최상위 실행문을 두지 않는다: tools/bundle-budget.test.ts) */
let registryCache: Map<string, Schema> | null = null;
function registry(): Map<string, Schema> {
  if (registryCache) return registryCache;
  const m = new Map<string, Schema>();
  for (const f of readdirSync(LAKE_SCHEMA_DIR).filter((n) => n.endsWith('.schema.json'))) {
    const s = readJson(join(LAKE_SCHEMA_DIR, f));
    m.set(s.$id, s);
  }
  return (registryCache = m);
}

const isType = (t: string, v: unknown) =>
  t === 'null' ? v === null
  : t === 'array' ? Array.isArray(v)
  : t === 'object' ? typeof v === 'object' && v !== null && !Array.isArray(v)
  : t === 'integer' ? Number.isInteger(v)
  : typeof v === t;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function resolve(ref: string, base: string): { schema: Schema; base: string } {
  const url = new URL(ref, base);
  const frag = url.hash;
  url.hash = '';
  const doc = registry().get(url.href);
  if (doc === undefined) throw new Error(`$ref를 찾을 수 없음: ${ref} (기준 ${base})`);
  let node: any = doc;
  for (const part of frag.replace(/^#\/?/, '').split('/').filter(Boolean)) node = node[decodeURIComponent(part)];
  if (node === undefined) throw new Error(`$ref 조각 없음: ${ref}`);
  return { schema: node, base: url.href };
}

function check(s: Schema, v: unknown, base: string, path: string, out: string[]) {
  if (s === true) return;
  if (s === false) return void out.push(`${path}: 허용 안 됨`);
  for (const k of Object.keys(s)) if (!KEYWORDS.has(k)) throw new Error(`검사기가 모르는 키워드 ${k} (${path})`);
  if (s.$id) base = s.$id;
  if (s.$ref) {
    const r = resolve(s.$ref, base);
    check(r.schema, v, r.base, path, out);
  }
  if (s.type !== undefined) {
    const types: string[] = [].concat(s.type);
    if (!types.some((t) => isType(t, v))) return void out.push(`${path}: 형 ${types.join('|')} 아님`);
  }
  if ('const' in s && !same(s.const, v)) out.push(`${path}: ${JSON.stringify(s.const)} 아님`);
  if (s.enum && !s.enum.some((e: unknown) => same(e, v))) out.push(`${path}: enum 밖 ${JSON.stringify(v)}`);
  if (typeof v === 'string') {
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) out.push(`${path}: 형식 ${s.pattern} 아님`);
    if (s.minLength !== undefined && [...v].length < s.minLength) out.push(`${path}: 너무 짧음`);
    if (s.maxLength !== undefined && [...v].length > s.maxLength) out.push(`${path}: 너무 김`);
    if (s.format === 'date-time' && !(RFC3339.test(v) && !Number.isNaN(Date.parse(v)))) out.push(`${path}: 시각 형식 아님`);
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) out.push(`${path}: ${s.minimum} 미만`);
    if (s.maximum !== undefined && v > s.maximum) out.push(`${path}: ${s.maximum} 초과`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push(`${path}: 항목 부족`);
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${path}: 항목 초과`);
    if (s.items !== undefined) v.forEach((x, i) => check(s.items, x, base, `${path}/${i}`, out));
  }
  if (isType('object', v)) {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) out.push(`${path}/${k}: 필수`);
    for (const [k, sub] of Object.entries<Schema>(s.properties ?? {})) if (k in o) check(sub, o[k], base, `${path}/${k}`, out);
    if (s.additionalProperties === false) for (const k of Object.keys(o)) if (!(k in (s.properties ?? {}))) out.push(`${path}/${k}: 정의에 없는 필드`);
  }
  for (const sub of s.allOf ?? []) check(sub, v, base, path, out);
  if (s.if !== undefined) {
    const probe: string[] = [];
    check(s.if, v, base, path, probe);
    if (!probe.length) s.then !== undefined && check(s.then, v, base, path, out);
    else if (s.else !== undefined) check(s.else, v, base, path, out);
  }
}


/** 계약 스키마 파일 하나로 값 하나를 검사 — 오류 목록(통과면 빈 배열) */
export function lakeSchemaErrors(file: string) {
  const s = readJson(join(LAKE_SCHEMA_DIR, file));
  return (v: unknown) => {
    const out: string[] = [];
    check(s, v, s.$id, '', out);
    return out;
  };
}
