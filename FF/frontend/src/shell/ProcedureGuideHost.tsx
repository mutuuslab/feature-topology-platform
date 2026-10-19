// 셸에 붙는 업무 절차 따라하기 호스트 — 화면 패널이 지정한 활동을 현재 화면의 data-tour 앵커로 강조한다.
// 대상이 있을 때만 가이드와 workflows 데이터(211 KB)를 지연 로딩한다(첫 화면 번들 보호).
import { Suspense, lazy } from 'react';
import { procedures as P } from '../copy/procedures';
import { useWorkflows } from '../data/workflows';
import { procedureGuideStore, useProcedureGuide, type ProcedureGuideTarget } from './procedureGuide';

const ProcedureGuide = lazy(() => import('../screens/procedures/ProcedureGuide').then((m) => ({ default: m.ProcedureGuide })));

export function ProcedureGuideHost() {
  const target = useProcedureGuide();
  if (!target) return null;
  return (
    <Suspense fallback={null}>
      <GuideLoader target={target} />
    </Suspense>
  );
}

function GuideLoader({ target }: { target: ProcedureGuideTarget }) {
  const doc = useWorkflows();
  if (doc === null) return <p className="ds-stale" role="status">{P.loading}</p>;
  if (doc === 'fail') return null;
  const process = doc.processes.find((p) => p.id === target.processId);
  const activity = process?.activities.find((a) => a.id === target.activityId);
  if (!process || !activity) return null;
  return <ProcedureGuide doc={doc} process={process} activity={activity} onClose={() => procedureGuideStore.close()} />;
}
