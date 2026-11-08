// 내 업무 흐름 — 현재 역할이 13개 절차에서 맡은 활동을 생애주기 사슬로 잇고, 줄마다 받는 곳 → 내 활동 → 넘기는 곳을 그린다.
// 역할 전환기에서 역할을 바꾸면 그 역할의 흐름으로 바뀐다. 지금 내 차례인 활동은 강조한다.
// MyWorkFlowCompact는 메인 화면 업무 절차 가젯용 작은 판(지금 내 차례부터 3건, 화면 폭에 맞춤).
// 모양은 절차 흐름도와 같은 절차서 표기: 내 활동 = 파란 테두리 상자, 상대 역할 = 레인 머리 모양, 외부 입력·보존 기록 = 문서,
// 주고받는 산출물 = 금색 점선(객체 흐름, 이름표 = 산출물), 내 활동 사이 생애주기 순서 = 남색 점선.
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { WorkflowDoc } from '@ff/contracts';
import { workflowLabels } from '../../../data/workflowLabels';
import { procedureFlow as F } from '../../../copy/procedureFlow';
import { roleLabel } from '../../../data/refdata';
import { useAppShell } from '../../../store';
import { Segmented } from '../../../design';
import { ArrowDefs, DocShape, EdgeLabel, FlowLegend, roleNameOf, StateIcon, stateText, useFlowStatuses } from './FlowParts';
import { collapseSides, layoutMyFlow, MY_FLOW_COMPACT, MY_FLOW_FULL, myWorkSteps, wpNameOf, type Counterpart, type MyFlowLayout, type MyFlowSize, type MyStep } from './myFlow';
import type { ActivityStatus } from './status';
import { ellipsize, wrapText } from './svgText';

type Filter = 'open' | 'now' | 'all';

const isNow = (s: ActivityStatus | undefined) => !!s && s.mine && (s.state === 'mine' || s.state === 'overdue');

/** own=false — 다른 담당자의 흐름: 그 담당자 자신의 역할은 "(이 담당)"으로 */
function who(doc: WorkflowDoc, c: Counterpart, own = true) {
  const name = roleNameOf(doc, c.role);
  const base = c.kind === 'external' ? F.mine.external : c.kind === 'retained' ? F.mine.retained : c.mine ? (own ? F.mine.meRole(name) : F.roles.selfRole(name)) : name;
  return c.extra ? `${base} ${F.mine.more(c.extra)}` : base;
}
const acts = (doc: WorkflowDoc, c: Counterpart) => (c.activities.length ? `${workflowLabels(doc).activity(c.activities[0].id)}${c.activities.length > 1 ? ` ${F.node.more(c.activities.length - 1)}` : ''}` : '');

function MyFlowSvg({ doc, layout, statuses, size, fit, label, own = true }: { doc: WorkflowDoc; layout: MyFlowLayout; statuses: Map<string, ActivityStatus>; size: MyFlowSize; fit: boolean; label: string; own?: boolean }) {
  const nav = useNavigate();
  const marker = `pf-my-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg
      className="pf-svg pf-my"
      viewBox={`0 0 ${layout.width} ${Math.max(1, layout.height)}`}
      width={fit ? '100%' : layout.width}
      height={fit ? undefined : layout.height}
      // 폭 맞추기는 줄이기만 한다 — 넓은 화면에서 키우면 가젯이 지나치게 커진다
      style={fit ? { maxWidth: layout.width } : undefined}
      preserveAspectRatio="xMinYMin meet"
      role="group"
      aria-label={label}
    >
      <ArrowDefs id={marker} />
      <g aria-hidden>
        {layout.chain.map((c) => (
          <polyline key={`${c.from}>${c.to}`} className="pf-chain" points={c.points.map((q) => q.join(',')).join(' ')} markerEnd={`url(#${marker})`} />
        ))}
      </g>
      {layout.rows.map((r) => {
        const s = r.step;
        const st = statuses.get(s.activity.id);
        const center = r.layout.nodes.find((n) => n.side === 'center')!;
        const open = () => nav(`/procedures/${s.process.id}?a=${s.activity.id}`);
        const lines = wrapText(s.activity.name, center.w - 16, 12, 2);
        return (
          <g key={s.activity.id} transform={`translate(0 ${r.y})`} data-step={s.activity.id}>
            {r.header && (
              <text className="pf-my__header" x={16} y={-10}>
                {ellipsize(s.process.name, layout.centerX - 40, 13)}
              </text>
            )}
            <g aria-hidden>
              {r.layout.edges.map((e) => (
                <polyline key={e.id} className="pf-edge pf-of" points={e.points.map((q) => q.join(',')).join(' ')} markerEnd={`url(#${marker}-of)`} />
              ))}
              {r.layout.edges.map((e) => (e.labelAt && e.label ? <EdgeLabel key={e.id} at={e.labelAt} text={e.label} full={e.wps.map((k) => wpNameOf(doc, k)).join(', ')} /> : null))}
            </g>
            {r.layout.nodes
              .filter((n) => n.side !== 'center')
              .map((n) => {
                const c = n.counterpart!;
                const sub = acts(doc, c);
                const name = who(doc, c, own);
                const wps = c.wps.map((k) => wpNameOf(doc, k)).join(', ');
                const nameLines = wrapText(name, n.w - 22, 12, 2);
                return (
                  <g key={n.id} className="pf-peer" data-kind={c.kind} data-mine={c.mine ? '' : undefined} role="img" aria-label={F.mine.sideLabel(n.side === 'from' ? F.mine.from : F.mine.to, name, c.activities.map((x) => workflowLabels(doc).activity(x.id)).join(', '), wps)}>
                    {c.kind === 'role' ? <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={4} /> : <g className="pf-doc"><DocShape x={n.x} y={n.y} w={n.w} h={n.h} fold={10} /></g>}
                    {/* 이름은 두 줄까지(잘리지 않게), 그 아래 활동 ID */}
                    {nameLines.map((t, j) => (
                      <text key={j} className="pf-peer__name" x={n.x + 8} y={n.y + (sub ? 17 : n.h / 2 + 4 - (nameLines.length - 1) * 7) + j * 14}>{t}</text>
                    ))}
                    {sub && <text className="pf-peer__sub" x={n.x + 8} y={n.y + 17 + nameLines.length * 14 + 1}>{ellipsize(sub, n.w - 16, 10)}</text>}
                  </g>
                );
              })}
            <g
              className="pf-node pf-node--activity"
              role="button"
              tabIndex={0}
              data-state={st?.state ?? 'waiting'}
              data-mine=""
              data-now={isNow(st) ? '' : undefined}
              data-activity={s.activity.id}
              aria-label={F.mine.stepLabel(s.activity.name, s.process.name, stateText(st, own))}
              onClick={open}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  open();
                }
              }}
            >
              <rect x={center.x} y={center.y} width={center.w} height={center.h} rx={8} />
              {st?.mine && st.state === 'overdue' && <rect className="pf-node__ring" x={center.x + 4} y={center.y + 4} width={center.w - 8} height={center.h - 8} rx={5} />}
              {s.activity.gateDecision && <text className="pf-node__id" x={center.x + center.w / 2} y={center.y + 16} textAnchor="middle">{F.node.gate(s.activity.gateDecision)}</text>}
              {lines.map((t, j) => (
                <text key={j} className="pf-node__name" x={center.x + center.w / 2} y={center.y + 33 + j * 15 + (lines.length === 1 ? 7 : 0)} textAnchor="middle">{t}</text>
              ))}
              <StateIcon state={st?.state ?? 'waiting'} x={center.x + 8} y={center.y + center.h - 19} />
              <text className="pf-node__state" x={center.x + 25} y={center.y + center.h - 9}>{stateText(st, own)}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

function MyFlowText({ doc, steps, statuses, own = true, caption }: { doc: WorkflowDoc; steps: MyStep[]; statuses: Map<string, ActivityStatus>; own?: boolean; caption: string }) {
  const side = (cs: Counterpart[]) =>
    cs.length ? (
      <ul className="pf-cell-list">
        {cs.map((c) => (
          <li key={c.id}>
            {who(doc, c, own)}
            {c.activities.length ? ` · ${c.activities.map((x) => workflowLabels(doc).activity(x.id)).join(', ')}` : ''}
            {c.wps.length ? ` (${c.wps.map((k) => wpNameOf(doc, k)).join(', ')})` : ''}
          </li>
        ))}
      </ul>
    ) : (
      F.process.none
    );
  return (
    <div className="pf-text__scroll">
      <table className="ds-table pf-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{F.mine.col.order}</th>
            <th scope="col">{F.mine.col.activity}</th>
            <th scope="col">{F.mine.col.state}</th>
            <th scope="col">{F.mine.col.from}</th>
            <th scope="col">{F.mine.col.to}</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => {
            const st = statuses.get(s.activity.id);
            return (
              <tr key={s.activity.id} data-state={st?.state ?? 'waiting'} data-now={isNow(st) ? '' : undefined}>
                <td>{i + 1}</td>
                <th scope="row">
                  <Link to={`/procedures/${s.process.id}?a=${s.activity.id}`}>{s.activity.name}</Link>
                  <span className="ds-field__hint pf-block">{s.process.name}</span>
                </th>
                <td className="pf-state-cell">
                  <svg width={14} height={14} viewBox="-1 -1 14 14" aria-hidden>
                    <StateIcon state={st?.state ?? 'waiting'} x={0} y={0} />
                  </svg>
                  {stateText(st, own)}
                </td>
                <td>{side(s.from)}</td>
                <td>{side(s.to)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** /procedures 허브의 내 업무 흐름 */
/** persona를 주면 그 담당자의 흐름(역할 전환 없이 보기) — 없으면 지금 역할 */
export function MyWorkFlow({ doc, sample, persona }: { doc: WorkflowDoc; sample?: readonly string[]; persona?: string }) {
  const { role: me } = useAppShell();
  const { role, roleIds, statuses } = useFlowStatuses(doc, sample, persona);
  const own = role === me;
  const title = own ? F.mine.title : F.roles.flowLabel(roleLabel(role));
  const [filter, setFilter] = useState<Filter>('open');
  const [mode, setMode] = useState<'diagram' | 'text'>('diagram');
  const all = myWorkSteps(doc, roleIds);
  const steps = all.filter((s) => {
    const st = statuses.get(s.activity.id);
    return filter === 'all' ? true : filter === 'now' ? isNow(st) : st?.state !== 'done';
  });
  const layout = layoutMyFlow(steps, doc, MY_FLOW_FULL, F.node.more);
  return (
    <div className="pf-view" data-mode={mode} data-role={role}>
      <p className="ds-field__hint pf-hint">{own ? F.mine.hint(roleLabel(role)) : F.roles.hint(roleLabel(role))}</p>
      <div className="pf-toolbar">
        <Segmented<Filter>
          label={F.mine.filter}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: F.mine.open, count: all.filter((s) => statuses.get(s.activity.id)?.state !== 'done').length },
            { value: 'now', label: own ? F.mine.now : F.roles.now, count: all.filter((s) => isNow(statuses.get(s.activity.id))).length },
            { value: 'all', label: F.mine.all, count: all.length },
          ]}
        />
        <Segmented<'diagram' | 'text'> label={F.views.label} value={mode} onChange={setMode} options={[{ value: 'diagram', label: F.views.diagram }, { value: 'text', label: F.views.text }]} />
      </div>
      {!all.length ? (
        <p className="ds-field__hint" role="status">{F.mine.empty}</p>
      ) : !steps.length ? (
        <p className="ds-field__hint" role="status">{F.mine.emptyFilter}</p>
      ) : mode === 'diagram' ? (
        <>
          <FlowLegend shapes="mine" own={own} />
          <p className="ds-field__hint pf-count">{own ? F.mine.count(steps.length, all.length) : F.roles.count(steps.length, all.length)}</p>
          <div className="pf-scroll">
            <MyFlowSvg doc={doc} layout={layout} statuses={statuses} size={MY_FLOW_FULL} fit={false} label={title} own={own} />
          </div>
        </>
      ) : (
        <MyFlowText doc={doc} steps={steps} statuses={statuses} own={own} caption={own ? F.mine.textCaption : F.roles.textCaption(roleLabel(role))} />
      )}
    </div>
  );
}

/** 메인 화면 가젯용 — 지금 내 차례(기한 초과 먼저) → 남은 일 순으로 3건 */
export function MyWorkFlowCompact({ doc, limit = 3, sample }: { doc: WorkflowDoc; limit?: number; sample?: readonly string[] }) {
  const { roleIds, statuses } = useFlowStatuses(doc, sample);
  const all = myWorkSteps(doc, roleIds);
  const rank = (s: MyStep) => {
    const st = statuses.get(s.activity.id);
    return st?.state === 'overdue' ? 0 : isNow(st) ? 1 : st?.state === 'ready' ? 2 : st?.state === 'waiting' ? 3 : 4;
  };
  const steps = all
    .map((s, i) => ({ s, i, r: rank(s) }))
    .filter((x) => x.r < 4)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => collapseSides(x.s));
  const now = steps.filter((s) => isNow(statuses.get(s.activity.id))).length;
  const layout = layoutMyFlow(steps, doc, MY_FLOW_COMPACT, F.node.more);
  return (
    <div className="pf-compact" data-flow-compact="">
      <div className="pf-compact__head">
        <span className="ds-eyebrow">{F.mine.title}</span>
        <Link to="/procedures?view=flow" className="pf-compact__all">{F.mine.openAll}</Link>
      </div>
      {!steps.length ? (
        <p className="ds-field__hint" role="status">{all.length ? F.mine.compactNone : F.mine.empty}</p>
      ) : (
        <>
          <p className="ds-field__hint pf-hint">{now ? F.mine.compactHint : F.mine.compactNone}</p>
          <MyFlowSvg doc={doc} layout={layout} statuses={statuses} size={MY_FLOW_COMPACT} fit label={F.mine.title} />
        </>
      )}
    </div>
  );
}
