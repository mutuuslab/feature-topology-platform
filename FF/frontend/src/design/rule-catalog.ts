// 보고서 규칙 카탈로그(원문·시험) — 화면은 처음 필요할 때 따로 읽는다(첫 화면 묶음 밖, harness/budgets.json).
// 규칙 제목·원문을 보이는 부품(규칙 점검표·설명 칩·규칙 Drawer·표준 화면)은 useReportCatalog()를 부르고,
// 읽기가 끝나면 다시 그려 제목을 채운다. 그 전에는 규칙 ID만 보인다(reportRule이 undefined).
import { useEffect, useSyncExternalStore } from 'react';
import { installReportCatalog, reportCatalogInstalled } from '@ff/contracts';

let loading: Promise<void> | undefined;
const subs = new Set<() => void>();

/** 카탈로그를 한 번만 읽어 설치한다 — 이미 설치돼 있으면(시험 준비 등) 읽지 않는다 */
export function loadReportCatalog(): Promise<void> {
  if (reportCatalogInstalled()) return Promise.resolve();
  return (loading ??= import('../../../contracts/src/generated/report-catalog').then((m) => {
    installReportCatalog(m.REPORT_RULES, m.REPORT_TESTS);
    for (const f of subs) f();
  }));
}

const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

/** 카탈로그 준비 여부 — 부르면 읽기를 시작하고, 끝나면 이 컴포넌트를 다시 그린다 */
export function useReportCatalog(): boolean {
  const ready = useSyncExternalStore(subscribe, reportCatalogInstalled, reportCatalogInstalled);
  useEffect(() => {
    if (!ready) void loadReportCatalog();
  }, [ready]);
  return ready;
}
