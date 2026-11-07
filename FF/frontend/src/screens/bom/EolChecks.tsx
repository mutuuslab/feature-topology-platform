// 출고 실물 구성 대조 /baselines/eol (ORC-UI08 · Orca B06) — 주문 사양 vs VIN 스캔 실물 구성, 불일치는 품질 보류. 실물 구성 원장은 공장 품질 시스템.
// 핵심 메시지 '품질 보류 차량 N대 — 주문 사양과 실물 구성 불일치', 실물 미확인은 일치로 세지 않는다. 행 상세: 원인·결정 주체·재작업·재대조·출고 근거와 인도 때 확인 두 묶음.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ACCEPTANCE_GROUP_LABEL, ACCEPTANCE_STATE_LABEL, EOL_DECISION_LABEL } from '../../../../contracts/src/rules/eol';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { eol as E } from '../../copy/ads-p5';
import { personName } from '../../data/people';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, KeyValue, PageHeader, Panel, Select, type KeyMessageSpec } from '../../design';
import { BlockedAction, fmtAt, UnknownMark, VerdictReason, type VerdictTone } from '../../design/ads';
import { usePermission } from '../shared';
import '../ads/ads-config.css';

interface Part {
  ecuPno: string;
  ordered: string | null;
  built: string | null;
  kind: string;
}
interface Row {
  vin: string;
  label: string;
  plant: string;
  scannedAt: string;
  verdict: 'MATCH' | 'MISMATCH' | 'UNCONFIRMED';
  verdictLabel: string;
  reason: string;
  parts: Part[];
  orderEcus: { ecuPno: string; hwRevision: string }[];
  builtEcus: { ecuPno: string; hwRevision: string | null }[];
  status: string;
  statusLabel: string;
}
interface ListResp {
  items: Row[];
  summary: { total: number; hold: number; unconfirmed: number; match: number; shippedWithMismatch: number };
  ledger: string;
}
interface Check {
  checkId: string;
  decision: string;
  cause: string;
  reworkRef: string | null;
  recheckResult: string | null;
  shippedEvidence: string | null;
  decidedBy: string;
  decidedAt: string;
}
interface Detail extends Row {
  checks: Check[];
  acceptance: { items: { featureId: string; name: string; group: 'STATIONARY' | 'DRIVING'; state: 'CONFIRMED' | 'UNCONFIRMED' | 'POST_DELIVERY' }[]; summary: { accepted: number; total: number; postDelivery: number; unconfirmed: number } };
}

const TONE: Record<Row['verdict'], VerdictTone> = { MATCH: 'ok', MISMATCH: 'danger', UNCONFIRMED: 'unknown' };
const ecus = (xs: { ecuPno: string; hwRevision: string | null }[]) => xs.map((e) => `${e.ecuPno} ${e.hwRevision ?? '?'}`).join(' · ');

function keyMessage(s: ListResp['summary'] | undefined): KeyMessageSpec {
  if (!s) return { tone: 'neutral', text: E.loading };
  return s.hold ? { tone: 'danger', text: E.key(s.hold) } : { tone: 'ok', text: E.keyNone };
}

export default function EolChecksScreen() {
  const q = useApi<ListResp>('eolMismatches');
  const [sp, setSp] = useSearchParams();
  const vin = sp.get('vin');
  const items = q.data?.items ?? [];
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D05-02 · ORC-UI08"
        title={E.title}
        lead={E.lead}
        message={keyMessage(q.data?.summary)}
        meta={
          <span className="adsc-row">
            <span className="adsc-tag" data-ext-ref>{E.ledger}</span>
            {q.data?.summary.unconfirmed ? <UnknownMark kind="UNCONFIRMED" reason={E.unconfirmed(q.data.summary.unconfirmed)} /> : null}
            <Link to="/baselines">{E.toBaselines}</Link>
          </span>
        }
      />
      <Panel title={E.caption} id="eol-list">
        <AsyncView state={asyncState(q, items.length === 0)} error={q.error ? E.error : null} onRetry={() => q.refetch()} empty={E.empty}>
          <DataTable
            caption={E.caption}
            rows={items}
            pageSize={0}
            rowKey={(r) => r.vin}
            onOpen={(r) => setSp({ vin: r.vin }, { replace: true })}
            columns={[
              { key: 'v', header: E.vin, cell: (r) => <span className="ds-mono">{r.vin}</span> },
              { key: 'p', header: E.plant, cell: (r) => r.plant },
              { key: 'o', header: E.order, cell: (r) => <span className="ds-mono">{ecus(r.orderEcus)}</span> },
              { key: 'b', header: E.built, cell: (r) => <span className="ds-mono">{ecus(r.builtEcus)}</span> },
              { key: 'j', header: E.verdict, cell: (r) => (r.verdict === 'UNCONFIRMED' ? <UnknownMark kind="UNCONFIRMED" reason={r.reason} /> : <VerdictReason tone={TONE[r.verdict]} label={r.verdictLabel} reason={r.reason} />) },
              { key: 's', header: E.status, cell: (r) => <VerdictReason tone={r.status === 'QUALITY_HOLD' || r.status === 'REWORK' ? 'warn' : r.status === 'UNCONFIRMED' ? 'unknown' : 'ok'} label={r.statusLabel} /> },
            ]}
          />
        </AsyncView>
      </Panel>
      <Drawer open={!!vin} title={vin ? E.detail(vin) : ''} onClose={() => setSp({}, { replace: true })}>
        {vin ? <EolDetail vin={vin} /> : null}
      </Drawer>
    </div>
  );
}

function EolDetail({ vin }: { vin: string }) {
  const q = useApi<Detail>('eolVehicle', { params: { vin } });
  const d = q.data;
  return (
    <AsyncView state={asyncState(q)} error={q.error ? E.error : null} onRetry={() => q.refetch()}>
      {d ? (
        <div className="adsc-stack" data-eol-detail={vin}>
          <VerdictReason tone={TONE[d.verdict]} label={`${d.verdictLabel} · ${d.statusLabel}`} reason={d.reason} />
          {d.parts.length ? (
            <section aria-label={E.parts}>
              <p className="adsc-note">{E.parts}</p>
              <ul className="adsc-list">
                {d.parts.map((p) => (
                  <li key={p.ecuPno}>{E.partRow(p.ecuPno, p.ordered ?? '—', p.built ?? '—')}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <KeyValue rows={[{ k: E.scanned, v: `${d.plant} · ${fmtAt(d.scannedAt)}` }]} />
          <section aria-label={E.checks}>
            <p className="adsc-note">{E.checks}</p>
            <ul className="adsc-list">
              {d.checks.map((c) => (
                <li key={c.checkId} data-eol-check={c.decision}>
                  {E.checkRow(EOL_DECISION_LABEL[c.decision as keyof typeof EOL_DECISION_LABEL] ?? c.decision, personName(c.decidedBy), fmtAt(c.decidedAt))} — {c.cause}
                  {c.reworkRef ? ` · ${E.rework} ${c.reworkRef}` : ''}
                  {c.recheckResult ? ` · ${E.recheck} ${E.recheckValue[c.recheckResult]}` : ''}
                  {c.shippedEvidence ? ` · ${E.shipped} ${c.shippedEvidence}` : ''}
                </li>
              ))}
            </ul>
          </section>
          <CheckForm d={d} />
          <section aria-label={E.acceptance} data-eol-acceptance>
            <p className="adsc-note">{E.acceptance} — {E.accepted(d.acceptance.summary.accepted, d.acceptance.summary.total, d.acceptance.summary.postDelivery)}</p>
            {(['STATIONARY', 'DRIVING'] as const).map((g) => (
              <div key={g} className="adsc-stack">
                <p className="adsc-sub">{ACCEPTANCE_GROUP_LABEL[g]}</p>
                <ul className="adsc-list">
                  {d.acceptance.items
                    .filter((i) => i.group === g)
                    .map((i) => (
                      <li key={i.featureId}>
                        <VerdictReason tone={i.state === 'CONFIRMED' ? 'ok' : i.state === 'POST_DELIVERY' ? 'neutral' : 'unknown'} label={`${i.featureId} ${i.name}`} reason={ACCEPTANCE_STATE_LABEL[i.state]} />
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
      ) : null}
    </AsyncView>
  );
}

function CheckForm({ d }: { d: Detail }) {
  const perm = usePermission(['BOM_APPROVER']);
  const [f, setF] = useState({ decision: 'REWORK', cause: '', reworkRef: '', recheckResult: '', shippedEvidence: '', reason: '' });
  const m = useApiMutation('createEolCheck', ['eolMismatches', 'eolVehicle', 'audit']);
  if (!perm.ok) return <BlockedAction label={E.release} reason={STATIC_MODE ? E.readOnly : E.noPermission} />;
  if (f.decision === 'RELEASE' && d.verdict !== 'MATCH' && f.recheckResult !== 'PASS') return (
    <div className="adsc-stack">
      <BlockedAction label={E.release} reason={E.releaseBlocked(d.parts.length)} />
      <Button onClick={() => setF({ ...f, decision: 'REWORK' })}>{EOL_DECISION_LABEL.REWORK}</Button>
    </div>
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="adsc-stack" data-eol-form>
      <Select label={E.decision} value={f.decision} onChange={set('decision')}>
        {Object.entries(EOL_DECISION_LABEL).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </Select>
      <Field label={E.cause}>
        <input className="ds-input" value={f.cause} onChange={set('cause')} />
      </Field>
      <Field label={E.rework}>
        <input className="ds-input" value={f.reworkRef} onChange={set('reworkRef')} />
      </Field>
      <Select label={E.recheck} value={f.recheckResult} onChange={set('recheckResult')}>
        <option value="">—</option>
        <option value="PASS">{E.recheckValue.PASS}</option>
        <option value="FAIL">{E.recheckValue.FAIL}</option>
      </Select>
      <Field label={E.shipped}>
        <input className="ds-input" value={f.shippedEvidence} onChange={set('shippedEvidence')} />
      </Field>
      <Field label={E.reason}>
        <input className="ds-input" value={f.reason} onChange={set('reason')} />
      </Field>
      <Button
        variant="primary"
        disabled={f.cause.trim().length < 2 || f.reason.trim().length < 2 || m.isPending}
        onClick={() => m.mutate({ body: { vin: d.vin, decision: f.decision, cause: f.cause, reworkRef: f.reworkRef.trim() || null, recheckResult: f.recheckResult || null, shippedEvidence: f.shippedEvidence.trim() || null, reason: f.reason } })}
      >
        {E.save}
      </Button>
      <ErrorNote error={m.error} />
    </div>
  );
}
