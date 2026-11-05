// Feature DB 규모 파생 값 (30-95 §5.1 규모 · §9 이전 점검) — 엑셀 v1.3 수식을 그대로 옮긴다. 저장하지 않고 이 규칙으로 계산한다.
//   등급 포인트 T  = INDEX(SIZE_PTS, MATCH(S, SIZE_CLASSES, 0))                 — 05_기준값 A절 (피보나치 한 항씩 건너뜀)
//   명목 포인트 U  = IF(N(O) > 0, O / ANCHOR_EUR / BH, T)                       — O 벤치마크 €, BH 대표 ASIL 계수
//   대표 ASIL 계수 BH = INDEX(ASIL_F, MATCH(L, ASIL_LIST, 0))                    — 05_기준값 B절 (COCOMO II RELY × DOCU)
// ANCHOR_EUR(포인트당 벤치마크 €, 02_프로젝트설정 C23)는 과제 설정값이다 — 벤치마크 €가 있는 행의 U는 이 값에 따라 달라지므로 인자로 받는다(기본 v1.3 값 €10,000).
// BW(신규 개발 기준 공수 = U × MM_PER_PT × BH)는 MM_PER_PT = ANCHOR_EUR ÷ (환산 단가 × 인월당 시간)이 과제 설정값이라 여기서 다루지 않는다(산정 규칙 20-94).
// 개발비 산정 엔진(rules/cost/engine.ts)도 T·BH·U를 이 함수로 계산한다 — 그때는 과제가 고정한 계수 표의 등급 포인트·ASIL 표(SizeTables)를 넘긴다.
// 기본 표(SIZE_POINTS·ASIL_FACTOR)는 계수 표 v1.3과 같다(engine.test.ts가 대조).
// 의존성 없음 — tools(Node 타입 스트리핑)에서도 직접 가져다 쓴다.

export const SIZE_CLASSES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const;
export type TshirtSize = (typeof SIZE_CLASSES)[number];

/** 05_기준값 A절 — 등급 → 포인트 */
export const SIZE_POINTS: Readonly<Record<TshirtSize, number>> = { XS: 1, S: 3, M: 8, L: 21, XL: 55, XXL: 144, XXXL: 377 };

export const REF_ASIL_LIST = ['QM', 'A', 'B', 'C', 'D'] as const;
export type RefAsil = (typeof REF_ASIL_LIST)[number];

/** 05_기준값 B절 — RELY 승수 × DOCU 승수. 엑셀 G열도 같은 곱셈이라 부동소수 값까지 같다(1.1 × 1.11 = 1.2210000000000003). */
export const ASIL_FACTOR: Readonly<Record<RefAsil, number>> = {
  QM: 1 * 1,
  A: 1.1 * 1,
  B: 1.1 * 1.11,
  C: 1.26 * 1.11,
  D: 1.26 * 1.23,
};

/** 02_프로젝트설정 C23 v1.3 값 — 포인트당 벤치마크 비용(€). XS 1포인트 = Kearney Garage door opener €10,000 */
export const DEFAULT_ANCHOR_EUR = 10_000;

/** 계수 표(05_기준값 A·B절)의 등급 포인트·ASIL 승수 — 산정 과제는 고정한 계수 표 버전의 값을 넘긴다 */
export interface SizeTables {
  points: Readonly<Record<string, number>>;
  asil: Readonly<Record<string, { rely: number; docu: number }>>;
}

/** 엑셀 MATCH(…, 0)는 대소문자를 가리지 않는다 */
const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();

const own = <T>(o: Readonly<Record<string, T>>, k: string): T | undefined => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** 등급 포인트 T — 없는 등급이면 null(엑셀 #N/A) */
export function sizePoints(tshirt: string | null | undefined, tables?: SizeTables): number | null {
  const t = norm(tshirt);
  return own<number>(tables ? tables.points : SIZE_POINTS, t) ?? null;
}

/** 대표 ASIL 계수 BH = RELY × DOCU — 없는 ASIL이면 null(엑셀 #N/A) */
export function asilFactor(asil: string | null | undefined, tables?: SizeTables): number | null {
  const a = norm(asil);
  if (!tables) return own<number>(ASIL_FACTOR, a) ?? null;
  const f = own(tables.asil, a);
  return f ? f.rely * f.docu : null;
}

export interface SizeInput {
  tshirt: string | null | undefined;
  asilRep: string | null | undefined;
  /** O열 Kearney 평균 업체 개발비(€) — 비었거나 0 이하이면 등급 포인트를 그대로 쓴다(엑셀 N(O) > 0) */
  benchmarkEur: number | null | undefined;
}

/** 명목 포인트 U — 벤치마크 €가 있으면 € ÷ ANCHOR_EUR ÷ 대표 ASIL 계수(나눗셈 순서도 엑셀과 같게), 없으면 T */
export function nominalPoints(row: SizeInput, anchorEur: number = DEFAULT_ANCHOR_EUR, tables?: SizeTables): number | null {
  const o = typeof row.benchmarkEur === 'number' && Number.isFinite(row.benchmarkEur) ? row.benchmarkEur : 0;
  if (o > 0) {
    const bh = asilFactor(row.asilRep, tables);
    return bh == null ? null : o / anchorEur / bh;
  }
  return sizePoints(row.tshirt, tables);
}
