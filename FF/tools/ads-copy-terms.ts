// ADS·Orca 상태 용어 규칙(ORC-BE03, 설계 P-9·P-13) — ADS 화면 문구 카탈로그(copy/ads*.ts)는 위반 0건이 하드 규칙.
// '모름'은 판단 불가·미확인 두 낱말만, '사용 준비 완료' 대신 사용 준비 확인, '차단'·'보류'는 단독으로 쓰지 않는다.
export const ADS_COPY_FILE = /[/\\]copy[/\\]ads(-[a-z]+)?\.ts$/;

export const ADS_TERM_RULES: [RegExp, string][] = [
  [/확인 불가|판정 불명|판단 보류|확정 불가/, "'모름'은 두 낱말만 — 판단 불가(차량 판정 UNKNOWN·근거 부족)·미확인(관측 없음·기준 시간 초과·연동 전)"],
  [/사용 준비 완료/, "'사용 준비 확인'(차량 준비 보고 있음)"],
  [/(?<!(?:긴급|종료)\s?)차단/, "'차단' 단독 금지 — 긴급 차단(요청)·종료 차단(재활성화 금지)·종료 차단 해제(행위)"],
  [/(?<!(?:전달|확대|설치|품질|노출)\s?)보류/, "'보류' 단독 금지 — 전달 보류·확대 보류·설치 보류·품질 보류·노출 보류"],
];

/** 한 파일 본문의 위반 — 주석 줄은 뺀다 */
export function adsTermHits(text: string): { line: number; text: string; why: string }[] {
  const out: { line: number; text: string; why: string }[] = [];
  text.split('\n').forEach((raw, i) => {
    const t = raw.trim();
    if (t.startsWith('//') || t.startsWith('*')) return;
    for (const [re, why] of ADS_TERM_RULES) if (re.test(raw)) out.push({ line: i + 1, text: t.slice(0, 80), why });
  });
  return out;
}
