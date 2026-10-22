// 'Twin/트윈' 표기 검사 — Digital Twin 용어 금지(사용자 결정 2026-10-12). lint-copy가 쓴다.
// 경로·식별자(/twin/…, TwinVehicle, twin.tsx)는 화면에 보이지 않으므로 대상이 아니다.

export const TWIN = /디지털\s?트윈|digital\s?twin|트윈|\btwin\b/i;

/** 따옴표·JSX 여는 꺾쇠 뒤의 문자열 안에 있는 Twin 표기 */
const TWIN_IN_STRING = /['"`>][^'"`<]*?(디지털\s?트윈|[Dd]igital\s?[Tt]win|트윈|(?<![/\w])Twin(?![\w/]))/;

/** 여러 줄 JSX 텍스트의 이어지는 줄 — 코드 기호·따옴표·꺾쇠가 없는 순수 문장 줄 */
const JSX_TEXT_LINE = /^[^=;(){}[\]'"`<>]+$/;
const TWIN_WORD = /디지털\s?트윈|[Dd]igital\s?[Tt]win|트윈|(?<![/\w.])Twin(?![\w/])/;

/** 화면에 보이는 줄인가 — 주석은 제외 */
export function twinVisible(line: string): boolean {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
  return TWIN_IN_STRING.test(line) || (JSX_TEXT_LINE.test(t) && TWIN_WORD.test(t));
}
