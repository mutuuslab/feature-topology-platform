// 흐름도 공용 부품 — 상태 아이콘(색만으로 구분하지 않게 모양·글자를 함께), 화살표 머리(제어·객체 흐름), 문서 모양, 범례, 상태 읽기 도우미.
// 모양은 엔지니어링 절차서 표기: 활동 = 파란 테두리 상자, 산출물 = 귀퉁이를 접은 문서, 제어 흐름 = 남색 실선, 객체 흐름 = 금색 점선.
import { useEffect, useRef, useState } from 'react';
import type { WorkflowDoc } from '@ff/contracts';
import { procedureFlow as F } from '../../../copy/procedureFlow';
import { useProgress } from '../../../data/procedureProgress';
import { useAppShell } from '../../../store';
import { activityStatuses, type ActivityState, type ActivityStatus } from './status';
import { ellipsize, wrapLabel } from './svgText';
import './flow.css';

export const roleNameOf = (doc: WorkflowDoc, id: string | null) => (id ? doc.roles.find((r) => r.id === id)?.name ?? id : '');

/** own=false — 다른 담당자의 흐름을 볼 때: '내 차례' 대신 '이 담당 차례' */
export const stateText = (s: ActivityStatus | undefined, own = true): string =>
  !s
    ? F.state.waiting
    : s.state === 'overdue' && s.mine
      ? own ? F.state.mineOverdue : F.state.theirsOverdue
      : s.state === 'mine' && !own
        ? F.state.theirs
        : F.state[s.state];

/** 레인 머리 글자 — [이름, 영문 보조] */
export const laneTitle = (doc: WorkflowDoc, id: string): string => (id === '__in' ? F.lanes.in : id === '__out' ? F.lanes.out : roleNameOf(doc, id));

/** 담당자(데모 역할) 이름의 레인 이름 — 역할 전환기 이름(차량 운영)과 흐름도 레인(운영 조직)을 잇는다 */
export const lanesOf = (doc: WorkflowDoc, persona: string) => (doc.personas[persona] ?? []).map((id) => roleNameOf(doc, id)).join('·');

/** 내 역할 기준 모든 활동 상태 — 역할 전환·완료가 바뀌면 다시 계산된다.
 *  sample을 주면 서버를 읽지 않고 그 완료 목록으로 그린다(디자인 갤러리 견본) */
export function useFlowStatuses(doc: WorkflowDoc, sample?: readonly string[], persona?: string) {
  const { role: me } = useAppShell();
  // persona — 다른 담당자의 흐름을 볼 때(역할 전환 없이). 완료 상태는 서버 전체 기록이라 같고, 내 차례만 그 담당자 기준
  const role = persona ?? me;
  const roleIds = doc.personas[role] ?? [];
  const { doneIds, items } = useProgress(me, !sample);
  const statuses = activityStatuses(doc, { done: new Set(sample ?? doneIds()), items: sample ? [] : items, roleIds, now: Date.now() });
  return { role, roleIds, statuses };
}

/** 상태 아이콘 — 12×12, (x, y)가 왼쪽 위 */
export function StateIcon({ state, x, y }: { state: ActivityState; x: number; y: number }) {
  const t = `translate(${x} ${y})`;
  switch (state) {
    case 'done':
      return (
        <g className="pf-ico pf-ico--done" transform={t} aria-hidden>
          <circle cx={6} cy={6} r={6} />
          <path d="M3 6.2 L5.2 8.4 L9.2 3.8" />
        </g>
      );
    case 'mine':
      return (
        <g className="pf-ico pf-ico--mine" transform={t} aria-hidden>
          <circle cx={6} cy={6} r={6} />
          <path d="M4.5 3 L8.8 6 L4.5 9 Z" />
        </g>
      );
    case 'overdue':
      return (
        <g className="pf-ico pf-ico--overdue" transform={t} aria-hidden>
          <path d="M6 0.5 L11.6 11 L0.4 11 Z" />
          <path d="M6 4 L6 7.4 M6 8.8 L6 9.4" />
        </g>
      );
    case 'ready':
      return (
        <g className="pf-ico pf-ico--ready" transform={t} aria-hidden>
          <circle cx={6} cy={6} r={5.4} />
          <path d="M4.8 3.6 L8.2 6 L4.8 8.4 Z" />
        </g>
      );
    default:
      return (
        <g className="pf-ico pf-ico--waiting" transform={t} aria-hidden>
          <circle cx={6} cy={6} r={5.4} />
          <path d="M6 3 L6 6.2 L8.2 7.4" />
        </g>
      );
  }
}

/** 화살표 머리 — id(=id-cf) 제어 흐름(남색), id-of 객체 흐름(금색) */
export function ArrowDefs({ id }: { id: string }) {
  return (
    <defs>
      {[id, `${id}-cf`].map((m) => (
        <marker key={m} id={m} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="pf-arrow" />
        </marker>
      ))}
      <marker id={`${id}-of`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" className="pf-arrow pf-arrow--of" />
      </marker>
    </defs>
  );
}

/** 산출물 문서 — 오른쪽 위 귀퉁이를 접은 상자(바깥선 + 접힌 선) */
export function DocShape({ x, y, w, h, fold = 12 }: { x: number; y: number; w: number; h: number; fold?: number }) {
  return (
    <>
      <path className="pf-doc__body" d={`M${x} ${y} h${w - fold} l${fold} ${fold} v${h - fold} h${-w} z`} />
      <path className="pf-doc__fold" d={`M${x + w - fold} ${y} v${fold} h${fold}`} />
    </>
  );
}

/** 사건 시작 — 원 안의 번개(글꼴에 기대지 않는 경로). (x, y) = 가운데 */
export function TriggerBolt({ x, y }: { x: number; y: number }) {
  return <path className="pf-bolt" d={`M${x + 1.5} ${y - 6.5} L${x - 3.5} ${y + 1} L${x - 0.5} ${y + 1} L${x - 1.5} ${y + 6.5} L${x + 3.5} ${y - 1} L${x + 0.5} ${y - 1} Z`} />;
}

const STATES: ActivityState[] = ['mine', 'overdue', 'ready', 'waiting', 'done'];

/** 범례 — 상태 5종(아이콘·글자) + 도형 */
export function FlowLegend({ shapes = true, own = true }: { shapes?: boolean | 'mine'; own?: boolean }) {
  return (
    <div className="pf-legend" role="group" aria-label={F.legend.title}>
      {STATES.map((s) => (
        <span key={s} className="pf-legend__item" data-state={s}>
          <svg width={14} height={14} viewBox="-1 -1 14 14" aria-hidden>
            <StateIcon state={s} x={0} y={0} />
          </svg>
          {s === 'mine' && !own ? F.state.theirs : F.state[s]}
        </span>
      ))}
      {shapes === 'mine' && (
        <>
          <span className="pf-legend__item">
            <svg width={24} height={14} viewBox="0 0 24 14" aria-hidden>
              <rect className="pf-legend__act" x={1} y={1} width={22} height={12} rx={3} />
            </svg>
            {F.legend.myActivity}
          </span>
          <span className="pf-legend__item">
            <svg width={24} height={14} viewBox="0 0 24 14" aria-hidden>
              <rect className="pf-legend__peer" x={1} y={1} width={22} height={12} rx={2} />
            </svg>
            {F.legend.peer}
          </span>
          <span className="pf-legend__item">
            <svg width={20} height={16} viewBox="0 0 20 16" aria-hidden>
              <g className="pf-doc" data-external="">
                <DocShape x={1} y={1} w={18} h={14} fold={5} />
              </g>
            </svg>
            {F.mine.external}
          </span>
          <span className="pf-legend__item">
            <svg width={20} height={16} viewBox="0 0 20 16" aria-hidden>
              <g className="pf-doc">
                <DocShape x={1} y={1} w={18} h={14} fold={5} />
              </g>
            </svg>
            {F.mine.retained}
          </span>
          <span className="pf-legend__item">
            <svg width={26} height={10} viewBox="0 0 26 10" aria-hidden>
              <line className="pf-legend__of" x1={1} y1={5} x2={20} y2={5} />
              <path className="pf-arrow pf-arrow--of" d="M19 2 L25 5 L19 8 Z" />
            </svg>
            {F.legend.handoff}
          </span>
          <span className="pf-legend__item">
            <svg width={26} height={10} viewBox="0 0 26 10" aria-hidden>
              <line className="pf-legend__chain" x1={1} y1={5} x2={20} y2={5} />
              <path className="pf-arrow" d="M19 1.5 L25 5 L19 8.5 Z" />
            </svg>
            {F.legend.chain}
          </span>
        </>
      )}
      {shapes === true && (
        <>
          <span className="pf-legend__item">
            <svg width={24} height={14} viewBox="0 0 24 14" aria-hidden>
              <rect className="pf-legend__act" x={1} y={1} width={22} height={12} rx={3} />
            </svg>
            {F.legend.activity}
          </span>
          <span className="pf-legend__item">
            <svg width={20} height={16} viewBox="0 0 20 16" aria-hidden>
              <g className="pf-doc">
                <DocShape x={1} y={1} w={18} h={14} fold={5} />
              </g>
            </svg>
            {F.legend.doc}
          </span>
          <span className="pf-legend__item">
            <svg width={20} height={16} viewBox="0 0 20 16" aria-hidden>
              <g className="pf-doc" data-external="">
                <DocShape x={1} y={1} w={18} h={14} fold={5} />
              </g>
            </svg>
            {F.legend.extDoc}
          </span>
          <span className="pf-legend__item">
            <svg width={20} height={16} viewBox="0 0 20 16" aria-hidden>
              <g className="pf-doc" data-ref="">
                <DocShape x={1} y={1} w={18} h={14} fold={5} />
              </g>
            </svg>
            {F.legend.refDoc}
          </span>
          <span className="pf-legend__item">
            <svg width={26} height={10} viewBox="0 0 26 10" aria-hidden>
              <line className="pf-legend__cf" x1={1} y1={5} x2={20} y2={5} />
              <path className="pf-arrow" d="M19 1.5 L25 5 L19 8.5 Z" />
            </svg>
            {F.legend.flow}
          </span>
          <span className="pf-legend__item">
            <svg width={26} height={10} viewBox="0 0 26 10" aria-hidden>
              <line className="pf-legend__of" x1={1} y1={5} x2={20} y2={5} />
              <path className="pf-arrow pf-arrow--of" d="M19 2 L25 5 L19 8 Z" />
            </svg>
            {F.legend.object}
          </span>
          <span className="pf-legend__item">
            <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
              <path className="pf-legend__gate" d="M8 1 L15 8 L8 15 L1 8 Z" />
            </svg>
            {F.legend.gate}
          </span>
          <span className="pf-legend__item">
            <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
              <circle className="pf-legend__start" cx={7} cy={7} r={6} />
            </svg>
            {F.legend.start}
          </span>
          <span className="pf-legend__item">
            <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
              <g className="pf-term pf-term--event">
                <circle cx={8} cy={8} r={7} />
                <TriggerBolt x={8} y={8} />
              </g>
            </svg>
            {F.legend.event}
          </span>
          <span className="pf-legend__item">
            <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
              <g className="pf-term pf-term--end">
                <circle cx={8} cy={8} r={7} />
                <circle className="pf-term__inner" cx={8} cy={8} r={3.5} />
              </g>
            </svg>
            {F.legend.end}
          </span>
          <span className="pf-legend__item">
            <svg width={12} height={16} viewBox="0 0 12 16" aria-hidden>
              <line className="pf-legend__bar" x1={6} y1={2} x2={6} y2={14} />
            </svg>
            {F.legend.join}
          </span>
        </>
      )}
    </div>
  );
}

/** 간선 이름표 — 출구 구간 위 한 줄(자리가 있으면 선 아래 둘째 줄). 전체 이름은 title로 */
export function EdgeLabel({ at, text, full }: { at: { x: number; y: number; maxW: number; lines: 1 | 2 }; text: string; full: string }) {
  const lines = at.lines === 2 ? wrapLabel(text, at.maxW, 11) : [ellipsize(text, at.maxW, 11)];
  return (
    <text className="pf-edge__label" x={at.x} y={at.y}>
      <title>{full}</title>
      {lines.map((t, i) => (
        <tspan key={i} x={at.x} y={at.y + i * 16}>
          {t}
        </tspan>
      ))}
    </text>
  );
}

/** 용기 폭을 따라간다 — ResizeObserver가 없는 환경(시험)은 기본 폭 */
export function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return { ref, w };
}
