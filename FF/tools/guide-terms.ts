// 국제표준 대응방안 보고서 v1.1 용어 규칙(harness/guide/harness/terms.json) 중 플랫폼 화면에 적용하는 금지어 — lint-copy가 쓴다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from './lib.ts';

/** 보고서 용어 규칙 중 플랫폼 화면에 적용하는 것 — PoC·GLEO·timeline.json 등은 보고서 본문 전용(플랫폼에는 /poc 화면이 있다) */
const GUIDE_TERMS = ['SAFE_STOP', 'KILLED', 'ISO 26262 인증서', 'MISRA 완전 준수', '즉시 비활성화', '증적', '상태기계', '상태 기계'];
const TERMS_FILE = join(FF, 'harness', 'guide', 'harness', 'terms.json');

export interface GuideTerm {
  term: string;
  allow: RegExp;
  why: string;
}
export function loadGuideTerms(file = TERMS_FILE): GuideTerm[] {
  if (!existsSync(file)) return [];
  const all = JSON.parse(readFileSync(file, 'utf8')).banned as {
    term: string;
    allow_context: string;
    why: string;
  }[];
  const picked = all.filter((b) => GUIDE_TERMS.includes(b.term));
  const missing = GUIDE_TERMS.filter((t) => !picked.some((b) => b.term === t));
  if (missing.length) throw new Error(`terms.json에 없는 용어 규칙: ${missing.join(', ')} — 보고서 용어 규칙이 바뀌었으면 GUIDE_TERMS를 고친다`);
  return picked.map((b) => ({
    term: b.term,
    allow: new RegExp(b.allow_context),
    why: b.why,
  }));
}
/** 줄 하나에서 허용 문맥 없이 쓰인 금지어 */
export function guideTermHits(line: string, terms: GuideTerm[]): GuideTerm[] {
  return terms.filter((t) => line.includes(t.term) && !t.allow.test(line));
}
