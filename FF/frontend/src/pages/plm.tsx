// UI07 Catalog 상품 구성 · UI21 UPG와 UPG VC · UI22 SW Structure
//
// 세 화면 모두 "기준정보를 정확 버전으로 고정해 연결한다"는 같은 계약을 가진다.
// 상품은 BOM 기준선을, Structure 는 UPG VC 를, 구성원은 SW 정확 버전을 참조하며
// 참조가 비면 화면이 그 이유를 그대로 보여주고 진행 버튼을 잠근다.
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useLiveSlices, useToast } from '../store';
import { CanonicalScreen, FIELD, Gated, Reasons, Table, type Kpi } from '../components/AreaScreen';
import { BOM_BASELINES, baselineUsageOf } from '../data/featureBom';
import {
  CHECK_KO, EO_STATE_KO, OFFER_DELIVERY, OFFER_STATE_KO, OFFER_STATE_TONE, SEED_EOS, SEED_OFFERS, SEED_STRUCTURES, SEED_UPGS,
  STRUCT_STATE_KO, UPG_STATE_KO, UPG_STATES, offerGate, structureCheck, upgIdent,
  type Offer, type OfferState, type StructState, type SwStructure, type Upg,
} from '../data/plmData';

const STATE_TONE: Record<string, string> = {
  DRAFT: '#8a8f98', IN_REVIEW: '#b8860b', APPROVED: '#2b6cb0', PUBLISHED: '#2f855a',
  WITHDRAWN: '#c53030', RETIRED: '#9ca3af', INVALID: '#c53030', VALIDATED: '#2b6cb0', FROZEN: '#2f855a',
};
const Pill = ({ s }: { s: string }) => <span className="pill" style={{ background: STATE_TONE[s] || 'var(--surface-2)', color: '#fff', borderColor: 'transparent' }}>{s}</span>;

/** 근거 없는 판정은 화면에 남기지 않는다 — 사유가 있으면 사유를, 없으면 없다고 적는다. */
function Note({ children }: { children: ReactNode }) {
  return <p className="small muted" style={{ marginTop: 8 }}>{children}</p>;
}

function Fields<T extends string>({ cols, values, onChange }: { cols: [string, T][]; values: Record<T, string>; onChange: (k: T, v: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, minmax(120px, 1fr))`, gap: 8 }}>
      {cols.map(([label, key]) => (
        <label key={key} className="small muted">{label}
          <input style={{ ...FIELD, marginTop: 4 }} value={values[key]} onChange={e => onChange(key, e.target.value)} />
        </label>
      ))}
    </div>
  );
}

// ═══════════════════════════════════ UI07 ═══════════════════════════════════
type OfferKey = 'name' | 'version' | 'bomRef' | 'topologyRef' | 'market' | 'delivery';
const OFFER_FORM: Record<OfferKey, string> = { name: '', version: '1.0', bomRef: '', topologyRef: '', market: 'KR', delivery: 'OPTION' };

export function OfferComposition() {
  const nav = useNavigate();
  const { state, dispatch, can } = useApp();
  const { subscriptions } = useLiveSlices();
  const toast = useToast();
  const [offers, setOffers] = useState<Offer[]>(() => SEED_OFFERS.map(o => ({ ...o, items: [...o.items] })));
  const [pick, setPick] = useState(SEED_OFFERS[0].id);
  const [form, setForm] = useState<Record<OfferKey, string>>(OFFER_FORM);
  const [item, setItem] = useState({ feature: state.features[0]?.id || '', version: '', role: 'BASE' });

  const cur = offers.find(o => o.id === pick) || offers[0];
  const have = (ref: string) => state.bomBaselines.some(b => `${b.id}@${b.version}` === ref);
  const gate = cur ? offerGate(cur, have) : { ok: false, reasons: ['상품이 없다'] };

  /** 등록 검증 — OfferingItem 이 참조하는 Feature 가 구성에서 요구·배제 관계를 어기는지 본다. */
  const conflicts = useMemo(() => {
    if (!cur) return [];
    const out: string[] = [];
    const rel = state.relations;
    cur.items.forEach(i => {
      const need = rel.filter(r => r.source === i.feature && (r.type === 'requires' || r.type === 'composed_of')).map(r => r.target.split('@')[0]);
      need.forEach(n => { if (!cur.items.some(x => x.feature === n)) out.push(`${i.feature} 이(가) 요구하는 ${n} 이 Offering 구성에 없다`); });
      const ban = rel.filter(r => r.source === i.feature && r.type === 'excludes').map(r => r.target.split('@')[0]);
      ban.forEach(n => { if (cur.items.some(x => x.feature === n && x !== i)) out.push(`${i.feature} 은(는) ${n} 과(와) 함께 구성할 수 없다`); });
      if (!i.exactVersion.trim()) out.push(`${i.feature} 정확 버전 미지정`);
    });
    const dupe = cur.items.map(i => i.feature).filter((f, i, a) => a.indexOf(f) !== i);
    dupe.forEach(f => out.push(`${f} 중복 구성`));
    if (!cur.bomRef.trim()) out.push('BOM 기준선 미지정');
    return out;
  }, [cur, state.relations]);

  const audited = (action: string, target: string, detail: string) =>
    dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 10:00', actor: state.role, action, target, detail } });

  const patch = (p: Partial<Offer>) => setOffers(list => list.map(o => (o.id === cur.id ? { ...o, ...p } : o)));

  const move = (to: OfferState) => {
    if (!cur) return;
    const g = offerGate({ ...cur, publish: to }, have);
    if (!g.ok) { toast(g.reasons[0], 'err'); return; }
    patch({ publish: to });
    audited('OFFER_PUBLISH', cur.id, `${cur.publish} → ${to}`);
    toast(`${cur.id} ${OFFER_STATE_KO[to]}`, 'ok');
  };

  const areas: Record<string, () => ReactNode> = {
    'UI07-S01': () => (
      <div>
        {cur && <div className="kv small"><b>{cur.id}</b> · {cur.name} · v{cur.version} <Pill s={cur.publish} /></div>}
        <div className="mt"><Table head={['상품', '이름', '버전', 'BOM 기준선', '시장', '제공 방식', '상태', '구성']}>
          {offers.map(o => (
            <tr key={o.id} onClick={() => setPick(o.id)} style={{ cursor: 'pointer', background: o.id === pick ? 'var(--surface-2)' : undefined }}>
              <td className="mono">{o.id}</td><td>{o.name}</td><td className="mono">v{o.version}</td>
              <td className="mono">{o.bomRef || '—'}{have(o.bomRef) ? '' : ' ⚠'}</td>
              <td>{o.market}</td><td>{o.delivery}</td><td><Pill s={o.publish} /></td>
              <td>{o.items.length}건</td>
            </tr>
          ))}
        </Table></div>
        <div className="card mt" style={{ background: 'var(--surface-2)' }}>
          <b className="small">상품 등록</b>
          <div className="mt"><Fields<OfferKey> cols={[['상품명', 'name'], ['버전', 'version'], ['BOM 기준선', 'bomRef'], ['Topology', 'topologyRef'], ['시장', 'market'], ['제공 방식', 'delivery']]} values={form} onChange={(k, v) => setForm({ ...form, [k]: v })} /></div>
          <div className="row mt" style={{ gap: 8 }}>
            <Gated label="상품 등록" kind="primary" reasons={!form.name.trim() ? ['상품명 없음'] : !have(form.bomRef) ? [`BOM 기준선 ${form.bomRef || '(미지정)'} 이 Registry 에 없다`] : []} onClick={() => {
              const id = `OFF-${form.name.replace(/[^A-Za-z가-힣]/g, '').slice(0, 6).toUpperCase() || 'NEW'}-${offers.length + 1}`;
              const o: Offer = {
                id, name: form.name, version: form.version, bomRef: form.bomRef, topologyRef: form.topologyRef,
                market: form.market === 'EU' ? 'EU' : 'KR', delivery: (OFFER_DELIVERY as readonly string[]).includes(form.delivery) ? (form.delivery as Offer['delivery']) : 'OPTION',
                publish: 'DRAFT', description: '', items: [],
              };
              setOffers([o, ...offers]); setPick(id); setForm(OFFER_FORM);
              audited('OFFER_CREATE', id, o.bomRef);
              toast(`${id} 등록됨 (초안)`, 'ok');
            }} />
            <span className="small muted">기준선이 Registry 에 없으면 판매 상품으로 올릴 수 없다.</span>
          </div>
        </div>
      </div>
    ),
    'UI07-S02': () => (
      <div>
        <Table head={['Feature', '정확 버전', '역할', '기준선 사용처', '제거']}>
          {cur?.items.map((i, n) => (
            <tr key={i.feature + n}>
              <td className="mono">{i.feature}</td><td className="mono">{i.exactVersion || '⚠ 미지정'}</td><td>{i.role}</td>
              <td className="small">{baselineUsageOf(`${i.feature}@${i.exactVersion}`).length}개 기준선</td>
              <td><Gated label="제거" reasons={can('edit') ? [] : ['편집 권한 없음']} onClick={() => { patch({ items: cur.items.filter(x => x !== i) }); audited('OFFER_ITEM_REMOVE', cur.id, i.feature); }} /></td>
            </tr>
          ))}
        </Table>
        <div className="row mt" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="small muted">Feature
            <select style={{ ...FIELD, marginTop: 4 }} value={item.feature} onChange={e => setItem({ ...item, feature: e.target.value })}>
              {state.features.map(f => <option key={f.id} value={f.id}>{f.id}</option>)}
            </select>
          </label>
          <label className="small muted">정확 버전
            <input style={{ ...FIELD, marginTop: 4 }} value={item.version} onChange={e => setItem({ ...item, version: e.target.value })} placeholder="1.1.0" />
          </label>
          <label className="small muted">역할
            <select style={{ ...FIELD, marginTop: 4 }} value={item.role} onChange={e => setItem({ ...item, role: e.target.value })}>
              <option value="BASE">BASE</option><option value="ADDON">ADDON</option>
            </select>
          </label>
          <Gated label="구성 추가" reasons={!item.feature ? ['Feature 없음'] : !item.version.trim() ? ['정확 버전을 적어야 한다'] : []} onClick={() => {
            patch({ items: [...cur.items, { feature: item.feature, exactVersion: item.version, role: item.role as 'BASE' | 'ADDON' }] });
            audited('OFFER_ITEM_ADD', cur.id, `${item.feature}@${item.version}`);
            setItem({ ...item, version: '' });
          }} />
        </div>
        <Note>OfferingItem 은 기준선의 구성원을 그대로 가리키지 않고 Feature 정확 버전을 고정한다 — 기준선이 개정돼도 판매된 상품 구성이 흔들리지 않게 하기 위해서다.</Note>
      </div>
    ),
    'UI07-S03': () => (
      <div>
        <Table head={['국가', '차종·Trim', 'HW', 'SW 조건', '적용 판정', '근거']}>
          {[
            { n: 'KR', m: 'Premium', hw: 'Gen3', sw: '≥3.2.0', ok: 'ALLOW', why: 'Variant Matrix Allowed' },
            { n: 'EU', m: 'Premium', hw: 'Gen3', sw: '≥3.2.0', ok: 'ALLOW', why: 'Variant Matrix Allowed' },
            { n: 'US', m: 'Premium', hw: 'Gen3', sw: '≥3.2.0', ok: 'DENY', why: 'Variant Matrix Blocked — 인증 없음' },
            { n: 'KR', m: 'Standard', hw: 'Gen2', sw: '2.x', ok: 'DENY', why: 'HW 세대 미지원' },
          ].map(r => (
            <tr key={r.n + r.m}><td>{r.n}</td><td>{r.m}</td><td>{r.hw}</td><td className="mono">{r.sw}</td>
              <td><span className="badge" style={{ background: r.ok === 'ALLOW' ? 'var(--pass)' : 'var(--fail)' }}>{r.ok}</span></td>
              <td className="small muted">{r.why}</td></tr>
          ))}
        </Table>
        <Note>적용조건은 상품이 아니라 Variant 판정에서 온다 — 상품 등록 화면에서 조건을 새로 만들지 않는다.</Note>
      </div>
    ),
    'UI07-S04': () => (
      <div>
        <Reasons list={conflicts} title="구성 검증" ok={conflicts.length === 0} />
        <div className="mt small muted">검사 항목 — requires/composed_of 충족 · excludes 위반 · 정확 버전 지정 · 중복 구성 · 기준선 지정</div>
        <div className="mt"><Gated label="검증 기록" reasons={can('edit') ? [] : ['편집 권한 없음']} onClick={() => { audited('OFFER_VALIDATE', cur.id, conflicts.length ? `위반 ${conflicts.length}건` : '위반 없음'); toast(conflicts.length ? `위반 ${conflicts.length}건 기록` : '위반 없음', conflicts.length ? 'warn' : 'ok'); }} /></div>
      </div>
    ),
    'UI07-S05': () => {
      const subs = subscriptions.filter(s => cur?.items.some(i => i.feature === s.feature));
      return (
        <div>
          <Table head={['Feature', '사용 권리', '요금제', '수량', '매출(₩)']}>
            {subs.map(s => <tr key={s.feature + s.right}><td className="mono">{s.feature}</td><td>{s.right}</td><td>{s.plan}</td><td>{s.qty}</td><td className="mono">{s.revenueWon.toLocaleString()}</td></tr>)}
          </Table>
          {subs.length === 0 && <Note>이 상품 구성에 연결된 판매·사용 권리가 아직 없다.</Note>}
          <div className="mt"><button className="btn" onClick={() => nav('/commerce/FEAT-BDC-001')}>과금·사용 권리 화면 →</button></div>
        </div>
      );
    },
    'UI07-S06': () => (
      <div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED'] as OfferState[]).map(s => (
            <Gated key={s} label={`${s} 로`} kind={s === 'PUBLISHED' ? 'primary' : undefined}
              reasons={cur?.publish === s ? ['이미 같은 상태다'] : offerGate({ ...cur, publish: s }, have).reasons}
              onClick={() => move(s)} />
          ))}
          <Gated label="철회" kind="danger" reasons={cur?.publish === 'PUBLISHED' ? ['발행된 상품은 철회 대신 WITHDRAWN 절차로 내린다'] : ['발행 상태가 아니다']} onClick={() => move('WITHDRAWN')} />
        </div>
        <div className="mt"><Reasons list={gate.reasons} title="발행 조건" ok={gate.ok} /></div>
        <div className="mt"><Table head={['사용처', '기준선 상태', '이 상품 구성원']}>
          {BOM_BASELINES.map(b => {
            const used = cur?.items.filter(i => b.members.some(m => m.featureVersionRef === `${i.feature}@${i.exactVersion}`));
            return <tr key={b.id}><td className="mono">{b.id}@{b.version}</td><td><Pill s={b.state} /></td><td className="small">{used?.length ? used.map(u => u.feature).join(', ') : '—'}</td></tr>;
          })}
        </Table></div>
      </div>
    ),
  };

  const kpis: Kpi[] = [
    { v: offers.length, l: '상품' },
    { v: offers.filter(o => o.publish === 'PUBLISHED').length, l: '발행' },
    { v: offers.reduce((n, o) => n + o.items.length, 0), l: 'OfferingItem' },
    { v: conflicts.length, l: '구성 위반' },
  ];
  return <CanonicalScreen screenId="UI07" title="Catalog 상품 구성" core="C15 적용 대상 선정" kpis={kpis} areas={areas} />;
}

// ═══════════════════════════════════ UI21 ═══════════════════════════════════
type UpgKey = 'name' | 'system' | 'component' | 'modelNo' | 'modelCode' | 'serial' | 'vc';
const UPG_FORM: Record<UpgKey, string> = { name: '', system: '', component: '', modelNo: '00', modelCode: '', serial: '', vc: 'VC-A' };

export function UpgRegistry() {
  const { state, dispatch, can } = useApp();
  const { syncLogs } = useLiveSlices();
  const toast = useToast();
  const [upgs, setUpgs] = useState<Upg[]>(SEED_UPGS);
  const [pick, setPick] = useState(SEED_UPGS[0].id);
  const [form, setForm] = useState<Record<UpgKey, string>>(UPG_FORM);
  const cur = upgs.find(u => u.id === pick) || upgs[0];
  const ident = cur ? upgIdent(cur.system, cur.component, cur.modelNo, cur.modelCode, cur.serial) : { ok: false, reasons: [], id: '' };
  const audited = (action: string, detail: string) => dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 10:10', actor: state.role, action, target: cur?.id || '-', detail } });
  const relevantLogs = syncLogs.filter(l => !cur || (l.event || '').includes(cur.id) || l.conn === 'PLM-UPG');

  const areas: Record<string, () => ReactNode> = {
    'UI21-S01': () => (
      <div>
        <Table head={['UPG', '이름', '식별', 'VC', '승인 상태', '원천']}>
          {upgs.map(u => (
            <tr key={u.id} onClick={() => setPick(u.id)} style={{ cursor: 'pointer', background: u.id === pick ? 'var(--surface-2)' : undefined }}>
              <td className="mono">{u.id}</td><td>{u.name}</td>
              <td className="mono small">{upgIdent(u.system, u.component, u.modelNo, u.modelCode, u.serial).id}</td>
              <td>{u.vc}</td><td><Pill s={u.approved} /></td><td className="small muted">{u.source}</td>
            </tr>
          ))}
        </Table>
        <div className="card mt" style={{ background: 'var(--surface-2)' }}>
          <b className="small">UPG 등록 — 식별 규칙을 먼저 통과해야 한다</b>
          <div className="mt"><Fields<UpgKey> cols={[['이름', 'name'], ['System(2)', 'system'], ['Component(4)', 'component'], ['차종번호(2)', 'modelNo'], ['차종코드(3)', 'modelCode'], ['Serial(3)', 'serial'], ['VC', 'vc']]} values={form} onChange={(k, v) => setForm({ ...form, [k]: v })} /></div>
          <div className="row mt" style={{ gap: 8, alignItems: 'center' }}>
            <Gated label="UPG 등록" kind="primary"
              reasons={!form.name.trim() ? ['이름 없음'] : upgIdent(form.system, form.component, form.modelNo, form.modelCode, form.serial).reasons}
              onClick={() => {
                const g = upgIdent(form.system, form.component, form.modelNo, form.modelCode, form.serial);
                const u: Upg = { id: `UPG-${form.modelCode}-${form.serial || '000'}`, name: form.name, vc: form.vc, approved: 'DRAFT', source: 'MANUAL-2026.09', ...form } as Upg;
                setUpgs([u, ...upgs]); setPick(u.id); setForm(UPG_FORM);
                dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 10:10', actor: state.role, action: 'UPG_CREATE', target: u.id, detail: g.id } });
                toast(`${u.id} 등록됨 (초안)`, 'ok');
              }} />
            <span className="mono small muted">{upgIdent(form.system, form.component, form.modelNo, form.modelCode, form.serial).id || '(식별 미완성)'}</span>
          </div>
        </div>
      </div>
    ),
    'UI21-S02': () => (
      <div>
        <Table head={['절', '값', '규칙', '판정']}>
          {[['System', cur?.system, '2자리'], ['Component', cur?.component, '4자리'], ['차종 번호', cur?.modelNo, '2자리'], ['차종 코드', cur?.modelCode, '3자리'], ['Serial', cur?.serial, '3자리 후보']].map(([a, b, c]) => (
            <tr key={a as string}><td>{a}</td><td className="mono">{b || '—'}</td><td className="small muted">{c}</td>
              <td>{new RegExp(`^[0-9A-Z]{${(c as string).match(/\d/)?.[0]}}$`).test((b as string) || '') ? <span className="badge" style={{ background: 'var(--pass)' }}>OK</span> : <span className="badge" style={{ background: 'var(--fail)' }}>NG</span>}</td></tr>
          ))}
        </Table>
        <div className="kv small mt">조립 식별 — <span className="mono">{ident.id}</span> · VC {cur?.vc}</div>
        <div className="mt"><Reasons list={ident.reasons} title="식별 규칙" ok={ident.ok} /></div>
      </div>
    ),
    'UI21-S03': () => (
      <div>
        <Table head={['국가', '차량 코드', '적용', '근거']}>
          {[['KR', 'KMH-BDC-27', '예', '국내 인증 완료'], ['EU', 'WVW-BDC-27', '예', 'R156 심사 완료'], ['US', 'KMH-BDC-27', '아니오', '미인증 — Variant Blocked'], ['CN', 'KMH-BDC-27', '미정', 'PIPL 검토 중']].map(r => (
            <tr key={r[0]}><td>{r[0]}</td><td className="mono">{r[1]}</td>
              <td><span className="badge" style={{ background: r[2] === '예' ? 'var(--pass)' : r[2] === '미정' ? 'var(--pending)' : 'var(--fail)' }}>{r[2]}</span></td>
              <td className="small muted">{r[3]}</td></tr>
          ))}
        </Table>
        <Note>차량 코드 연결은 UPG 단위로 유지한다 — 차종 코드가 바뀌면 새 UPG 를 발급하고 이력을 남긴다.</Note>
      </div>
    ),
    'UI21-S04': () => (
      <div>
        <Table head={['조건 Profile', '구현 참조', '적용 조건', '판정']}>
          {[['AP-KR-A@1', 'IBOM-BDC-001@1.1.0', 'KR · Premium', 'RESOLVED'], ['AP-EU-B@1', 'IBOM-BDC-001@1.0.0', 'EU · Gen3', 'RESOLVED'], ['AP-KR-A2@9', '—', 'KR · Standard', 'UNRESOLVED']].map(r => (
            <tr key={r[0]}><td className="mono">{r[0]}</td><td className="mono">{r[1]}</td><td className="small">{r[2]}</td>
              <td><span className="badge" style={{ background: r[3] === 'RESOLVED' ? 'var(--pass)' : 'var(--pending)' }}>{r[3]}</span></td></tr>
          ))}
        </Table>
        <Note>구현 참조가 비면 그 조건은 기준선 승인 단계에서 차단된다.</Note>
      </div>
    ),
    'UI21-S05': () => (
      <div>
        <div className="row" style={{ gap: 8 }}>
          <Gated label="원천 동기화 요청" reasons={can('run-engine') ? [] : ['동기화 권한 없음']} onClick={() => { audited('UPG_SYNC_REQUEST', cur?.source || '—'); toast('동기화 요청을 보냈다 — 응답은 ACK 대기로 남는다', 'ok'); }} />
          <span className="small muted">요청은 비동기이며 응답 도착 전에는 승인 상태를 바꾸지 않는다.</span>
        </div>
        <div className="mt"><Table head={['시각', '연계', '이벤트', '상태']}>
          {relevantLogs.slice(0, 8).map((l, i) => <tr key={i}><td className="mono small">{l.ts}</td><td>{l.conn}</td><td className="small">{l.event}</td><td><span className="pill">{l.status}</span></td></tr>)}
        </Table></div>
      </div>
    ),
    'UI21-S06': () => (
      <div>
        <div className="row" style={{ gap: 8 }}>
          {UPG_STATES.map(s => (
            <Gated key={s} label={`${UPG_STATE_KO[s]} 로`} kind={s === 'APPROVED' ? 'primary' : undefined}
              reasons={!ident.ok ? ident.reasons : cur?.approved === s ? ['이미 같은 상태다'] : can('approve') ? [] : ['승인 권한 없음']}
              onClick={() => { setUpgs(list => list.map(u => (u.id === cur.id ? { ...u, approved: s } : u))); audited('UPG_STATE', `${cur?.approved} → ${s}`); toast(`${cur?.id} ${UPG_STATE_KO[s]}`, 'ok'); }} />
          ))}
        </div>
        <div className="mt"><Table head={['시각', '행위자', '행위', '대상']}>
          {state.audit.filter(a => a.target === cur?.id).slice(0, 10).map((a, i) => <tr key={i}><td className="mono small">{a.ts}</td><td>{a.actor}</td><td>{a.action}</td><td className="small muted">{a.detail}</td></tr>)}
        </Table></div>
      </div>
    ),
  };

  const kpis: Kpi[] = [
    { v: upgs.length, l: 'UPG' },
    { v: upgs.filter(u => u.approved === 'APPROVED').length, l: '승인' },
    { v: upgs.filter(u => upgIdent(u.system, u.component, u.modelNo, u.modelCode, u.serial).ok).length, l: '식별 통과' },
    { v: relevantLogs.length, l: '원천 로그' },
  ];
  return <CanonicalScreen screenId="UI21" title="UPG와 UPG VC" core="C32 Legacy 시스템 연계" kpis={kpis} areas={areas} />;
}

// ═══════════════════════════════════ UI22 ═══════════════════════════════════
type MemKey = 'node' | 'parent' | 'sw' | 'level' | 'qty' | 'upgvc';
const MEM_FORM: Record<MemKey, string> = { node: '', parent: '', sw: 'v1.0.0', level: '2', qty: '1', upgvc: 'VC-A' };

export function SwStructure() {
  const { state, dispatch, can } = useApp();
  const toast = useToast();
  const [rows, setRows] = useState<SwStructure[]>(() => SEED_STRUCTURES.map(s => ({ ...s, members: [...s.members] })));
  const [pick, setPick] = useState(SEED_STRUCTURES[0].id);
  const [form, setForm] = useState<Record<MemKey, string>>(MEM_FORM);
  const cur = rows.find(r => r.id === pick) || rows[0];
  const check = cur ? structureCheck(cur) : { ok: false, issues: [] };
  const upg = SEED_UPGS.find(u => u.id === cur?.upg);
  const audited = (action: string, detail: string) => dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 10:20', actor: state.role, action, target: cur?.id || '-', detail } });
  const patch = (p: Partial<SwStructure>) => setRows(list => list.map(r => (r.id === cur.id ? { ...r, ...p } : r)));

  const uses = useMemo(() => BOM_BASELINES.filter(b => cur?.members.some(m => b.topologyNodes.some(n => n.startsWith(m.node.replace('SWC-', 'FEAT-'))))), [cur]);

  const areas: Record<string, () => ReactNode> = {
    'UI22-S01': () => (
      <div>
        <Table head={['Structure', '이름', '버전', 'UPG', '상태', '구성원', '검사']}>
          {rows.map(s => {
            const c = structureCheck(s);
            return (
              <tr key={s.id} onClick={() => setPick(s.id)} style={{ cursor: 'pointer', background: s.id === pick ? 'var(--surface-2)' : undefined }}>
                <td className="mono">{s.id}</td><td>{s.name}</td><td className="mono">v{s.version}</td>
                <td className="mono small">{s.upg}</td><td><Pill s={s.state} /></td><td>{s.members.length}</td>
                <td>{c.ok ? <span className="badge" style={{ background: 'var(--pass)' }}>OK</span> : <span className="badge" style={{ background: 'var(--fail)' }}>{c.issues.length}건</span>}</td>
              </tr>
            );
          })}
        </Table>
        <div className="kv small mt">{cur?.id} · v{cur?.version} — {cur?.reason || '사유 미기재'}</div>
        <Note>Structure 는 UPG 승인 상태와 분리해 관리하지만, 발행(고정)은 둘 다 통과해야 한다.</Note>
      </div>
    ),
    'UI22-S02': () => (
      <div>
        <Table head={['구성원', '부모', 'SW 정확 버전', '계층', '수량', 'UPG VC', '제거']}>
          {cur?.members.map((m, i) => (
            <tr key={m.node + i}>
              <td className="mono">{m.node}</td><td className="mono small">{m.parent || '—'}</td>
              <td className="mono">{m.sw}</td><td>{m.level}</td><td>{m.qty}</td><td>{m.upgvc}</td>
              <td><Gated label="제거" reasons={can('edit') ? [] : ['편집 권한 없음']} onClick={() => { patch({ members: cur.members.filter(x => x !== m) }); audited('STRUCT_MEMBER_REMOVE', m.node); }} /></td>
            </tr>
          ))}
        </Table>
        <div className="mt"><Fields<MemKey> cols={[['구성원', 'node'], ['부모', 'parent'], ['SW 버전', 'sw'], ['계층', 'level'], ['수량', 'qty'], ['UPG VC', 'upgvc']]} values={form} onChange={(k, v) => setForm({ ...form, [k]: v })} /></div>
        <div className="row mt" style={{ gap: 8, alignItems: 'center' }}>
          <Gated label="구성원 추가" reasons={!form.node.trim() ? ['구성원 이름 없음'] : !/^v\d+\.\d+\.\d+$/.test(form.sw) ? ['SW 정확 버전 형식(v1.0.0)이 아니다'] : []}
            onClick={() => {
              const m = { node: form.node, parent: form.parent, sw: form.sw, level: Number(form.level) || 1, qty: Number(form.qty) || 1, upgvc: form.upgvc };
              patch({ members: [...cur.members, m] }); audited('STRUCT_MEMBER_ADD', `${m.node} ${m.sw}`); setForm(MEM_FORM);
            }} />
          <span className="small muted">부모를 비우면 최상위 구성원이 된다 — 계층 2 이상에서 부모가 비면 검사에서 오류로 남는다.</span>
        </div>
      </div>
    ),
    'UI22-S03': () => (
      <div>
        <Table head={['구성원', 'UPG VC', 'Structure VC', '호환 판정']}>
          {cur?.members.map((m, i) => {
            const ok = !upg || m.upgvc === upg.vc;
            return <tr key={i}><td className="mono">{m.node}</td><td>{m.upgvc}</td><td>{upg?.vc || '—'}</td>
              <td><span className="badge" style={{ background: ok ? 'var(--pass)' : 'var(--fail)' }}>{ok ? '호환' : '불일치'}</span></td></tr>;
          })}
        </Table>
        <Note>UPG VC 와 다른 VC 를 쓰는 구성원은 기준선에서 적용 대상이 갈리므로 별도 승인이 필요하다.</Note>
      </div>
    ),
    'UI22-S04': () => (
      <div>
        <Table head={['사용처', '기준선 상태', '노드 일치']}>
          {BOM_BASELINES.map(b => <tr key={b.id}><td className="mono">{b.id}@{b.version}</td><td><Pill s={b.state} /></td>
            <td className="small">{uses.some(u => u.id === b.id) ? '일치' : '—'}</td></tr>)}
        </Table>
        <Note>기준선은 Structure 노드를 그대로 복사하지 않고 참조한다 — Structure 개정 시 사용처가 다시 검토 대상이 된다.</Note>
      </div>
    ),
    'UI22-S05': () => (
      <div>
        <div className="row" style={{ gap: 8 }}>
          {(['DRAFT', 'INVALID', 'VALIDATED', 'FROZEN'] as StructState[]).map(s => (
            <Gated key={s} label={`${STRUCT_STATE_KO[s]} 로`} kind={s === 'FROZEN' ? 'primary' : undefined}
              reasons={cur?.state === s ? ['이미 같은 상태다'] : !check.ok ? check.issues.map(i => `${i.node}: ${CHECK_KO[i.code]}`) : s === 'FROZEN' && upg?.approved !== 'APPROVED' ? [`UPG ${upg?.id} 가 승인 상태가 아니다`] : can('approve') ? [] : ['승인 권한 없음']}
              onClick={() => { patch({ state: s, reason: s === 'INVALID' ? '검사 오류로 표시' : cur.reason }); audited('STRUCT_STATE', `${cur?.state} → ${s}`); toast(`${cur?.id} ${STRUCT_STATE_KO[s]}`, 'ok'); }} />
          ))}
        </div>
        <div className="mt"><Reasons list={check.issues.map(i => `${i.node} — ${CHECK_KO[i.code]}`)} title="구조 검사" ok={check.ok} /></div>
        <div className="mt"><Table head={['원천', '원천 버전', '대사 결과']}>
          <tr><td className="mono">{upg?.source || '—'}</td><td className="mono">{cur?.version}</td>
            <td><span className="badge" style={{ background: check.ok ? 'var(--pass)' : 'var(--pending)' }}>{check.ok ? '일치' : '보류'}</span></td></tr>
        </Table></div>
      </div>
    ),
    'UI22-S06': () => {
      const eos = SEED_EOS.filter(e => e.structure.startsWith(cur?.id || ''));
      return (
        <div>
          <Table head={['SW EO', '변경 유형', 'New 구성', 'Old 구성', '상태', 'BOM 반영']}>
            {eos.map(e => <tr key={e.id}><td className="mono">{e.id}</td><td>{e.changeType}</td><td className="mono small">{e.structure}</td>
              <td className="mono small">{e.oldStructure || '—'}</td><td><span className="pill">{EO_STATE_KO[e.state]}</span></td><td className="small">{e.bomAck || '—'}</td></tr>)}
          </Table>
          {eos.length === 0 && <Note>이 Structure 에 걸린 SW EO 가 아직 없다 — 변경은 SW EO 화면에서 만든다.</Note>}
          <div className="mt"><Table head={['시각', '행위자', '행위', '대상']}>
            {state.audit.filter(a => a.target === cur?.id).slice(0, 10).map((a, i) => <tr key={i}><td className="mono small">{a.ts}</td><td>{a.actor}</td><td>{a.action}</td><td className="small muted">{a.detail}</td></tr>)}
          </Table></div>
        </div>
      );
    },
  };

  const kpis: Kpi[] = [
    { v: rows.length, l: 'Structure' },
    { v: rows.filter(r => structureCheck(r).ok).length, l: '검사 통과' },
    { v: rows.reduce((n, r) => n + r.members.length, 0), l: '구성원' },
    { v: check.issues.length, l: '선택 구조 오류' },
  ];
  return <CanonicalScreen screenId="UI22" title="SW Structure" core="C03 Feature BOM" kpis={kpis} areas={areas} />;
}
