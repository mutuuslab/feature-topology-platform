// /activation/decide — 활성화 판단(D01-09, PoC ③). 사용 권한·체험권 화면은 Entitlements.tsx
// 핵심 값은 VIN 지원 판정 4상태(ORC-UI02 — 정책 ON을 '쓸 수 있음'으로 읽지 않게, P-1). 서버 정책 평가는 '정책 평가' 탭(값 '정책 ON(의도) — 차량 실행은 차량이 판단').
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { ofrepSnapshotFile, type EligibilityReason, type EligibilityState, type CompatClass } from '@ff/contracts';
import { ELIGIBILITY_LABEL, REASON_AXIS_LABEL, REASON_RESULT_LABEL } from '../../../../contracts/src/rules/ads-config';
import { STATIC_MODE, call, readSnapshotFile } from '../../api/client';
import { asyncState, useApi } from '../../api/hooks';
import { eligibility as E } from '../../copy/ads-config';
import { ko } from '../../copy/ko';
import { pickAvailableValue } from '../../data/first-run';
import { AsyncView, Button, DataTable, PageHeader, Pager, Panel, Select, Tabs, VerdictBadge, type KeyMessageSpec } from '../../design';
import { FreshnessChip, UnknownMark, VerdictReason, fmtAt, type VerdictTone } from '../../design/ads';
import { OpenFeaturePanel } from './OpenFeaturePanel';
import '../ads/ads-config.css';

const A = ko.activation;
const TABS = [
  { key: 'eligibility', label: E.tabs.eligibility },
  { key: 'policy', label: E.tabs.policy },
];

interface Decision {
  vehicle: { vin: string; label: string; quality: string };
  result: { flagKey: string; value: boolean; variant: string; decision: string; reason: string; policyId: string; revision: number; trace: { step: keyof typeof A.steps; result: string; detail: string }[] };
  entitlement: { active: boolean };
}

interface Eligibility {
  vin: string;
  vehicle: { vin: string; label: string; country: string; vehicleModel: string; trim: string };
  catalog: { catalogId: string; name: string; version: string; country: string; saleType: string };
  feature: { featureId: string; version: string; name: string } | null;
  state: EligibilityState;
  label: string;
  headline: string;
  reasons: EligibilityReason[];
  states: Exclude<EligibilityState, 'NOT_OFFERED'>[];
  otaLinked: boolean;
  configSet: { setId: string; cls: CompatClass } | null;
  checkedAt: string;
  observedAt: string | null;
  staleAfterMs: number;
}

const DECISION_VERDICT: Record<string, string> = { ALLOW: 'PASS', DENY: 'FAIL', HOLD: 'CONDITIONAL', SAFE_DEFAULT: 'CONDITIONAL' };
const STATE_TONE: Record<EligibilityState, VerdictTone> = { ELIGIBLE: 'ok', UPDATE_REQUIRED: 'warn', HW_MISSING: 'danger', VEHICLE_CHECK: 'unknown', NOT_OFFERED: 'neutral' };
const KEY_TONE: Record<EligibilityState, KeyMessageSpec['tone']> = { ELIGIBLE: 'ok', UPDATE_REQUIRED: 'warn', HW_MISSING: 'warn', VEHICLE_CHECK: 'warn', NOT_OFFERED: 'neutral' };

export function ActivationScreen() {
  const [sp, setSp] = useSearchParams();
  // flagKey만 준 주소(정책 상세의 '활성화 판단 →')는 정책 평가를 보려는 것 — 탭을 주소에 붙인다
  const policy = sp.get('tab') === 'policy' || (!sp.get('tab') && !!sp.get('flagKey'));
  useEffect(() => {
    if (!policy || sp.get('tab')) return;
    const n = new URLSearchParams(sp);
    n.set('tab', 'policy');
    setSp(n, { replace: true });
  }, [policy, sp, setSp]);
  return policy ? <PolicyEvaluation /> : <EligibilityView />;
}

/** 사유 칸 결과 — 판단 불가·미확인은 UnknownMark 두 낱말(P-9), 충족·미충족은 글리프+글자 */
function ResultCell({ r }: { r: EligibilityReason }) {
  if (r.result === 'UNDECIDABLE' || r.result === 'UNCONFIRMED') return <UnknownMark kind={r.result} />;
  return <VerdictReason tone={r.result === 'MET' ? 'ok' : 'danger'} label={REASON_RESULT_LABEL[r.result]} />;
}

/** VIN 지원 판정 탭(ORC-UI02) — 첫 진입은 구형 SW 차량 × 체험 상품(차량 확인 필요 — 설치 기록 연동 전) */
function EligibilityView() {
  const [sp, setSp] = useSearchParams();
  const vehicles = useApi<{ items: { vin: string; label: string; quality: string }[] }>('vehicles');
  const products = useApi<{ items: { catalogId: string; name: string }[] }>('listProducts');
  const catalogs = products.data ? [...new Map(products.data.items.map((p) => [p.catalogId, p])).values()] : undefined;
  const vehiclePick = pickAvailableValue(vehicles.data?.items.map((v) => v.vin), sp.get('vin'), 'KMH-NX4-0004');
  const catalogPick = pickAvailableValue(catalogs?.map((c) => c.catalogId), sp.get('catalogId'), 'CAT-00019');
  const vin = vehiclePick.value, catalogId = catalogPick.value;
  const none = vehiclePick.none || catalogPick.none || vehiclePick.unavailable || catalogPick.unavailable;
  const listErr = vehicles.isError ? vehicles : products.isError ? products : null;
  const ready = !!vin && !!catalogId && !vehiclePick.pending && !catalogPick.pending && !none && !listErr;
  const q = useApi<Eligibility>('vehicleEligibility', { params: { vin }, query: { catalogId } }, { enabled: ready });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    setSp(n, { replace: true });
  };
  const d = q.data;
  const message: KeyMessageSpec = d ? { tone: KEY_TONE[d.state], text: d.headline } : { tone: 'neutral', text: none ? E.empty.body : E.states };
  const unknown = d?.reasons.find((r) => r.result === 'UNDECIDABLE' || r.result === 'UNCONFIRMED');
  const observedMs = d?.observedAt ? Date.parse(d.checkedAt) - Date.parse(d.observedAt) : null;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D02-02 · ORC-UI02 · ORC-BE02"
        title={A.title}
        lead={E.lead}
        message={message}
        actions={
          <div className="adsc-row">
            <Select label={A.vehicle} value={vin} onChange={(e) => set('vin', e.target.value)}>
              {(vehiclePick.pending || vehiclePick.unavailable || !vin) && <option value={vin}>{vin || '—'}</option>}
              {(vehicles.data?.items ?? []).map((v) => (
                <option key={v.vin} value={v.vin}>
                  {v.vin} · {v.label}
                </option>
              ))}
            </Select>
            <Select label={E.product} value={catalogId} onChange={(e) => set('catalogId', e.target.value)}>
              {(catalogPick.pending || catalogPick.unavailable || !catalogId) && <option value={catalogId}>{catalogId || '—'}</option>}
              {(catalogs ?? []).map((c) => (
                <option key={c.catalogId} value={c.catalogId}>
                  {c.catalogId} · {c.name}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      <Tabs tabs={TABS}>
        {() => (
          <AsyncView emptyHidden={false} state={none ? 'empty' : asyncState(listErr ?? q)} error={(listErr ?? q).error ? E.error : null} onRetry={() => (listErr ?? q).refetch()} empty={E.empty}>
            {d ? (
              <div className="adsc-stack" data-eligibility={d.state}>
                <Panel title={E.states} id="eligibility-states">
                  <div className="adsc-stack">
                    <ul className="adsc-states" aria-label={E.states}>
                      {d.states.map((s) => (
                        <li key={s} data-state={s} data-current={s === d.state ? '' : undefined} aria-current={s === d.state ? 'true' : undefined}>
                          {ELIGIBILITY_LABEL[s]}
                          {s === 'UPDATE_REQUIRED' && !d.otaLinked ? <span className="adsc-sub">{E.updateLater}</span> : null}
                        </li>
                      ))}
                    </ul>
                    <div className="adsc-row">
                      <VerdictReason tone={STATE_TONE[d.state]} label={d.label} code={d.state} />
                      {d.state === 'VEHICLE_CHECK' && unknown ? <UnknownMark kind={unknown.result as 'UNDECIDABLE' | 'UNCONFIRMED'} reason={unknown.basis} /> : null}
                    </div>
                    <FreshnessChip state={!d.observedAt ? 'UNOBSERVED' : observedMs !== null && observedMs > d.staleAfterMs ? 'UNOBSERVED' : 'FRESH'} observedAt={d.observedAt} staleAfterMs={d.staleAfterMs} now={Date.parse(d.checkedAt)} note={E.checkedAt(fmtAt(d.checkedAt))} />
                  </div>
                </Panel>
                <DataTable
                  caption={E.reasons}
                  rows={d.reasons}
                  pageSize={0}
                  rowKey={(r) => r.axis}
                  columns={[
                    { key: 'a', header: E.col.axis, cell: (r) => REASON_AXIS_LABEL[r.axis] },
                    { key: 'r', header: E.col.result, cell: (r) => <ResultCell r={r} /> },
                    { key: 'b', header: E.col.basis, cell: (r) => <span className="adsc-cell"><span>{r.basis}</span><code className="adsc-sub">{r.code}</code></span> },
                  ]}
                />
                <div className="adsc-row">
                  {d.feature ? <span className="adsc-note">{E.feature(d.feature.featureId, d.feature.version)}</span> : null}
                  {d.configSet ? <span className="adsc-note">{`${E.configSet} ${d.configSet.setId}`}</span> : null}
                  <Button onClick={() => q.refetch()}>{E.refresh}</Button>
                </div>
                {d.state === 'ELIGIBLE' ? <p className="adsc-note">{E.notReady}</p> : null}
                <p className="adsc-note" data-recheck>{E.recheck}</p>
              </div>
            ) : null}
          </AsyncView>
        )}
      </Tabs>
    </div>
  );
}

/** '정책 평가' 탭 — 서버 기준 정책 평가(7단계 근거·Fleet·OFREP). 값은 의도이지 차량 실행이 아니다 */
function PolicyEvaluation() {
  const [sp, setSp] = useSearchParams();
  const vehicles = useApi<{ items: { vin: string; label: string; quality: string }[] }>('vehicles');
  const policies = useApi<{ items: { flagKey: string; status: string }[] }>('listPolicies', { query: { status: 'DEPLOYED' } });
  const flags = policies.data ? [...new Set(policies.data.items.filter((p) => p.status === 'DEPLOYED').map((p) => p.flagKey))].sort() : undefined;
  // 기본 대상 — 예시 차량이 있으면 그것, 없으면 첫 차량. 차량·배포 정책이 없으면(빈 설치) 빈 상태(출시 준비 RD-OPS-02)
  const vehiclePick = pickAvailableValue(vehicles.data?.items.map((v) => v.vin), sp.get('vin'), 'ego-01');
  const flagPick = pickAvailableValue(flags, sp.get('flagKey'));
  const vin = vehiclePick.value, flagKey = flagPick.value;
  const noVehicle = vehiclePick.none, noPolicy = flagPick.none;
  const unavailable = vehiclePick.unavailable || flagPick.unavailable;
  const none = noVehicle || noPolicy || unavailable;
  // 기본 대상을 고를 목록을 못 받으면 그 목록의 오류(권한 없음 포함)를 보인다 — 판단 조회는 하지 않는다
  const listErr = vehicles.isError ? vehicles : policies.isError ? policies : null;
  const eligible = !!vin && !!flagKey && !vehiclePick.pending && !flagPick.pending && !none && !listErr;
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    setSp(n, { replace: true });
  };
  const q = useApi<Decision>('activationDecide', { query: { vin, flagKey } }, { enabled: eligible });
  const [ofrep, setOfrep] = useState<unknown>(null);
  useEffect(() => {
    setOfrep(null);
    if (!eligible) return;
    const controller = new AbortController();
    // 정적 데모는 스냅샷을 만들 때 같은 요청(차량·Flag)으로 받아 둔 응답을 읽는다
    (STATIC_MODE
      ? readSnapshotFile<{ flags?: Record<string, unknown> }>(ofrepSnapshotFile(vin), controller.signal).then((s) => s.flags?.[flagKey] ?? null)
      : fetch(`/ofrep/v1/evaluate/flags/${encodeURIComponent(flagKey)}`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: { targetingKey: vin } }) }).then((r) => r.json())
    )
      .then((value) => { if (!controller.signal.aborted) setOfrep(value); }, () => { if (!controller.signal.aborted) setOfrep(null); });
    return () => controller.abort();
  }, [vin, flagKey, eligible, q.dataUpdatedAt]);
  const [fleetPage, setFleetPage] = useState(0);
  const [fleetSearch, setFleetSearch] = useState('');
  const filtered = (vehicles.data?.items ?? []).filter((v) => `${v.vin} ${v.label}`.toLowerCase().includes(fleetSearch.trim().toLowerCase()));
  const currentPage = Math.min(fleetPage, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  const visibleVehicles = filtered.slice(currentPage * 25, (currentPage + 1) * 25);
  // Fleet 전체 판단 — 차량마다 같은 평가기. flagKey가 정해지기 전(정책 목록이 차량 목록보다 늦게 올 때)에는 묻지 않는다
  const fleet = useQueries({
    queries: visibleVehicles.map((v) => ({
      queryKey: ['activationDecide', {}, { vin: v.vin, flagKey }],
      queryFn: ({ signal }) => call<Decision>('activationDecide', { query: { vin: v.vin, flagKey }, signal }),
      enabled: eligible,
    })),
  });
  const d = q.data;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-09 · ACTIVATION"
        title={A.title}
        lead={A.lead}
        // 값은 정책 의도 — 'ON'을 '쓸 수 있음'으로 읽지 않게 문장으로 쓰고, 판정 코드는 meta 보조 글자(ORC-UI02 blocker)
        message={none ? { tone: 'neutral', status: { label: '—' }, text: flagPick.unavailable ? `${flagKey} · ${A.unpublishedShort}` : vehiclePick.unavailable ? A.vehicleUnavailable : noVehicle ? ko.state.noVehicleTitle : ko.state.noPolicyTitle } : d ? { tone: 'neutral', text: d.result.value ? E.policyKey : E.policyKeyOff } : { tone: 'neutral', text: A.key(vin, flagKey, '…', '…') }}
        meta={d && !none ? <span className="adsc-sub" data-policy-code>{`${E.policyCode} ${d.result.decision} · ${d.result.reason} — ${vin} · ${flagKey}`}</span> : undefined}
        actions={
          <div className="adsc-row">
            <Select label={A.vehicle} value={vin} onChange={(e) => set('vin', e.target.value)}>
              {(vehiclePick.pending || vehiclePick.unavailable || !vin) && <option value={vin}>{vin || '—'}{vehiclePick.unavailable ? ` · ${A.vehicleUnavailable}` : ''}</option>}
              {(vehicles.data?.items ?? []).map((v) => (
                <option key={v.vin} value={v.vin}>
                  {v.vin} · {v.label}
                </option>
              ))}
            </Select>
            <Select label={A.flag} value={flagKey} onChange={(e) => set('flagKey', e.target.value)}>
              {(flagPick.pending || flagPick.unavailable || !flagKey) && <option value={flagKey}>{flagKey || '—'}{flagPick.unavailable ? ` · ${A.unpublishedShort}` : ''}</option>}
              {(flags ?? []).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
          </div>
        }
      />
      <Tabs tabs={TABS}>
        {() => (
          <AsyncView emptyHidden={none && !unavailable} state={none ? 'empty' : asyncState(listErr ?? q)} error={(listErr ?? q).error} onRetry={() => (listErr ?? q).refetch()} empty={flagPick.unavailable ? { title: A.unpublished, body: A.unpublishedBody } : vehiclePick.unavailable ? { title: A.vehicleUnavailable, body: ko.state.noVehicleBody } : noVehicle ? { title: ko.state.noVehicleTitle, body: ko.state.noVehicleBody } : { title: ko.state.noPolicyTitle, body: ko.state.noPolicyBody }}>
            {d && (
              <>
                <Panel title={A.trace} eyebrow={`${d.result.policyId} r${d.result.revision}`} id="result" tour="activation-trace">
                  <ol className="ds-trace">
                    {d.result.trace.map((t) => (
                      <li key={t.step} data-result={t.result} data-step={t.step}>
                        <span className="ds-trace__step">{A.steps[t.step]}</span>
                        <span className="ds-trace__res">{t.result}</span>
                        <span className="ds-trace__detail">{t.detail}</span>
                      </li>
                    ))}
                  </ol>
                </Panel>
                <div className="ds-split">
                  <Panel title={A.fleet} id="fleet">
                    <label className="ds-field"><span className="ds-field__label">{A.fleetSearch}</span><input className="ds-input" value={fleetSearch} onChange={(e) => { setFleetSearch(e.target.value); setFleetPage(0); }} /></label>
                    <DataTable
                      caption={A.fleet}
                      rows={visibleVehicles.map((v, i) => ({ v, r: fleet[i]?.data as Decision | undefined }))}
                      pageSize={0}
                      rowKey={(x) => x.v.vin}
                      onOpen={(x) => set('vin', x.v.vin)}
                      columns={[
                        { key: 'vin', header: A.vehicle, cell: (x) => <span className="ds-mono">{x.v.vin}</span> },
                        { key: 'l', header: ko.registry.col.name, cell: (x) => <span style={{ fontSize: 'var(--fs-xs)' }}>{x.v.label}</span> },
                        { key: 'q', header: 'Context', cell: (x) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{x.v.quality}</span> },
                        { key: 'd', header: A.result, cell: (x) => (x.r ? <VerdictBadge value={DECISION_VERDICT[x.r.result.decision] ?? '미판정'} /> : '…') },
                        { key: 'why', header: ko.audit.col.reason, cell: (x) => <span style={{ fontSize: 'var(--fs-xs)' }} title={x.r?.result.reason}>{x.r ? (A.reason[x.r.result.reason] ?? x.r.result.reason) : ''}</span> },
                      ]}
                    />
                    <Pager page={currentPage} pageSize={25} total={filtered.length} onPage={setFleetPage} label={A.fleet} />
                  </Panel>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--sp-3)', alignContent: 'start' }}>
                    <OpenFeaturePanel vin={vin} flagKey={flagKey} serverValue={d.result.value} />
                    <Panel title={A.ofrep} codes="IF-10" eyebrow={`POST /ofrep/v1/evaluate/flags/${flagKey}`} id="ofrep">
                      {STATIC_MODE && <p className="ds-field__hint">{A.ofrepSnapshot}</p>}
                      <pre className="ds-code" tabIndex={0} data-testid="ofrep-response">{ofrep ? JSON.stringify(ofrep, null, 2) : '…'}</pre>
                    </Panel>
                  </div>
                </div>
              </>
            )}
          </AsyncView>
        )}
      </Tabs>
    </div>
  );
}

