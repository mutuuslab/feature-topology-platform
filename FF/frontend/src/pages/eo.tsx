// UI23 SW EO 변경관리 · UI24 제품사양과 HW Variant
//
// 두 화면 모두 "발행은 공식 번호와 함께만 성립한다"는 계약을 지킨다.
// SW EO 는 New/Old 구성 비교와 협조 검토를 거쳐 발행하고 BOM 반영을 대사하며,
// 제품사양은 국가·차종·Trim 조합의 판정을 미정(UNKNOWN) 상태로 남겨 임의 확정하지 않는다.
import { useMemo, useState, type ReactNode } from 'react';
import { useApp, useToast } from '../store';
import { CanonicalScreen, FIELD, Gated, Reasons, StageRail, Table, type Kpi } from '../components/AreaScreen';
import { BOM_BASELINES } from '../data/featureBom';
import {
  EO_CHANGE_TYPES, EO_STATE_KO, EO_STATES, SEED_EOS, SEED_SPECS, SEED_STRUCTURES, SEED_UPGS,
  SPEC_STATE_KO, SPEC_STATE_TONE, eoGate, specStats,
  type EoState, type ProductSpec, type SpecState, type SwEo, type VariantRow,
} from '../data/plmData';

const Pill = ({ s, tone }: { s: string; tone?: string }) => (
  <span className="pill" style={{ background: tone || 'var(--surface-2)', color: tone ? '#fff' : 'var(--muted)', borderColor: 'transparent' }}>{s}</span>
);
const Note = ({ children }: { children: ReactNode }) => <p className="small muted" style={{ marginTop: 8 }}>{children}</p>;

const EO_STEP_KO: Record<EoState, string> = {
  DRAFT: '초안', IN_REVIEW: '협조 검토', APPROVED: '승인', ISSUE_PENDING: '발행 대기', ISSUED: '발행', ACK_PENDING: 'BOM 반영 대기', ACKED: '반영 확인',
};
const EO_STAGES = EO_STATES.map(s => ({ key: s, ko: EO_STEP_KO[s] }));

/** Structure 참조 `STR-BDC-SW@1.1` 을 구성원 목록으로 편다 — 없는 버전이면 빈 목록. */
function membersOf(ref: string) {
  const [id, ver] = ref.split('@');
  const s = SEED_STRUCTURES.find(x => x.id === id && x.version === ver);
  return s ? s.members : [];
}

// ═══════════════════════════════════ UI23 ═══════════════════════════════════
export function SwEoChange() {
  const { state, dispatch, can } = useApp();
  const toast = useToast();
  const [eos, setEos] = useState<SwEo[]>(() => SEED_EOS.map(e => ({ ...e })));
  const [pick, setPick] = useState(SEED_EOS[0].id);
  const [form, setForm] = useState({ name: '', structure: 'STR-BDC-SW@1.1', oldStructure: 'STR-BDC-SW@1.0', changeType: 'I', reason: '' });
  const cur = eos.find(e => e.id === pick) || eos[0];
  const audited = (action: string, detail: string) => dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 10:35', actor: state.role, action, target: cur?.id || '-', detail } });
  const patch = (p: Partial<SwEo>) => setEos(list => list.map(e => (e.id === cur.id ? { ...e, ...p } : e)));
  const to = (s: EoState) => {
    if (!cur) return;
    const g = eoGate(cur, s);
    if (!g.ok) { toast(g.reasons[0], 'err'); return; }
    patch({ state: s });
    audited('EO_STATE', `${cur.state} → ${s}`);
    toast(`${cur.id} ${EO_STATE_KO[s]}`, 'ok');
  };

  const newMembers = membersOf(cur?.structure || '');
  const oldMembers = membersOf(cur?.oldStructure || '');
  const diff = useMemo(() => {
    const key = (m: { node: string }) => m.node;
    const o = new Map(oldMembers.map(m => [key(m), m]));
    const n = new Map(newMembers.map(m => [key(m), m]));
    const added = newMembers.filter(m => !o.has(key(m)));
    const removed = oldMembers.filter(m => !n.has(key(m)));
    const changed = newMembers.filter(m => o.has(key(m)) && o.get(key(m))!.sw !== m.sw);
    return { added, removed, changed };
  }, [cur?.structure, cur?.oldStructure]);

  const areas: Record<string, () => ReactNode> = {
    'UI23-S01': () => (
      <div>
        <StageRail steps={EO_STAGES} current={EO_STATE_KO[cur?.state || 'DRAFT']} note="발행 흐름은 앞으로만 간다 — 되돌릴 때는 변경 유형 R 로 새 요청을 만든다." />
        <div className="mt"><Table head={['SW EO', '이름', '변경 유형', 'New 구성', 'Old 구성', '공식 번호', '상태']}>
          {eos.map(e => (
            <tr key={e.id} onClick={() => setPick(e.id)} style={{ cursor: 'pointer', background: e.id === pick ? 'var(--surface-2)' : undefined }}>
              <td className="mono">{e.id}</td><td>{e.name}</td><td>{e.changeType}</td>
              <td className="mono small">{e.structure}</td><td className="mono small">{e.oldStructure || '—'}</td>
              <td className="mono small">{e.officialNo || '—'}</td><td><Pill s={EO_STATE_KO[e.state]} /></td>
            </tr>
          ))}
        </Table></div>
        <div className="card mt" style={{ background: 'var(--surface-2)' }}>
          <b className="small">변경요청 생성</b>
          <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))', gap: 8 }}>
            {([['이름', 'name'], ['New 구성', 'structure'], ['Old 구성', 'oldStructure'], ['변경 유형', 'changeType'], ['사유', 'reason']] as [string, keyof typeof form][]).map(([l, k]) => (
              <label key={k} className="small muted">{l}
                <input style={{ ...FIELD, marginTop: 4 }} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <div className="row mt" style={{ gap: 8, alignItems: 'center' }}>
            <Gated label="변경요청 생성" kind="primary"
              reasons={!form.name.trim() ? ['이름 없음'] : !membersOf(form.structure).length ? [`New 구성 ${form.structure} 을 찾을 수 없다`] : !form.reason.trim() ? ['변경 사유 없음'] : []}
              onClick={() => {
                const id = `EO-2026-${String(44 + eos.length).padStart(4, '0')}`;
                const e: SwEo = {
                  id, name: form.name, structure: form.structure, oldStructure: form.oldStructure,
                  changeType: (EO_CHANGE_TYPES as readonly string[]).includes(form.changeType) ? (form.changeType as SwEo['changeType']) : 'I',
                  reason: form.reason, mainText: '', aText: '', bText: '', officialNo: '', state: 'DRAFT', review: '', bomAck: '',
                };
                setEos([e, ...eos]); setPick(id); setForm({ ...form, name: '', reason: '' });
                dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 10:35', actor: state.role, action: 'EO_CREATE', target: id, detail: form.structure } });
                toast(`${id} 생성됨 (초안)`, 'ok');
              }} />
            <span className="small muted">전역 유일 ID 를 붙인다 — 같은 이름의 변경요청도 각각 별건으로 추적한다.</span>
          </div>
        </div>
      </div>
    ),
    'UI23-S02': () => (
      <div>
        <Table head={['구분', '구성원', 'SW 버전', 'Old', 'New', '판정']}>
          {diff.added.map(m => <tr key={'a' + m.node}><td>추가</td><td className="mono">{m.node}</td><td className="mono">{m.sw}</td><td>—</td><td className="mono">{m.sw}</td><td><Pill s="추가" tone="#2f855a" /></td></tr>)}
          {diff.removed.map(m => <tr key={'r' + m.node}><td>삭제</td><td className="mono">{m.node}</td><td className="mono">{m.sw}</td><td className="mono">{m.sw}</td><td>—</td><td><Pill s="삭제" tone="#c53030" /></td></tr>)}
          {diff.changed.map(m => {
            const old = oldMembers.find(x => x.node === m.node)!;
            return <tr key={'c' + m.node}><td>버전 변경</td><td className="mono">{m.node}</td><td className="mono">{old.sw} → {m.sw}</td><td className="mono">{old.sw}</td><td className="mono">{m.sw}</td><td><Pill s="변경" tone="#b8860b" /></td></tr>;
          })}
        </Table>
        {diff.added.length + diff.removed.length + diff.changed.length === 0 && <Note>New/Old 구성 차이가 없다 — 구성 참조가 같은지 먼저 확인한다.</Note>}
        <div className="kv small mt">계층 수 New {membersOf(cur?.structure || '').length} · Old {oldMembers.length} · 변경 유형 {cur?.changeType}</div>
      </div>
    ),
    'UI23-S03': () => (
      <div>
        {([['Main — 변경 본문', 'mainText'], ['A — 선행 차종 적용', 'aText'], ['B — 후속 차종 적용', 'bText']] as [string, keyof SwEo][]).map(([l, k]) => (
          <label key={k} className="small muted" style={{ display: 'block', marginTop: 8 }}>{l}
            <textarea style={{ ...FIELD, marginTop: 4, minHeight: 56 }} value={(cur?.[k] as string) || ''}
              onChange={e => { patch({ [k]: e.target.value } as Partial<SwEo>); }} disabled={!can('edit')} />
          </label>
        ))}
        <Reasons list={[!cur?.reason?.trim() ? '변경 사유 없음' : '', !cur?.mainText?.trim() ? 'Main 변경 내용 없음' : ''].filter(Boolean)} title="승인 전 필수 근거" ok={!!cur?.reason?.trim() && !!cur?.mainText?.trim()} />
        <Note>A/B 는 차종별 적용 시점을 적는 자리다 — 비워둘 수 있지만 그때는 적용 없음(—)으로 남긴다.</Note>
      </div>
    ),
    'UI23-S04': () => (
      <div>
        <div className="row" style={{ gap: 8 }}>
          {(['IN_REVIEW', 'APPROVED', 'ISSUE_PENDING', 'ISSUED'] as EoState[]).map(s => (
            <Gated key={s} label={`${EO_STATE_KO[s]} 로`} kind={s === 'ISSUED' ? 'primary' : undefined}
              reasons={eoGate(cur, s).reasons} onClick={() => to(s)} />
          ))}
        </div>
        <div className="mt" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="small muted">협조 검토 결과
            <input style={{ ...FIELD, marginTop: 4 }} value={cur?.review || ''} placeholder="품질 검토 완료 (YYYY-MM-DD)" onChange={e => patch({ review: e.target.value })} />
          </label>
          <label className="small muted">공식 번호
            <input style={{ ...FIELD, marginTop: 4 }} value={cur?.officialNo || ''} placeholder="EO-BDC-2026-0044" onChange={e => patch({ officialNo: e.target.value })} />
          </label>
        </div>
        <div className="mt"><Reasons list={[...eoGate(cur, 'APPROVED').reasons, ...eoGate(cur, 'ISSUED').reasons]} title="발행 요청 조건" ok={!eoGate(cur, 'APPROVED').reasons.length && !eoGate(cur, 'ISSUED').reasons.length} /></div>
        <Note>공식 번호 없이 ISSUED 로 넘길 수 없다 — 화면 잠금과 서버 재검사가 같은 조건을 쓴다.</Note>
      </div>
    ),
    'UI23-S05': () => {
      const target = BOM_BASELINES.find(b => b.topologyNodes.some(n => n.startsWith('FEAT-BDC-001')));
      return (
        <div>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <label className="small muted">BOM 반영 결과
              <input style={{ ...FIELD, marginTop: 4 }} value={cur?.bomAck || ''} placeholder="BOM-BDC-2026.09@1.1 반영" onChange={e => patch({ bomAck: e.target.value })} />
            </label>
            <Gated label="반영 확인(ACKED) 로" reasons={eoGate(cur, 'ACK_PENDING').reasons} onClick={() => to('ACK_PENDING')} />
            <Gated label="대사 완료(ACKED) 로" kind="primary" reasons={eoGate(cur, 'ACKED').reasons} onClick={() => to('ACKED')} />
          </div>
          <div className="mt"><Table head={['기준선', '상태', '구성원', '대사 판정']}>
            {target && <tr><td className="mono">{target.id}@{target.version}</td><td><Pill s={target.state} /></td>
              <td className="small mono">{target.members.map(m => m.featureVersionRef).join(', ')}</td>
              <td>{cur?.bomAck ? <Pill s="일치" tone="#2f855a" /> : <Pill s="보류" tone="#b8860b" />}</td></tr>}
          </Table></div>
          <Note>대사는 EO 발행 내용과 기준선 구성원이 같은 버전을 가리키는지 본다 — 다르면 되돌리지 않고 새 변경요청을 만든다.</Note>
        </div>
      );
    },
    'UI23-S06': () => (
      <div>
        <div className="row" style={{ gap: 8 }}>
          <Gated label="원천 재처리 요청" reasons={can('run-engine') ? [] : ['재처리 권한 없음']} onClick={() => { audited('EO_REPROCESS', cur?.officialNo || cur?.id || ''); toast('재처리 요청을 보냈다', 'ok'); }} />
          <span className="small muted">재처리는 발행 상태를 바꾸지 않는다 — 결과는 원천 대사 줄에만 남는다.</span>
        </div>
        <div className="mt"><Table head={['시각', '행위자', '행위', '내용']}>
          {state.audit.filter(a => a.target === cur?.id).slice(0, 12).map((a, i) => <tr key={i}><td className="mono small">{a.ts}</td><td>{a.actor}</td><td>{a.action}</td><td className="small muted">{a.detail}</td></tr>)}
        </Table></div>
      </div>
    ),
  };

  const kpis: Kpi[] = [
    { v: eos.length, l: 'SW EO' },
    { v: eos.filter(e => e.state === 'ISSUED' || e.state === 'ACK_PENDING' || e.state === 'ACKED').length, l: '발행' },
    { v: eos.filter(e => e.state === 'ACKED').length, l: '반영 확인' },
    { v: diff.added.length + diff.removed.length + diff.changed.length, l: '선택 EO 차이' },
  ];
  return <CanonicalScreen screenId="UI23" title="SW EO 변경관리" core="C27 S/W 배포 기능 출시 분리" kpis={kpis} areas={areas} />;
}

// ═══════════════════════════════════ UI24 ═══════════════════════════════════
export function ProductSpec() {
  const { state, dispatch, can } = useApp();
  const toast = useToast();
  const [specs, setSpecs] = useState<ProductSpec[]>(() => SEED_SPECS.map(s => ({ ...s, rows: s.rows.map(r => ({ ...r })) })));
  const [pick, setPick] = useState(SEED_SPECS[0].id);
  const [form, setForm] = useState({ model: '', plant: 'KR-HMA', market: 'KR', options: '' });
  const [probe, setProbe] = useState({ nation: 'KR', trim: 'Premium' });
  const cur = specs.find(s => s.id === pick) || specs[0];
  const st = specStats(cur?.rows || []);
  const audited = (action: string, detail: string) => dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 10:50', actor: state.role, action, target: cur?.id || '-', detail } });
  const patch = (p: Partial<ProductSpec>) => setSpecs(list => list.map(s => (s.id === cur.id ? { ...s, ...p } : s)));
  const setRow = (row: VariantRow, review: SpecState) => patch({ rows: cur.rows.map(r => (r === row ? { ...r, review, note: review === 'UNKNOWN' ? '검토 중 — 임의 확정 금지' : r.note } : r)) });

  const areas: Record<string, () => ReactNode> = {
    'UI24-S01': () => (
      <div>
        <Table head={['사양', 'Revision', '차종', '공장', '시장', '상태', '조건행']}>
          {specs.map(s => (
            <tr key={s.id} onClick={() => setPick(s.id)} style={{ cursor: 'pointer', background: s.id === pick ? 'var(--surface-2)' : undefined }}>
              <td className="mono">{s.id}</td><td className="mono">r{s.revision}</td><td>{s.model}</td><td>{s.plant}</td>
              <td>{s.market}</td><td><Pill s={SPEC_STATE_KO[s.state]} tone={SPEC_STATE_TONE[s.state]} /></td><td>{s.rows.length}</td>
            </tr>
          ))}
        </Table>
        <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr)) 160px', gap: 8, alignItems: 'end' }}>
          {([['차종', 'model'], ['공장', 'plant'], ['시장', 'market'], ['옵션', 'options']] as [string, keyof typeof form][]).map(([l, k]) => (
            <label key={k} className="small muted">{l}<input style={{ ...FIELD, marginTop: 4 }} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} /></label>
          ))}
          <Gated label="Revision 추가" kind="primary" reasons={!form.model.trim() ? ['차종 없음'] : can('edit') ? [] : ['편집 권한 없음']}
            onClick={() => {
              const next = String(Number(cur?.revision || '0') + 1);
              const s: ProductSpec = { id: `SPEC-${form.model}-${form.market}`, revision: next, model: form.model, plant: form.plant, market: form.market === 'EU' ? 'EU' : 'KR', options: form.options, state: 'DRAFT', rows: [] };
              setSpecs([s, ...specs]); setPick(s.id); setForm({ ...form, model: '', options: '' });
              dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 10:50', actor: state.role, action: 'SPEC_REVISION', target: s.id, detail: `r${next}` } });
              toast(`${s.id} r${next} 생성됨`, 'ok');
            }} />
        </div>
        <Note>Revision 은 덮어쓰지 않는다 — 조건이 바뀌면 새 Revision 을 만들고 이전 Revision 을 그대로 남긴다.</Note>
      </div>
    ),
    'UI24-S02': () => (
      <div>
        <Table head={['HW', 'SW 조건', '기능 지원', '판정']}>
          {[['ECU-BDC-C · Gen3', '≥3.2.0', 'BDC 전체', '지원'], ['ECU-BDC-B · Gen3', '≥3.2.0', 'BDC 전체', '지원'], ['ECU-BDC-B · Gen2', '2.x', 'BDC 부분', '미지원'], ['ECU-ADAS-A · Gen3', '≥2.0.0', 'ADAS Long', '지원']].map(r => (
            <tr key={r[0]}><td className="mono">{r[0]}</td><td className="mono">{r[1]}</td><td>{r[2]}</td>
              <td><Pill s={r[3]} tone={r[3] === '지원' ? '#2f855a' : '#c53030'} /></td></tr>
          ))}
        </Table>
        <Note>HW 세대와 SW 조건이 모두 만족해야 조건행이 ALLOW 가 된다 — 하나라도 비면 UNKNOWN 이다.</Note>
      </div>
    ),
    'UI24-S03': () => {
      const hit = (cur?.rows || []).find(r => r.nation === probe.nation && r.trim === probe.trim);
      return (
        <div>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <label className="small muted">국가
              <select style={{ ...FIELD, marginTop: 4 }} value={probe.nation} onChange={e => setProbe({ ...probe, nation: e.target.value })}>
                {['KR', 'EU', 'US', 'CN'].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="small muted">Trim
              <select style={{ ...FIELD, marginTop: 4 }} value={probe.trim} onChange={e => setProbe({ ...probe, trim: e.target.value })}>
                {['Premium', 'Standard'].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <div className="kv small mt">
            판정 <b>{hit ? SPEC_STATE_KO[hit.review] : '조건행 없음'}</b> · Variant <span className="mono">{hit?.variant || '—'}</span>
          </div>
          {hit?.review === 'UNKNOWN' && <Note>미정은 허용도 차단도 아니다 — 근거를 채우기 전에는 발행 화면에서도 열리지 않는다.</Note>}
          {!hit && <Note>이 조합은 사양에 행이 없다 — 비어 있음은 차단이 아니라 미정이다.</Note>}
        </div>
      );
    },
    'UI24-S04': () => (
      <div>
        <Table head={['국가', '시장', '차종', 'Trim', 'Variant', '판정', '비고']}>
          {cur?.rows.map((r, i) => (
            <tr key={i}><td>{r.nation}</td><td>{r.market}</td><td className="mono">{r.model}</td><td>{r.trim}</td>
              <td className="mono small">{r.variant}</td>
              <td>
                <select style={{ ...FIELD, padding: '2px 4px' }} value={r.review} disabled={!can('edit')} onChange={e => setRow(r, e.target.value as SpecState)}>
                  {(['DRAFT', 'ALLOW', 'DENY', 'UNKNOWN'] as SpecState[]).map(s => <option key={s} value={s}>{SPEC_STATE_KO[s]}</option>)}
                </select>
              </td>
              <td className="small muted">{r.note || '—'}</td></tr>
          ))}
        </Table>
        <div className="mt"><Gated label="조건행 추가" reasons={can('edit') ? [] : ['편집 권한 없음']} onClick={() => {
          patch({ rows: [...cur.rows, { nation: probe.nation, market: probe.nation, model: cur.model, trim: probe.trim, variant: '', review: 'UNKNOWN', note: '검토 중 — 임의 확정 금지' }] });
          audited('SPEC_ROW_ADD', `${probe.nation} ${probe.trim}`);
        }} /></div>
        <div className="mt small muted">허용 {st.allow} · 차단 {st.deny} · 미정 {st.unknown} — 미정을 허용으로 바꾸려면 근거를 적어야 한다.</div>
      </div>
    ),
    'UI24-S05': () => (
      <div>
        <Table head={['UPG', 'UPG VC', '식별', '차종 코드', '사양 조건행']}>
          {SEED_UPGS.map(u => {
            const rows = (cur?.rows || []).filter(r => r.model.split('-')[0] === u.modelCode);
            return <tr key={u.id}><td className="mono">{u.id}</td><td>{u.vc}</td><td className="mono small">{u.system}-{u.component}-{u.modelNo}-{u.modelCode}-{u.serial}</td>
              <td className="mono">{u.modelCode}</td><td className="small">{rows.length ? rows.map(r => `${r.nation}/${r.trim}`).join(', ') : '—'}</td></tr>;
          })}
        </Table>
        <Note>적용 매핑은 사양 조건행과 UPG 차종 코드가 같이 맞아야 성립한다 — 한쪽만 바뀌면 매핑이 끊긴 것으로 본다.</Note>
      </div>
    ),
    'UI24-S06': () => (
      <div>
        <div className="row" style={{ gap: 8 }}>
          {(['DRAFT', 'ALLOW', 'DENY'] as SpecState[]).map(s => (
            <Gated key={s} label={`${SPEC_STATE_KO[s]} 로`} kind={s === 'ALLOW' ? 'primary' : undefined}
              reasons={cur?.state === s ? ['이미 같은 상태다'] : st.unknown > 0 && s === 'ALLOW' ? [`미정 조건행 ${st.unknown}건이 남아 있다`] : can('approve') ? [] : ['승인 권한 없음']}
              onClick={() => { patch({ state: s }); audited('SPEC_STATE', `${cur?.state} → ${s}`); toast(`${cur?.id} ${SPEC_STATE_KO[s]}`, 'ok'); }} />
          ))}
        </div>
        <div className="mt"><Reasons list={st.unknown > 0 ? [`미정 조건행 ${st.unknown}건 — 판정 근거 필요`] : []} title="검증 승인 조건" ok={st.unknown === 0} /></div>
        <div className="mt"><Table head={['시각', '행위자', '행위', '내용']}>
          {state.audit.filter(a => a.target === cur?.id).slice(0, 10).map((a, i) => <tr key={i}><td className="mono small">{a.ts}</td><td>{a.actor}</td><td>{a.action}</td><td className="small muted">{a.detail}</td></tr>)}
        </Table></div>
      </div>
    ),
  };

  const kpis: Kpi[] = [
    { v: specs.length, l: '사양 Revision' },
    { v: st.allow, l: '판정 허용' },
    { v: st.deny, l: '판정 차단' },
    { v: st.unknown, l: '미정' },
  ];
  return <CanonicalScreen screenId="UI24" title="제품사양과 HW Variant" core="C15 적용 대상 선정" kpis={kpis} areas={areas} />;
}
