// 메인 화면 업무 절차 가젯 — 본문(내 업무 흐름 작은 판 + 업무 절차 지도)은 첫 화면 번들 밖에서 지연 로딩한다(성능 예산).
// 가젯 id 'procedures'와 내보내는 이름 ProcedureMapBody(props: summary)는 대시보드(screens/home/dashboard)가 쓰므로 바꾸지 않는다.
import { lazy, Suspense } from 'react';
import type { ProcedureSummary } from '@ff/contracts';

const Panel = lazy(() => import('./ProcedureMapPanel'));

export function ProcedureMapBody({ summary }: { summary: ProcedureSummary | null }) {
  return (
    <Suspense
      fallback={
        <div className="ds-skel" data-state="loading" aria-busy="true">
          <span />
          <span />
        </div>
      }
    >
      <Panel summary={summary} />
    </Suspense>
  );
}
