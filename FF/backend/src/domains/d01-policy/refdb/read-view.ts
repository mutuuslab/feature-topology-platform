// Feature DB 응답 모양 — 역할별 열람 범위. 벤치마크 금액·조달 판단 필드는 산정 역할만 본다(20-94 §8).
import { REF_MONEY_FIELDS, type FeatureRefRow, type RefMoneyField, type Role } from '@ff/contracts';

// 벤치마크 필드 목록은 contracts REF_MONEY_FIELDS 하나 — 금액·Kearney 메모·Make/Buy 물량·프리미엄(엑셀 O·P·V·W 열)

/**
 * 벤치마크 필드를 볼 수 있는 역할.
 * TODO(20-94 §8): 개발비 산정 역할(산정 담당·산정 승인)이 생기면 그 역할을 더한다. 지금은 Feature DB 관리자만.
 */
export const BENCHMARK_VIEWERS: readonly Role[] = ['REFDB_ADMIN'];
export const canSeeBenchmark = (role: Role) => BENCHMARK_VIEWERS.includes(role);

export type RefView = Omit<FeatureRefRow, RefMoneyField> & Partial<Pick<FeatureRefRow, RefMoneyField>>;

/** 역할에 맞춘 기준 행 — 볼 수 없는 역할에는 벤치마크 필드를 아예 빼고 보낸다(빈 값으로도 두지 않는다) */
export function refView(r: FeatureRefRow, role: Role): RefView {
  if (canSeeBenchmark(role)) return r;
  const out: Record<string, unknown> = { ...r };
  for (const k of REF_MONEY_FIELDS) delete out[k];
  return out as RefView;
}
