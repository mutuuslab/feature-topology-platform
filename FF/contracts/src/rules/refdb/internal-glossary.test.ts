// 사내 용어 검색 별칭(P1-8) — 'SCC'·'스마트 크루즈'가 적응형 순항 제어(AD-LON-002)를 찾는다
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { internalGlossaryHits, REF_INTERNAL_GLOSSARY } from './internal-glossary';

const refs = JSON.parse(readFileSync(join(__dirname, '../../../../data/reference/feature-db/v1.3/refs.json'), 'utf8')) as { refId: string }[];

describe('사내 용어 검색 별칭', () => {
  it('SCC·스마트 크루즈(띄어쓰기·대소문자 무시)는 AD-LON-002', () => {
    expect([...internalGlossaryHits('SCC')]).toEqual(['AD-LON-002']);
    expect([...internalGlossaryHits('scc')]).toEqual(['AD-LON-002']);
    expect([...internalGlossaryHits('스마트 크루즈')]).toContain('AD-LON-002');
    expect([...internalGlossaryHits('스마트크루즈 컨트롤')]).toContain('AD-LON-002');
  });
  it('한 글자·빈 검색어는 걸지 않는다', () => {
    expect(internalGlossaryHits('a').size).toBe(0);
    expect(internalGlossaryHits('').size).toBe(0);
  });
  it('표의 기준 행 ID는 Feature DB v1.3에 있다', () => {
    const ids = new Set(refs.map((r) => r.refId));
    for (const t of REF_INTERNAL_GLOSSARY) for (const id of t.refIds) expect(ids.has(id), `${t.term} → ${id}`).toBe(true);
  });
});
