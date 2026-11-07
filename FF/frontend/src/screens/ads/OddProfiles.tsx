// ODD 프로파일 /config/odd (ADS-UI04 · ADS-BE09) — 프로파일 목록(승인 상한 대비 배포 설정), 상세(축별 조건·의미 검증·연결·변경 전후·승인), 적용 장소 탭.
// 핵심 메시지는 '승인 상한을 넘는 배포 설정 N건 — 판단 불가 M건 별도', '모두 상한 안'은 판단 불가 0건일 때만(P-4). 장소 상태 수는 탭 머리 SummaryLine(P-15).
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type DeployComparison, type LimitVerdict, type OddCondition, type OddIssue, type OddProfile, type OddProfileListItem, type OddSite, type SiteStatus } from '@ff/contracts';
import { LIMIT_VERDICT_LABEL, ODD_AXES, ODD_AXIS_LABEL, ODD_SELF_APPROVAL, oddConditionText, SITE_STATUS_LABEL } from '../../../../contracts/src/rules/ads-config';
import { actorFor } from '../../api/actor';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { odd as O } from '../../copy/ads-config';
import { personName } from '../../data/people';
import { ApprovalSlots, AsyncView, Button, DataTable, DiffView, ErrorNote, Field, IdChip, KeyValue, PageHeader, Panel, SummaryLine, Tabs, type KeyMessageSpec } from '../../design';
import { BlockedAction, ChangeKindBadge, UnknownMark, VerdictReason, type VerdictTone } from '../../design/ads';
import { useAppShell } from '../../store';
import { usePermission } from '../shared';
import { CompileTab, SiteApprove, SiteRequestAction, type CompileRow, type VerdictLogs } from './P5Panels';
import { compile as CP } from '../../copy/ads-p5';
import './ads-config.css';

interface ListResp {
  items: OddProfileListItem[];
  summary: { exceeds: number; undecidable: number; within: number; total: number };
}
type SiteRow = OddSite & { status: SiteStatus; reason: string; code: string | null; requested?: boolean };
interface Detail {
  profile: OddProfile;
  feature: { featureId: string; version: string; name: string; lifecycle: string } | null;
  issues: OddIssue[];
  blockedReason: string | null;
  deploy: DeployComparison[];
  deployCounts: Record<LimitVerdict, number>;
  sites: SiteRow[];
  flagKeys: string[];
  policies: { policyId: string; flagKey: string; status: string }[];
  configSets: string[];
  base: { profileId: string; version: number; status: string } | null;
  diff: { field: string; before: string; after: string }[];
  /** ADS-BE09 정책 컴파일 검사 — Flag별 배포 설정 ↔ 승인 상한 */
  compile?: CompileRow[];
  /** 이 프로파일 참조로 기록된 차량 판정 */
  logs?: VerdictLogs;
}

const INVALIDATE = ['oddProfiles', 'oddProfile', 'audit', 'events'];
const VERDICT_TONE: Record<LimitVerdict, VerdictTone> = { WITHIN: 'ok', EXCEEDS: 'danger', UNDECIDABLE: 'unknown' };
const SITE_TONE: Record<SiteStatus, VerdictTone> = { APPROVED: 'ok', PENDING: 'neutral', EXPOSURE_HOLD: 'warn' };

/** 핵심 메시지 — 판단 불가는 상한 안으로 세지 않는다 */
function oddKeyMessage(s: ListResp['summary'] | undefined, empty: boolean): KeyMessageSpec {
  if (!s) return { tone: 'neutral', text: O.key.loading };
  if (s.exceeds) return { tone: 'danger', text: O.key.exceeds(s.exceeds, s.undecidable) };
  if (s.undecidable) return { tone: 'warn', text: O.key.undecidable(s.undecidable) };
  if (empty) return { tone: 'neutral', text: O.empty.title };
  return { tone: 'ok', text: O.key.allWithin };
}

/** 목록 칸 — 승인 상한 대비 배포 설정(확대·판단 불가·모두 상한 안) */
function DeployCell({ d }: { d: Record<LimitVerdict, number> }) {
  return (
    <span className="adsc-cell">
      {d.EXCEEDS ? <VerdictReason tone="danger" label={O.deploy.exceeds(d.EXCEEDS)} /> : d.UNDECIDABLE ? null : <VerdictReason tone="ok" label={O.deploy.within} />}
      {d.UNDECIDABLE ? <UnknownMark kind="UNDECIDABLE" reason={O.deploy.undecidable(d.UNDECIDABLE)} /> : null}
    </span>
  );
}

export default function OddProfilesScreen() {
  const [sp, setSp] = useSearchParams();
  const q = useApi<ListResp>('oddProfiles');
  const items = q.data?.items ?? [];
  // 첫 진입 — 검증 오류가 남은 초안(승인 전 확인할 것)을 연다
  const selected = sp.get('profile') ?? items.find((i) => i.status === 'DRAFT')?.profileId ?? items[0]?.profileId ?? null;
  const open = (id: string) => {
    const n = new URLSearchParams(sp);
    n.set('profile', id);
    setSp(n, { replace: true });
  };
  const C = O.col;
  return (
    <div className="ds-screen">
      <PageHeader codes="D02-01 · ADS-UI04 · ADS-BE09" title={O.title} lead={O.lead} message={oddKeyMessage(q.data?.summary, !!q.data && items.length === 0)} meta={<Link to="/config/compat">{O.toCompat}</Link>} />
      <Panel title={O.list} id="odd-profiles">
        <AsyncView state={asyncState(q, items.length === 0)} error={q.error ? O.error : null} onRetry={() => q.refetch()} empty={O.empty}>
          <DataTable
            caption={O.list}
            rows={items}
            pageSize={0}
            rowKey={(r) => r.profileId}
            onOpen={(r) => open(r.profileId)}
            columns={[
              {
                key: 'f',
                header: C.feature,
                cell: (r) => (
                  <span className="adsc-cell">
                    <span className="ds-mono ds-nowrap">{`${r.featureId} ${r.featureVersion}`}</span>
                    {r.featureName ? <span className="adsc-sub">{r.featureName}</span> : null}
                  </span>
                ),
              },
              { key: 'v', header: C.version, cell: (r) => <span className="ds-mono" data-selected={r.profileId === selected ? '' : undefined}>{`${r.profileId} · ${O.ver(r.version)}`}</span> },
              { key: 's', header: C.status, cell: (r) => <VerdictReason tone={r.status === 'APPROVED' ? 'ok' : 'neutral'} label={O.status[r.status]} /> },
              { key: 'd', header: C.deploy, cell: (r) => <DeployCell d={r.deploy} /> },
              { key: 'i', header: C.issues, cell: (r) => (r.issues ? <VerdictReason tone="danger" label={O.issues(r.issues)} /> : O.issues(0)) },
              { key: 'p', header: C.sites, cell: (r) => <span className="adsc-sub">{O.sitesCell(r.sites.APPROVED, r.sites.PENDING, r.sites.EXPOSURE_HOLD)}</span> },
            ]}
          />
        </AsyncView>
      </Panel>
      {selected ? <ProfileDetail id={selected} /> : null}
    </div>
  );
}

function ProfileDetail({ id }: { id: string }) {
  const q = useApi<Detail>('oddProfile', { params: { id } });
  const d = q.data;
  const siteCount = d ? d.sites.length : undefined;
  return (
    <Panel title={O.detail(id)} id="odd-detail">
      <AsyncView state={asyncState(q)} error={q.error ? O.error : null} onRetry={() => q.refetch()}>
        {d ? (
          <Tabs param="detail" tabs={[{ key: 'cond', label: O.tabs.cond }, { key: 'deploy', label: O.tabs.deploy, count: d.deploy.length }, { key: 'compile', label: CP.tab, count: (d.compile ?? []).filter((c) => c.blockers.length).length }, { key: 'sites', label: O.tabs.sites, count: siteCount }]}>
            {(active) => (active === 'sites' ? <SitesTab rows={d.sites} profileId={d.profile.profileId} /> : active === 'deploy' ? <DeployTab rows={d.deploy} /> : active === 'compile' ? <CompileTab rows={d.compile ?? []} logs={d.logs} /> : <ConditionsTab d={d} />)}
          </Tabs>
        ) : null}
      </AsyncView>
    </Panel>
  );
}

function ConditionsTab({ d }: { d: Detail }) {
  const p = d.profile;
  const rows = [...p.conditions].sort((a, b) => ODD_AXES.indexOf(a.axis) - ODD_AXES.indexOf(b.axis));
  const limitOf = (c: OddCondition) => p.envelope.find((e) => e.key === c.key) ?? null;
  const C = O.cond;
  return (
    <div className="adsc-stack">
      <DataTable
        caption={C.caption}
        rows={rows}
        pageSize={0}
        rowKey={(c) => `${c.axis}|${c.key}`}
        columns={[
          { key: 'a', header: C.axis, cell: (c) => (c.axis === 'EXCLUSION' ? <span className="adsc-tag" data-exclusion>{C.exclusionTag}</span> : ODD_AXIS_LABEL[c.axis]) },
          { key: 'n', header: C.name, cell: (c) => c.label },
          { key: 'v', header: C.value, cell: (c) => <span data-odd-value>{oddConditionText(c)}</span> },
          { key: 'l', header: C.limit, cell: (c) => { const l = limitOf(c); return l ? oddConditionText(l) : <span className="adsc-sub">{C.noLimit}</span>; } },
        ]}
      />
      <section className="adsc-stack" aria-label={O.validation.title} data-odd-validation>
        <p className="adsc-note">{O.validation.title}</p>
        {d.issues.length ? (
          <ul className="adsc-list">
            {d.issues.map((i, n) => (
              <li key={n}>
                <VerdictReason tone="danger" label={i.short} reason={i.message} code={i.code} />
              </li>
            ))}
          </ul>
        ) : (
          <VerdictReason tone="ok" label={O.validation.none} />
        )}
      </section>
      <KeyValue
        rows={[
          { k: O.links.feature, v: d.feature ? <Link className="ds-mono" to={`/features/${d.feature.featureId}/${d.feature.version}`}>{`${d.feature.featureId} ${d.feature.version} · ${d.feature.name}`}</Link> : '—' },
          { k: O.links.policies, v: d.policies.length ? d.policies.map((x) => <IdChip key={x.policyId} id={x.policyId} to={`/policies/${x.policyId}`} />) : <span className="adsc-sub">{O.links.none}</span> },
          { k: O.links.flags, v: <span className="ds-mono">{d.flagKeys.join(', ') || '—'}</span> },
          { k: O.links.sets, v: d.configSets.length ? d.configSets.map((s) => <Link key={s} className="ds-mono" to="/config/compat">{s}</Link>) : '—' },
        ]}
      />
      <section className="adsc-stack" aria-label={O.diff.title}>
        <div className="adsc-row">
          <ChangeKindBadge kind="ODD" />
          <span className="adsc-note">{d.base ? O.diff.base(d.base.profileId) : O.diff.first}</span>
        </div>
        {d.base ? <DiffView rows={d.diff} /> : null}
        <p className="adsc-note">{O.diff.flow}</p>
      </section>
      <Approval d={d} />
    </div>
  );
}

function Approval({ d }: { d: Detail }) {
  const p = d.profile;
  const perm = usePermission(['SAFETY_OFFICER']);
  const { role } = useAppShell();
  const approve = useApiMutation('approveOddProfile', INVALIDATE);
  const [reason, setReason] = useState('');
  if (p.status === 'APPROVED')
    return <ApprovalSlots requester={{ id: p.createdBy, name: personName(p.createdBy) }} slots={[{ role: O.approval.role, approver: p.approvedBy && p.approvedAt ? { id: p.approvedBy, name: personName(p.approvedBy), signedAt: p.approvedAt } : null }]} />;
  if (d.blockedReason) return <BlockedAction label={O.approval.action} reason={d.blockedReason} />;
  if (!perm.ok) return <BlockedAction label={O.approval.action} reason={STATIC_MODE ? O.approval.readOnly : O.approval.noPermission} />;
  // 직무 분리 — 초안 작성자는 자기 초안을 승인하지 않는다(서버도 같은 사유로 거부)
  if (actorFor(role, ['SAFETY_OFFICER']).id === p.createdBy) return <BlockedAction label={O.approval.action} reason={ODD_SELF_APPROVAL} />;
  return (
    <div className="adsc-row">
      <Field label={O.approval.reason}>
        <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button variant="primary" disabled={reason.trim().length < 2 || approve.isPending} onClick={() => approve.mutate({ params: { id: p.profileId }, body: { reason } })}>
        {O.approval.action}
      </Button>
      <ErrorNote error={approve.error} />
    </div>
  );
}

function DeployTab({ rows }: { rows: DeployComparison[] }) {
  const C = O.deployTable;
  return (
    <DataTable
      caption={C.caption}
      rows={rows}
      pageSize={0}
      rowKey={(r) => r.settingId}
      columns={[
        { key: 's', header: C.setting, cell: (r) => r.label },
        { key: 'f', header: C.flag, cell: (r) => <span className="ds-mono">{r.flagKey}</span> },
        { key: 'v', header: C.value, cell: (r) => oddConditionText(r) },
        { key: 'l', header: C.limit, cell: (r) => r.limitText ?? '—' },
        {
          key: 'r',
          header: C.verdict,
          cell: (r) => (r.verdict === 'UNDECIDABLE' ? <UnknownMark kind="UNDECIDABLE" reason={r.reason} /> : <VerdictReason tone={VERDICT_TONE[r.verdict]} label={LIMIT_VERDICT_LABEL[r.verdict]} reason={r.reason} />),
        },
      ]}
    />
  );
}

function SitesTab({ rows, profileId }: { rows: SiteRow[]; profileId: string }) {
  const n = (s: SiteStatus) => rows.filter((r) => r.status === s).length;
  const S = O.sites;
  return (
    <div className="adsc-stack">
      <div className="adsc-row">
        <SummaryLine label={S.summary} items={(['APPROVED', 'PENDING', 'EXPOSURE_HOLD'] as SiteStatus[]).map((s) => ({ k: SITE_STATUS_LABEL[s], v: n(s) }))} />
        <SiteRequestAction profileId={profileId} />
      </div>
      <DataTable
        caption={S.caption}
        rows={rows}
        pageSize={0}
        rowKey={(r) => r.siteId}
        columns={[
          { key: 'n', header: S.name, cell: (r) => r.name },
          { key: 'k', header: S.kind, cell: (r) => S.kinds[r.kind] },
          { key: 'm', header: S.map, cell: (r) => <span className="ds-mono">{r.mapVersion}</span> },
          { key: 'i', header: S.infra, cell: (r) => <span className="ds-mono">{r.infraVersion}</span> },
          { key: 's', header: S.status, cell: (r) => <VerdictReason tone={SITE_TONE[r.status]} label={SITE_STATUS_LABEL[r.status]} code={r.code ?? undefined} /> },
          { key: 'r', header: S.reason, cell: (r) => (r.requested && r.status === 'PENDING' ? <SiteApprove profileId={profileId} siteId={r.siteId} status={r.status} reason={r.reason} /> : <span data-site-reason>{r.reason}</span>) },
        ]}
      />
    </div>
  );
}

