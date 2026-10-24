// 전체 지도 — 13개 절차를 가치 사슬 흐름으로. 생애주기는 화살표로 차례로 잇고, 지원 절차는 아래 띠에 둔다.
// 칸마다 내 역할 참여(내 활동 수·내 차례)와 완료를 표시하고, 칸을 누르면 그 절차의 흐름도로 간다.
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { WorkflowDoc } from '@ff/contracts';
import { procedureFlow as F } from '../../../copy/procedureFlow';
import { Segmented } from '../../../design';
import { ArrowDefs, useFlowStatuses, useWidth } from './FlowParts';
import { layoutValueChain } from './valueChain';
import { ellipsize, wrapText } from './svgText';

export function ValueChainMap({ doc, sample }: { doc: WorkflowDoc; sample?: readonly string[] }) {
  const { statuses } = useFlowStatuses(doc, sample);
  const nav = useNavigate();
  const [mode, setMode] = useState<'diagram' | 'text'>('diagram');
  const { ref, w } = useWidth(1040);
  const layout = layoutValueChain(doc.processes, w - 2);
  const stats = new Map(
    doc.processes.map((p) => {
      const s = p.activities.map((a) => statuses.get(a.id));
      return [p.id, { mine: s.filter((x) => x?.mine).length, turn: s.filter((x) => x?.mine && (x.state === 'mine' || x.state === 'overdue')).length, done: s.filter((x) => x?.state === 'done').length, total: p.activities.length }];
    }),
  );
  const proc = new Map(doc.processes.map((p) => [p.id, p]));
  const marker = `pf-chain-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div className="pf-view" data-mode={mode}>
      <p className="ds-field__hint pf-hint">{F.chain.hint}</p>
      <div className="pf-toolbar">
        <Segmented<'diagram' | 'text'> label={F.views.label} value={mode} onChange={setMode} options={[{ value: 'diagram', label: F.views.diagram }, { value: 'text', label: F.views.text }]} />
      </div>
      {mode === 'diagram' ? (
        <div className="pf-scroll" ref={ref}>
          <svg className="pf-svg pf-chainmap" viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} role="group" aria-label={F.chain.title}>
            <ArrowDefs id={marker} />
            <text className="pf-chainmap__title" x={8} y={18}>{F.chain.life}</text>
            {layout.supportBand && (
              <>
                <rect className="pf-chainmap__band" x={0} y={layout.supportBand.y} width={layout.width} height={layout.supportBand.h} rx={8} />
                <text className="pf-chainmap__title" x={8} y={layout.supportBand.y + 24}>{F.chain.support}</text>
              </>
            )}
            <g aria-hidden>
              {layout.arrows.map((a) => (
                <polyline key={`${a.from}>${a.to}`} className="pf-edge pf-edge--flow" points={a.points.map((q) => q.join(',')).join(' ')} markerEnd={`url(#${marker})`} />
              ))}
            </g>
            {layout.boxes.map((b) => {
              const p = proc.get(b.id)!;
              const s = stats.get(b.id)!;
              const go = () => nav(`/procedures/${p.id}`);
              const lines = wrapText(p.name, b.w - 16, 12, 2);
              return (
                <g
                  key={b.id}
                  className="pf-proc"
                  role="link"
                  tabIndex={0}
                  data-process={p.id}
                  data-mine={s.mine ? '' : undefined}
                  data-turn={s.turn ? '' : undefined}
                  aria-label={F.chain.boxLabel(p.id, p.name, s.mine, s.turn, s.done, s.total)}
                  onClick={go}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      go();
                    }
                  }}
                >
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={5} />
                  <text className="pf-node__id" x={b.x + 8} y={b.y + 16}>{ellipsize(`${p.id}${p.gates.length ? ` · ${p.gates.join('·')}` : ''}`, b.w - 16, 10)}</text>
                  {lines.map((t, j) => (
                    <text key={j} className="pf-node__name" x={b.x + 8} y={b.y + 34 + j * 15}>{t}</text>
                  ))}
                  <text className="pf-proc__meta" x={b.x + 8} y={b.y + b.h - 30}>
                    {ellipsize(`${s.mine ? F.chain.mine(s.mine) : F.chain.none}${s.turn ? ` · ${F.chain.turn(s.turn)}` : ''}`, b.w - 16, 11)}
                  </text>
                  <rect className="pf-proc__track" x={b.x + 8} y={b.y + b.h - 18} width={b.w - 76} height={4} rx={2} />
                  <rect className="pf-proc__bar" x={b.x + 8} y={b.y + b.h - 18} width={((b.w - 76) * s.done) / Math.max(1, s.total)} height={4} rx={2} />
                  <text className="pf-proc__meta" x={b.x + b.w - 8} y={b.y + b.h - 12} textAnchor="end">{F.chain.progress(s.done, s.total)}</text>
                  {s.mine > 0 && (
                    <g className="pf-proc__marker" aria-hidden>
                      <circle cx={b.x + b.w - 12} cy={b.y + 12} r={6} />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="pf-text__scroll">
          <table className="ds-table pf-table">
            <caption>{F.chain.textCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{F.chain.col.process}</th>
                <th scope="col">{F.chain.col.group}</th>
                <th scope="col">{F.chain.col.gates}</th>
                <th scope="col">{F.chain.col.mine}</th>
                <th scope="col">{F.chain.col.turn}</th>
                <th scope="col">{F.chain.col.progress}</th>
              </tr>
            </thead>
            <tbody>
              {doc.processes.map((p) => {
                const s = stats.get(p.id)!;
                return (
                  <tr key={p.id} data-mine={s.mine ? '' : undefined}>
                    <th scope="row"><Link to={`/procedures/${p.id}`}>{p.id} {p.name}</Link></th>
                    <td>{p.group}</td>
                    <td>{p.gates.join(', ') || F.process.none}</td>
                    <td>{s.mine}</td>
                    <td>{s.turn}</td>
                    <td>{F.chain.progress(s.done, s.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
