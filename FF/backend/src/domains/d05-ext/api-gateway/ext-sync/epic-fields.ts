// JIRA Epic 사용자 필드(80-50 §4.2) — FF 키 ↔ JIRA 필드 ID 변환. 표는 contracts EPIC_FIELDS, ID는 JIRA_FIELDS(JSON) > 옛 JIRA_FIELD_* > 모의 기본값.
// 프로세스 내 모의·live 어댑터·webhook 정규화가 같은 변환을 쓴다(어댑터를 import하지 않는다 — 순환 방지).
import { CHILD_FIELDS, EPIC_FIELDS, JIRA_FIELD, parseJiraFields, type EpicFieldKey, type EpicFieldRule, type JiraFieldKey } from '@ff/contracts';

const live = () => process.env.IF_MODE_14 === 'live';

/** 지금 설정의 필드 ID(설정 오류는 시작 검사가 막으므로 여기서는 빈 표) */
export function epicFieldIds(): Partial<Record<JiraFieldKey, string>> {
  const r = parseJiraFields((k) => process.env[k], live());
  return 'ids' in r ? r.ids : {};
}

/** FF 값 → JIRA 필드 본문(선택 목록은 { value }, 목록은 문자열 배열). 값이 null이면 비운다 */
export function encodeEpicFields(values: Partial<Record<JiraFieldKey, unknown>>): Record<string, unknown> {
  const ids = epicFieldIds();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values) as [JiraFieldKey, unknown][]) {
    const id = ids[k];
    if (!id || v === undefined || !JIRA_FIELD[k]) continue;
    const schema = JIRA_FIELD[k].schema;
    out[id] = v == null || v === '' ? null : schema === 'option' ? { value: String(v) } : schema === 'array' ? (Array.isArray(v) ? v.map(String) : String(v).split(/[\s,;]+/).filter(Boolean)) : String(v);
  }
  return out;
}

/** JIRA 이슈 필드 → FF 값(실린 필드만). 선택 목록 { value }·{ name }, 목록은 문자열 배열로 */
export function decodeEpicFields(fields: Record<string, unknown>): Partial<Record<EpicFieldKey, string | string[] | null>> {
  return decodeFields(fields, EPIC_FIELDS) as Partial<Record<EpicFieldKey, string | string[] | null>>;
}
/** Story·Task·Bug의 FF 칸(기능 ID·산출물 종류·운영 인시던트) — 값이 있는 것만 */
export function decodeChildFields(fields: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(decodeFields(fields, CHILD_FIELDS)).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1]));
}
function decodeFields(fields: Record<string, unknown>, rules: readonly EpicFieldRule[]): Partial<Record<JiraFieldKey, string | string[] | null>> {
  const ids = epicFieldIds();
  const out: Partial<Record<JiraFieldKey, string | string[] | null>> = {};
  for (const f of rules) {
    const id = ids[f.key];
    if (!id || !(id in fields)) continue;
    const raw = fields[id];
    const one = (x: unknown): string | null => (typeof x === 'string' ? x : x && typeof x === 'object' ? (((x as Record<string, unknown>).value ?? (x as Record<string, unknown>).name) as string | undefined) ?? null : x == null ? null : String(x));
    if (f.schema === 'array') {
      const items = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
      const list = items.flatMap((x) => (one(x) ?? '').split(/[\s,;]+/)).map((s) => s.trim()).filter(Boolean);
      out[f.key] = list.length ? list : null;
    } else out[f.key] = one(raw);
  }
  return out;
}

/** JIRA Cloud v3 본문(ADF) → 글자(문단은 빈 줄). v2·webhook의 글자는 그대로 */
export function adfText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!v || typeof v !== 'object') return '';
  const node = v as { type?: string; text?: string; content?: unknown[] };
  if (node.type === 'text') return node.text ?? '';
  const parts = (node.content ?? []).map(adfText);
  return node.type === 'doc' ? parts.join('\n\n') : parts.join('');
}

/** 이슈 조회 때 함께 받을 필드 ID 목록 */
export const epicFieldIdList = (): string[] => Object.values(epicFieldIds()).filter((x): x is string => !!x);
