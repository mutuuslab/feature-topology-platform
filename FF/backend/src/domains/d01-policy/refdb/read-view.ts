// Feature DB 응답 모양 — 역할별 열람 범위. 벤치마크 금액·조달 판단 필드는 산정 역할만 본다(20-94 §8).
import { REF_MONEY_FIELDS, type FeatureRefRow, type RefMoneyField, type Role, COST_MONEY_ROLES } from '@ff/contracts';

// 벤치마크 필드 목록은 contracts REF_MONEY_FIELDS 하나 — 금액·Kearney 메모·Make/Buy 물량·프리미엄(엑셀 O·P·V·W 열)

/**
 * 벤치마크 필드를 볼 수 있는 역할.
 * 개발비 산정 역할(20-94 §8, D07-01)도 본다 — 벤치마크 €·Make/Buy는 산정 근거다.
 */
export const BENCHMARK_VIEWERS: readonly Role[] = ['REFDB_ADMIN', ...COST_MONEY_ROLES];
export const canSeeBenchmark = (role: Role) => BENCHMARK_VIEWERS.includes(role);

export type RefView = Omit<FeatureRefRow, RefMoneyField> & Partial<Pick<FeatureRefRow, RefMoneyField>>;

/** 역할에 맞춘 기준 행 — 볼 수 없는 역할에는 벤치마크 필드를 아예 빼고 보낸다(빈 값으로도 두지 않는다) */
export function refView(r: FeatureRefRow, role: Role): RefView {
  if (canSeeBenchmark(role)) return r;
  const out: Record<string, unknown> = { ...r };
  for (const k of REF_MONEY_FIELDS) delete out[k];
  return out as RefView;
}

/** 감사 기록에 남기는 벤치마크 필드 자리 — 감사 이력(GET /api/audit)은 역할 제한이 없으므로 값 대신 '바뀜'만 남긴다 */
export const MONEY_AUDIT_MASK = '(벤치마크 값 — 감사에는 남기지 않음)';

/** 감사용 사본 — 벤치마크 필드에 값이 있으면 값만 자리 표시로 바꾼다(필드가 바뀌었다는 사실은 남는다). 빈 값(null·'')은 숨길 것이 없어 그대로 */
export function maskMoney<T extends Record<string, unknown> | null | undefined>(row: T): T {
  if (!row) return row;
  const out: Record<string, unknown> = { ...row };
  for (const k of REF_MONEY_FIELDS) if (out[k] !== undefined && out[k] !== null && out[k] !== '') out[k] = MONEY_AUDIT_MASK;
  return out as T;
}
