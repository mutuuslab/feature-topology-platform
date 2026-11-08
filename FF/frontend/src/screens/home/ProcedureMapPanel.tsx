// 메인 화면 업무 절차 가젯 본문(지연 로딩) — 위: 내 업무 흐름(작은 판), 아래: 업무 절차 지도.
// 지도는 13개 절차를 생애주기·지원 단계로 늘어놓고 완료·내 차례·Gate를 한눈에 — 이름·Gate·활동 수는 WORKFLOW_MAP, 진행률은 서버 요약만 쓴다.
// 내 업무 흐름은 전체 절차 문서(211 KB)가 필요하다 — 이 모듈은 첫 화면 번들 밖이고(ProcedureMap.tsx가 지연 로딩), 문서도 따로 불러온다.
import { Link } from 'react-router-dom';
import { AsyncView } from '../../design';
import { useWorkflows } from '../../data/workflows';
import { MyWorkFlowCompact } from '../procedures/flow/MyWorkFlow';
import type { ProcedureSummary, WorkflowMapProcess } from '@ff/contracts';
import { procedures as P } from '../../copy/procedures';
import { WORKFLOW_MAP } from '../../data/workflowMap';
import './ProcedureMap.css';

type Group = { name: string; items: WorkflowMapProcess[] };

/** 메인 화면 지도에서는 HARA(FPW.2)를 뺀다 — 사용자 지시 2026-10-19. 전체 절차는 /procedures에 그대로 있다. */
const HOME_EXCLUDED = new Set(['FPW.2']);

function CompactFlow() {
  const doc = useWorkflows();
  if (doc === null) return <AsyncView state="loading" rows={2} />;
  if (doc === 'fail') return <AsyncView state="error" error={P.loadFail} />;
  return <MyWorkFlowCompact doc={doc} />;
}

/** 가젯 본문 — 대시보드 가젯 틀 안에 그대로 넣는다. 머리(제목·전체 보기)는 틀이 그린다 */
export default function ProcedureMapPanel({ summary }: { summary: ProcedureSummary | null }) {
  return (
    <>
      <CompactFlow />
      <ProcedureMapView summary={summary} />
    </>
  );
}

/** 업무 절차 지도 */
function ProcedureMapView({ summary }: { summary: ProcedureSummary | null }) {
  const counts = new Map((Array.isArray(summary?.processes) ? summary.processes : []).map((c) => [c.id, c]));
  const shown = WORKFLOW_MAP.processes.filter((p) => !HOME_EXCLUDED.has(p.id));
  const nextId = shown.find((p) => {
    const c = counts.get(p.id);
    return !!c && c.todo + c.review > 0;
  })?.id;
  const groups: Group[] = [];
  for (const p of shown) {
    const g = groups.find((x) => x.name === p.group) ?? (groups.push({ name: p.group, items: [] }), groups[groups.length - 1]);
    g.items.push(p);
  }
  return (
    <>
      <p className="ds-field__hint pm-hint">{P.map.hint}</p>
      {!summary && <p className="ds-field__hint pm-note">{P.map.noSummary}</p>}
      <div className="pm-map">
        {groups.map((g) => (
          <section key={g.name} className="pm-group" aria-label={g.name}>
            <h3 className="ds-eyebrow">{g.name}</h3>
            <ol className="pm-flow">
              {g.items.map((p) => {
                const c = counts.get(p.id);
                const done = c?.done ?? 0;
                const mine = (c?.todo ?? 0) + (c?.review ?? 0);
                const pct = p.activities ? Math.round((done / p.activities) * 100) : 0;
                const full = done >= p.activities;
                return (
                  <li key={p.id}>
                    <Link
                      to={`/procedures/${p.id}`}
                      className="pm-node"
                      data-mine={mine > 0 ? '' : undefined}
                      data-done={full ? '' : undefined}
                      data-next={p.id === nextId ? '' : undefined}
                      aria-label={`${p.name} — ${P.map.progress(done, p.activities)}${mine ? `, ${P.map.mine(mine)}` : ''}`}
                    >
                      <span className="pm-node__top">
                        <span className="pm-node__gates">
                          {p.gates.map((g) => (
                            <span key={g} className="ds-tag ds-mono">{g}</span>
                          ))}
                        </span>
                      </span>
                      {/* '·' 앞에서 줄이 바뀌어 다음 줄이 '·'로 시작하지 않게 — 앞에 단어 결합 문자(U+2060) */}
                      <span className="pm-node__name">{p.name.replaceAll('·', '\u2060·')}</span>
                      <span className="pm-node__bar" aria-hidden>
                        <span style={{ width: `${pct}%` }} />
                      </span>
                      <span className="pm-node__meta">
                        <span className="ds-mono" title={P.map.progress(done, p.activities)}>{P.map.ratio(done, p.activities)}</span>
                        {mine > 0 && <span className="pm-node__mine">{P.map.mine(mine)}</span>}
                      </span>
                      {p.id === nextId && <span className="pm-node__next">{P.map.next}</span>}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}
