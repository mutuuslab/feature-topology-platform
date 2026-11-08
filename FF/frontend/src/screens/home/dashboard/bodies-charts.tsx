// 차트 가젯 본문 — 통계 원형 차트·2차원 통계·생성 대 해결·Lifecycle 분포(Jira 가젯 모양, SVG). 필요할 때만 읽는 묶음.
// 색만으로 읽지 않는다: 범례·표에 건수와 비율을 글자로 적고, 원형 조각은 범례 단추로도 누를 수 있다(키보드).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LIFECYCLE } from '@ff/contracts';
import { useApi } from '../../../api/hooks';
import { dashboard } from '../../../copy/dashboard';
import { Lozenge } from '../../../design';
import type { GadgetBodyProps } from './Dashboard';
import { GadgetState, JiraTable, KeyLink, SERIES, Status } from './parts';
import { countBy, fieldValue, SourceData, sourceOf, type FieldKey, type Row, type SourceId } from './sources';

const B = dashboard.board;
const Bd = B.body;
const F = B.fields;
const MAX_SLICES = 7;

/** 큰 것부터 MAX_SLICES개, 나머지는 '기타' */
function slices(rows: Row[], field: FieldKey) {
  const all = countBy(rows, field);
  const head = all.slice(0, MAX_SLICES);
  const rest = all.slice(MAX_SLICES).reduce((n, x) => n + x.n, 0);
  return { list: rest ? [...head, { value: '\u0000other', n: rest }] : head, total: rows.length, others: new Set(all.slice(MAX_SLICES).map((x) => x.value)) };
}
const sliceLabel = (v: string) => (v === '\u0000other' ? Bd.other : v || Bd.none);
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${cx} ${cy}L${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z`;
}

function Drill({ rows, field, value, source, onBack }: { rows: Row[]; field: FieldKey; value: string; source: SourceId; onBack: () => void }) {
  const src = sourceOf(source);
  const hit = rows.filter((r) => fieldValue(r, field) === value);
  const url = src.listUrl?.(field, value);
  return (
    <div className="jd-drill">
      <p className="jd-drill__head">
        <button type="button" className="jd-btn jd-btn--subtle" onClick={onBack}>
          {Bd.backToChart}
        </button>
        <strong>{Bd.drill(F[field], value || Bd.none)}</strong>
        {url && <Link to={url}>{Bd.viewAll}</Link>}
      </p>
      <JiraTable
        caption={Bd.drill(F[field], value || Bd.none)}
        rows={hit.slice(0, 20)}
        rowKey={(r) => r.key}
        columns={[
          { key: 'key', header: F.key, cell: (r) => <KeyLink to={r.to}>{r.key}</KeyLink> },
          { key: 'summary', header: F.summary, grow: true, cell: (r) => <span className="jd-summary">{r.summary}</span> },
          { key: 'status', header: F.status, cell: (r) => <Status value={r.status} /> },
        ]}
      />
    </div>
  );
}

function Pie({ gadget }: GadgetBodyProps) {
  const c = gadget.config;
  const src = sourceOf(c.source);
  const field = (src.groups.includes(c.groupBy as FieldKey) ? c.groupBy : src.groups[0]) as FieldKey;
  const [drill, setDrill] = useState<string | null>(null);
  return (
    <SourceData key={src.id} source={src.id}>
      {({ rows, state, error, retry }) => {
        if (drill !== null && state === 'ready') return <Drill rows={rows} field={field} value={drill} source={src.id} onBack={() => setDrill(null)} />;
        const s = slices(rows, field);
        let a = 0;
        return (
          <GadgetState state={state} error={error} retry={retry} empty={!rows.length}>
            <div className="jd-pie">
              <svg viewBox="0 0 200 200" className="jd-pie__svg" aria-hidden focusable="false">
                {s.list.length === 1 ? (
                  <circle cx="100" cy="100" r="92" fill={SERIES[0]} className="jd-pie__slice" onClick={() => s.list[0].value !== '\u0000other' && setDrill(s.list[0].value)} />
                ) : (
                  s.list.map((x, i) => {
                    const a0 = a;
                    a += (x.n / s.total) * Math.PI * 2;
                    return <path key={x.value} d={arc(100, 100, 92, a0, a)} fill={SERIES[i % SERIES.length]} className="jd-pie__slice" onClick={() => x.value !== '\u0000other' && setDrill(x.value)} />;
                  })
                )}
              </svg>
              <table className="jd-legend">
                <caption className="ds-sr">{`${B.types.pie.title}: ${F[field]}`}</caption>
                <thead>
                  <tr>
                    <th scope="col">{F[field]}</th>
                    <th scope="col">{Bd.count}</th>
                    <th scope="col">{Bd.share}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.list.map((x, i) => (
                    <tr key={x.value}>
                      <td>
                        <span className="jd-swatch" style={{ background: SERIES[i % SERIES.length] }} aria-hidden />
                        {x.value === '\u0000other' ? (
                          <span>{Bd.other}</span>
                        ) : (
                          <button type="button" className="jd-linkbtn" onClick={() => setDrill(x.value)} aria-label={Bd.sliceAria(sliceLabel(x.value), x.n, pct(x.n, s.total))}>
                            {sliceLabel(x.value)}
                          </button>
                        )}
                      </td>
                      <td className="jd-num">{x.n}</td>
                      <td className="jd-num">{`${pct(x.n, s.total)}%`}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{Bd.total}</th>
                    <td className="jd-num">{s.total}</td>
                    <td className="jd-num">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </GadgetState>
        );
      }}
    </SourceData>
  );
}

const MAX_AXIS = 8;

function TwoD({ gadget }: GadgetBodyProps) {
  const c = gadget.config;
  const src = sourceOf(c.source);
  const pick = (v: unknown, d: FieldKey) => (src.groups.includes(v as FieldKey) ? (v as FieldKey) : d);
  const y = pick(c.y, src.groups[0]);
  const x = pick(c.x, src.groups[1] ?? src.groups[0]);
  return (
    <SourceData key={src.id} source={src.id}>
      {({ rows, state, error, retry }) => {
        const xs = countBy(rows, x).slice(0, MAX_AXIS).map((v) => v.value);
        const ys = countBy(rows, y).map((v) => v.value);
        const cell = (yv: string, xv: string) => rows.filter((r) => fieldValue(r, y) === yv && fieldValue(r, x) === xv).length;
        const rowTotal = (yv: string) => rows.filter((r) => fieldValue(r, y) === yv).length;
        const colTotal = (xv: string) => rows.filter((r) => fieldValue(r, x) === xv).length;
        return (
          <GadgetState state={state} error={error} retry={retry} empty={!rows.length}>
            <div className="jd-table-wrap">
              <table className="jd-table jd-table--matrix">
                <caption className="ds-sr">{`${B.types.twoD.title}: ${F[y]} × ${F[x]}`}</caption>
                <thead>
                  <tr>
                    <th scope="col">{`${F[y]} \\ ${F[x]}`}</th>
                    {xs.map((v) => (
                      <th key={v} scope="col" className="jd-num">
                        {v ? <Lozenge>{v}</Lozenge> : Bd.none}
                      </th>
                    ))}
                    <th scope="col" className="jd-num">
                      {Bd.total}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ys.map((yv) => (
                    <tr key={yv}>
                      <th scope="row">{yv ? <Lozenge>{yv}</Lozenge> : Bd.none}</th>
                      {xs.map((xv) => {
                        const n = cell(yv, xv);
                        return (
                          <td key={xv} className="jd-num" data-zero={n ? undefined : ''}>
                            {n}
                          </td>
                        );
                      })}
                      <td className="jd-num jd-total">{rowTotal(yv)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{Bd.total}</th>
                    {xs.map((xv) => (
                      <td key={xv} className="jd-num jd-total">
                        {colTotal(xv)}
                      </td>
                    ))}
                    <td className="jd-num jd-total">{rows.length}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </GadgetState>
        );
      }}
    </SourceData>
  );
}

/** 날짜 칸 — 90일은 주 단위 */
function buckets(days: number, now = Date.now()) {
  const step = days > 30 ? 7 : 1;
  const n = Math.ceil(days / step);
  const end = new Date(new Date(now).toISOString().slice(0, 10) + 'T23:59:59.999Z').getTime();
  return Array.from({ length: n }, (_, i) => {
    const to = end - (n - 1 - i) * step * 86_400_000;
    return { from: to - step * 86_400_000, to, label: new Date(to).toISOString().slice(5, 10) };
  });
}

/** 그릴 폭(px) — 차트 좌표를 실제 폭으로 두어 축 글자가 폭에 따라 커지거나 작아지지 않게 */
function useWidth(fallback: number) {
  // 불러오기 뒤에 그려지는 상자 — 붙는 때를 알도록 ref 함수로 받는다
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!el) return;
    const read = () => el.clientWidth && setW(Math.round(el.clientWidth));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, w] as const;
}

function CreatedResolved({ gadget }: GadgetBodyProps) {
  const [box, width] = useWidth(320);
  const c = gadget.config;
  const days = [7, 30, 90].includes(Number(c.days)) ? Number(c.days) : 30;
  const source: SourceId = c.source === 'reviews' ? 'policies' : 'anomalies';
  return (
    <SourceData key={source} source={source}>
      {({ rows, state, error, retry }) => {
        const bs = buckets(days);
        const t = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);
        const created = bs.map((b) => rows.filter((r) => t(r.at) > b.from && t(r.at) <= b.to).length);
        const resolved = bs.map((b) => rows.filter((r) => t(r.closedAt) > b.from && t(r.closedAt) <= b.to).length);
        const sumC = created.reduce((a, b) => a + b, 0);
        const sumR = resolved.reduce((a, b) => a + b, 0);
        const max = Math.max(1, ...created, ...resolved);
        const W = Math.max(200, width);
        const H = 160;
        const L = 24;
        const step = (W - L - 8) / Math.max(1, bs.length - 1);
        const px = (i: number) => L + i * step;
        const py = (v: number) => H - 18 - (v / max) * (H - 30);
        const line = (vs: number[]) => vs.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join('');
        const area = (vs: number[]) => `${line(vs)}L${px(vs.length - 1).toFixed(1)} ${py(0).toFixed(1)}L${px(0).toFixed(1)} ${py(0).toFixed(1)}Z`;
        const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
        return (
          <GadgetState state={state} error={error} retry={retry}>
            <p className="jd-chart__summary">{sumC + sumR ? Bd.trend(days, sumC, sumR) : Bd.noTrend}</p>
            <div ref={box}>
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="jd-trend" role="img" aria-label={Bd.trend(days, sumC, sumR)} focusable="false">
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={L} x2={W - 8} y1={py(v)} y2={py(v)} className="jd-trend__grid" />
                  <text x={L - 6} y={py(v) + 3} className="jd-trend__tick" textAnchor="end">
                    {v}
                  </text>
                </g>
              ))}
              <path d={area(created)} className="jd-trend__area" data-series="created" />
              <path d={area(resolved)} className="jd-trend__area" data-series="resolved" />
              <path d={line(created)} className="jd-trend__line" data-series="created" />
              <path d={line(resolved)} className="jd-trend__line" data-series="resolved" />
              {[0, Math.floor((bs.length - 1) / 2), bs.length - 1].map((i) => (
                <text key={i} x={px(i)} y={H - 4} className="jd-trend__tick" textAnchor={i === 0 ? 'start' : i === bs.length - 1 ? 'end' : 'middle'}>
                  {bs[i].label}
                </text>
              ))}
            </svg>
            </div>
            <p className="jd-chart__legend">
              <span data-series="created">
                <i aria-hidden /> {`${Bd.created} ${sumC}`}
              </span>
              <span data-series="resolved">
                <i aria-hidden /> {`${Bd.resolved} ${sumR}`}
              </span>
            </p>
          </GadgetState>
        );
      }}
    </SourceData>
  );
}

function LifecycleBars() {
  const q = useApi<{ items?: { lifecycle: string }[] }>('listFeatures', { query: { latestOnly: true } });
  const items = Array.isArray(q.data?.items) ? q.data!.items! : [];
  const by = items.reduce<Record<string, number>>((m, x) => ((m[x.lifecycle] = (m[x.lifecycle] ?? 0) + 1), m), {});
  const max = Math.max(1, ...Object.values(by));
  return (
    <GadgetState state={q.isPending ? 'loading' : q.isError ? 'error' : 'ready'} error={q.error} retry={() => void q.refetch()} empty={!items.length} emptyText={Bd.lifecycleNone}>
      {/* Registry와 같은 범위(최신 Version) — 누르면 같은 수의 행이 보인다 */}
      <ul className="jd-bars">
        {LIFECYCLE.filter((lc) => by[lc]).map((lc) => (
          <li key={lc}>
            <Lozenge>{lc}</Lozenge>
            <span className="jd-bars__track" aria-hidden>
              <span className="jd-bars__fill" style={{ inlineSize: `${(by[lc] / max) * 100}%` }} />
            </span>
            <Link to={`/features?lifecycle=${lc}`} className="jd-num" aria-label={`${lc} ${by[lc]}`}>
              {by[lc]}
            </Link>
          </li>
        ))}
      </ul>
    </GadgetState>
  );
}

export default function ChartBody(p: GadgetBodyProps) {
  if (p.gadget.type === 'pie') return <Pie {...p} />;
  if (p.gadget.type === 'twoD') return <TwoD {...p} />;
  if (p.gadget.type === 'createdResolved') return <CreatedResolved {...p} />;
  return <LifecycleBars />;
}
