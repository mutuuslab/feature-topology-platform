// /verify/safety-case — Safety Case 근거 지도 (D06-07, ADS-UI08·BE14). 주장–논거–Evidence 트리, Evidence manifest(Drawer), 독립 검토 발견사항.
// 원본 Safety Case는 안전 조직 소유 — 이 화면은 주장 ↔ Evidence 연결만. Evidence 원장은 /verify/evidence(manifest가 그 참조로 연결).
// 형상 불일치·한계·미검토·가정값 시간 예산은 주장을 뒷받침한 것으로 세지 않는다. 열린 중대 발견이 있으면 핵심 메시지는 승격 불가.
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type AdsCaseEvidenceView, type AdsEvidenceManifest, type AdsReviewFinding, type AdsSafetyCaseView, type AdsSupport, type AdsConfigBinding, type Role } from '@ff/contracts';
import { ADS_REVIEWER_NOT_INDEPENDENT } from '../../../../contracts/src/rules/ads-evidence';
import { actorFor } from '../../api/actor';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { safetyCase as T } from '../../copy/ads-evidence';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, PageHeader, Panel, Segmented, Select, SummaryLine, Toolbar, type KeyMessageSpec } from '../../design';
import { BlockedAction, VerdictReason, type VerdictTone } from '../../design/ads';
import { useAppShell } from '../../store';
import { usePermission, when } from '../shared';
import './ads-evidence.css';

const REVIEWERS: Role[] = ['SAFETY_OFFICER'];
const INVALIDATE = ['adsSafetyCase', 'adsEvidenceManifest', 'audit'];
const DEFAULT_FEATURE = 'FEAT-00004';

type ManifestDetail = AdsEvidenceManifest & { target: AdsConfigBinding | null; linkedNodes: string[]; findings: AdsReviewFinding[] };

const SUPPORT_TONE: Record<AdsSupport, VerdictTone> = { SUPPORTS: 'ok', MISMATCH: 'danger', LIMIT: 'warn', UNREVIEWED: 'unknown', ASSUMED: 'warn', FAIL: 'danger' };

function supportReason(e: AdsCaseEvidenceView): string | undefined {
  const s = e.support;
  if (!s || s === 'SUPPORTS') return undefined;
  if (s === 'MISMATCH') return T.supportReason.MISMATCH(e.mismatch.map((k) => T.manifest.configField[k as keyof AdsConfigBinding] ?? k).join(' · '));
  return T.supportReason[s];
}

export function SupportBadge({ e }: { e: AdsCaseEvidenceView }) {
  if (!e.support) return <VerdictReason tone="neutral" label={T.noEvidence} />;
  return <VerdictReason tone={SUPPORT_TONE[e.support]} label={T.support[e.support]} reason={supportReason(e)} />;
}

export default function SafetyCaseScreen() {
  const [sp, setSp] = useSearchParams();
  const featureId = sp.get('feature') ?? DEFAULT_FEATURE;
  const q = useApi<AdsSafetyCaseView>('adsSafetyCase', { params: { featureId } });
  const [open, setOpen] = useState<string | null>(null);
  const d = q.data;
  const c = d?.counts;
  const message: KeyMessageSpec = !d
    ? { tone: 'neutral', text: T.title }
    : d.promotion.openMajor > 0
      ? { tone: 'danger', text: T.key.openMajor(d.promotion.openMajor) }
      : c!.unsupportedClaims > 0
        ? { tone: 'warn', text: T.key.unsupported(c!.unsupportedClaims) }
        : { tone: 'ok', text: T.key.allSupported };
  return (
    <div className="ds-screen">
      <PageHeader codes="D06-07 · ADS-UI08 · ADS-BE14" title={T.title} lead={T.lead} meta={T.owner} message={message} />
      <Toolbar label={T.pick}>
        <Select label={T.pick} value={featureId} onChange={(e) => setSp({ feature: e.target.value })}>
          {!(d?.features ?? []).some((f) => f.featureId === featureId) && <option value={featureId}>{featureId}</option>}
          {(d?.features ?? []).map((f) => (
            <option key={f.featureId} value={f.featureId}>{`${f.featureId} ${f.featureVersion} · ${f.name}`}</option>
          ))}
        </Select>
      </Toolbar>
      <AsyncView state={asyncState(q)} error={q.error ? (q.error.status === 404 ? T.empty : T.error) : null} onRetry={() => q.refetch()}>
        {d && c && (
          <>
            <SummaryLine
              items={[
                { k: T.summary.unsupported, v: `${c.unsupportedClaims}/${c.claims}` },
                { k: T.summary.unreviewed, v: c.unreviewed },
                { k: T.summary.limit, v: c.limit },
                { k: T.summary.mismatch, v: c.mismatch },
                { k: T.summary.assumed, v: c.assumed },
                { k: T.summary.supports, v: `${c.supports}/${c.evidence}` },
              ]}
            />
            <Panel title={T.tree} id="ads-safety-tree">
              <CaseTree view={d} onOpen={setOpen} />
            </Panel>
            <Panel title={T.findings.title} id="ads-safety-findings">
              <KeyValue rows={[{ k: T.gate.title, v: d.promotion.openMajor > 0 ? <VerdictReason tone="danger" label={T.gate.blocked(d.promotion.openMajor)} /> : <VerdictReason tone="ok" label={T.gate.ok} /> }]} />
              <FindingTable rows={d.findings} onOpen={setOpen} />
            </Panel>
          </>
        )}
      </AsyncView>
      <ManifestDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

interface Item {
  id: string;
  level: number;
  parent: string | null;
  expandable: boolean;
  manifestId: string | null;
}

/** 주장–논거–Evidence 트리 — role=tree, 화살표로 이동·펼치기, Enter·Space로 Evidence 열기 */
function CaseTree({ view, onOpen }: { view: AdsSafetyCaseView; onOpen: (manifestId: string) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string>(view.claims[0]?.claim.nodeId ?? '');
  const refs = useRef(new Map<string, HTMLLIElement>());
  const visible = useMemo(() => {
    const out: Item[] = [];
    for (const c of view.claims) {
      out.push({ id: c.claim.nodeId, level: 1, parent: null, expandable: c.arguments.length > 0, manifestId: null });
      if (collapsed.has(c.claim.nodeId)) continue;
      for (const a of c.arguments) {
        out.push({ id: a.node.nodeId, level: 2, parent: c.claim.nodeId, expandable: a.evidence.length > 0, manifestId: null });
        if (collapsed.has(a.node.nodeId)) continue;
        for (const e of a.evidence) out.push({ id: e.nodeId, level: 3, parent: a.node.nodeId, expandable: false, manifestId: e.manifestId });
      }
    }
    return out;
  }, [view, collapsed]);
  const move = (id: string) => {
    setFocus(id);
    refs.current.get(id)?.focus();
  };
  const toggle = (id: string, open?: boolean) =>
    setCollapsed((s) => {
      const n = new Set(s);
      const isOpen = !n.has(id);
      if (open === undefined ? isOpen : !open) n.add(id);
      else n.delete(id);
      return n;
    });
  const onKey = (e: KeyboardEvent, it: Item) => {
    // 안쪽 항목의 키가 바깥 treeitem으로 올라가 두 번 처리되지 않게
    if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(e.key)) e.stopPropagation();
    const i = visible.findIndex((x) => x.id === it.id);
    if (e.key === 'ArrowDown' && i < visible.length - 1) move(visible[i + 1].id);
    else if (e.key === 'ArrowUp' && i > 0) move(visible[i - 1].id);
    else if (e.key === 'ArrowRight' && it.expandable) collapsed.has(it.id) ? toggle(it.id, true) : visible[i + 1] && move(visible[i + 1].id);
    else if (e.key === 'ArrowLeft') it.expandable && !collapsed.has(it.id) ? toggle(it.id, false) : it.parent && move(it.parent);
    else if ((e.key === 'Enter' || e.key === ' ') && it.manifestId) onOpen(it.manifestId);
    else if ((e.key === 'Enter' || e.key === ' ') && it.expandable) toggle(it.id);
    else return;
    e.preventDefault();
  };
  const props = (it: Item) => ({
    role: 'treeitem' as const,
    'aria-level': it.level,
    'aria-expanded': it.expandable ? !collapsed.has(it.id) : undefined,
    tabIndex: focus === it.id ? 0 : -1,
    ref: (el: HTMLLIElement | null) => void (el ? refs.current.set(it.id, el) : refs.current.delete(it.id)),
    onKeyDown: (e: KeyboardEvent) => onKey(e, it),
    onFocus: (e: { target: EventTarget; currentTarget: EventTarget }) => e.target === e.currentTarget && setFocus(it.id),
    'data-node': it.id,
  });
  const caret = (id: string, expandable: boolean) => <span className="ads-ev-node__toggle" aria-hidden>{expandable ? (collapsed.has(id) ? '▸' : '▾') : '·'}</span>;
  return (
    <ul className="ads-ev-tree" role="tree" aria-label={T.tree}>
      {view.claims.map((c) => {
        const ci: Item = { id: c.claim.nodeId, level: 1, parent: null, expandable: c.arguments.length > 0, manifestId: null };
        return (
          <li key={ci.id} {...props(ci)}>
            <div className="ads-ev-node" onClick={() => (move(ci.id), ci.expandable && toggle(ci.id))}>
              {caret(ci.id, ci.expandable)}
              <IdChip id={ci.id} copy={false} />
              <b>{c.claim.text}</b>
              <span className="ads-ev-node__count">{c.linked ? T.nodeCount(c.supporting, c.linked) : T.noEvidence}</span>
              {c.supporting === 0 && <VerdictReason tone="warn" label={T.summary.unsupported} />}
            </div>
            {!collapsed.has(ci.id) && c.arguments.length > 0 && (
              <ul role="group">
                {c.arguments.map((a) => {
                  const ai: Item = { id: a.node.nodeId, level: 2, parent: ci.id, expandable: a.evidence.length > 0, manifestId: null };
                  const linked = a.evidence.filter((e) => e.manifest).length;
                  const sup = a.evidence.filter((e) => e.support === 'SUPPORTS').length;
                  return (
                    <li key={ai.id} {...props(ai)}>
                      <div className="ads-ev-node" onClick={() => (move(ai.id), ai.expandable && toggle(ai.id))}>
                        {caret(ai.id, ai.expandable)}
                        <IdChip id={ai.id} copy={false} />
                        <span>{a.node.text}</span>
                        <span className="ads-ev-node__count">{linked ? T.nodeCount(sup, linked) : T.noEvidence}</span>
                      </div>
                      {!collapsed.has(ai.id) && a.evidence.length > 0 && (
                        <ul role="group">
                          {a.evidence.map((e) => {
                            const ei: Item = { id: e.nodeId, level: 3, parent: ai.id, expandable: false, manifestId: e.manifestId };
                            return (
                              <li key={ei.id} {...props(ei)}>
                                <div className="ads-ev-node" onClick={() => (move(ei.id), e.manifestId && onOpen(e.manifestId))}>
                                  {caret(ei.id, false)}
                                  <IdChip id={ei.id} copy={false} />
                                  <span>{e.text}</span>
                                  {e.manifestId && <span className="ds-mono">{e.manifestId}</span>}
                                  <SupportBadge e={e} />
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FindingTable({ rows, onOpen }: { rows: AdsReviewFinding[]; onOpen: (manifestId: string) => void }) {
  const F = T.findings;
  return (
    <DataTable
      caption={F.caption}
      rows={rows}
      rowKey={(f) => f.findingId}
      onOpen={(f) => onOpen(f.manifestId)}
      pageSize={0}
      columns={[
        { key: 'id', header: F.id, cell: (f) => <span className="ds-mono">{f.findingId}</span> },
        { key: 'ev', header: F.evidence, cell: (f) => <span className="ds-mono">{f.manifestId}</span> },
        { key: 'sev', header: F.severity, cell: (f) => <VerdictReason tone={f.severity === 'MAJOR' ? 'danger' : 'neutral'} label={F.sev[f.severity]} /> },
        { key: 'st', header: F.status, cell: (f) => <VerdictReason tone={f.status === 'OPEN' ? (f.severity === 'MAJOR' ? 'danger' : 'warn') : 'ok'} label={F.st[f.status]} reason={f.closeReason ?? undefined} /> },
        { key: 'sum', header: F.summary, cell: (f) => f.summary },
        { key: 'rev', header: F.reviewer, cell: (f) => <span className="ds-mono">{f.reviewer}</span> },
        { key: 'ind', header: F.independence, cell: (f) => <VerdictReason tone={f.reviewerIndependent ? 'ok' : 'danger'} label={f.reviewerIndependent ? F.independent : F.notIndependent} /> },
        { key: 'at', header: F.opened, cell: (f) => <span className="ds-mono ds-nowrap">{when(f.openedAt)}</span>, minor: true },
      ]}
    />
  );
}

function ManifestDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useApi<ManifestDetail>('adsEvidenceManifest', { params: { id: id ?? '' } }, { enabled: !!id });
  const m = q.data && q.data.manifestId === id ? q.data : null;
  const M = T.manifest;
  return (
    <Drawer open={!!id} title={id ? `${M.title} · ${id}` : M.title} onClose={onClose}>
      <AsyncView state={asyncState(q)} error={q.error ? T.error : null} onRetry={() => q.refetch()}>
        {m && (
          <div className="ds-stack" style={{ gap: 'var(--sp-3)' }}>
            <KeyValue
              rows={[
                { k: M.req, v: <span className="ds-mono">{m.requirementIds.join(' · ')}</span>, note: `${M.hazard}: ${m.hazardIds.join(' · ')}` },
                {
                  k: M.config,
                  v: (
                    <span className="ds-stack">
                      {(Object.keys(M.configField) as (keyof AdsConfigBinding)[]).map((k) => (
                        <span key={k} className="ds-mono" data-config-diff={m.target && m.target[k] !== m.config[k] ? '' : undefined}>
                          {`${M.configField[k]} ${m.config[k]}${m.target && m.target[k] !== m.config[k] ? ` ≠ ${m.target[k]}` : ''}`}
                        </span>
                      ))}
                    </span>
                  ),
                  note: m.target ? `${M.target}: ${m.target.configSet} · ${m.target.sw}` : undefined,
                },
                { k: M.tool, v: `${m.tool.name} ${m.tool.version}`, note: `${m.tool.validRange}${m.toolValidity === 'OUT_OF_RANGE' ? ` — ${T.support.LIMIT}` : ''}` },
                { k: M.scenario, v: <span><span className="ds-mono">{m.scenario.id}</span> {m.scenario.title}</span> },
                { k: M.expected, v: m.expectedTransition },
                { k: M.actual, v: m.actualTransition },
                { k: M.timing, v: M.timingValue(m.timing.measuredMs, m.timing.budgetMs, m.timing.budgetStatus === 'ASSUMED') },
                { k: M.result, v: m.result, note: M.originV[m.origin] },
                { k: M.digest, v: <span className="ds-mono">{m.resultDigest.slice(0, 19)}</span> },
                { k: M.ledger, v: m.evidenceRef ? <Link className="ds-mono" to={`/verify/evidence?ref=${encodeURIComponent(m.evidenceRef)}`}>{m.evidenceRef}</Link> : '—', note: m.gateRecordId ?? undefined },
                { k: M.review, v: m.review.status === 'APPROVED' ? M.reviewed(m.review.by ?? '—', when(m.review.at)) : M.pending },
                { k: M.author, v: <span className="ds-mono">{m.author}</span>, note: when(m.authoredAt) },
                { k: M.linked, v: <span className="ds-mono">{m.linkedNodes.join(' · ')}</span> },
              ]}
            />
            {m.findings.length > 0 && <FindingTable rows={m.findings} onOpen={() => undefined} />}
            <RegisterFinding m={m} />
          </div>
        )}
      </AsyncView>
    </Drawer>
  );
}

/** 발견사항 등록 — Safety Manager 중 그 Evidence 작성자가 아닌 사람만. 작성자·권한 없음은 막힌 이유를 글자로 */
function RegisterFinding({ m }: { m: ManifestDetail }) {
  const perm = usePermission(REVIEWERS);
  const { role } = useAppShell();
  const me = actorFor(role, REVIEWERS).id;
  const create = useApiMutation<AdsReviewFinding>('adsReviewFindingCreate', INVALIDATE);
  const [severity, setSeverity] = useState<'MAJOR' | 'MINOR'>('MAJOR');
  const [summary, setSummary] = useState('');
  const R = T.register;
  if (!perm.ok) return <BlockedAction label={R.action} reason={T.noPermission} />;
  if (me === m.author) return <BlockedAction label={R.action} reason={ADS_REVIEWER_NOT_INDEPENDENT} />;
  return (
    <div className="ds-stack" style={{ gap: 'var(--sp-2)' }} data-testid="register-finding">
      <Segmented<'MAJOR' | 'MINOR'> label={R.severity} value={severity} onChange={setSeverity} options={[{ value: 'MAJOR', label: T.findings.sev.MAJOR }, { value: 'MINOR', label: T.findings.sev.MINOR }]} />
      <Field label={R.summary}>
        <textarea className="ds-input" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <ErrorNote error={create.error} />
      {create.isSuccess && (
        <p className="ds-ok" role="status">
          {R.done}
        </p>
      )}
      <Button variant="primary" disabled={summary.trim().length < 2 || create.isPending} onClick={() => create.mutate({ body: { manifestId: m.manifestId, severity, summary: summary.trim() } }, { onSuccess: () => setSummary('') })}>
        {R.submit}
      </Button>
    </div>
  );
}
