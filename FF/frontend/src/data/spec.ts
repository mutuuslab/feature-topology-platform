// 기능명세서(xlsx → spec.json) 적재 + 헬퍼. 재생성: python scripts/ingest_spec.py "<xlsx>"
import data from './spec.json';

export interface Requirement {
  id: string; family: string; sheet: string; category: string; component: string;
  sub: string; name: string; desc: string; impl: string; area: string; note: string;
}
export interface Component { no: string; category: string; devItem: string; component: string; desc: string; owner: string; }

export const requirements = (data.requirements || []) as Requirement[];
export const components = (data.components || []) as Component[];
export const changeLog = (data.changeLog || []) as { version: string; date: string; desc: string; author: string }[];
export const glossary = (data.glossary || []) as { term: string; def: string }[];

export const families = [...new Set(requirements.map(r => r.family))].filter(Boolean).sort();
export const categories = [...new Set(requirements.map(r => r.category))].filter(Boolean);
export const sheets = [...new Set(requirements.map(r => r.sheet))].filter(Boolean);
export const areas = [...new Set(requirements.flatMap(r => r.area.split('/')).map(s => s.trim()))].filter(Boolean);

export const byFamily = (f: string) => requirements.filter(r => r.family === f);
export const byCategory = (c: string) => requirements.filter(r => r.category === c);
export const familyName = (f: string) => byFamily(f)[0]?.component || f;
export const familyCategory = (f: string) => byFamily(f)[0]?.category || '';

// 카테고리 → 그 카테고리의 family 목록
export function familiesByCategory(): Record<string, string[]> {
  const m: Record<string, Set<string>> = {};
  requirements.forEach(r => { (m[r.category] ||= new Set()).add(r.family); });
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]));
}

export function search(q: string): Requirement[] {
  if (!q) return requirements;
  const s = q.toLowerCase();
  return requirements.filter(r =>
    r.id.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) ||
    r.desc.toLowerCase().includes(s) || r.family.toLowerCase().includes(s));
}

export const counts = {
  requirements: requirements.length, families: families.length,
  components: components.length, glossary: glossary.length, sheets: sheets.length,
};
