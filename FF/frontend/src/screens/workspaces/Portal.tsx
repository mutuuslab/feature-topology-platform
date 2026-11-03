// ⑤ 검토 포털(구매·법무·개인정보보호) — 다른 부서가 의견을 구하는 업무(협의 C)를 문서함처럼. 기술 코드 대신 업무 이름과
// 한 줄 설명, 요청 부서를 보인다. 큰 글자(토큰 --fs-base 15px), 단순한 상단 메뉴.
import { Link } from 'react-router-dom';
import type { DepartmentSummary } from '@ff/contracts';
import { departments as D } from '../../copy/departments';
import { AsyncView, PageHeader, Panel } from '../../design';
import { departmentById } from '../../data/departments';
import { activityHref, MyWork, useDeptDoc, type DeptActivity } from './common';

/** 이 활동을 수행하는 부서(첫 번째 R 역할의 부서) */
function askerOf(a: DeptActivity, deptOfRole: (r: string) => string | undefined): string {
  const id = deptOfRole(a.activity.raci.R[0]);
  return (id && departmentById(id)?.name) || '—';
}

export default function PortalHome({ dept }: { dept: DepartmentSummary }) {
  const P = D.portal;
  const d = useDeptDoc(dept);
  const ready = d && d !== 'fail' ? d : null;
  const asks = ready ? ready.acts.filter((a) => a.part === 'C') : [];
  const deptOfRole = (r: string) => ready?.doc.departments.find((x) => x.roles.includes(r))?.id;
  return (
    <div className="ds-screen ws ws--portal" data-workspace-home="portal">
      <PageHeader codes={P.eyebrow} title={P.title(dept.name)} lead={P.lead} message={ready ? { tone: 'neutral', ...P.key(asks.length) } : { tone: 'neutral', value: '—', text: P.key(0).text }} />
      <Panel title={P.ask}>
        <AsyncView state={d === null ? 'loading' : d === 'fail' ? 'error' : asks.length ? 'ready' : 'empty'} empty={{ title: P.askEmpty }} rows={5}>
          <ol className="ws-asks">
            {asks.map((a) => (
              <li key={a.activity.id}>
                <div className="ws-asks__head">
                  <Link to={activityHref(a)} className="ws-asks__name">
                    {a.activity.name}
                  </Link>
                  <span className="ws-asks__asker">
                    {P.asker}: {askerOf(a, deptOfRole)}
                  </span>
                </div>
                <p className="ws-asks__look">
                  <span>{P.look}</span> {a.activity.steps[0] ?? a.process.purpose}
                </p>
                <p className="ws-asks__proc">
                  {P.process}: {a.process.name}
                  {!a.firstScope && <em> · {D.home.secondScope}</em>}
                </p>
              </li>
            ))}
          </ol>
        </AsyncView>
      </Panel>
      <div className="ws-split">
        <Panel title={P.mine}>
          <MyWork d={d} limit={6} />
        </Panel>
        <Panel title={P.docs}>
          <p>
            <Link to={`/procedures/roles?view=dept&dept=${dept.id}`}>{P.rnrDoc}</Link>
          </p>
          <p className="ws-muted">{P.rnrHint}</p>
        </Panel>
      </div>
    </div>
  );
}
