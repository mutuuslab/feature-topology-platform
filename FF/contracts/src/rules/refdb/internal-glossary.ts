// 사내 용어(FF가 더한 검색 별칭, 30-95 §5.1 aliases '+ 사내 용어집') — 엑셀 03b C절 용어집(ref_glossary)에 없는 현업 약칭.
// 서버 검색(backend read-search)과 정적 데모 화면 검색(frontend refSearch)이 같은 표를 쓴다. 기준 행 ID는 v1.3에 있어야 한다(시험).
export interface RefInternalTerm {
  /** 현업에서 부르는 이름·약칭 */
  term: string;
  /** 뜻 — 검색 결과 안내 */
  meaning: string;
  refIds: readonly string[];
}

export const REF_INTERNAL_GLOSSARY: readonly RefInternalTerm[] = [
  { term: 'SCC', meaning: 'Smart Cruise Control, 스마트 크루즈 컨트롤', refIds: ['AD-LON-002'] },
  { term: '스마트 크루즈', meaning: '스마트 크루즈 컨트롤(SCC) — 적응형 순항 제어', refIds: ['AD-LON-002'] },
  { term: 'HDA', meaning: 'Highway Driving Assist, 고속도로 주행 보조', refIds: ['AD-LAT-011'] },
  { term: 'LKAS', meaning: 'Lane Keeping Assist System, 차로 유지 보조', refIds: ['AD-LAT-002'] },
];

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 검색어(공백·대소문자 무시)에 걸리는 사내 용어가 가리키는 기준 행 */
export function internalGlossaryHits(key: string, table: readonly RefInternalTerm[] = REF_INTERNAL_GLOSSARY): Set<string> {
  const k = norm(key);
  const out = new Set<string>();
  if (k.length < 2) return out; // 한 글자는 거의 모든 뜻에 걸린다
  for (const t of table) if (norm(t.term).includes(k) || k.includes(norm(t.term)) || norm(t.meaning).includes(k)) for (const id of t.refIds) out.add(id);
  return out;
}
