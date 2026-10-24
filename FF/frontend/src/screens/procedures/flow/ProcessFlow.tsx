// 절차 흐름도 — 스윔레인(레인 = 수행 역할) · 활동 상자 · Gate 마름모 · 시작/종료 원 · 산출물 이름표가 붙은 직교 화살표.
// 상자마다 서버 상태(완료·내 차례·진행 가능·앞 활동 대기·기한 초과)를 색·아이콘·글자로 얹는다. 상자를 누르면 활동 상세가 열린다.
// 같은 내용을 텍스트(표)로도 볼 수 있다 — 화면 낭독기·인쇄용.
import { type KeyboardEvent, useId, useState } from 'react';
import type { WorkflowDoc, WorkflowProcess } from '@ff/contracts';
import { procedureFlow as F } from '../../../copy/procedureFlow';
import { Segmented } from '../../../design';
import { ArrowDefs, EdgeLabel, FlowLegend, roleNameOf, StateIcon, stateText, useWidth } from './FlowParts';
import { processFlow, readingOrder, type ProcessLayout } from './model';
import type { ActivityStatus } from './status';
import { ellipsize, wrapText } from './svgText';

const LABEL_FS = 11;
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

function LaneLabels({ doc, layout, focus }: { doc: WorkflowDoc; layout: ProcessLayout; focus: readonly string[] }) {
  return (
    <>
      {layout.lanes.map((ln) => {
        const lines = wrapText(roleNameOf(doc, ln.id), layout.laneLabelW - 20, 12, 3);
        const on = focus.includes(ln.id);
        return (
          <g key={ln.id} data-lane={ln.id} data-focus={on ? '' : undefined}>
            <rect className={`pf-lane pf-lane--${on ? 'focus' : ln.index % 2}`} data-focus={on ? '' : undefined} x={0} y={ln.y} width={layout.width} height={ln.h} />
            {on && <rect className="pf-lane__mark" x={0} y={ln.y} width={4} height={ln.h} />}
            <line className="pf-lane__sep" x1={layout.laneLabelW} y1={ln.y} x2={layout.laneLabelW} y2={ln.y + ln.h} />
            {lines.map((t, j) => (
              <text key={j} className="pf-lane__label" x={12} y={ln.y + ln.h / 2 - (lines.length - 1) * 8 + j * 16 + 4}>
                {t}
              </text>
            ))}
          </g>
        );
      })}
    </>
  );
}

export function ProcessFlowDiagram({ doc, process: p, statuses, selected, onSelect, fit, focusRoles = [] }: Props) {
  const { layout } = processFlow(p, F.node.more);
  const marker = `pf-arr-${p.id.replace('.', '-')}-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const act = new Map(p.activities.map((a) => [a.id, a]));
  const wpName = new Map(p.workProducts.map((w) => [w.key, w.name]));
  const at = new Map(layout.nodes.map((n) => [n.id, n]));
  const order = readingOrder(layout);
  return (
    <svg
      className="pf-svg"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={fit ? '100%' : layout.width}
      height={fit ? undefined : layout.height}
      // 폭 맞추기도 75%보다 작게 줄이지 않는다(글자가 읽히지 않는다) — 그보다 넓으면 그 크기로 가로 스크롤
      style={fit ? { minWidth: Math.round(layout.width * 0.75), maxWidth: layout.width } : undefined}
      preserveAspectRatio="xMinYMin meet"
      role="group"
      aria-label={F.process.title(p.id)}
      data-flow={p.id}
    >
      <ArrowDefs id={marker} />
      <LaneLabels doc={doc} layout={layout} focus={focusRoles} />
      <g aria-hidden>
        {layout.edges.map((e) => (
          <polyline key={e.id} className={`pf-edge pf-edge--${e.kind}${e.back ? ' pf-edge--back' : ''}`} points={e.points.map((q) => q.join(',')).join(' ')} markerEnd={`url(#${marker})`} data-edge={e.id} />
        ))}
        {layout.joins.map(([x, y], i) => (
          <circle key={i} className="pf-join" cx={x} cy={y} r={3} />
        ))}
        {layout.edges.map((e) => (e.labelAt && e.label ? <EdgeLabel key={e.id} at={e.labelAt} text={e.label} full={e.wps.map((k) => wpName.get(k) ?? k).join(', ')} /> : null))}
      </g>
      {order.map((id) => {
        const n = at.get(id)!;
        if (n.kind === 'start' || n.kind === 'end' || n.kind === 'event') {
          const a = n.activityId ? act.get(n.activityId) : null;
          const label = n.kind === 'start' ? F.node.startLabel(p.entry.length) : n.kind === 'end' ? F.node.endLabel(p.exit.length) : F.node.eventLabel(a?.trigger ?? '');
          return (
            <g key={id} className={`pf-term pf-term--${n.kind}`} role="img" aria-label={label}>
              <title>{n.kind === 'start' ? p.entry.join('\n') : n.kind === 'end' ? p.exit.join('\n') : a?.trigger ?? ''}</title>
              <circle cx={n.x + n.w / 2} cy={n.y + n.h / 2} r={n.w / 2} />
              {n.kind === 'end' && <circle className="pf-term__inner" cx={n.x + n.w / 2} cy={n.y + n.h / 2} r={n.w / 2 - 5} />}
              <text className="pf-term__text" x={n.x + n.w / 2} y={n.y + n.h / 2 + 4} textAnchor="middle">
                {n.kind === 'start' ? F.node.start : n.kind === 'end' ? F.node.end : F.node.event}
              </text>
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
          const cx = n.x + n.w / 2;
          const cy = n.y + n.h / 2;
          return (
            <g key={id} {...common} aria-label={F.node.gateLabel(n.gate!, a.id, txt)} data-activity={a.id} data-gate={n.gate}>
              <path d={`M${cx} ${n.y} L${n.x + n.w} ${cy} L${cx} ${n.y + n.h} L${n.x} ${cy} Z`} />
              <text className="pf-gate__id" x={cx} y={cy + 1} textAnchor="middle">{n.gate}</text>
              <StateIcon state={state} x={cx - 6} y={cy + 6} />
            </g>
          );
        }
        const lines = wrapText(a.name, n.w - 16, NAME_FS, 3);
        const roleLabel = roleNameOf(doc, a.raci.R[0]);
        const idLine = `${a.id}${a.gateDecision ? ` · ${a.gateDecision}` : ''}${a.trigger ? ` · ${F.node.trigger}` : ''}`;
        const dueAt = st?.dueAt && st.state === 'overdue' ? st.dueAt.slice(5, 16).replace('T', ' ') : '';
        const due = dueAt ? ` · ${F.node.due(dueAt)}` : '';
        // 상자 안 상태 줄은 짧게 — 내 차례이면서 기한 초과면 날짜는 접근 이름·툴팁에만
        const statusLine = ellipsize(st?.mine || !dueAt ? txt : `${txt} · ${dueAt}`, n.w - 34, LABEL_FS);
        return (
          <g key={id} {...common} aria-label={`${F.node.activityLabel(a.id, a.name, roleLabel, txt)}${due}`} data-activity={a.id}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={5} />
            {/* 내 차례이면서 기한 초과 — 빨간 테두리 안쪽에 내 차례 테두리를 함께 */}
            {st?.mine && state === 'overdue' && <rect className="pf-node__ring" x={n.x + 4} y={n.y + 4} width={n.w - 8} height={n.h - 8} rx={3} />}
            {due && <title>{`${txt}${due}`}</title>}
            <text className="pf-node__id" x={n.x + 8} y={n.y + 15}>{ellipsize(idLine, n.w - 16, 10)}</text>
            {lines.map((t, j) => (
              <text key={j} className="pf-node__name" x={n.x + 8} y={n.y + 32 + j * 15}>{t}</text>
            ))}
            <StateIcon state={state} x={n.x + 8} y={n.y + n.h - 19} />
            <text className="pf-node__state" x={n.x + 25} y={n.y + n.h - 9}>{statusLine}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** 텍스트 보기 — 흐름도와 같은 내용을 읽는 순서대로 표로 */
export function ProcessFlowText({ doc, process: p, statuses, onSelect }: Omit<Props, 'selected' | 'fit' | 'focusRoles'>) {
  const { layout } = processFlow(p, F.node.more);
  const act = new Map(p.activities.map((a) => [a.id, a]));
  const wpName = new Map(p.workProducts.map((w) => [w.key, w.name]));
  const rows = readingOrder(layout)
    .map((id) => layout.nodes.find((n) => n.id === id)!)
    .filter((n) => n.kind === 'activity');
  const pos = new Map(readingOrder(layout).map((id, i) => [id, i]));
  const incoming = (id: string) => layout.edges.filter((e) => e.to === id && e.kind !== 'gate').sort((x, y) => pos.get(x.from)! - pos.get(y.from)!);
  const outgoing = (id: string) => layout.edges.filter((e) => (e.from === id || e.from === `${id}:gate`) && e.kind !== 'gate').sort((x, y) => pos.get(x.to)! - pos.get(y.to)!);
  const who = (nodeId: string, side: 'from' | 'to') => {
    const n = layout.nodes.find((x) => x.id === nodeId)!;
    if (n.kind === 'start') return F.process.fromStart;
    if (n.kind === 'end') return F.process.toEnd;
    if (n.kind === 'event') return F.node.eventLabel(act.get(n.activityId!)?.trigger ?? '');
    return n.activityId ? `${n.activityId} ${act.get(n.activityId)?.name ?? ''}` : side;
  };
  const wps = (keys: string[]) => (keys.length ? ` (${keys.map((k) => wpName.get(k) ?? k).join(', ')})` : '');
  return (
    <div className="pf-text">
      <dl className="pf-criteria">
        <dt>{F.process.entry}</dt>
        <dd><ul>{p.entry.map((x, i) => <li key={i}>{x}</li>)}</ul></dd>
        <dt>{F.process.exit}</dt>
        <dd><ul>{p.exit.map((x, i) => <li key={i}>{x}</li>)}</ul></dd>
      </dl>
      <div className="pf-text__scroll">
        <table className="ds-table pf-table">
          <caption>{F.process.textCaption(p.id)}</caption>
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
                      {a.id} {a.name}
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
                  <td>{ins.length ? <ul className="pf-cell-list">{ins.map((e) => <li key={e.id}>{who(e.from, 'from')}{wps(e.wps)}</li>)}</ul> : F.process.none}</td>
                  <td>{outs.length ? <ul className="pf-cell-list">{outs.map((e) => <li key={e.id}>{who(e.to, 'to')}{wps(e.wps)}</li>)}</ul> : F.process.none}</td>
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
  const [fit, setFit] = useState(false);
  const { layout } = processFlow(props.process, F.node.more);
  const { ref, w } = useWidth(1040);
  const wide = layout.width > w + 2;
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
          <FlowLegend />
          <p className="ds-field__hint pf-hint">
            {F.process.hint}
            {wide && !fit ? ` ${F.process.scroll}` : ''}
          </p>
          <div className="pf-scroll" ref={ref} data-fit={fit ? '' : undefined} data-wide={wide && !fit ? '' : undefined}>
            <ProcessFlowDiagram {...props} fit={fit} />
          </div>
          {/* 시작·종료 원의 조건 — 흐름도 아래에 글로도 둔다 */}
          <dl className="pf-criteria pf-criteria--inline">
            <dt>{F.process.entry}</dt>
            <dd>{props.process.entry.join(' · ')}</dd>
            <dt>{F.process.exit}</dt>
            <dd>{props.process.exit.join(' · ')}</dd>
          </dl>
        </>
      ) : (
        <ProcessFlowText {...props} />
      )}
    </div>
  );
}

