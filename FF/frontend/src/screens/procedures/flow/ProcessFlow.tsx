// 절차 흐름도 — 엔지니어링 절차서 표기: 맨 위 '입력' 레인(밖에서 오는 산출물 문서) · 역할 레인(활동, 레인 = 수행 R 역할) · 맨 아래 '산출물' 레인(만든 문서).
// 제어 흐름 = 짙은 남색 실선(시작 점 → 활동 → Gate 마름모 → 다음 활동 → 종료 과녁), 객체 흐름 = 금색 점선(문서 ↔ 활동, 상자 위아래 변).
// 상자마다 서버 상태(완료·내 차례·진행 가능·앞 활동 대기·기한 초과)를 색·아이콘·글자로 얹는다. 활동을 누르면 활동 상세가 열린다.
// 같은 내용을 텍스트(표)로도 볼 수 있다 — 화면 낭독기·인쇄용. 넓은 흐름도는 레인 머리를 왼쪽에 고정한 채 가로로 스크롤한다.
import { type CSSProperties, type KeyboardEvent, useId, useState } from 'react';
import type { WorkflowDoc, WorkflowProcess } from '@ff/contracts';
import { workflowLabels } from '../../../data/workflowLabels';
import { procedureFlow as F } from '../../../copy/procedureFlow';
import { Segmented } from '../../../design';
import { ArrowDefs, DocShape, FlowLegend, laneTitle, roleNameOf, StateIcon, stateText, TriggerBolt, useWidth } from './FlowParts';
import { IN_LANE, isObjectFlow, OUT_LANE, processFlow, readingOrder, type ProcessGraph, type ProcessLayout } from './model';
import type { ActivityStatus } from './status';
import { ellipsize, wrapText } from './svgText';

const NAME_FS = 12;

type Props = {
  doc: WorkflowDoc;
  process: WorkflowProcess;
  statuses: Map<string, ActivityStatus>;
  selected: string | null;
  onSelect: (activityId: string) => void;
  fit?: boolean;
  /** 강조할 레인(조직 역할) — ?role= 담당자 */
  focusRoles?: readonly string[];
};

const keyActivate = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

/** 레인 머리(왼쪽 열) — 흐름도 안과 가로 스크롤 때 왼쪽에 고정되는 겹침 그림이 같이 쓴다 */
function LaneHeads({ doc, layout, focus }: { doc: WorkflowDoc; layout: ProcessLayout; focus: readonly string[] }) {
  return (
    <>
      {layout.lanes.map((ln) => {
        const io = ln.id === IN_LANE || ln.id === OUT_LANE;
        const lines = wrapText(laneTitle(doc, ln.id), layout.laneLabelW - 20, 12, 3);
        const on = focus.includes(ln.id);
        return (
          <g key={ln.id} className="pf-lanehead" data-io={io ? '' : undefined} data-focus={on ? '' : undefined}>
            <rect className="pf-lanehead__box" x={0} y={ln.y} width={layout.laneLabelW} height={ln.h} />
            {on && <rect className="pf-lane__mark" x={0} y={ln.y} width={4} height={ln.h} />}
            {lines.map((t, j) => (
              <text key={j} className="pf-lanehead__text" x={layout.laneLabelW / 2} y={ln.y + ln.h / 2 - (lines.length - 1) * 8 + j * 16 + 4} textAnchor="middle">
                {t}
              </text>
            ))}
          </g>
        );
      })}
    </>
  );
}

function Lanes({ layout, focus }: { layout: ProcessLayout; focus: readonly string[] }) {
  return (
    <>
      {layout.lanes.map((ln) => {
        const io = ln.id === IN_LANE || ln.id === OUT_LANE;
        const on = focus.includes(ln.id);
        return (
          <g key={ln.id} data-lane={ln.id} data-focus={on ? '' : undefined}>
            <rect className={`pf-lane pf-lane--${on ? 'focus' : io ? 'io' : 'role'}`} data-focus={on ? '' : undefined} x={layout.laneLabelW} y={ln.y} width={layout.width - layout.laneLabelW} height={ln.h} />
            {ln.index > 0 && <line className="pf-lane__sep" x1={0} y1={ln.y} x2={layout.width} y2={ln.y} />}
          </g>
        );
      })}
    </>
  );
}

/** 문서의 출처는 절차·활동 이름으로 읽고, 이 절차의 문서는 종류를 표시한다. */
export const docTag = (doc: WorkflowDoc, n: ProcessGraph['nodes'][number]) =>
  n.ref ? F.doc.ref(workflowLabels(doc).activity(n.owner!)) : n.external ? (n.owner ? F.doc.from(workflowLabels(doc).process(n.owner)) : F.doc.outside) : n.retained ? F.doc.retained : F.doc.produced;

export function ProcessFlowDiagram({ doc, process: p, statuses, selected, onSelect, fit, focusRoles = [] }: Props) {
  const { layout } = processFlow(p, doc);
  const uid = `${p.id.replace('.', '-')}-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const act = new Map(p.activities.map((a) => [a.id, a]));
  const wpName = (k: string) => p.workProducts.find((w) => w.key === k)?.name ?? doc.processes.flatMap((x) => x.workProducts).find((w) => w.key === k)?.name ?? k;
  const at = new Map(layout.nodes.map((n) => [n.id, n]));
  const order = readingOrder(layout);
  const onObject = new Set(layout.edges.filter((e) => isObjectFlow(e.kind)).flatMap((e) => e.points.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`)));
  return (
    <svg
      className="pf-svg"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={fit ? '100%' : layout.width}
      height={fit ? undefined : layout.height}
      // 축소 보기 = 화면 폭에 맞춘다(전체 모양 보기). 글자가 작아지면 실제 크기로 돌아가 읽는다
      style={fit ? { maxWidth: layout.width } : undefined}
      preserveAspectRatio="xMinYMin meet"
      role="group"
      aria-label={F.process.title(p.name)}
      data-flow={p.id}
    >
      <ArrowDefs id={uid} />
      <Lanes layout={layout} focus={focusRoles} />
      <LaneHeads doc={doc} layout={layout} focus={focusRoles} />
      <g aria-hidden>
        {layout.edges.map((e) => {
          const object = isObjectFlow(e.kind);
          return (
            <polyline
              key={e.id}
              className={`pf-edge ${object ? 'pf-of' : 'pf-cf'}${e.back ? ' pf-edge--back' : ''}`}
              points={e.points.map((q) => q.join(',')).join(' ')}
              markerEnd={`url(#${uid}-${object ? 'of' : 'cf'})`}
              data-edge={e.id}
              data-kind={e.kind}
            />
          );
        })}
        {layout.bars.map((b, i) => (
          <line key={`b${i}`} className="pf-bar" x1={b.x} y1={b.y1} x2={b.x} y2={b.y2} />
        ))}
        {layout.joins.map(([x, y], i) => (
          <circle key={i} className={onObject.has(`${Math.round(x)},${Math.round(y)}`) ? 'pf-join pf-join--of' : 'pf-join'} cx={x} cy={y} r={3} />
        ))}
      </g>
      {order.map((id) => {
        const n = at.get(id)!;
        const cx = n.x + n.w / 2;
        const cy = n.y + n.h / 2;
        if (n.kind === 'doc') {
          const name = wpName(n.wp!);
          const lines = wrapText(name, n.w - 16, NAME_FS, 2);
          const tag = docTag(doc, n);
          return (
            <g key={id} className="pf-doc" data-external={n.external ? '' : undefined} data-ref={n.ref ? '' : undefined} data-retained={n.retained ? '' : undefined} data-wp={n.wp} role="img" aria-label={F.doc.label(name, tag, n.external)}>
              <title>{`${name}\n${tag}`}</title>
              <DocShape x={n.x} y={n.y} w={n.w} h={n.h} />
              <text className="pf-doc__tag" x={n.x + 8} y={n.y + 14}>{ellipsize(tag, n.w - 26, 10)}</text>
              {lines.map((t, j) => (
                <text key={j} className="pf-doc__name" x={cx} y={n.y + 36 + j * 15 - (lines.length - 1) * 5} textAnchor="middle">{t}</text>
              ))}
            </g>
          );
        }
        if (n.kind === 'start' || n.kind === 'end' || n.kind === 'event') {
          const a = n.activityId ? act.get(n.activityId) : null;
          // 사건 없이 따로 시작하는 활동 = 앞 활동 산출물이 준비되면 시작(준비 시작, 남색 점)
          const ready = n.kind === 'event' && !a?.trigger;
          const label = n.kind === 'start' ? F.node.startLabel(p.entry.length) : n.kind === 'end' ? F.node.endLabel(p.exit.length) : ready ? F.node.readyLabel : F.node.eventLabel(a?.trigger ?? '');
          return (
            <g key={id} className={`pf-term pf-term--${ready ? 'start' : n.kind}`} data-ready={ready ? '' : undefined} role="img" aria-label={label}>
              <title>{n.kind === 'start' ? p.entry.join('\n') : n.kind === 'end' ? p.exit.join('\n') : ready ? F.node.readyLabel : a?.trigger ?? ''}</title>
              <circle cx={cx} cy={cy} r={n.w / 2} />
              {n.kind === 'end' && <circle className="pf-term__inner" cx={cx} cy={cy} r={n.w / 2 - 6} />}
              {n.kind === 'event' && !ready && <TriggerBolt x={cx} y={cy} />}
            </g>
          );
        }
        const a = act.get(n.activityId!)!;
        const st = statuses.get(a.id);
        const state = st?.state ?? 'waiting';
        const txt = stateText(st);
        const open = () => onSelect(a.id);
        const common = {
          role: 'button',
          tabIndex: 0,
          'aria-pressed': selected === a.id,
          className: `pf-node pf-node--${n.kind}`,
          'data-state': state,
          'data-mine': st?.mine ? '' : undefined,
          'data-selected': selected === a.id ? '' : undefined,
          onClick: open,
          onKeyDown: keyActivate(open),
        } as const;
        if (n.kind === 'gate') {
          return (
            <g key={id} {...common} aria-label={F.node.gateLabel(n.gate!, a.name, txt)} data-activity={a.id} data-gate={n.gate}>
              <path d={`M${cx} ${n.y} L${n.x + n.w} ${cy} L${cx} ${n.y + n.h} L${n.x} ${cy} Z`} />
              <text className="pf-gate__id" x={cx} y={cy + 1} textAnchor="middle">{n.gate}</text>
              <StateIcon state={state} x={cx - 6} y={cy + 5} />
            </g>
          );
        }
        const lines = wrapText(a.name, n.w - 16, NAME_FS, 2);
        const roleLabel = roleNameOf(doc, a.raci.R[0]);
        const dueAt = st?.dueAt && st.state === 'overdue' ? st.dueAt.slice(5, 16).replace('T', ' ') : '';
        const due = dueAt ? ` · ${F.node.due(dueAt)}` : '';
        // 상자 안 상태 줄은 짧게 — 내 차례이면서 기한 초과면 날짜는 접근 이름·툴팁에만
        const statusLine = ellipsize(st?.mine || !dueAt ? txt : `${txt} · ${dueAt}`, n.w - 34, 11);
        return (
          <g key={id} {...common} aria-label={`${F.node.activityLabel(a.name, roleLabel, txt)}${due}`} data-activity={a.id}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={8} />
            {/* 내 차례이면서 기한 초과 — 빨간 테두리 안쪽에 내 차례 테두리를 함께 */}
            {st?.mine && state === 'overdue' && <rect className="pf-node__ring" x={n.x + 4} y={n.y + 4} width={n.w - 8} height={n.h - 8} rx={5} />}
            {due && <title>{`${txt}${due}`}</title>}
            {lines.map((t, j) => (
              <text key={j} className="pf-node__name" x={cx} y={n.y + 34 + j * 15 + (lines.length === 1 ? 7 : 0)} textAnchor="middle">{t}</text>
            ))}
            <StateIcon state={state} x={n.x + 8} y={n.y + n.h - 19} />
            <text className="pf-node__state" x={n.x + 25} y={n.y + n.h - 9}>{statusLine}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** 가로 스크롤 때 왼쪽에 고정되는 레인 머리 */
function StickyLanes({ doc, layout, focus }: { doc: WorkflowDoc; layout: ProcessLayout; focus: readonly string[] }) {
  return (
    <svg className="pf-lanes" viewBox={`0 0 ${layout.laneLabelW} ${layout.height}`} width={layout.laneLabelW} height={layout.height} aria-hidden style={{ '--pf-lane-w': `${layout.laneLabelW}px` } as CSSProperties}>
      <LaneHeads doc={doc} layout={layout} focus={focus} />
    </svg>
  );
}

/** 텍스트 보기 — 흐름도와 같은 내용을 읽는 순서대로 표로 */
export function ProcessFlowText({ doc, process: p, statuses, onSelect }: Omit<Props, 'selected' | 'fit' | 'focusRoles'>) {
  const { graph, layout } = processFlow(p, doc);
  const act = new Map(p.activities.map((a) => [a.id, a]));
  const node = new Map(graph.nodes.map((n) => [n.id, n]));
  const wpName = (k: string) => doc.processes.flatMap((x) => x.workProducts).find((w) => w.key === k)?.name ?? k;
  const order = readingOrder(layout);
  const rows = order.map((id) => node.get(id)!).filter((n) => n.kind === 'activity');
  const pos = new Map(order.map((id, i) => [id, i]));
  const gateOf = (id: string) => (node.get(`${id}:gate`) ? `${id}:gate` : id);
  const incoming = (id: string) => graph.edges.filter((e) => e.to === id && e.kind !== 'gate').sort((x, y) => pos.get(x.from)! - pos.get(y.from)!);
  const outgoing = (id: string) => graph.edges.filter((e) => (e.from === id || e.from === gateOf(id)) && e.kind !== 'gate').sort((x, y) => pos.get(x.to)! - pos.get(y.to)!);
  const who = (nodeId: string) => {
    const n = node.get(nodeId)!;
    if (n.kind === 'start') return F.process.fromStart;
    if (n.kind === 'end') return F.process.toEnd;
    if (n.kind === 'event') return act.get(n.activityId!)?.trigger ? F.node.eventLabel(act.get(n.activityId!)!.trigger!) : F.node.readyLabel;
    if (n.kind === 'doc') return F.doc.text(wpName(n.wp!), docTag(doc, n));
    return workflowLabels(doc).activity(n.activityId!);
  };
  const wps = (e: ProcessGraph['edges'][number]) => ((e.kind === 'flow' || e.kind === 'data') && e.wps.length ? ` (${e.wps.map(wpName).join(', ')})` : '');
  const line = (e: ProcessGraph['edges'][number], end: 'from' | 'to') => `${isObjectFlow(e.kind) ? F.process.object : ''}${who(e[end])}${wps(e)}`;
  return (
    <div className="pf-text">
      <div className="pf-text__scroll">
        <table className="ds-table pf-table">
          <caption>{F.process.textCaption(p.name)}</caption>
          <thead>
            <tr>
              <th scope="col">{F.process.col.order}</th>
              <th scope="col">{F.process.col.activity}</th>
              <th scope="col">{F.process.col.role}</th>
              <th scope="col">{F.process.col.state}</th>
              <th scope="col">{F.process.col.from}</th>
              <th scope="col">{F.process.col.to}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n, i) => {
              const a = act.get(n.activityId!)!;
              const st = statuses.get(a.id);
              const ins = incoming(a.id);
              const outs = outgoing(a.id);
              return (
                <tr key={a.id} data-state={st?.state ?? 'waiting'} data-mine={st?.mine ? '' : undefined}>
                  <td>{i + 1}</td>
                  <th scope="row">
                    <button type="button" className="pf-linkbtn" onClick={() => onSelect(a.id)}>
                      {a.name}
                    </button>
                    {a.gateDecision && <span className="ds-tag ds-mono pf-gate-tag">{F.node.gate(a.gateDecision)}</span>}
                  </th>
                  <td>{roleNameOf(doc, a.raci.R[0])}</td>
                  <td className="pf-state-cell">
                    <svg width={14} height={14} viewBox="-1 -1 14 14" aria-hidden>
                      <StateIcon state={st?.state ?? 'waiting'} x={0} y={0} />
                    </svg>
                    {stateText(st)}
                  </td>
                  <td>{ins.length ? <ul className="pf-cell-list">{ins.map((e) => <li key={e.id}>{line(e, 'from')}</li>)}</ul> : F.process.none}</td>
                  <td>{outs.length ? <ul className="pf-cell-list">{outs.map((e) => <li key={e.id}>{line(e, 'to')}</li>)}</ul> : F.process.none}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 절차 상세의 흐름 보기 — 흐름도/텍스트 전환, 폭 맞추기, 범례 */
export function ProcessFlowView(props: Omit<Props, 'fit'>) {
  const [mode, setMode] = useState<'diagram' | 'text'>('diagram');
  const [choice, setFit] = useState<boolean | null>(null);
  const { layout } = processFlow(props.process, props.doc);
  const { ref, w } = useWidth(1040);
  const wide = layout.width > w + 2;
  // 조금(6% 이하)만 넘치면 처음부터 축소 보기 — 끝 상자가 잘려 보이지 않게. 고르면 그대로 따른다
  const fit = choice ?? (wide && layout.width <= w * 1.06);
  return (
    <div className="pf-view" data-mode={mode}>
      <div className="pf-toolbar">
        <Segmented<'diagram' | 'text'> label={F.views.label} value={mode} onChange={setMode} options={[{ value: 'diagram', label: F.views.diagram }, { value: 'text', label: F.views.text }]} />
        {mode === 'diagram' && (wide || fit) && (
          <Segmented label={F.views.fitLabel} value={fit ? 'fit' : 'actual'} onChange={(v) => setFit(v === 'fit')} options={[{ value: 'actual', label: F.views.actual }, { value: 'fit', label: F.views.fit }]} />
        )}
      </div>
      {mode === 'diagram' ? (
        <>
          {wide && !fit && <p className="pf-scrollhint">{F.process.scroll}</p>}
          <div className="pf-scroll" ref={ref} data-fit={fit ? '' : undefined} data-wide={wide && !fit ? '' : undefined}>
            {wide && !fit && <StickyLanes doc={props.doc} layout={layout} focus={props.focusRoles ?? []} />}
            <ProcessFlowDiagram {...props} fit={fit} />
          </div>
          {/* 범례·읽는 법은 흐름도 아래 — 흐름도가 첫 화면에 들어오게 */}
          <FlowLegend />
          <p className="ds-field__hint pf-hint">{F.process.hint}</p>
        </>
      ) : (
        <ProcessFlowText {...props} />
      )}
    </div>
  );
}
