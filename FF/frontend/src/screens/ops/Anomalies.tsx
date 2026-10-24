// /ops/anomalies — 이상 징후 대응 (D06-12, PoC ⑥ 이상 확인). 차량 고장 보고·서명 거부 회신·배포 회신 이상 → 이상 건 → 긴급 차단·조치·기각.
// /quality/feedback — 품질 피드백 (D04-06). 조치된 이상 건이 다음 Version에 남긴 요구(G5·G7 재판정, 가상검증 회귀) — 새 Version의 G5 PASS로 자동 해소.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, PageHeader, Segmented, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';

const A = ko.anomaly;
const FB = ko.feedback;
const OPS_ROLES = ['OPERATOR', 'SAFETY_OFFICER'] as const;
const SEVERITY_VERDICT: Record<string, string> = { CRITICAL: 'FAIL', WARNING: 'CONDITIONAL', INFO: '미판정' };

interface Anomaly {
  anomalyId: string;
  kind: keyof typeof A.kind;
  featureId: string;
  status: keyof typeof A.status;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  advice: keyof typeof A.advice;
  reasons: string[];
  vins: string[];
  signals: { vin: string | null; code: string; severity: string; at: string; ref: string | null }[];
  openedAt: string;
  updatedAt: string;
  acknowledgedBy: string | null;
  closedBy: string | null;
  closedAt: string | null;
  closeReason: string | null;
  killId: string | null;
}

function AnomalyDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useApi<Anomaly>('anomalyDetail', { params: { id: id ?? '' } }, { enabled: !!id });
  const perm = usePermission([...OPS_ROLES]);
  const inv = ['anomalies', 'anomalyDetail', 'qualityFeedback', 'audit'];
  const ack = useApiMutation('acknowledgeAnomaly', inv);
  const mitigate = useApiMutation('mitigateAnomaly', inv);
  const dismiss = useApiMutation('dismissAnomaly', inv);
  const [reason, setReason] = useState('');
  const a = q.data;
  const open = a && (a.status === 'OPEN' || a.status === 'ACKNOWLEDGED');
  const act = (m: typeof ack) => a && m.mutate({ params: { id: a.anomalyId }, body: { reason } }, { onSuccess: () => setReason('') });
  const busy = ack.isPending || mitigate.isPending || dismiss.isPending;
  const ok = perm.ok && reason.trim().length >= 2 && !busy;
  return (
    <Drawer open={!!id} title={id ?? ''} onClose={onClose}>
      {a && (
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <KeyValue
            rows={[
              { k: A.col.kind, v: <span className="ds-tag">{A.kind[a.kind]}</span> },
              { k: A.col.feature, v: <IdChip id={a.featureId} copy={false} /> },
              { k: A.col.severity, v: <VerdictBadge value={SEVERITY_VERDICT[a.severity]} />, note: a.severity },
              { k: A.col.advice, v: <strong>{A.advice[a.advice]}</strong> },
              { k: A.col.status, v: <span className="ds-mono">{A.status[a.status]}</span>, note: a.closedAt ? `${a.closedBy} · ${when(a.closedAt)} · ${a.closeReason}` : a.acknowledgedBy ? `${a.acknowledgedBy}` : undefined },
              { k: A.col.vehicles, v: <span className="ds-mono">{a.vins.join(', ') || '—'}</span> },
              ...(a.killId ? [{ k: A.killLinked, v: <Link to={`/ops/kill?id=${a.killId}`}>{a.killId}</Link> }] : []),
            ]}
          />
          <div>
            <h3 className="ds-eyebrow">{A.reasons}</h3>
            <ul className="ds-check">
              {a.reasons.map((r) => (
                <li key={r} data-state="INFO">
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
          <DataTable
            caption={A.signals}
            rows={[...a.signals].reverse()}
            rowKey={(s) => `${s.at}-${s.vin}-${s.code}-${s.ref}`}
            columns={[
              { key: 'at', header: A.col.updated, cell: (s) => <span className="ds-mono ds-nowrap">{when(s.at)}</span> },
              { key: 'v', header: A.col.vehicles, cell: (s) => <span className="ds-mono">{s.vin ?? '—'}</span> },
              { key: 'c', header: 'code', cell: (s) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{s.code}</span> },
              { key: 's', header: A.col.severity, cell: (s) => <VerdictBadge value={SEVERITY_VERDICT[s.severity] ?? '미판정'} /> },
            ]}
          />
          {open && (
            <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
              {a.kind === 'FEATURE_FAULT' && (
                <Link className="ds-btn ds-btn--danger" to={`/ops/kill?featureId=${a.featureId}&anomaly=${a.anomalyId}`}>
                  {A.toKill}
                </Link>
              )}
              <Field label={ko.page.reason}>
                <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
              </Field>
              <ErrorNote error={ack.error ?? mitigate.error ?? dismiss.error} />
              <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                {a.status === 'OPEN' && (
                  <Button disabled={!ok} title={perm.hint} onClick={() => act(ack)}>
                    {A.acknowledge}
                  </Button>
                )}
                <Button variant="primary" disabled={!ok} title={perm.hint} onClick={() => act(mitigate)}>
                  {A.mitigate}
                </Button>
                <Button disabled={!ok} title={perm.hint} onClick={() => act(dismiss)}>
                  {A.dismiss}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function AnomalyScreen() {
  const [status, setStatus] = useState<'OPEN' | 'ALL'>('OPEN');
  const q = useApi<{ items: Anomaly[] }>('anomalies');
  usePlatformEvents(['anomaly.', 'vehicle.fault', 'kill.'], ['anomalies', 'anomalyDetail']);
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(location.search).get('id'));
  const all = q.data?.items ?? [];
  const rows = status === 'ALL' ? all : all.filter((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED');
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D06-12 · ANOMALY RESPONSE"
        title={A.title}
        lead={A.lead}
        message={(() => {
          const n = all.filter((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED').length;
          return !q.data ? { tone: 'neutral', value: '—', text: A.key.open } : all.length === 0 ? { tone: 'neutral', value: 0, text: A.key.none } : n ? { tone: 'warn', value: n, text: A.key.open } : { tone: 'ok', text: A.key.clean };
        })()}
      />
      <Segmented
        label={A.col.status}
        options={[
          { value: 'OPEN', label: `${A.status.OPEN}·${A.status.ACKNOWLEDGED}` },
          { value: 'ALL', label: ko.page.all, count: all.length },
        ]}
        value={status}
        onChange={(v) => setStatus(v as typeof status)}
      />
      <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: A.empty }} error={q.error} onRetry={() => q.refetch()}>
        <DataTable
          caption={A.title}
          rows={rows}
          rowKey={(a) => a.anomalyId}
          onOpen={(a) => setOpen(a.anomalyId)}
          columns={[
            { key: 'id', header: A.col.id, cell: (a) => <span className="ds-mono">{a.anomalyId}</span>, sort: (a) => a.anomalyId },
            { key: 'k', header: A.col.kind, cell: (a) => <span className="ds-tag">{A.kind[a.kind]}</span> },
            { key: 'f', header: A.col.feature, cell: (a) => <span className="ds-mono">{a.featureId}</span> },
            { key: 's', header: A.col.severity, cell: (a) => <VerdictBadge value={SEVERITY_VERDICT[a.severity]} />, sort: (a) => ['INFO', 'WARNING', 'CRITICAL'].indexOf(a.severity) },
            { key: 'a', header: A.col.advice, cell: (a) => <span style={{ fontWeight: a.advice === 'KILL' ? 600 : 400 }}>{A.advice[a.advice]}</span> },
            { key: 'v', header: A.col.vehicles, cell: (a) => <span className="ds-mono">{a.vins.length}</span>, align: 'right' },
            { key: 'st', header: A.col.status, cell: (a) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{A.status[a.status]}</span> },
            { key: 'u', header: A.col.updated, cell: (a) => <span className="ds-mono ds-nowrap">{when(a.updatedAt)}</span>, sort: (a) => a.updatedAt },
          ]}
        />
      </AsyncView>
      <AnomalyDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

interface Feedback {
  feedbackId: string;
  featureId: string;
  featureVersion: string;
  anomalyId: string;
  kind: string;
  summary: string;
  actions: { kind: string; ref: string; label: string }[];
  status: keyof typeof FB.status;
  createdAt: string;
  acceptedBy: string | null;
  resolvedAt: string | null;
  note: string | null;
}

export function FeedbackScreen() {
  const q = useApi<{ items: Feedback[] }>('qualityFeedback');
  const perm = usePermission(['FEATURE_AUTHOR', 'GATE_JUDGE', 'SAFETY_OFFICER']);
  const accept = useApiMutation('acceptFeedback', ['qualityFeedback', 'audit']);
  usePlatformEvents(['quality.feedback', 'gate.judged'], ['qualityFeedback']);
  const [open, setOpen] = useState<Feedback | null>(null);
  const [reason, setReason] = useState('');
  const rows = q.data?.items ?? [];
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D04-06 · QUALITY FEEDBACK"
        title={FB.title}
        lead={FB.lead}
        message={(() => {
          // 표의 '검토 중'(ACCEPTED)도 아직 끝나지 않은 피드백이다 — 헤드라인이 초록인데 표에 검토 중 행이 보였다
          const open = rows.filter((r) => r.status === 'OPEN' || r.status === 'ACCEPTED').length;
          return !q.data ? { tone: 'neutral', value: '—', text: FB.key.open } : rows.length === 0 ? { tone: 'neutral', value: 0, text: FB.key.none } : open ? { tone: 'warn', value: open, text: FB.key.open } : { tone: 'ok', text: FB.key.clean };
        })()}
      />
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
        <DataTable
          caption={FB.title}
          rows={rows}
          rowKey={(f) => f.feedbackId}
          onOpen={(f) => setOpen(f)}
          columns={[
            { key: 'id', header: FB.col.id, cell: (f) => <span className="ds-mono">{f.feedbackId}</span>, sort: (f) => f.feedbackId },
            { key: 'f', header: FB.col.feature, cell: (f) => <IdChip id={f.featureId} version={f.featureVersion} to={`/features/${f.featureId}/${f.featureVersion}`} copy={false} /> },
            { key: 'a', header: FB.col.actions, cell: (f) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{f.actions.map((x) => x.ref).join(' · ')}</span> },
            { key: 'st', header: FB.col.status, cell: (f) => <VerdictBadge value={f.status === 'RESOLVED' ? 'PASS' : f.status === 'ACCEPTED' ? '검토 중' : 'CONDITIONAL'} /> },
            { key: 'an', header: FB.col.anomaly, cell: (f) => <Link className="ds-mono" to={`/ops/anomalies?id=${f.anomalyId}`}>{f.anomalyId}</Link> },
            { key: 'c', header: FB.col.created, cell: (f) => <span className="ds-mono ds-nowrap">{when(f.createdAt)}</span>, sort: (f) => f.createdAt },
          ]}
        />
      </AsyncView>
      <Drawer open={!!open} title={open?.feedbackId ?? ''} onClose={() => setOpen(null)}>
        {open && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <p>{open.summary}</p>
            <KeyValue
              rows={[
                { k: FB.col.status, v: <span className="ds-mono">{FB.status[open.status]}</span>, note: open.note ?? undefined },
                { k: FB.col.version, v: <span className="ds-mono">{`${open.featureId} ${open.featureVersion}`}</span> },
              ]}
            />
            <ul className="ds-check">
              {open.actions.map((x) => (
                <li key={x.ref} data-state={open.status === 'RESOLVED' ? 'PASS' : 'INFO'}>
                  <span>{x.label}</span>
                  {x.kind === 'VIRTUAL_REGRESSION' && <Link to="/validations/virtual">{ko.virtual.title} →</Link>}
                </li>
              ))}
            </ul>
            {open.status === 'OPEN' && (
              <>
                <Field label={ko.page.reason}>
                  <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
                </Field>
                <ErrorNote error={accept.error} />
                <Button variant="primary" disabled={!perm.ok || reason.trim().length < 2 || accept.isPending} title={perm.hint} onClick={() => accept.mutate({ params: { id: open.feedbackId }, body: { reason } }, { onSuccess: (f: any) => (setOpen(f), setReason('')) })}>
                  {FB.accept}
                </Button>
              </>
            )}
            <Link to={`/features/${open.featureId}/${open.featureVersion}`}>{FB.newVersion} →</Link>
          </div>
        )}
      </Drawer>
    </div>
  );
}
