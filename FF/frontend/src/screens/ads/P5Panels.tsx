// ADS 구성 마감 패널 — ODD 프로파일의 정책 컴파일 검사·적용 장소 추가(ADS-BE09), 승인 구성 조합의 발행 후보·복구 결정(ADS-BE10),
// Feature 분류 입력·확정·시장 기준선 입력(ADS-BE16), 지원 종료·서버 교체 연습(ADS-LC02), OTA 설치 단계 띠(ADS-OTA01).
// 막힌 행동은 BlockedAction 글자로, 판정은 글리프+글자(VerdictReason)로 — 색만으로 구분하지 않는다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type ClassificationView, type MarketBaseline } from '@ff/contracts';
import { INSTALL_LINEAR, INSTALL_STAGE_LABEL } from '../../../../contracts/src/rules/ota-install';
import { CANDIDATE_EXCLUSION_LABEL } from '../../../../contracts/src/rules/ads-publish';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { baselineEdit as BE, cls as CL, compile as CP, drill as DR, install as IN, publish as PB, recovery as RC, site as ST } from '../../copy/ads-p5';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, Panel, Select, StatusGlyph, SummaryLine } from '../../design';
import { BlockedAction, fmtAt, UnknownMark, VerdictReason } from '../../design/ads';
import { personName } from '../../data/people';
import { usePermission } from '../shared';

interface Blocker {
  code: string;
  message: string;
  ref: string;
}

// ───────────── ODD 프로파일 › 정책 컴파일 검사 ─────────────

export interface CompileRow {
  flagKey: string;
  against: string | null;
  blockers: Blocker[];
}
export interface VerdictLogs {
  oddRef: string;
  ALLOW: number;
  DENY: number;
  UNKNOWN: number;
  total: number;
}

export function CompileTab({ rows, logs }: { rows: CompileRow[]; logs: VerdictLogs | undefined }) {
  return (
    <div className="adsc-stack" data-odd-compile>
      <DataTable
        caption={CP.caption}
        rows={rows}
        pageSize={0}
        rowKey={(r) => r.flagKey}
        columns={[
          { key: 'f', header: CP.flag, cell: (r) => <span className="ds-mono">{r.flagKey}</span> },
          { key: 'a', header: CP.against, cell: (r) => (r.against ? <span className="ds-mono">{r.against}</span> : <UnknownMark kind="UNDECIDABLE" reason={CP.noProfile} />) },
          {
            key: 'v',
            header: CP.verdict,
            cell: (r) =>
              r.blockers.length ? (
                <ul className="adsc-list" data-compile-blocked={r.flagKey}>
                  <li>
                    <VerdictReason tone="danger" label={CP.blocked(r.blockers.length)} />
                  </li>
                  {r.blockers.map((b) => (
                    <li key={`${b.code}:${b.ref}`}>
                      {b.code === 'ODD_UNDECIDABLE' ? <UnknownMark kind="UNDECIDABLE" reason={b.message} /> : <VerdictReason tone="danger" label={b.ref} reason={b.message} code={b.code} />}
                    </li>
                  ))}
                </ul>
              ) : (
                <VerdictReason tone="ok" label={CP.pass} />
              ),
          },
        ]}
      />
      {logs ? (
        <p className="adsc-note" data-odd-logs={logs.oddRef}>
          {CP.logs(logs.ALLOW, logs.DENY, logs.UNKNOWN)} {CP.logsNote}
        </p>
      ) : null}
    </div>
  );
}

// ───────────── ODD 프로파일 › 적용 장소 추가·승인 ─────────────

export function SiteRequestAction({ profileId }: { profileId: string }) {
  const perm = usePermission(['FEATURE_AUTHOR', 'SAFETY_OFFICER']);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', kind: 'ZONE', mapVersion: '', infraVersion: '', changeImpactRef: '', reason: '' });
  const m = useApiMutation('addOddSite', ['oddProfile', 'oddProfiles', 'audit']);
  if (!perm.ok) return <BlockedAction label={ST.add} reason={STATIC_MODE ? ST.readOnly : ST.noPermission} />;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ok = f.name.trim().length >= 2 && f.mapVersion && f.infraVersion && f.reason.trim().length >= 2;
  return (
    <>
      <Button onClick={() => setOpen(true)}>{ST.add}</Button>
      <Drawer open={open} title={ST.addTitle} onClose={() => setOpen(false)}>
        <div className="adsc-stack">
          <Field label={ST.name}>
            <input className="ds-input" value={f.name} onChange={set('name')} />
          </Field>
          <Select label={ST.kind} value={f.kind} onChange={set('kind')}>
            {Object.entries(ST.kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Field label={ST.map}>
            <input className="ds-input" value={f.mapVersion} onChange={set('mapVersion')} />
          </Field>
          <Field label={ST.infra}>
            <input className="ds-input" value={f.infraVersion} onChange={set('infraVersion')} />
          </Field>
          <Field label={ST.impact} hint={ST.impactHint}>
            <input className="ds-input" value={f.changeImpactRef} onChange={set('changeImpactRef')} />
          </Field>
          <Field label={ST.reason}>
            <input className="ds-input" value={f.reason} onChange={set('reason')} />
          </Field>
          <p className="adsc-note">{ST.envelopeNote}</p>
          <Button
            variant="primary"
            disabled={!ok || m.isPending}
            onClick={() => m.mutate({ params: { id: profileId }, body: { name: f.name, kind: f.kind, mapVersion: f.mapVersion, infraVersion: f.infraVersion, changeImpactRef: f.changeImpactRef.trim() || null, reason: f.reason } }, { onSuccess: () => setOpen(false) })}
          >
            {ST.submit}
          </Button>
          <ErrorNote error={m.error} />
        </div>
      </Drawer>
    </>
  );
}

export function SiteApprove({ profileId, siteId, status, reason }: { profileId: string; siteId: string; status: string; reason: string }) {
  const perm = usePermission(['SAFETY_OFFICER']);
  const m = useApiMutation('approveOddSite', ['oddProfile', 'oddProfiles', 'audit']);
  const [why, setWhy] = useState('');
  if (status !== 'PENDING') return null;
  if (!perm.ok) return <BlockedAction label={ST.approve} reason={STATIC_MODE ? ST.readOnly : ST.noPermission} />;
  return (
    <span className="adsc-row">
      <input className="ds-input" aria-label={ST.approveReason} value={why} onChange={(e) => setWhy(e.target.value)} />
      <Button disabled={why.trim().length < 2 || m.isPending} onClick={() => m.mutate({ params: { id: profileId, siteId }, body: { reason: why } })}>
        {ST.approve}
      </Button>
      {m.error ? <ErrorNote error={m.error} /> : <span className="adsc-sub">{reason}</span>}
    </span>
  );
}

// ───────────── 승인 구성 조합 › 발행 후보 ─────────────

interface Preview {
  policyId: string;
  featureId: string;
  featureVersion: string;
  flagKey: string;
  scope: number;
  enforced: boolean;
  targets: string[];
  excluded: { vin: string; code: string; reason: string }[];
  blockers: Blocker[];
  warnings: Blocker[];
}
const EXCL_LABEL: Record<string, string> = CANDIDATE_EXCLUSION_LABEL;

function PreviewRow({ policyId }: { policyId: string }) {
  const q = useApi<Preview>('publishPreview', { params: { id: policyId } });
  const p = q.data;
  if (!p) return <tr><td colSpan={5}>{policyId}</td></tr>;
  return (
    <tr data-publish-preview={policyId}>
      <th scope="row">
        <Link className="ds-mono" to={`/policies/${p.policyId}`}>{p.policyId}</Link> <span className="adsc-sub ds-mono">{p.flagKey}</span>
      </th>
      <td>{p.scope}</td>
      <td>{p.targets.length}</td>
      <td>
        <ul className="adsc-list">
          {p.excluded.map((x) => (
            <li key={x.vin}>
              <VerdictReason tone={x.code === 'CONFIG_UNCONFIRMED' ? 'unknown' : 'warn'} label={`${x.vin} — ${EXCL_LABEL[x.code] ?? x.code}`} reason={x.reason} code={x.code} />
            </li>
          ))}
          {[...p.blockers, ...p.warnings].map((b) => (
            <li key={b.code}>
              <VerdictReason tone="danger" label={b.message} code={b.code} />
            </li>
          ))}
        </ul>
      </td>
      <td>{p.enforced ? PB.enforced : PB.preview}</td>
    </tr>
  );
}

export function PublishTab({ policyIds, unverified }: { policyIds: string[]; unverified: { count: number; items: { featureId: string; version: string; name: string | null; fClass: string | null }[] } | undefined }) {
  return (
    <div className="adsc-stack">
      {unverified ? <UnknownMark kind="UNCONFIRMED" reason={`${PB.unverified(unverified.count)} — ${unverified.items.slice(0, 5).map((x) => `${x.featureId} ${x.version}`).join(', ')}`} /> : null}
      <table className="ads-axes">
        <caption className="ads-axes__caption">{PB.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{PB.policy}</th>
            <th scope="col">{PB.scope}</th>
            <th scope="col">{PB.targets}</th>
            <th scope="col">{PB.excluded}</th>
            <th scope="col">{PB.mode}</th>
          </tr>
        </thead>
        <tbody>
          {policyIds.map((id) => (
            <PreviewRow key={id} policyId={id} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────── 승인 구성 조합 › 복구 결정 ─────────────

interface Decision {
  decisionId: string;
  vin: string;
  path: string;
  decidedBy: string;
  rationale: string;
  configSetRef: string;
  decidedAt: string;
  verdict: { cls: string; code: string; reasons: string[] };
  reactivation: { eligible: boolean; reason: string };
}

export function RecoveryTab({ setIds }: { setIds: string[] }) {
  const q = useApi<{ items: Decision[] }>('recoveryDecisions');
  const items = q.data?.items ?? [];
  return (
    <div className="adsc-stack">
      <div className="adsc-row">
        <SummaryLine label={RC.tab} items={[{ k: RC.count(items.length), v: '' }]} />
        <RecoveryForm setIds={setIds} />
      </div>
      <AsyncView state={asyncState(q)} error={q.error ? RC.caption : null} onRetry={() => q.refetch()}>
        <DataTable
          caption={RC.caption}
          rows={items}
          pageSize={0}
          rowKey={(r) => r.decisionId}
          columns={[
            { key: 'v', header: RC.vin, cell: (r) => <span className="ds-mono">{r.vin}</span> },
            { key: 'p', header: RC.path, cell: (r) => RC.paths[r.path] ?? r.path },
            { key: 's', header: RC.set, cell: (r) => <span className="ds-mono">{r.configSetRef}</span> },
            { key: 'b', header: RC.by, cell: (r) => `${personName(r.decidedBy)} · ${fmtAt(r.decidedAt)}` },
            { key: 'r', header: RC.rationale, cell: (r) => r.rationale },
            { key: 'a', header: RC.reactivation, cell: (r) => <VerdictReason tone={r.reactivation.eligible ? 'ok' : 'warn'} label={r.reactivation.reason} code={r.verdict.code} /> },
          ]}
        />
      </AsyncView>
    </div>
  );
}

function RecoveryForm({ setIds }: { setIds: string[] }) {
  const perm = usePermission(['OPS_LEAD', 'SAFETY_OFFICER']);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ vin: '', path: 'SAFE_STATE', configSetRef: setIds[0] ?? '', candidatePublicationId: '', rationale: '' });
  const m = useApiMutation('createRecoveryDecision', ['recoveryDecisions', 'configSets', 'audit']);
  if (!perm.ok) return <BlockedAction label={RC.add} reason={STATIC_MODE ? RC.readOnly : RC.noPermission} />;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <Button onClick={() => setOpen(true)}>{RC.add}</Button>
      <Drawer open={open} title={RC.addTitle} onClose={() => setOpen(false)}>
        <div className="adsc-stack">
          <Field label={RC.vin}>
            <input className="ds-input" value={f.vin} onChange={set('vin')} />
          </Field>
          <Select label={RC.path} value={f.path} onChange={set('path')}>
            {Object.entries(RC.paths).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select label={RC.set} value={f.configSetRef} onChange={set('configSetRef')}>
            {setIds.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Field label={RC.candidate} hint={RC.candidateHint}>
            <input className="ds-input" value={f.candidatePublicationId} onChange={set('candidatePublicationId')} />
          </Field>
          <Field label={RC.rationale}>
            <input className="ds-input" value={f.rationale} onChange={set('rationale')} />
          </Field>
          <Button
            variant="primary"
            disabled={!f.vin || f.rationale.trim().length < 2 || m.isPending}
            onClick={() => m.mutate({ body: { vin: f.vin, path: f.path, configSetRef: f.configSetRef, candidatePublicationId: f.candidatePublicationId.trim() || null, rationale: f.rationale } }, { onSuccess: () => setOpen(false) })}
          >
            {RC.add}
          </Button>
          <ErrorNote error={m.error} />
        </div>
      </Drawer>
    </>
  );
}

// ───────────── Feature 분류 입력·확정 ─────────────

const tri = (v: boolean | null | undefined) => (v === true ? 'true' : v === false ? 'false' : '');
const fromTri = (s: string) => (s === 'true' ? true : s === 'false' ? false : null);
const STATES = ['CREATE', 'OPERATE', 'SUSPEND', 'DISPOSE'] as const;
const STATE_LABEL = CL.stateLabel;

export function ClassificationActions({ v }: { v: ClassificationView }) {
  const author = usePermission(['FEATURE_AUTHOR']);
  const safety = usePermission(['SAFETY_OFFICER']);
  const c = v.classification;
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState('');
  const [f, setF] = useState({ adsFeature: tri(c?.adsFeature), ddtImpact: c?.ddtImpact ?? '', safetyRelated: tri(c?.safetyRelated), owner: c?.owner ?? '', reason: '', ...Object.fromEntries(STATES.map((s) => [s, c?.lifecycleOwners?.[s] ?? ''])) } as Record<string, string>);
  const inv = ['adsClassification', 'adsUnclassified', 'audit'];
  const save = useApiMutation('updateAdsClassification', inv);
  const confirm = useApiMutation('confirmAdsClassification', inv);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const params = { id: v.featureId, ver: v.version };
  return (
    <div className="adc-stack" data-cls-actions>
      {v.ruleEnabled ? <p className="adc-note">{CL.ruleOn}</p> : null}
      <div className="adc-row">
        {author.ok ? <Button onClick={() => setOpen(true)}>{CL.edit}</Button> : <BlockedAction label={CL.edit} reason={STATIC_MODE ? CL.readOnly : CL.noPermission} />}
        {c && c.status !== 'CONFIRMED' ? (
          safety.ok ? (
            <span className="adc-row">
              <input className="ds-input" aria-label={CL.confirmReason} value={why} onChange={(e) => setWhy(e.target.value)} />
              <Button variant="primary" disabled={why.trim().length < 2 || confirm.isPending} onClick={() => confirm.mutate({ params, body: { reason: why } })}>
                {CL.confirm}
              </Button>
            </span>
          ) : (
            <BlockedAction label={CL.confirm} reason={STATIC_MODE ? CL.readOnly : CL.noPermission} />
          )
        ) : null}
        <ErrorNote error={confirm.error} />
      </div>
      {(v.ownerHistory ?? []).length ? (
        <details>
          <summary>{CL.history}</summary>
          <ul className="adsc-list">
            {(v.ownerHistory ?? []).slice(-8).map((h, i) => (
              <li key={i}>{CL.historyRow(STATE_LABEL[h.state] ?? h.state, h.ownerId ?? '—', `${personName(h.assignedBy)} · ${fmtAt(h.assignedAt)}`)}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <Drawer open={open} title={CL.editTitle} onClose={() => setOpen(false)}>
        <div className="adsc-stack">
          {(['adsFeature', 'safetyRelated'] as const).map((k) => (
            <Select key={k} label={k === 'adsFeature' ? CL.ads : CL.safety} value={f[k]} onChange={set(k)}>
              <option value="">{CL.blank}</option>
              <option value="true">{CL.yes}</option>
              <option value="false">{CL.no}</option>
            </Select>
          ))}
          <Select label={CL.ddt} value={f.ddtImpact} onChange={set('ddtImpact')}>
            <option value="">{CL.blank}</option>
            {Object.entries(CL.ddtOptions).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <Field label={CL.owner}>
            <input className="ds-input" value={f.owner} onChange={set('owner')} />
          </Field>
          {STATES.map((s) => (
            <Field key={s} label={CL.ownerOf(STATE_LABEL[s])}>
              <input className="ds-input" value={f[s]} onChange={set(s)} />
            </Field>
          ))}
          <Field label={CL.reason}>
            <input className="ds-input" value={f.reason} onChange={set('reason')} />
          </Field>
          <Button
            variant="primary"
            disabled={f.reason.trim().length < 2 || save.isPending}
            onClick={() =>
              save.mutate(
                { params, body: { adsFeature: fromTri(f.adsFeature), ddtImpact: f.ddtImpact || null, safetyRelated: fromTri(f.safetyRelated), owner: f.owner.trim() || null, lifecycleOwners: Object.fromEntries(STATES.map((s) => [s, f[s].trim() || null])), reason: f.reason } },
                { onSuccess: () => setOpen(false) },
              )
            }
          >
            {CL.save}
          </Button>
          <ErrorNote error={save.error} />
        </div>
      </Drawer>
    </div>
  );
}

export function BaselineAction({ v }: { v: ClassificationView }) {
  const perm = usePermission(['REGULATORY_OWNER']);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ market: 'KR', approvalType: 'SELF_CERT', regs: '', oddProfileRef: '', approvalStatus: 'PENDING', note: '', reason: '' });
  const m = useApiMutation('putMarketBaseline', ['adsClassification', 'adsMarketBaselines', 'audit']);
  if (!perm.ok) return <BlockedAction label={BE.add} reason={STATIC_MODE ? CL.readOnly : BE.noPermission} />;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const regulations = f.regs
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.lastIndexOf(' ');
      return { reg: x.slice(0, i).trim(), series: x.slice(i + 1).trim() };
    })
    .filter((r) => r.reg && r.series);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{BE.add}</Button>
      <Drawer open={open} title={BE.title} onClose={() => setOpen(false)}>
        <div className="adsc-stack">
          <Field label={BE.market}>
            <input className="ds-input" value={f.market} onChange={set('market')} />
          </Field>
          <Select label={BE.type} value={f.approvalType} onChange={set('approvalType')}>
            {Object.entries(BE.types).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <Field label={BE.regs} hint={BE.regsHint}>
            <input className="ds-input" value={f.regs} onChange={set('regs')} />
          </Field>
          <Field label={BE.odd}>
            <input className="ds-input" value={f.oddProfileRef} onChange={set('oddProfileRef')} />
          </Field>
          <Select label={BE.status} value={f.approvalStatus} onChange={set('approvalStatus')}>
            {Object.entries(BE.statuses).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <Field label={BE.note}>
            <input className="ds-input" value={f.note} onChange={set('note')} />
          </Field>
          <Field label={BE.reason}>
            <input className="ds-input" value={f.reason} onChange={set('reason')} />
          </Field>
          <Button
            variant="primary"
            disabled={f.reason.trim().length < 2 || m.isPending}
            onClick={() => m.mutate({ params: { id: v.featureId, ver: v.version, market: f.market.trim().toUpperCase() }, body: { approvalType: f.approvalType, regulations, oddProfileRef: f.oddProfileRef.trim() || null, approvalStatus: f.approvalStatus, note: f.note.trim() || null, reason: f.reason } }, { onSuccess: () => setOpen(false) })}
          >
            {BE.save}
          </Button>
          <ErrorNote error={m.error} />
        </div>
      </Drawer>
    </>
  );
}
export type { MarketBaseline };

// ───────────── 지원 종료·서버 교체 연습 ─────────────

interface Drill {
  drillId: string;
  runBy: string;
  runAt: string;
  passed: boolean;
  horizonDays: number;
  checks: { id: string; label: string; result: 'PASS' | 'FAIL'; basis: string }[];
}

export function SupportDrillPanel({ id, ver }: { id: string; ver: string }) {
  const q = useApi<{ items: Drill[] }>('supportDrills', { params: { id, ver } });
  const perm = usePermission(['RELEASE_MANAGER', 'SAFETY_OFFICER']);
  const run = useApiMutation('runSupportDrill', ['supportDrills', 'audit']);
  const [why, setWhy] = useState('');
  const items = q.data?.items ?? [];
  const last = items.at(-1);
  return (
    <Panel title={DR.title} id="ads-support-drill">
      <div className="adc-stack" data-support-drill>
        <p className="adc-note">{DR.lead}</p>
        <div className="adc-row">
          {perm.ok ? (
            <span className="adc-row">
              <input className="ds-input" aria-label={DR.reason} value={why} onChange={(e) => setWhy(e.target.value)} />
              <Button disabled={why.trim().length < 2 || run.isPending} onClick={() => run.mutate({ params: { id, ver }, body: { horizonDays: 90, reason: why } })}>
                {DR.run}
              </Button>
            </span>
          ) : (
            <BlockedAction label={DR.run} reason={STATIC_MODE ? CL.readOnly : DR.noPermission} />
          )}
          <span className="adc-note">{items.length ? DR.count(items.length) : DR.zero}</span>
          <ErrorNote error={run.error} />
        </div>
        <AsyncView state={asyncState(q)} onRetry={() => q.refetch()}>
          {last ? (
            <div className="adc-stack">
              <VerdictReason tone={last.passed ? 'ok' : 'danger'} label={last.passed ? DR.passed : DR.failed(last.checks.filter((c) => c.result === 'FAIL').length)} reason={DR.runAt(fmtAt(last.runAt), personName(last.runBy))} />
              <table className="ads-axes">
                <caption className="ads-axes__caption">{DR.caption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{DR.check}</th>
                    <th scope="col">{DR.result}</th>
                    <th scope="col">{DR.basis}</th>
                  </tr>
                </thead>
                <tbody>
                  {last.checks.map((c) => (
                    <tr key={c.id} data-drill-check={c.id}>
                      <th scope="row">{c.label}</th>
                      <td>
                        <StatusGlyph kind={c.result === 'PASS' ? 'PASS' : 'FAIL'} /> {c.result === 'PASS' ? DR.pass : DR.fail}
                      </td>
                      <td>{c.basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </AsyncView>
      </div>
    </Panel>
  );
}

// ───────────── OTA 설치 단계 띠(선형 5단계 + 갈림 상태 줄) ─────────────

const LINEAR = INSTALL_LINEAR.map((s) => INSTALL_STAGE_LABEL[s]);
export interface InstallViewModel {
  step: number;
  of: number;
  label: string;
  branch: { kind: string; text: string } | null;
  restriction: string | null;
  confirmed: boolean;
  stale: boolean;
  lastAt: string | null;
  safeState: { reachedAt: string; basis: string } | null;
}

export function InstallStrip({ view }: { view: InstallViewModel }) {
  return (
    <div className="ds-stages" data-install-strip data-step={view.step}>
      <ol className="ds-stages__list" aria-label={IN.title}>
        {LINEAR.map((name, i) => {
          const status = i + 1 < view.step ? 'done' : i + 1 === view.step ? 'current' : 'todo';
          const label = i + 1 === view.step ? (view.stale || (i === 3 && !view.confirmed && view.label !== LINEAR[3]) ? view.label : name) : name;
          return (
            <li key={name} className="ds-stages__step" data-status={status} aria-current={status === 'current' ? 'step' : undefined}>
              <span className="ds-stages__label">
                <StatusGlyph kind={status === 'done' ? 'PASS' : status === 'current' ? 'REVIEW' : 'UNJUDGED'} />
                <span className="ds-stages__no">
                  {i + 1}/{LINEAR.length}
                </span>
                {label}
              </span>
              {i === 0 && view.restriction ? <span className="ds-stages__meta">{view.restriction}</span> : null}
            </li>
          );
        })}
      </ol>
      <span className="ds-sr">{IN.stepOf(view.step, view.of)}</span>
      {view.branch ? (
        <p className="adsc-note" data-install-branch={view.branch.kind}>
          <VerdictReason tone={view.branch.kind === 'DEFERRED' ? 'neutral' : 'danger'} label={view.branch.text} />
        </p>
      ) : null}
      {view.safeState ? <p className="adsc-note">{IN.safeState(fmtAt(view.safeState.reachedAt), view.safeState.basis)}</p> : null}
    </div>
  );
}
