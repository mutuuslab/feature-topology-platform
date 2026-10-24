// 절차서 본문 — 엔지니어링 절차서의 프로세스 절 모양을 FF 모델 필드로 그린다:
//   요약 문장(입력 → 활동 N개 → 주 산출물) · 결과·진입·완료 기준 상자 · 활동 카드(RACI 배지·입력/출력·수행 절차·완료 기준·규칙) · 산출물 카드(주요 내용·만드는/쓰는 활동).
// 모델에 없는 절차서 항목(BP·PAM 근거·EA 위치·체크리스트)은 그리지 않는다. 활동 카드의 상태는 흐름도와 같은 서버 상태다.
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { RaciKey, WorkflowActivity, WorkflowDoc, WorkflowProcess } from '@ff/contracts';
import { procedureFlow as F } from '../../../copy/procedureFlow';
import { roleNameOf, StateIcon, stateText, TriggerBolt } from './FlowParts';
import { processFlow, wpInfoOf } from './model';
import type { ActivityStatus } from './status';

type Props = {
  doc: WorkflowDoc;
  process: WorkflowProcess;
  statuses: Map<string, ActivityStatus>;
  selected: string | null;
  onSelect: (activityId: string) => void;
};

const RACI: RaciKey[] = ['R', 'A', 'C', 'I'];

/** 요약 문장 — 밖에서 오는 입력, 활동 수, 절차 밖으로 나가는 주 산출물 */
export function ProcessLead({ doc, process: p }: { doc: WorkflowDoc; process: WorkflowProcess }) {
  const { graph } = processFlow(p, doc);
  const info = wpInfoOf(doc);
  const name = (k: string) => info(k)?.name ?? k;
  const ins = graph.nodes.filter((n) => n.kind === 'doc' && n.external).map((n) => n.wp!);
  const outs = [...new Set(p.activities.flatMap((a) => a.outputs))];
  const leaving = graph.edges.filter((e) => e.kind === 'end').flatMap((e) => e.wps);
  const main = leaving[leaving.length - 1] ?? outs[outs.length - 1];
  const inText = ins.length ? `${ins.slice(0, 2).map(name).join(', ')}${ins.length > 2 ? ` ${F.card.leadMore(ins.length - 2)}` : ''}` : F.card.leadNoInput;
  return (
    <p className="pf-lead" aria-label={F.card.leadLabel}>
      {inText} <b aria-hidden>→</b> {F.card.lead(p.activities.length)} <b aria-hidden>→</b>{' '}
      <strong>
        {main ? name(main) : F.card.none}
        {outs.length > 1 ? ` ${F.card.leadMore(outs.length - 1)}` : ''}
      </strong>
    </p>
  );
}

/** 결과·진입·완료 기준 */
export function ProcessCriteria({ process: p }: { process: WorkflowProcess }) {
  return (
    <div className="pf-crit">
      <div>
        <h4>{F.card.outcomes}</h4>
        <ul>
          {p.outcomes.map((o) => (
            <li key={o.id}>
              <span className="pf-tag">{o.id}</span> {o.text}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4>{F.card.entry}</h4>
        <ul>{p.entry.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </div>
      <div>
        <h4>{F.card.exit}</h4>
        <ul>{p.exit.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </div>
    </div>
  );
}

/** 활동 ID 목록 — 이 절차 활동은 고르기 단추, 다른 절차는 그 절차로 가는 링크 */
function Refs({ ids }: { ids: ReactNode[] }) {
  return (
    <>
      {ids.map((x, i) => (
        <Fragment key={i}>
          {i > 0 && ', '}
          {x}
        </Fragment>
      ))}
    </>
  );
}
const pickBtn = (id: string, onPick: (id: string) => void) => (
  <button key={id} type="button" className="pf-linkbtn pf-refbtn" onClick={() => onPick(id)}>
    {id}
  </button>
);
const procLink = (id: string) => (
  <Link key={id} to={`/procedures/${id}`} className="pf-refbtn">
    {id}
  </Link>
);

function ActivityCard({ doc, process: p, a, st, selected, onSelect, onPick }: { doc: WorkflowDoc; process: WorkflowProcess; a: WorkflowActivity; st: ActivityStatus | undefined; selected: boolean; onSelect: () => void; onPick: (id: string) => void }) {
  const info = wpInfoOf(doc);
  const producerIn = (k: string) => p.activities.find((b) => b.id !== a.id && b.outputs.includes(k))?.id ?? null;
  const from = (k: string): ReactNode => {
    const local = producerIn(k);
    if (local) return pickBtn(local, onPick);
    const owner = info(k)?.process;
    return owner ? procLink(owner) : F.card.outside;
  };
  const users = (k: string) => p.activities.filter((b) => b.id !== a.id && b.inputs.includes(k)).map((b) => b.id);
  const raci = (k: RaciKey) => (k === 'A' ? [a.raci.A] : a.raci[k]).filter(Boolean);
  const outcome = (id: string) => p.outcomes.find((o) => o.id === id)?.text ?? id;
  return (
    <article className="pf-card" data-activity-card={a.id} data-selected={selected ? '' : undefined} data-state={st?.state ?? 'waiting'}>
      <div className="pf-card__head">
        <span className="pf-card__id">{a.id}</span>
        <h3 className="pf-card__title">{a.name}</h3>
        <span className="pf-card__state">
          <svg width={14} height={14} viewBox="-1 -1 14 14" aria-hidden>
            <StateIcon state={st?.state ?? 'waiting'} x={0} y={0} />
          </svg>
          {stateText(st)}
        </span>
        <span className="pf-card__chips">
          {a.trigger && (
            <span className="pf-card__trigger">
              <svg width={12} height={14} viewBox="-6 -7 12 14" aria-hidden>
                <TriggerBolt x={0} y={0} />
              </svg>
              {F.card.trigger(a.trigger)}
            </span>
          )}
          {a.gateDecision && <span className="pf-tag">{F.card.gate(a.gateDecision)}</span>}
          {a.outcomes.map((o) => (
            <span key={o} className="pf-tag" title={outcome(o)}>{o}</span>
          ))}
          {a.slaHours ? <span className="pf-tag">{F.card.sla(a.slaHours)}</span> : null}
        </span>
      </div>
      <div className="pf-raci-row">
        {RACI.filter((k) => raci(k).length).map((k) => (
          <span key={k} aria-label={F.card.raciLabel(F.card.raci[k], raci(k).map((r) => roleNameOf(doc, r)).join(', '))}>
            <b className="pf-raci-badge" data-k={k} aria-hidden>{k}</b>
            {raci(k).map((r) => roleNameOf(doc, r)).join(', ')}
          </span>
        ))}
      </div>
      <div className="pf-io">
        <div>
          <h4>{F.card.inputs}</h4>
          {a.inputs.length ? (
            <ul>
              {a.inputs.map((k) => (
                <li key={k}>
                  {info(k)?.name ?? k} <span className="pf-io__ext">{from(k)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ds-field__hint">{F.card.none}</p>
          )}
        </div>
        <div>
          <h4>{F.card.outputs}</h4>
          {a.outputs.length ? (
            <ul>
              {a.outputs.map((k) => (
                <li key={k}>
                  {info(k)?.name ?? k} <span className="pf-io__ext">{users(k).length ? <Refs ids={users(k).map((id) => pickBtn(id, onPick))} /> : F.card.usedElsewhere}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ds-field__hint">{F.card.none}</p>
          )}
        </div>
      </div>
      <div className="pf-two">
        <div>
          <h4>{F.card.steps}</h4>
          <ol>{a.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
        <div>
          <h4>{F.card.checks}</h4>
          <ul className="pf-checks">{a.checks.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      </div>
      <div className="pf-card__foot">
        {/* 규칙 ID는 설명 모드에서만(본문에 규칙 코드를 두지 않는다 — 3초 테스트 ⑨) */}
        {a.rules.length > 0 && (
          <span className="ds-explain">
            <span className="pf-card__en">{F.card.rules}</span>
            {a.rules.map((r) => (
              <span key={r} className="pf-rule">{r}</span>
            ))}
          </span>
        )}
        <span className="pf-card__chips">
          <button type="button" className="pf-linkbtn" aria-pressed={selected} onClick={onSelect}>
            {selected ? F.card.opened : F.card.open}
          </button>
        </span>
      </div>
    </article>
  );
}

export function ActivityCards({ doc, process: p, statuses, selected, onSelect }: Props) {
  return (
    <div className="pf-cards">
      {p.activities.map((a) => (
        <ActivityCard key={a.id} doc={doc} process={p} a={a} st={statuses.get(a.id)} selected={selected === a.id} onSelect={() => onSelect(a.id)} onPick={onSelect} />
      ))}
    </div>
  );
}

export function WorkProductCards({ doc, process: p, onSelect }: { doc: WorkflowDoc; process: WorkflowProcess; onSelect: (id: string) => void }) {
  const elsewhere = (k: string) => doc.processes.filter((q) => q.id !== p.id && q.activities.some((a) => a.inputs.includes(k))).map((q) => q.id);
  return (
    <div className="pf-cards">
      {p.workProducts.map((w) => {
        const made = p.activities.filter((a) => a.outputs.includes(w.key)).map((a) => a.id);
        const used = p.activities.filter((a) => a.inputs.includes(w.key)).map((a) => a.id);
        const other = elsewhere(w.key);
        return (
          <article key={w.key} className="pf-card pf-wp-card" data-wp-card={w.key}>
            <div className="pf-card__head">
              <span className="pf-tag">{w.key}</span>
              <h3 className="pf-card__title">{w.name}</h3>
              <span className="pf-card__en">{w.en}</span>
              <span className="pf-tag" data-kind="gold">{F.card.wpKind[w.kind] ?? w.kind}</span>
              {w.retained && <span className="pf-tag" data-kind="gold">{F.card.retained}</span>}
            </div>
            <div className="pf-two">
              <div>
                <h4>{F.card.content}</h4>
                <ul>{w.content.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
              <dl className="pf-wp-refs">
                <dt>{F.card.producedBy}</dt>
                <dd>{made.length ? <Refs ids={made.map((id) => pickBtn(id, onSelect))} /> : F.card.outside}</dd>
                <dt>{F.card.usedBy}</dt>
                <dd>
                  {used.length || other.length ? (
                    <Refs ids={[...used.map((id) => pickBtn(id, onSelect)), ...other.map(procLink)]} />
                  ) : (
                    F.card.notUsed
                  )}
                </dd>
              </dl>
            </div>
          </article>
        );
      })}
    </div>
  );
}
