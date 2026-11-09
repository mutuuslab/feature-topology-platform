// /procurement/sw-cost/:estId — 산정 과제 상세(20-94 §9): 설정 · 기능 목록 · 산정 결과 · 검토 · 이력 5탭.
// 핵심 메시지 = 총개발비(산정 역할, 과제 통화) 또는 총 공수(그 밖의 역할). 전이(승인 요청·승인·반려·개정)는 사유를 받는다.
// 작성자는 자기 과제를 승인·반려할 수 없다(SOD-16) — 서버가 막고, 화면은 이유를 미리 보인다.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { COST_TRANSITIONS, type CostProjectStatus } from '@ff/contracts';
import { actorFor } from '../../api/actor';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { COST_STATUS_LABEL, COST_STATUS_TONE, costDetail as T, costHistory as H,costReference as R } from '../../copy/cost';
import { CostReferenceEvidence } from './CostReferenceEvidence';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, IdChip, PageHeader, Panel, Tabs, whyDisabled } from '../../design';
import { useAppShell } from '../../store';
import { usePermission, when } from '../shared';
import { BackLink, COST_MONEY, downloadCostExport, mm, moneyKey, type CostDetailResponse } from './common';
import { CostLinesTab } from './CostLinesTab';
import { CostResultTab } from './CostResultTab';
import { CostReviewTab } from './CostReviewTab';
import { CostSettingsTab } from './CostSettingsTab';
import {CostPurchasingTab} from './CostPurchasingTab';
import {costPurchasing as P} from '../../copy/cost-purchasing';
import './cost-detail.css';

type Action = (typeof COST_TRANSITIONS)[number]['action'];

export function CostDetailScreen() {
  const { estId = '' } = useParams();
  const q = useApi<CostDetailResponse>('costProject', { params: { estId } });
  const d = q.data;
  const p = d?.project;
  const total = d?.result?.totals;
  const full = d?.view === 'FULL';
  const key = full && total?.totalCost != null ? moneyKey(total.totalCost, p?.currency, d?.fx) : null;
  const message = !d
    ? { tone: 'neutral' as const, text: T.back }
    : !d.result
      ? { tone: 'warn' as const, text: T.keyError, status: { label: COST_STATUS_LABEL[p!.status], tone: COST_STATUS_TONE[p!.status] } }
      : key
        ? { tone: 'neutral' as const, value: key.value, text: T.keyFull.replace('백만원', key.unit), status: { label: COST_STATUS_LABEL[p!.status], tone: COST_STATUS_TONE[p!.status] } }
        : { tone: 'neutral' as const, value: mm(total?.totalMm), text: T.keyMm, status: { label: COST_STATUS_LABEL[p!.status], tone: COST_STATUS_TONE[p!.status] } };
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D07-01 · SW COST"
        title={p?.name ?? estId}
        meta={<IdChip id={estId} />}
        lead={p?.target || undefined}
        message={message}
        actions={
          <div className="cost-detail-actions">
            <BackLink to="/procurement/sw-cost">{T.back}</BackLink>
            {d && <ExportButton estId={estId} />}
            {d && <TransitionButtons d={d} />}
          </div>
        }
      />
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {d && p && (
          <>
            {!full && <p className="ds-field__hint">{T.mmOnly}</p>}
            {p.status === 'APPROVED' && <p className="ds-field__hint">{T.approvedNote}</p>}
            <Tabs
              tabs={[
                { key: 'settings', label: T.tabs.settings },
                { key: 'lines', label: T.tabs.lines, count: d.lines.length },
                { key: 'result', label: T.tabs.result },
                { key: 'review', label: T.tabs.review, count: d.checks.open || undefined },
                { key: 'purchasing', label: P.title },
                { key: 'history', label: T.tabs.history, count: d.approvals.length || undefined },
              ]}
            >
              {(tab) =>
                tab === 'settings' ? (
                  <CostSettingsTab d={d} />
                ) : tab === 'lines' ? (
                  <CostLinesTab d={d} />
                ) : tab === 'result' ? (
                  <CostResultTab d={d} />
                ) : tab === 'purchasing' ? (
                  <CostPurchasingTab d={d} />
                ) : tab === 'review' ? (
                  <CostReviewTab d={d} />
                ) : (
                  <History d={d} />
                )
              }
            </Tabs>
          </>
        )}
      </AsyncView>
    </div>
  );
}

function ExportButton({ estId }: { estId: string }) {
  const perm = usePermission(COST_MONEY);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <Button
        disabled={!perm.ok || busy}
        reason={whyDisabled([!perm.ok, perm.hint])}
        onClick={() => {
          setBusy(true);
          setError(null);
          downloadCostExport(perm.role, estId)
            .then(setWarnings)
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        {T.export}
      </Button>
      {warnings.length > 0 && <span className="ds-field__hint" title={warnings.join('\n')}>{T.exportWarn(warnings.length)}</span>}
      <ErrorNote error={error as never} />
    </>
  );
}

function TransitionButtons({ d }: { d: CostDetailResponse }) {
  const { role } = useAppShell();
  const [action, setAction] = useState<Action | null>(null);
  const status = d.project.status as CostProjectStatus;
  const available = COST_TRANSITIONS.filter((t) => t.from === status);
  return (
    <>
      {available.map((t) => (
        <TransitionButton key={t.action} t={t} d={d} role={role} onOpen={() => setAction(t.action)} />
      ))}
      {action && <TransitionDrawer d={d} action={action} onClose={() => setAction(null)} />}
    </>
  );
}

function TransitionButton({ t, d, role, onOpen }: { t: (typeof COST_TRANSITIONS)[number]; d: CostDetailResponse; role: string; onOpen: () => void }) {
  const perm = usePermission(t.roles);
  const self = (t.action === 'APPROVE' || t.action === 'REJECT') && actorFor(role, t.roles).id === d.project.createdBy;
  const why = whyDisabled([!perm.ok, perm.hint], [self, T.transition.sod]);
  return (
    <Button variant={t.action === 'APPROVE' || t.action === 'SUBMIT' ? 'primary' : 'default'} disabled={!!why} reason={why} onClick={onOpen}>
      {T.transition[t.action]}
    </Button>
  );
}

function TransitionDrawer({ d, action, onClose }: { d: CostDetailResponse; action: Action; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const m = useApiMutation('costTransition', ['costProject', 'costProjects']);
  const why = whyDisabled([reason.trim().length < 2, T.transition.reasonHint]);
  return (
    <Drawer open title={`${T.transition[action]} · ${d.project.estId}`} onClose={onClose} dirty={!!reason}>
      <form
        className="ds-stack"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate({ params: { estId: d.project.estId }, body: { action, reason: reason.trim() } }, { onSuccess: onClose });
        }}
      >
        <Field label={T.transition.reason} hint={T.transition.reasonHint}>
          <textarea className="ds-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <ErrorNote error={m.error} />
        <Button type="submit" variant="primary" disabled={!!why || m.isPending} reason={why}>
          {T.transition.confirm}
        </Button>
      </form>
    </Drawer>
  );
}

function History({ d }: { d: CostDetailResponse }) {
  const rows = d.approvals;
  const [source,setSource]=useState<{lineNo:number;revision:number;refId?:string}|null>(null);
  return (
    <div className="ds-stack">
      <Panel title={H.approvals}>
        {rows.length ? (
          <DataTable
            rows={rows}
            rowKey={(r) => String(r.rev)}
            caption={H.approvals}
            columns={[
              { key: 'rev', header: H.cols.rev, cell: (r) => r.rev, align: 'right' },
              { key: 'by', header: H.cols.by, cell: (r) => r.approvedBy },
              { key: 'at', header: H.cols.at, cell: (r) => when(r.approvedAt) },
              { key: 'reason', header: H.cols.reason, cell: (r) => r.reason },
              { key: 'basis', header: H.cols.basis, cell: (r) => r.basisVersion, minor: true },
              { key: 'sha', header: H.cols.sha, cell: (r) => <span className="ds-mono">{r.resultSha256.slice(0, 12)}</span>, minor: true },
              {key:'sources',header:R.source,cell:r=>r.sources?.map(s=><Button key={s.lineNo} onClick={()=>setSource(s)}>{s.refId ?? `#${s.lineNo}`} · {R.revision} {s.revision}</Button>) ?? '—'},
            ]}
          />
        ) : (
          <p className="ds-field__hint">{H.none}</p>
        )}
      </Panel>
      {source && <CostReferenceEvidence d={d} editable={false} line={{lineNo:source.lineNo,refId:source.refId ?? `#${source.lineNo}`,sourceRevision:source.revision}} onClose={()=>setSource(null)}/>}
      <Panel title={H.lastReason}>
        <p>{d.project.lastReason ?? '—'}</p>
        <p className="ds-field__hint">{`${H.created} ${d.project.createdBy} · ${when(d.project.createdAt)}`}</p>
        <Link to="/audit">{H.audit}</Link>
      </Panel>
    </div>
  );
}
