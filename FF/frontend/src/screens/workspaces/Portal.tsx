// ⑤ SW개발비 및 정보보안(구매·법무·개인정보보호) — 다른 부서가 의견을 구한 실제 협의 건(대상·요청 부서·기한·상태)을 문서함처럼(W5 P5-1·P5-12).
// 건을 누르면 흐름도 대신 '검토할 것 한 장'(/consults/:id)이 열리고, 거기서 동의·보완·반대 의견을 남긴다.
// 업무 절차 코드·Gate·SLA·레인·RACI 글자를 보이지 않는다. 큰 글자(토큰 --fs-base 15px), 단순한 상단 메뉴.
import type { DepartmentSummary } from '@ff/contracts';
import { lazy, Suspense } from 'react';
import { asyncState, useApi } from '../../api/hooks';
import { consult as C } from '../../copy/consult';
import { procurementHome as T } from '../../copy/procurement-home';
import { AsyncView, PageHeader, Panel } from '../../design';
import { ConsultInbox, SentConsults, type ConsultList } from './Consults';
import { workspaceMarker } from './workspaceMarker';

const ProcurementWork = lazy(() => import('./ProcurementWork'));

export default function PortalHome({ dept }: { dept: DepartmentSummary }) {
  const P = C.portal;
  const purchasing = dept.id === 'DEP-PUR';
  const q = useApi<ConsultList>('listConsultations', { query: { to: dept.id } });
  const items = q.data?.items ?? [];
  const open = items.filter((c) => c.status === 'OPEN');
  const done = items.filter((c) => c.status === 'ANSWERED');
  const overdue = q.data?.overdue ?? 0;
  return (
    <div className="ds-screen ws ws--portal" {...workspaceMarker('portal')}>
      <PageHeader
        codes={P.eyebrow}
        title={purchasing ? T.title(dept.name) : P.title(dept.name)}
        lead={purchasing ? T.lead : P.lead}
        message={
          purchasing ? { tone: 'neutral', text: T.message } : !q.data
            ? { tone: 'neutral', value: '—', text: P.key(0).text }
            : open.length
              ? { tone: overdue ? 'warn' : 'neutral', ...P.key(open.length), status: overdue ? { label: P.overdue(overdue), tone: 'warn' } : undefined }
              : { tone: 'neutral', text: P.keyNone }
        }
      />
      {purchasing && <Suspense fallback={<div className="ds-skel" data-state="loading"><span /><span /></div>}><ProcurementWork /></Suspense>}
      <Panel title={P.inbox} id="ws-consult-inbox">
        <AsyncView state={asyncState(q, open.length === 0)} error={q.error} onRetry={() => q.refetch()} emptyHidden rows={5}>
          <ConsultInbox items={open} caption={P.inboxCaption} />
        </AsyncView>
      </Panel>
      {done.length > 0 && (
        <Panel title={P.done} id="ws-consult-done" eyebrow={String(done.length)}>
          <ConsultInbox items={done} caption={P.done} />
        </Panel>
      )}
      <SentConsults deptId={dept.id} />
    </div>
  );
}
