// 정본 화면 공통 셸 — 상세 영역 6개를 탭으로 가진 화면의 머리(빵부스러기·제목·KPI·탭)를 한 곳에서 그린다.
//
// 영역 이름과 개수는 data/canonical.ts(정본 영역 표)가 정하므로 화면마다 손으로 적지 않는다.
// 화면은 영역별 본문만 넘긴다. 제품에는 요구사양 문서를 두지 않으므로 여기서 문서 링크는 만들지 않는다.
import { type CSSProperties, type ReactNode, useState } from 'react';
import { Breadcrumb } from './Breadcrumb';
import { CANON_AREAS } from '../data/canonical';

export const FIELD: CSSProperties = {
  width: '100%', padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6,
  background: 'var(--surface)', color: 'var(--ink)', font: 'inherit', fontSize: 13,
};

export interface Kpi { v: ReactNode; l: string }

/** 공통 표 — 머리글과 행만 넘긴다(넘침은 .table-wrap 이 처리). */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="table-wrap"><table>
      <thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table></div>
  );
}

/** 차단 사유 목록 — 화면은 사유를 그대로 보여주고 판단은 서버가 다시 한다. */
export function Reasons({ list, title, ok }: { list: string[]; title: string; ok?: boolean }) {
  if (ok) return <div className="small" style={{ color: 'var(--pass)' }}>✓ {title} — 차단 조건 없음</div>;
  return (
    <div className="card" style={{ background: '#FDECEC', borderColor: 'var(--fail)', padding: '10px 12px', marginTop: 10 }}>
      <b className="small" style={{ color: 'var(--fail)' }}>✗ {title}</b>
      <ul className="small" style={{ margin: '6px 0 0 16px', color: 'var(--fail)' }}>
        {list.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </div>
  );
}

/** 조건 미충족을 이유와 함께 비활성으로 보여주는 버튼. */
export function Gated({ label, reasons, onClick, kind }: { label: string; reasons: string[]; onClick?: () => void; kind?: 'primary' | 'danger' }) {
  const ok = reasons.length === 0;
  return (
    <button
      className={`btn ${kind === 'primary' ? 'primary' : kind === 'danger' ? 'danger' : ''}`}
      disabled={!ok}
      title={ok ? label : reasons.join(' · ')}
      onClick={ok ? onClick : undefined}
    >{ok ? label : `🔒 ${label}`}</button>
  );
}

/** 5단계·3경로처럼 갈래가 있는 진행 표시 — 현재 단계와 종료 경로를 함께 보여준다. */
export function StageRail({ steps, current, terminal, note }: { steps: { key: string; ko: string }[]; current: string; terminal?: { ko: string }[]; note?: string }) {
  const at = steps.findIndex(s => s.key === current);
  const closed = at < 0;
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {steps.map((s, i) => {
          const on = !closed && i === at;
          const done = !closed && i < at;
          return (
            <span key={s.key} className="pill" style={{
              background: on ? 'var(--brand)' : done ? 'var(--pass)' : 'var(--surface-2)',
              color: on || done ? '#fff' : 'var(--muted)',
              borderColor: on ? 'var(--brand)' : done ? 'var(--pass)' : 'var(--line)',
            }}>{done ? '✓ ' : on ? '▶ ' : ''}{s.ko}</span>
          );
        })}
        {closed && <span className="pill" style={{ background: 'var(--fail)', color: '#fff', borderColor: 'var(--fail)' }}>■ {current}</span>}
      </div>
      {terminal && terminal.length > 0 && (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <span className="small muted">갈래</span>
          {terminal.map(t => <span key={t.ko} className="pill">{t.ko}</span>)}
        </div>
      )}
      {note && <p className="small muted" style={{ marginTop: 8 }}>{note}</p>}
    </div>
  );
}

export interface CanonicalScreenProps {
  /** 기준 화면 ID — 영역 표 조회와 화면 표식에 쓴다. */
  screenId: string;
  title: string;
  core?: string;
  /** 머리 오른쪽에 두는 화면 고유 요약(선택) */
  head?: ReactNode;
  kpis: Kpi[];
  /** 영역 ID → 본문. 6개 영역을 모두 채워야 한다. */
  areas: Record<string, () => ReactNode>;
  /** 탭을 화면 밖에서 제어할 때 */
  tab?: string;
}

export function CanonicalScreen({ screenId, title, core, head, kpis, areas, tab }: CanonicalScreenProps) {
  const defs = CANON_AREAS[screenId] || [];
  const [local, setLocal] = useState(defs[0]?.id || '');
  const active = tab && areas[tab] ? tab : (areas[local] ? local : defs[0]?.id || '');
  // 본문이 연결되지 않은 영역은 조용히 비우지 않고 탭에 표시한다.
  const miss = defs.filter(d => !areas[d.id]).map(d => d.id);
  const def = defs.find(d => d.id === active) || defs[0];

  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">{title} <span className="pill">{screenId}</span>{core && <> <span className="pill">{core}</span></>}</h1>
      <div className="kpis mt">
        {kpis.map(k => <div className="kpi" key={k.l}><div className="v">{k.v}</div><div className="l">{k.l}</div></div>)}
      </div>
      {head}
      <div className="tabs mt">
        {defs.map(d => (
          <button key={d.id} className={d.id === active ? 'active' : ''} onClick={() => setLocal(d.id)} title={`${d.id} · ${d.name} · ${d.layout}`}>
            {d.name}{miss.includes(d.id) ? ' ⚠' : ''}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <b>{def ? `${def.id} · ${def.name}` : screenId}</b>
          {def && <span className="pill">{def.layout}</span>}
        </div>
        <div className="mt">{def && areas[def.id] ? areas[def.id]() : <span className="muted small">영역 본문이 연결되지 않았다.</span>}</div>
      </div>
    </div>
  );
}
