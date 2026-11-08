// 출시 준비(Production Readiness) 규칙 — tools/readiness.ts와 회귀 시험이 이 파일 하나를 기준으로 삼는다.
// 정본: docs/20-architecture/20-90-production-readiness.md · 목록: harness/readiness.json
// 원칙: 빈틈을 목록으로 고정하고, 완료 조건은 자동 검사로, 열린 수는 줄어들기만 한다.
//   · done 항목은 검사가 하나 이상 있고 모두 통과해야 한다(되돌아감 방지)
//   · open 항목의 검사가 모두 통과하면 목록이 실제보다 뒤처진 것이다 — done으로 바꾼다
//   · 시험 표식: 시험 파일 주석에 `readiness: <항목 ID>` (쉼표로 여러 개)

export type Priority = 'P0' | 'P1' | 'P2';

export type Check =
  /** 시험 파일 어딘가에 `readiness: <이 항목 ID>` 표식이 있다 — 그 시험은 verify의 테스트 단계에서 돈다 */
  | { kind: 'marker' }
  /** 파일(FF 기준 상대 경로)이 있고 정규식에 맞는다 */
  | { kind: 'match'; path: string; pattern: string }
  /** 파일이 없거나, 있으면 정규식에 맞는 곳이 없다 */
  | { kind: 'absent'; path: string; pattern: string }
  /** 파일이 있다 */
  | { kind: 'exists'; path: string };

export interface Item {
  id: string;
  priority: Priority;
  area: string;
  phase: 'R1' | 'R2' | 'R3';
  title: string;
  evidence: string[];
  criteria: string;
  status: 'open' | 'done';
  checks: Check[];
  decision?: string;
}

export interface Catalog {
  note: string;
  items: Item[];
}

const ID = /^RD-[A-Z0-9]+-\d{2}$/;

export function validateCatalog(c: Catalog): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of c.items) {
    const at = it.id ?? '(ID 없음)';
    if (!ID.test(it.id ?? '')) out.push(`${at}: ID 형식은 RD-<영역>-<두 자리>`);
    if (seen.has(it.id)) out.push(`${at}: ID 중복`);
    seen.add(it.id);
    if (!['P0', 'P1', 'P2'].includes(it.priority)) out.push(`${at}: 우선순위는 P0|P1|P2`);
    if (!['R1', 'R2', 'R3'].includes(it.phase)) out.push(`${at}: 단계는 R1|R2|R3`);
    if (!['open', 'done'].includes(it.status)) out.push(`${at}: 상태는 open|done`);
    if (!it.title?.trim() || !it.criteria?.trim()) out.push(`${at}: 제목·완료 조건이 비었다`);
    if (!it.evidence?.length) out.push(`${at}: 근거(파일:줄)가 없다`);
    if (!it.checks?.length) out.push(`${at}: 완료 조건 검사가 없다 — 검사로 확인할 수 없는 항목은 목록에 넣지 않는다`);
    for (const ch of it.checks ?? []) {
      if (ch.kind !== 'marker') {
        if (!ch.path) out.push(`${at}: ${ch.kind} 검사에 path가 없다`);
        if ((ch.kind === 'match' || ch.kind === 'absent') && !isRegex(ch.pattern)) out.push(`${at}: 잘못된 정규식 ${ch.pattern}`);
      }
    }
  }
  return out;
}

function isRegex(p: string | undefined): boolean {
  if (!p) return false;
  try {
    new RegExp(p, 'm');
    return true;
  } catch {
    return false;
  }
}

/** 시험 파일 본문에서 readiness 표식 ID들 */
export function scanMarkers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\breadiness:\s*(RD-[A-Z0-9]+-\d{2}(?:\s*,\s*RD-[A-Z0-9]+-\d{2})*)/g)) {
    for (const id of m[1].split(',')) out.push(id.trim());
  }
  return out;
}

export interface Ctx {
  /** FF 기준 상대 경로의 파일 내용, 없으면 null */
  read(path: string): string | null;
  /** 항목 ID → 표식이 있는 시험 파일들 */
  markers: Map<string, string[]>;
}

export interface Result {
  id: string;
  pass: boolean;
  why: string[];
}

export function evaluate(it: Item, ctx: Ctx): Result {
  const why: string[] = [];
  for (const ch of it.checks) {
    if (ch.kind === 'marker') {
      if (!ctx.markers.get(it.id)?.length) why.push(`시험 표식 'readiness: ${it.id}' 없음`);
      continue;
    }
    const text = ctx.read(ch.path);
    if (ch.kind === 'exists') {
      if (text == null) why.push(`${ch.path} 없음`);
    } else if (ch.kind === 'match') {
      if (text == null) why.push(`${ch.path} 없음`);
      else if (!new RegExp(ch.pattern, 'm').test(text)) why.push(`${ch.path}에 /${ch.pattern}/ 없음`);
    } else if (text != null && new RegExp(ch.pattern, 'm').test(text)) why.push(`${ch.path}에 /${ch.pattern}/ 남음`);
  }
  return { id: it.id, pass: why.length === 0, why };
}

export interface Verdict {
  /** done인데 검사 실패 — verify 실패 */
  regressed: Result[];
  /** open인데 검사 통과 — 목록이 뒤처짐, verify 실패 */
  stale: Result[];
  open: Record<Priority, number>;
}

export function judge(c: Catalog, ctx: Ctx): Verdict {
  const v: Verdict = { regressed: [], stale: [], open: { P0: 0, P1: 0, P2: 0 } };
  for (const it of c.items) {
    const r = evaluate(it, ctx);
    if (it.status === 'done' && !r.pass) v.regressed.push(r);
    if (it.status === 'open') {
      v.open[it.priority]++;
      if (r.pass) v.stale.push(r);
    }
  }
  return v;
}
