import { transitionCaption, roleCaptionFromSourceLabel } from '../../data/contractCaptions';
import { TransitionBlocker } from '../../design/server-explanation';
// /features/:id/:ver — Feature Version 상세 (v2). Lifecycle 전이·Gate 판정·의존관계·구현 추적·Baseline·감사.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { GATES, ROLE_LABEL, ruleFor, type Lifecycle } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { STATIC_MODE } from '../../api/client';
import { actorFor } from '../../api/actor';
import { useAppShell } from '../../store';
import { ko } from '../../copy/ko';
import { extSync } from '../../copy/ext-sync';
import { NotFound } from '../../components/patterns';
import {
  AsyncView,
  Button,
  DataTable,
  Drawer,
  ErrorNote,
  Field,
  GateRail,
  IdChip,
  KeyValue,
  LifecycleBadge,
  LifecycleStepper,
  PageHeader,
  Panel,
  Select,
  Tabs,
  VerdictBadge,
  Icon,
} from '../../design';
import { scopeOf, usePermission, when } from '../shared';
import { AuditLog } from '../governance/AuditLog';
import { ReleaseSignoffBar } from './ReleaseSignoff';
import { EpicChip, ExtLinksTab, RequirementChips } from './ExtLinksTab';
import { FeatureRefsTab } from './FeatureRefsTab';
import { FeatureProfilePanel } from '../ple/FeatureProfilePanel';
import { FeatureFlagHighlight, FeatureFlagsTab } from './FeatureFlags';
import { flags as flagCopy } from '../../copy/flags';
import { evaluations as evaluationsCopy } from '../../copy/records';
import { featureRefsTab } from '../../copy/propose';
import { traceCopy } from '../../copy/trace-links';
import { taxonomyLevelNames } from '../../copy/taxonomy-level-names';
import { flagCode as flagCodeCopy } from '../../copy/flag-code';
import { RefWarningList, type RefWarning } from '../refdb/common';
import { SafetyBadges, SafetyTab } from './SafetyTab';
import { GatesTab } from './GatesTab';
import { FeatureVersionActions } from './VersionEdit';
import { NextTurn, roleBlocker } from './NextTurn';
import { nextTurn as NT } from '../../copy/inbox';
import { ImplDeadEnd, ImplMissingNotice, RegisteredGuide } from './ImplLinks';
import type { AuditEntry, ChecklistItem, FeatureDetail as Detail } from '../types';
import { ExternalToolLaunchers } from '../../external/launchers';
import { useFeatureTrace } from './ExtLinksTab';
import { useExternalChanges } from '../../external/useExternalChanges';
import { ChangeKindChip } from '../ads/ChangeImpact';
import { AdsClassificationPanel } from '../ads/AdsClassification';
import { BaselineHistory, HistoryTab, IssueInputs, RejectAction, ReleaseCandidatePanel, RetireAction, ReviewRecords } from './LifecyclePanels';
import { lcGate } from '../../copy/lifecycle-gate';
import type { IssueItem } from '../../../../contracts/src/rules/feature-retire';

const T = ko.detail;
// 평가 운영 데이터 탭(B5) — 탭을 열 때만 읽는다
const EvaluationsTab = lazy(() => import('./EvaluationsTab'));
// 운영 지표 탭(TL-UI04·UI18) — Data Lake 지표는 탭을 열 때 따로 읽는다
const OpsMetricsTab = lazy(() => import('./OpsMetricsTab').then((m) => ({ default: m.OpsMetricsTab })));
const TraceLinksTab = lazy(() => import('./TraceLinksTab'));
// 분류 경로 탭(TX) — L0부터 배치 노드까지·배치
const TaxonomyTab = lazy(() => import('./TaxonomyTab'));
// Lifecycle은 핵심 메시지 상태 pill과 스테퍼가 보인다 — 속성 표에서 한 번 더 보이지 않는다(3초 규칙 6, UX3-08)
const ATTR_ORDER = ['featureId', 'name', 'description', 'requirementIds', 'country', 'vehicleModel', 'trim', 'version', 'baselineId', 'ownerId', 'tags', 'asil', 'upgVc', 'functions', 'swIds', 'swVersions', 'ecuPnos', 'controlPoints', 'dependencyIds'] as const;
const INVALIDATE = ['featureDetail', 'listFeatures', 'gates', 'audit', 'baselineRequests', 'baselineChecklist', 'baselines'];

export default function FeatureDetail() {
  useExternalChanges();
  const { id = '', ver = '' } = useParams();
  const nav = useNavigate();
  const q = useApi<Detail>('featureDetail', { params: { id, ver } });
  const { role } = useAppShell();
  const d = q.data && STATIC_MODE ? forActor(q.data, role) : q.data;
  const external = useFeatureTrace(id, ver);
  const [transitionTo, setTransitionTo] = useState<Lifecycle | null>(null);
  // 막지 않은 기준 행 경고(전이·새 Version 응답 warnings) — 그 Version에서만 보인다. 새 Version은 이동할 때 state로 넘겨받는다
  const loc = useLocation();
  const [refWarn, setRefWarn] = useState<{ at: string; title: string; items: RefWarning[] } | null>(null);
  useEffect(() => {
    const s = loc.state as { refWarnings?: RefWarning[] } | null;
    if (s?.refWarnings?.length) setRefWarn({ at: `${id}@${ver}`, title: featureRefsTab.warnVersion, items: s.refWarnings });
    // 이동(새 Version)마다 한 번 — 같은 Version의 다시 그리기에는 다시 넣지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.key]);
  // 없는 Version/ID는 재시도해도 없는 데이터다 — 일반 오류 카드 대신 404 화면으로 보낸다(정적 호스팅은 HTTP 200이지만 화면 의미는 404)
  const notFound = q.error?.status === 404;

  return (
    <div className="ds-screen">
      {notFound ? (
        <NotFound />
      ) : (
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {d && (
          <>
            <PageHeader
              tour="feature-header"
              title={d.feature.name}
              message={{
                tone: Object.values(d.gates).filter((g) => g.status === 'PASS').length === GATES.length ? 'ok' : 'neutral',
                value: `${Object.values(d.gates).filter((g) => g.status === 'PASS').length}/${GATES.length}`,
                text: T.key.gateLabel,
                status: { label: ko.lifecycle[d.feature.lifecycle as keyof typeof ko.lifecycle] ?? d.feature.lifecycle, tone: d.feature.lifecycle === 'RELEASED' ? 'ok' : 'neutral' },
              }}
              // 머리 칩은 정체(ID·적용 범위·안전 분류·JIRA Epic)만 — ASIL·Owner·Baseline은 속성 표와 Baseline 탭에 있다(UX3-08: 칩 9개)
              meta={
                <>
                  <IdChip id={d.feature.featureId} version={d.feature.version} />
                  <span className="ds-tag">{scopeOf(d.feature)}</span>
                  <SafetyBadges id={id} ver={ver} />
                  <EpicChip id={id} ver={ver} />
                  {/* 변경 종류 배지 + 승인 경로 탭 링크만(ADS-UI09) — 비교·경로 표는 /analysis/impact */}
                  <ChangeKindChip featureId={id} version={ver} />
                </>
              }
              actions={
                <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <FeatureVersionActions key={`${id}@${ver}`} f={d.feature} latest={d.versions[d.versions.length - 1]?.version === ver} />
                  <Select label={T.versions} value={ver} onChange={(e) => nav(`/features/${id}/${e.target.value}`)}>
                    {/* 고른 Version의 Lifecycle은 핵심 메시지가 말한다 — 닫힌 선택 상자에 되풀이하지 않고, 다른 Version만 상태를 붙인다 */}
                    {d.versions.map((v) => (
                      <option key={v.version} value={v.version}>
                        {v.version === ver ? v.version : `${v.version} · ${ko.lifecycle[v.lifecycle]}`}
                      </option>
                    ))}
                  </Select>
                </div>
              }
            />

            <ExternalToolLaunchers compact requirement={external.data?.requirements?.[0]} jira={external.data?.epic ?? external.data?.changeRequests?.[0]} featureId={id} version={ver} />
            <FeatureFlagHighlight id={id} ver={ver} />

            <Panel id="lc">
              <LifecycleStepper current={d.feature.lifecycle} transitions={d.transitions} />
              <div className="feature-lifecycle-actions" style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
                {d.transitions
                  .filter((t) => !t.auto)
                  .map((t) => (
                    // 권한(역할·직무 분리)이 없으면 미리 막고 이유를 보인다 — 열어 본 뒤 422가 아니라(P1-6)
                    <Button
                      key={t.to}
                      variant={t.to === 'DEPRECATED' || t.to === 'RETIRED' ? 'default' : 'primary'}
                      disabled={!!roleBlocker(t)}
                      reason={roleBlocker(t)?.code === 'ROLE' ? NT.roleBlocked(t.roles.join('·')) : roleBlocker(t)?.message}
                      onClick={() => setTransitionTo(t.to)}
                    >
                      {T.transition(t.to)}
                    </Button>
                  ))}
                {d.transitions.some((t) => t.auto) && <span className="ds-field__hint">{T.autoNote}</span>}
                {/* 정의 승인 반려·즉시 폐기(P10) — 표 10 전이 밖의 요청·기록 */}
                <RejectAction featureId={id} version={ver} lifecycle={d.feature.lifecycle} createdBy={d.meta?.createdBy} />
                <RetireAction featureId={id} version={ver} lifecycle={d.feature.lifecycle} createdBy={d.meta?.createdBy} />
              </div>
              <ReviewRecords featureId={id} version={ver} />
              {refWarn?.at === `${id}@${ver}` && <RefWarningList warnings={refWarn.items} title={refWarn.title} />}
              {/* 등록 직후 다음 할 일 · 승인 뒤 구현이 비어 검증 완료로 못 가면 새 Version 길(담당자 웨이브 P1-7·P3-8) */}
              {(loc.state as { registered?: boolean } | null)?.registered && d.feature.lifecycle === 'PROPOSED' && <RegisteredGuide f={d.feature} gatesPassed={(['G1', 'G2', 'G3'] as const).every((g) => d.gates[g]?.status === 'PASS')} />}
              <ImplDeadEnd f={d.feature} lifecycle={d.feature.lifecycle} latest={d.versions[d.versions.length - 1]?.version === ver} />
              {d.feature.lifecycle === 'VERIFIED' && <ReleaseSignoffBar id={id} ver={ver} gatesPassed={d.gates.G8?.status === 'PASS' && d.gates.G9?.status === 'PASS'} />}
            </Panel>

            {/* 다음 차례 — 내가 할 일·다음 담당 부서·역할·막힌 조건 전부(기준 행 연결 포함), P1-6 */}
            <NextTurn transitions={d.transitions} />

            <Tabs
              tabs={[
                { key: 'overview', label: T.tabs.overview },
                { key: 'flags', label: flagCopy.tab },
                { key: 'evaluations', label: evaluationsCopy.tab },
                { key: 'refs', label: featureRefsTab.tab, count: d.feature.featureRefs?.length ?? 0 },
                { key: 'safety', label: T.tabs.safety },
                { key: 'gates', label: T.tabs.gates, count: Object.keys(d.gates).length },
                { key: 'deps', label: T.tabs.deps, count: d.dependencies.outgoing.length + d.dependencies.incoming.length },
                { key: 'trace', label: T.tabs.trace, count: d.trace.length },
                { key: 'links', label: traceCopy.tab },
                { key: 'taxonomy', label: taxonomyLevelNames.tab },
                { key: 'ops', label: T.tabs.ops },
                { key: 'ext', label: extSync.feature.tab },
                { key: 'baseline', label: T.tabs.baseline },
                { key: 'history', label: lcGate.history.tab },
                { key: 'audit', label: T.tabs.audit },
              ]}
            >
              {(tab) =>
                tab === 'overview' ? (
                  <Overview d={d} />
                ) : tab === 'flags' ? (
                  <FeatureFlagsTab id={id} ver={ver} />
                ) : tab === 'evaluations' ? (
                  <Suspense fallback={<AsyncView state="loading">{null}</AsyncView>}>
                    <EvaluationsTab id={id} />
                  </Suspense>
                ) : tab === 'refs' ? (
                  <>
                    <FeatureRefsTab links={d.feature.featureRefs ?? []} lifecycle={d.feature.lifecycle} feature={d.feature} />
                    <FeatureProfilePanel featureId={d.feature.featureId} version={d.feature.version} />
                  </>
                ) : tab === 'safety' ? (
                  // 안전 분류 탭 — 보고서 v1.1 안전 속성 + ADS 분류·Lifecycle 단계별 책임자·시장 기준선(ADS-UI12)
                  <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
                    <SafetyTab id={id} ver={ver} />
                    <AdsClassificationPanel id={id} ver={ver} lifecycle={d.feature.lifecycle} />
                  </div>
                ) : tab === 'gates' ? (
                  <GatesTab id={id} ver={ver} />
                ) : tab === 'deps' ? (
                  <Deps d={d} />
                ) : tab === 'taxonomy' ? (
                  <Suspense fallback={null}>
                    <TaxonomyTab id={id} />
                  </Suspense>
                ) : tab === 'links' ? (
                  <Suspense fallback={null}>
                    <TraceLinksTab id={id} />
                  </Suspense>
                ) : tab === 'trace' ? (
                  <Trace d={d} />
                ) : tab === 'ops' ? (
                  <Suspense fallback={null}>
                    <OpsMetricsTab id={id} />
                  </Suspense>
                ) : tab === 'ext' ? (
                  <ExtLinksTab id={id} ver={ver} functions={d.feature.functions} />
                ) : tab === 'baseline' ? (
                  <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
                    <BaselineTab d={d} />
                    <ReleaseCandidatePanel featureId={id} version={ver} lifecycle={d.feature.lifecycle} />
                    <BaselineHistory featureId={id} />
                  </div>
                ) : tab === 'history' ? (
                  <HistoryTab featureId={id} />
                ) : (
                  <AuditTab target={`${id}@${ver}`} />
                )
              }
            </Tabs>

            <TransitionDrawer d={d} to={transitionTo} onClose={() => setTransitionTo(null)} onWarnings={(items) => setRefWarn({ at: `${id}@${ver}`, title: featureRefsTab.warnTransition, items })} />
          </>
        )}
      </AsyncView>
      )}
    </div>
  );
}

/**
 * 정적 공개본 — 받아 둔 상세의 전이 미리 보기는 행위자 없이 찍혔다. 역할·직무 분리 막힘만 지금 역할로 다시 판정한다
 * (서버 evaluateTransition과 같은 규칙: 경로 역할 중 맡은 첫 역할, 작성자 본인 승인 금지). 쓰기는 브라우저 안 시연 데이터가 처리한다(20-60)
 */
function forActor(d: Detail, persona: string): Detail {
  const a = actorFor(persona);
  return {
    ...d,
    transitions: d.transitions.map((t) => {
      const rule = ruleFor(d.feature.lifecycle as Lifecycle, t.to as Lifecycle);
      if (!rule || t.auto) return t;
      const rest = t.blockers.filter((b) => b.code !== 'ROLE' && b.code !== 'SEPARATION_OF_DUTY');
      const roleBlock = rule.roles.includes(a.role) ? [] : [{ code: 'ROLE', message: `허용 역할이 아닙니다 (${rule.roles.map((r) => ROLE_LABEL[r]).join(' · ')})` }];
      const sod = d.meta?.createdBy && d.meta.createdBy === a.id ? [{ code: 'SEPARATION_OF_DUTY', message: '작성자는 자기 Feature 버전을 승인·출시할 수 없습니다.' }] : [];
      return { ...t, blockers: [...rest, ...roleBlock, ...sod] as typeof t.blockers };
    }),
  };
}

function Overview({ d }: { d: Detail }) {
  const f = d.feature as any;
  const missing = (d.feature._missing ?? {}) as Record<string, string>;
  const show = (k: string) => {
    const v = f[k];
    if (k === 'description' && typeof v === 'string' && v !== '') return <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{v}</span>;
    if (k === 'requirementIds' && Array.isArray(v) && v.length) return <RequirementChips id={d.feature.featureId} ver={d.feature.version} ids={v} />;
    if (k === 'functions') return (v as { functionId: string; label: string }[]).map((x) => <span key={x.functionId} className="ds-tag"><span className="ds-mono">{x.functionId}</span> {x.label}</span>);
    if (Array.isArray(v)) return v.length ? v.map((x: string, i: number) => <span key={i} className={/^[A-Z0-9-.@]+$/.test(x) ? 'ds-mono' : undefined}>{x}{i < v.length - 1 ? ',' : ''}</span>) : null;
    if (v === null || v === '') return null;
    return /^(FEAT|BL)-|^\d+\.\d+\.\d+$/.test(String(v)) ? <span className="ds-mono">{v}</span> : String(v);
  };
  return (
    <Panel id="attrs">
      <KeyValue rows={ATTR_ORDER.map((k) => ({ k: T.attrs[k], v: show(k) ?? <span style={{ color: 'var(--faint)' }}>—</span>, note: missing[k] }))} />
    </Panel>
  );
}

function Deps({ d }: { d: Detail }) {
  const table = (rows: Detail['dependencies']['outgoing'], caption: string) =>
    rows.length ? (
      <DataTable
        caption={caption}
        rows={rows}
        rowKey={(r) => r.dependencyId}
        columns={[
          { key: 'id', header: 'DEP', cell: (r) => <span className="ds-mono">{r.dependencyId}</span> },
          { key: 'type', header: 'Type', cell: (r) => <span className="ds-mono" style={{ fontWeight: 700 }}>{r.type}</span> },
          { key: 'src', header: 'Source', cell: (r) => <IdChip id={r.sourceFeatureId} version={r.sourceVersion} to={`/features/${r.sourceFeatureId}/${r.sourceVersion}`} copy={false} /> },
          { key: 'tgt', header: 'Target', cell: (r) => (r.targetVersion ? <IdChip id={r.targetFeatureId} version={r.targetVersion} to={`/features/${r.targetFeatureId}/${r.targetVersion}`} copy={false} /> : <span className="ds-mono">{r.targetFeatureId}</span>) },
          { key: 'v', header: ko.audit.col.result, cell: (r) => <VerdictBadge value={r.verdict} /> },
          { key: 'why', header: ko.page.reason, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.rationale}</span> },
        ]}
      />
    ) : (
      <p className="ds-field__hint">{T.noDeps}</p>
    );
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <Panel title={T.outgoing} id="dep-out">{table(d.dependencies.outgoing, T.outgoing)}</Panel>
      <Panel title={T.incoming} id="dep-in">{table(d.dependencies.incoming, T.incoming)}</Panel>
      <div>
        <Link to={`/analysis/impact?feature=${d.feature.featureId}&version=${d.feature.version}`}>{ko.impact.title} →</Link>
      </div>
    </div>
  );
}

function Trace({ d }: { d: Detail }) {
  const C = T.trace;
  return (
    <Panel id="trace">
      <DataTable
        caption={T.tabs.trace}
        rows={d.trace}
        rowKey={(r) => `${r.swId}@${r.swVersion}#${r.ecuPno}`}
        columns={[
          { key: 'f', header: C.function, cell: (r) => (r.function ? <><span className="ds-mono">{r.function.functionId}</span> {r.function.label}</> : '—') },
          { key: 'sw', header: C.sw, cell: (r) => <><span className="ds-mono">{r.swId}</span> <span style={{ color: 'var(--muted)' }}>{r.sw?.name}</span></> },
          { key: 'v', header: C.version, cell: (r) => <span className="ds-mono">{r.swVersion ?? '—'}</span> },
          { key: 'ecu', header: C.ecu, cell: (r) => <><span className="ds-mono">{r.ecuPno}</span> <span style={{ color: 'var(--muted)' }}>{r.ecu?.name}</span></> },
          { key: 'rt', header: C.runtime, cell: (r) => r.sw?.runtime ?? '—' },
          { key: 'st', header: C.status, cell: (r) => (r.sw ? <span className="ds-mono">{r.sw.lifecycle}</span> : <VerdictBadge value="FAIL" />) },
        ]}
      />
    </Panel>
  );
}

function BaselineTab({ d }: { d: Detail }) {
  const perm = usePermission(['FEATURE_AUTHOR']);
  const cl = useApi<{ items: ChecklistItem[] }>('baselineChecklist', { params: { id: d.feature.featureId, ver: d.feature.version } });
  const req = useApiMutation('requestBaseline', INVALIDATE);
  const [reason, setReason] = useState('');
  return (
    <div className="ds-split">
      <Panel title={T.tabs.baseline} id="bl">
        {d.baseline ? (
          <KeyValue
            rows={[
              { k: 'Baseline', v: <IdChip id={d.baseline.baselineId} /> },
              { k: T.baselineHash, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{d.baseline.contentHash}</span> },
              { k: ko.bom.decidedBy, v: d.baseline.approvedBy ?? '—', note: when(d.baseline.approvedAt) },
              { k: T.baselineProducts, v: d.products.length ? d.products.map((p) => <IdChip key={p.catalogId + p.version} id={p.catalogId} version={p.version} to={`/products/${p.catalogId}/${p.version}`} copy={false} />) : '—' },
            ]}
          />
        ) : (
          <p className="ds-field__hint">{T.baselineNone}</p>
        )}
        {d.pendingBaselineRequest && (
          <p style={{ marginBottom: 0 }}>
            <Link to={`/baselines?request=${d.pendingBaselineRequest.requestId}`}>{T.pending(d.pendingBaselineRequest.requestId)} →</Link>
          </p>
        )}
      </Panel>
      <Panel title={ko.bom.checklist} id="bl-check">
        <AsyncView state={asyncState(cl)} rows={4}>
          <Checklist items={cl.data?.items ?? []} />
        </AsyncView>
        {!d.baseline && !d.pendingBaselineRequest && (
          <form
            style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}
            onSubmit={(e) => {
              e.preventDefault();
              req.mutate({ body: { featureId: d.feature.featureId, version: d.feature.version, reason } });
            }}
          >
            <Field label={ko.page.reason}>
              <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
            </Field>
            <ErrorNote error={req.error} />
            <Button type="submit" variant="primary" disabled={!perm.ok || req.isPending} title={perm.hint}>
              {T.requestBaseline}
            </Button>
            {perm.hint && <span className="ds-field__hint">{perm.hint}</span>}
          </form>
        )}
      </Panel>
    </div>
  );
}

export function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="ds-check">
      {items.map((c) => (
        <li key={c.id} data-state={c.state}>
          <Icon name={c.state === 'PASS' ? 'check' : c.state === 'FAIL' ? 'close' : 'alert'} size={16} />
          <span>
            {c.label}
            <span className="ds-check__detail">{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function AuditTab({ target }: { target: string }) {
  // 이 Version의 기록 전부 — Version 자체(전이·기준선)와 그 아래 대상(#safety 안전 분류·#G1 Gate·#hara 분석)까지
  const q = useApi<{ items: AuditEntry[] }>('audit', { query: { targetPrefix: target, limit: 100 } });
  return (
    <AsyncView state={asyncState(q, (q.data?.items.length ?? 0) === 0)} error={q.error}>
      <AuditLog rows={q.data?.items ?? []} />
    </AsyncView>
  );
}

function TransitionDrawer({ d, to, onClose, onWarnings }: { d: Detail; to: Lifecycle | null; onClose: () => void; onWarnings: (w: RefWarning[]) => void }) {
  const opt = d.transitions.find((t) => t.to === to);
  const allowed = to === 'APPROVED' ? (['FEATURE_APPROVER'] as const) : (['RELEASE_MANAGER', 'GATE_JUDGE'] as const);
  const perm = usePermission(allowed);
  const m = useApiMutation<{ warnings?: RefWarning[] }>('transition', INVALIDATE);
  const [reason, setReason] = useState('');
  // 검증 이슈로 되돌릴 때 이슈 항목(P10, FR-REG-002-013)
  const [issues, setIssues] = useState<IssueItem[]>([{ item: '', detail: '' }]);
  const rework = d.feature.lifecycle === 'VERIFIED' && to === 'DEVELOPING';
  const issueList = issues.filter((x) => x.item.trim().length >= 2).map((x) => ({ item: x.item.trim(), detail: x.detail.trim() }));
  // 역할·사유·이슈 항목은 이 화면에서 채우는 조건이므로 그 외의 막힌 사유만 미리 보여 준다
  const hard = (opt?.blockers ?? []).filter((b) => !['ROLE', 'REASON_REQUIRED', 'SEPARATION_OF_DUTY', 'ISSUE_REQUIRED'].includes(b.code));
  return (
    <Drawer open={!!to} title={to ? T.transition(to) : ''} onClose={onClose}>
      {opt && (
        <form
          style={{ display: 'grid', gap: 'var(--sp-3)' }}
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate({ params: { id: d.feature.featureId, ver: d.feature.version }, body: { to, reason, ...(rework ? { issues: issueList } : {}) } }, { onSuccess: (r) => (setReason(''), setIssues([{ item: '', detail: '' }]), r?.warnings?.length && onWarnings(r.warnings), onClose()) });
          }}
        >
          <p style={{ margin: 0 }}>
            <LifecycleBadge value={d.feature.lifecycle} /> → <LifecycleBadge value={opt.to} /> · {transitionCaption(opt)}
          </p>
          {hard.length > 0 && <div className="ds-error" role="alert"><div><strong>{ko.stepper.blocked}</strong><ul>{hard.map((blocker,i)=><li key={`${blocker.code}:${blocker.ref ?? i}`}><TransitionBlocker blocker={blocker}/></li>)}</ul></div></div>}
          {/* 정의 승인 전 구현 미입력 — 막지 않고 알린다(승인 뒤에는 새 Version으로만 넣는다) */}
          {opt.to === 'APPROVED' && <ImplMissingNotice f={d.feature} onEdit={onClose} />}
          {/* 기준 행 막힘(연결 없음·요청 중·폐기 행·ASIL 다시 확인)은 '기준 행' 탭에서 연결과 ASIL 사유를 고친다 */}
          {hard.some((b) => b.code === 'REFDB_LINK_BLOCKED') && (
            <Link to={`/features/${encodeURIComponent(d.feature.featureId)}/${encodeURIComponent(d.feature.version)}?tab=refs`} onClick={onClose} data-ui="toFeatureRefs">
              {featureRefsTab.toRefsTab}
            </Link>
          )}
          {/* Flag 코드 연결 출시 관문(20-97 §3.4) — 막힌 Flag는 어긋남 대사판에서 PR·재스캔·해제 요청으로 푼다 */}
          {hard.some((b) => b.code === 'FLAG_CODE_MISSING') && (
            <Link to="/flag-code/reconcile" onClick={onClose} data-ui="toFlagReconcile">
              {flagCodeCopy.transition.toReconcile}
            </Link>
          )}
          {opt.to === 'RELEASED' && (
            <GateRail statuses={Object.fromEntries(GATES.map((g) => [g, d.gates[g]?.status ?? null]))} />
          )}
          {rework && (
            <>
              <p className="ds-field__hint" style={{ margin: 0 }}>{lcGate.rework.hint}</p>
              <IssueInputs value={issues} onChange={setIssues} />
            </>
          )}
          <Field label={ko.page.reason}>
            <textarea className="ds-input" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
          </Field>
          <ErrorNote error={m.error} />
          <Button type="submit" variant="primary" disabled={!perm.ok || hard.length > 0 || m.isPending || (rework && !issueList.length)} title={perm.hint}>
            {ko.page.submit}
          </Button>
          {perm.hint && <span className="ds-field__hint">{perm.hint}</span>}
          <p className="ds-field__hint" style={{ margin: 0 }}>
            {opt.roles.map(roleCaptionFromSourceLabel).join(' · ')}
          </p>
        </form>
      )}
    </Drawer>
  );
}
