// /admin/iam — 플랫폼 인증·권한 (D06-09): 역할 × 변경 권한(ROUTES 파생)·직무 분리·최근 거부 시도.
// /variant-conditions — Variant·지원 조건 (D02-01·D02-02): Feature Version × Fleet 매트릭스.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { REPORT_APPROVER_ROLES, ROLE_LABEL, type ApproverRole } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { PLATFORM_ROLES } from '../../api/actor';
import { roleLabel } from '../../data/refdata';
import { ko } from '../../copy/ko';
import { AsyncView, DataTable, Field, KeyValue, PageHeader, Panel, SummaryLine, VerdictBadge } from '../../design';
import { when } from '../shared';

const I = ko.iam;
const VC = ko.variant;

interface RolesView {
  roles: { role: string; label: string; human: boolean; allowed: string[] }[];
  humanRoles: string[];
  permissions: { name: string; method: string; path: string; summary: string; component: string; roles: string[] }[];
  sod: { id: string; subject: string; rule: string; component: string }[];
}

export function IamScreen() {
  const q = useApi<RolesView>('iamRoles');
  const den = useApi<{ items: { at: string; actorId: string; actorRole: string; action: string; target: string; reason: string | null }[]; byRole: Record<string, number> }>('iamDenials');
  const d = q.data;
  const roles = d ? d.roles.filter((r) => r.human) : [];
  return (
    <div className="ds-screen">
      <PageHeader codes="D06-09 · IAM" title={I.title} lead={I.lead} message={{ tone: 'neutral', value: den.data ? den.data.items.length : '—', text: I.key }} />
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <Panel title={I.matrix} id="matrix">
            {/* 스크롤 영역은 키보드로도 움직일 수 있어야 한다(표 안에 포커스 가능한 요소가 없다) */}
            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 360px)' }} tabIndex={0} role="region" aria-label={I.matrix}>
              <table className="ds-fleet">
                <caption className="ds-sr">{I.matrix}</caption>
                <thead>
                  <tr>
                    <th scope="col">{I.col.action}</th>
                    <th scope="col">{I.col.component}</th>
                    {roles.map((r) => (
                      <th key={r.role} scope="col" title={r.role}>
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.permissions.map((p) => (
                    <tr key={p.name}>
                      <th scope="row" title={`${p.method} ${p.path}`}>
                        <span style={{ fontSize: 'var(--fs-xs)' }}>{p.summary}</span>
                      </th>
                      <td className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                        {p.component}
                      </td>
                      {roles.map((r) => (
                        <td key={r.role} aria-label={`${r.label} ${p.roles.includes(r.role) ? 'O' : '-'}`}>
                          {p.roles.includes(r.role) ? <span className="ds-fcell" data-v="on">●</span> : <span style={{ color: 'var(--faint)' }}>·</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </AsyncView>
      <Panel title={I.reportRoles} id="report-roles" tour="report-roles">
        <p className="ds-field__hint" style={{ marginTop: 0 }}>
          {I.reportRolesLead}
        </p>
        <DataTable
          caption={I.reportRoles}
          rows={(Object.keys(REPORT_APPROVER_ROLES) as ApproverRole[]).map((a) => ({ a, role: REPORT_APPROVER_ROLES[a] }))}
          rowKey={(r) => r.a}
          columns={[
            { key: 'a', header: 'approvals[].role', cell: (r) => <span className="ds-rule-id">{r.a}</span> },
            { key: 'p', header: I.col.role, cell: (r) => <span>{`${ROLE_LABEL[r.role]} · `}<span className="ds-mono">{r.role}</span></span> },
            { key: 'h', header: I.holders, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{Object.entries(PLATFORM_ROLES).filter(([, rs]) => rs.includes(r.role)).map(([k]) => roleLabel(k)).join(', ') || '—'}</span> },
          ]}
        />
      </Panel>
      <div className="ds-split">
        <Panel title={I.sod} id="sod">
          <DataTable
            caption={I.sod}
            rows={d?.sod ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'id', header: 'ID', cell: (r) => <span className="ds-mono">{r.id}</span> },
              { key: 's', header: I.col.subject, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.subject}</span> },
              { key: 'r', header: I.col.rule, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.rule}</span> },
              { key: 'c', header: I.col.component, cell: (r) => <span className="ds-mono">{r.component}</span> },
            ]}
          />
        </Panel>
        <Panel title={I.denials} id="denials" actions={<Link to="/audit">{ko.audit.title} →</Link>}>
          <AsyncView state={asyncState(den, (den.data?.items ?? []).length === 0)} error={den.error?.message} onRetry={() => den.refetch()} rows={3}>
            <DataTable
              caption={I.denials}
              rows={den.data?.items ?? []}
              rowKey={(r) => `${r.at}-${r.actorId}-${r.action}`}
              columns={[
                { key: 'at', header: I.col.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.at)}</span> },
                { key: 'a', header: I.col.actor, cell: (r) => <span className="ds-mono">{`${r.actorId} · ${r.actorRole}`}</span> },
                { key: 'x', header: I.col.action, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.action}</span> },
                { key: 'r', header: ko.audit.col.reason, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.reason ?? ''}</span> },
              ]}
            />
          </AsyncView>
        </Panel>
      </div>
    </div>
  );
}

interface Matrix {
  feature: { featureId: string; version: string; name: string; lifecycle: string };
  conditions: { scope: string; upgVc: string[]; requiredSw: string | null; ecu: string | null; swId: string | null };
  summary: { applicable: number; notSupported: number; notApplicable: number; unknown: number };
  rows: { vin: string; label: string; quality: string; scope: boolean; upgVc: boolean | null; actual: string; required: string | null; verdict: keyof typeof VC.verdict; reason: string }[];
}
const V_VERDICT: Record<string, string> = { APPLICABLE: 'PASS', NOT_SUPPORTED: 'FAIL', NOT_APPLICABLE: '미판정', UNKNOWN: 'CONDITIONAL' };

export function VariantScreen() {
  const [sp, setSp] = useSearchParams();
  const [featureId, setFeatureId] = useState(sp.get('featureId') ?? 'FEAT-00022');
  const [version, setVersion] = useState(sp.get('version') ?? '1.0.0');
  const valid = /^FEAT-\d{5}$/.test(featureId) && /^\d+\.\d+\.\d+$/.test(version);
  const q = useApi<Matrix>('variantMatrix', { params: { featureId, version } }, { enabled: valid });
  const d = q.data;
  const set = (f: string, v: string) => (setFeatureId(f), setVersion(v), setSp({ featureId: f, version: v }, { replace: true }));
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D02-01 · D02-02 · VARIANT / SUPPORT"
        title={VC.title}
        lead={VC.lead}
        message={
          d
            ? d.summary.notSupported
              ? { tone: 'warn', value: d.summary.notSupported, text: VC.key.notSupported(`${d.feature.featureId} ${d.feature.version} ${d.feature.name}`) }
              : { tone: 'ok', text: VC.key.ok(`${d.feature.featureId} ${d.feature.version} ${d.feature.name}`) }
            : { tone: 'neutral', value: '—', text: VC.key.notSupported(`${featureId} ${version}`) }
        }
      />
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <Field label={VC.feature}>
          <input className="ds-input ds-input--mono" name="featureId" value={featureId} onChange={(e) => set(e.target.value.trim().toUpperCase(), version)} />
        </Field>
        <Field label={VC.version}>
          <input className="ds-input ds-input--mono" name="version" value={version} onChange={(e) => set(featureId, e.target.value.trim())} />
        </Field>
      </div>
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <>
            <SummaryLine
              items={[
                { k: VC.verdict.APPLICABLE, v: d.summary.applicable },
                { k: VC.verdict.NOT_APPLICABLE, v: d.summary.notApplicable },
                { k: VC.verdict.UNKNOWN, v: d.summary.unknown },
              ]}
            />
            <Panel title={VC.conditions} id="conditions" tour="variant-conditions">
              <KeyValue
                rows={[
                  { k: VC.col.scope, v: <span className="ds-mono">{d.conditions.scope}</span> },
                  { k: VC.col.upgVc, v: <span className="ds-mono">{d.conditions.upgVc.join(', ') || '—'}</span> },
                  { k: VC.requiredSw, v: <span className="ds-mono">{d.conditions.requiredSw ? `${d.conditions.swId} ≥ ${d.conditions.requiredSw}` : '—'}</span>, note: d.conditions.ecu ?? undefined },
                ]}
              />
            </Panel>
            <DataTable
              caption={VC.title}
              rows={d.rows}
              rowKey={(r) => r.vin}
              columns={[
                { key: 'v', header: VC.col.vin, cell: (r) => <Link className="ds-mono" to={`/fleet/vehicles/${encodeURIComponent(r.vin)}`}>{r.vin}</Link> },
                { key: 's', header: VC.col.scope, cell: (r) => <VerdictBadge value={r.scope ? 'PASS' : '미판정'} /> },
                { key: 'u', header: VC.col.upgVc, cell: (r) => <VerdictBadge value={r.upgVc === null ? '미판정' : r.upgVc ? 'PASS' : 'FAIL'} /> },
                { key: 'sw', header: VC.col.sw, cell: (r) => <span className="ds-mono">{r.actual}</span> },
                { key: 'x', header: VC.col.verdict, cell: (r) => <VerdictBadge value={V_VERDICT[r.verdict]} />, sort: (r) => r.verdict },
                { key: 'r', header: VC.col.reason, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.reason}</span> },
              ]}
            />
          </>
        )}
      </AsyncView>
    </div>
  );
}

/** 차량별 적용 상태 화면의 패널 — 이 차량이 배포 Feature를 지원하는가 (D02-02) */
export function SupportPanel({ vin }: { vin: string }) {
  const q = useApi<{ items: { featureId: string; version: string; name: string; flagKeys: string[]; verdict: keyof typeof VC.verdict; reason: string }[] }>('vehicleSupport', { params: { vin } });
  return (
    <Panel title={VC.support} codes="D02-02" id="support">
      <AsyncView state={asyncState(q, (q.data?.items ?? []).length === 0)} error={q.error?.message} onRetry={() => q.refetch()} rows={2}>
        <DataTable
          caption={VC.support}
          rows={q.data?.items ?? []}
          rowKey={(r) => `${r.featureId}@${r.version}`}
          columns={[
            { key: 'f', header: VC.feature, cell: (r) => <Link className="ds-mono" to={`/variant-conditions?featureId=${r.featureId}&version=${r.version}`}>{`${r.featureId} ${r.version}`}</Link> },
            { key: 'k', header: 'flag', cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.flagKeys.join(', ')}</span> },
            { key: 'x', header: VC.col.verdict, cell: (r) => <VerdictBadge value={V_VERDICT[r.verdict]} /> },
            { key: 'r', header: VC.col.reason, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.reason}</span> },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}
