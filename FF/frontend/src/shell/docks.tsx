// 셸의 표준 따라하기 패널·규칙 Drawer 자리 — 둘 다 보고서 카탈로그(규칙 원문·시험)를 쓰므로 처음 필요할 때 읽는다.
// 따라하기가 시작됐을 때, 규칙 칩을 처음 눌렀을 때만 본체(GuideDock.tsx)를 불러 첫 화면 묶음에서 카탈로그를 뺀다(harness/budgets.json).
import { lazy, Suspense, useEffect, useState } from 'react';
import { RULE_EVENT } from '../design';
import { DEMO_EXTRAS } from '../auth-mode';
import { useLearn } from './learn';

// 운영 빌드는 따라하기 패널을 싣지 않는다(D-RD-8) — 규칙 Drawer만 남는다
const GuideDock = DEMO_EXTRAS ? lazy(() => import('./GuideDock').then((m) => ({ default: m.GuideDock }))) : null;
const RuleDrawer = lazy(() => import('./GuideDock').then((m) => ({ default: m.RuleDrawer })));

/** 따라하기 중일 때만 패널을 불러 그린다 */
export function GuideDockHost() {
  const st = useLearn();
  return GuideDock && st ? (
    <Suspense fallback={null}>
      <GuideDock />
    </Suspense>
  ) : null;
}

/** 첫 규칙 열기 요청을 받아 Drawer를 불러온다 — 그 뒤의 요청은 Drawer가 직접 받는다 */
export function RuleDrawerHost() {
  const [first, setFirst] = useState<string | null>(null);
  useEffect(() => {
    if (first) return;
    const on = (e: Event) => setFirst((e as CustomEvent<string>).detail);
    window.addEventListener(RULE_EVENT, on);
    return () => window.removeEventListener(RULE_EVENT, on);
  }, [first]);
  return first ? (
    <Suspense fallback={null}>
      <RuleDrawer initialId={first} />
    </Suspense>
  ) : null;
}
