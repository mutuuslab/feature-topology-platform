// 안전 Kill과 리콜·봉쇄 절차 연계 (보고서 v1.1 7장 · FFG-DEAC-010) — 결함을 완화하는 F2 이상 안전 Kill은 리콜 번호나 봉쇄 결정 근거와 함께 발행하고
// (요청 단계 거부 + 게이트 FFG-PLT-009 판정), 시장별 결함 보고 기한을 명령 기록에 남긴다. 보고서가 기한을 준 시장은 미국(결함 판정 후 5영업일, NHTSA Part 573)뿐이다 —
// 다른 시장은 기한을 비워 두고 법규 담당 확인으로 표시한다. 영업일은 주말만 뺀다(공휴일 달력 없음 — 보수적으로 더 이른 기한이 되지 않는다는 보장은 없다).

export interface RecallReportDue {
  market: string;
  /** 결함 판정 시각 — 없으면 기한 계산 불가 */
  defectDeterminedAt: string | null;
  due: string | null;
  basis: string;
  note: string | null;
}

/** 주말을 뺀 n영업일 뒤(같은 시각) */
export function addBusinessDays(iso: string, n: number): string {
  const d = new Date(iso);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d.toISOString();
}

const DEADLINES: Record<string, { businessDays: number; basis: string }> = {
  US: { businessDays: 5, basis: 'NHTSA 49 CFR Part 573 — 결함 판정 후 5영업일' },
};

/**
 * 안전 Kill 대상 시장별 결함 보고 기한.
 * @rule FFG-DEAC-010 — F2 이상 안전 Kill의 리콜·봉쇄 근거와 시장별 보고 기한(미국 5영업일) 기록
 */
export function recallReportDue(markets: string[], defectDeterminedAt: string | null): RecallReportDue[] {
  return [...new Set(markets)].sort().map((market) => {
    const d = DEADLINES[market];
    if (!d) return { market, defectDeterminedAt, due: null, basis: '보고서에 기한 없음', note: '시장 보고 기한은 법규 담당 확인' };
    if (!defectDeterminedAt) return { market, defectDeterminedAt, due: null, basis: d.basis, note: '결함 판정 시각이 없어 기한을 계산할 수 없음' };
    return { market, defectDeterminedAt, due: addBusinessDays(defectDeterminedAt, d.businessDays), basis: d.basis, note: null };
  });
}
