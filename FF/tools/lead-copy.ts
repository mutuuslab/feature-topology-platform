// 설명문(lead) 규칙 — three-second.spec ⑤(머리 설명 한 줄 70자 이하, 코드·보고서 절 번호 없음)를
// 브라우저 없이 문구 카탈로그(frontend/src/copy/*.ts)에서 먼저 잡는다(BACKLOG UX3-14).
// e2e는 실제 화면 머리 설명만 보고, 여기서는 카탈로그의 모든 lead 키를 본다(패널 설명 포함 → 래칫).

export const LEAD_MAX = 70;
/** three-second.spec.ts의 CODE와 같은 식 */
export const LEAD_CODE = /FFG-[A-Z]+-\d|\bIF-\d|\bD0\d-\d|보고서 \d|§\d/;

const LEAD = /^\s*lead:\s*(['"`])((?:\\.|(?!\1).)*)\1/;

export interface LeadHit {
  line: number;
  why: 'long' | 'code';
  text: string;
}

export function leadHits(source: string): LeadHit[] {
  const out: LeadHit[] = [];
  source.split('\n').forEach((line, i) => {
    const m = line.match(LEAD);
    if (!m) return;
    const text = m[2];
    if (LEAD_CODE.test(text)) out.push({ line: i + 1, why: 'code', text });
    else if ([...text].length > LEAD_MAX) out.push({ line: i + 1, why: 'long', text });
  });
  return out;
}
