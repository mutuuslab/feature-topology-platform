// Feature 상세 '연계' 탭 — Epic 아래 이슈(80-50 §8): 기능 분해 Story, 현장 문제 Bug(운영 연결). 값은 /api/integrations/sync/features/:id/:ver 그대로.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { WORK_PRODUCT, type ExtLink, type RejudgeRow, type WpGateMode, type WpKindRow, type WpProblem, type WpResult } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { alm } from '../../copy/alm';
import { AsyncView, Button, DataTable, ErrorNote, ExtRefChip, Icon, Panel } from '../../design';
import { usePermission } from '../shared';

const A = alm.children;
const rowKey = (r: ExtLink) => `${r.system}:${r.key}`;
const byKeyNumber = (a: ExtLink, b: ExtLink) => Number(a.key.replace(/\D+/g, '')) - Number(b.key.replace(/\D+/g, '')) || a.key.localeCompare(b.key);
const clip = (text: string, ch = 48) => (
  <span className="ds-clip" title={text} style={{ maxWidth: `${ch}ch` }}>
    {text}
  </span>
);
const LIMIT = 10;

/** 기능 분해 — FF 기능(FUNC)마다 Epic 아래 Story */
export function StoriesPanel({ stories, functions }: { stories: ExtLink[]; functions: { functionId: string; label: string }[] }) {
  if (!stories.length) return null;
  const label = new Map(functions.map((f) => [f.functionId, f.label]));
  return (
    <Panel title={A.stories} id="ext-stories">
      <DataTable
        caption={A.stories}
        rows={[...stories].sort(byKeyNumber)}
        rowKey={rowKey}
        columns={[
          { key: 'k', header: A.col.key, cell: (r) => <ExtRefChip r={r} showStatus={false} /> },
          { key: 'f', header: A.col.function, cell: (r) => <span className="ds-mono ds-nowrap">{String(r.extra.functionId ?? '—')}</span> },
          { key: 't', header: A.col.title, cell: (r) => clip(label.get(String(r.extra.functionId)) ?? r.title) },
          { key: 's', header: A.col.status, cell: (r) => r.status },
        ]}
      />
    </Panel>
  );
}

/** 현장 문제 — Epic 아래 Bug. FF가 만든 것은 운영 인시던트·긴급 차단과 이어지고, JIRA에서 만든 것은 인시던트 후보 */
export function FieldIssuesPanel({ defects }: { defects: ExtLink[] }) {
  if (!defects.length) return null;
  const rows = [...defects].sort(byKeyNumber).reverse().slice(0, LIMIT);
  return (
    <Panel title={A.fieldIssues} id="ext-defects" eyebrow={defects.length > LIMIT ? A.latest(LIMIT, defects.length) : undefined}>
      <DataTable
        caption={A.fieldIssues}
        rows={rows}
        rowKey={rowKey}
        columns={[
          { key: 'k', header: A.col.key, cell: (r) => <ExtRefChip r={r} showStatus={false} /> },
          { key: 't', header: A.col.title, cell: (r) => clip(r.title) },
          { key: 's', header: A.col.status, cell: (r) => r.status },
          {
            key: 'o',
            header: A.col.ops,
            cell: (r) =>
              r.extra.killId ? (
                <Link to="/ops/kill">{A.kill(String(r.extra.killId))}</Link>
              ) : r.extra.incidentId ? (
                <Link to="/ops/incidents">{A.incident(String(r.extra.incidentId))}</Link>
              ) : r.extra.ref ? (
                <span className="ds-mono">{String(r.extra.ref)}</span>
              ) : (
                <Link to="/ops/incidents">{A.candidate}</Link>
              ),
          },
        ]}
      />
    </Panel>
  );
}

interface WpView {
  result: WpResult;
  cyberWhy: string;
  items: { key: string; kind: string; title: string; status: string; approved: boolean; url: string; suspect: boolean }[];
  hash: string;
  computedAt: string;
  gateMode?: WpGateMode;
  stages?: { judgeGate: string; to: string; blockers: WpProblem[] }[];
  changes?: { itemKey: string; title: string; fromVersion: number; toVersion: number; at: string; affected: string[] }[];
  rejudge?: RejudgeRow[];
}
const W = alm.wp;

/** 산출물 8종(80-50 §5.4) — 종류별 필요·승인·추적 완결·누락, 작성률. 누락은 규칙 문장으로 */
export function WorkProductsPanel({ id, ver }: { id: string; ver: string }) {
  const q = useApi<WpView>('almWorkProducts', { params: { id, ver } }, { staleTime: 15_000 });
  const refresh = useApiMutation<WpView>('refreshAlmWorkProducts', ['almWorkProducts', 'extFeatureTrace']);
  const perm = usePermission(['IMPLEMENTER', 'GATE_JUDGE', 'FEATURE_AUTHOR']);
  const v = q.data;
  const problemsOf = (k: string) => (v?.result?.problems ?? []).filter((p: WpProblem) => p.kind === k);
  return (
    <Panel
      title={W.title}
      id="ext-wp"
      actions={
        <Button disabled={!perm.ok || refresh.isPending} title={perm.hint} onClick={() => refresh.mutate({ params: { id, ver }, body: {} })}>
          {W.refresh}
        </Button>
      }
    >
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()} rows={4}>
        {v?.result && (
          <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <p>
              <strong>{W.rate(v.result.passedKinds, v.result.requiredKinds, v.result.rate)}</strong>
            </p>
            <p className="ds-field__hint">{W.cyber(v.cyberWhy)}</p>
            {v.result.suspects > 0 && <p style={{ color: 'var(--danger)' }}>{W.suspect(v.result.suspects)}</p>}
            {!!v.changes?.length && (
              <ul className="ds-check" aria-label={alm.changes.title}>
                {v.changes.map((c) => (
                  <li key={`${c.itemKey}:${c.toVersion}`} data-state="FAIL">
                    <Icon name="alert" size={16} />
                    <span>{alm.changes.line(c.itemKey, c.title, c.fromVersion, c.toVersion, c.affected.length)}</span>
                  </li>
                ))}
              </ul>
            )}
            <DataTable<WpKindRow>
              caption={W.title}
              rows={v.result.kinds}
              rowKey={(r) => r.kind}
              columns={[
                { key: 'k', header: W.col.kind, cell: (r) => <strong>{WORK_PRODUCT[r.kind].ko}</strong> },
                { key: 'p', header: W.col.process, cell: (r) => <span className="ds-nowrap">{WORK_PRODUCT[r.kind].process}</span> },
                { key: 'n', header: W.col.need, cell: (r) => (r.required ? W.need.yes : W.need.no) },
                { key: 'i', header: W.col.items, cell: (r) => r.items, align: 'right' },
                { key: 'a', header: W.col.approved, cell: (r) => r.approved, align: 'right' },
                { key: 's', header: W.col.state, cell: (r) => (!r.required && !r.items ? '—' : r.passed ? W.passed : <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{W.failed(r.problems)}</span>) },
                { key: 'x', header: W.col.problems, cell: (r) => { const ps = problemsOf(r.kind); return ps.length ? <span className="ds-clip" title={ps.map((p) => p.why).join('\n')} style={{ maxWidth: '44ch' }}>{ps[0].why}{ps.length > 1 ? ` · ${alm.reconcile.more(ps.length - 1)}` : ''}</span> : W.none; } },
              ]}
            />
          </div>
        )}
      </AsyncView>
      <ErrorNote error={refresh.error} />
    </Panel>
  );
}

const G = alm.gate;
/**
 * Gate 판정 화면의 산출물 확인(80-50 §5.5) — 정의 승인 G2·검증 G5·출시 G8은 그 단계의 필수 산출물이 완결돼야 PASS.
 * enforce면 PASS 버튼을 막고(서버도 같은 규칙), warn이면 알리기만. 열린 재판정 요청은 판정하거나 사유로 닫는다.
 */
export function useWpGateCheck(id: string, ver: string, gate: string, inputResult: string): { blocked: string | null; node: ReactNode } {
  const q = useApi<WpView>('almWorkProducts', { params: { id, ver } }, { staleTime: 15_000 });
  const close = useApiMutation('closeAlmRejudge', ['almWorkProducts', 'almRejudge', 'gates']);
  const perm = usePermission(['GATE_JUDGE', 'RELEASE_MANAGER', 'SAFETY_OFFICER']);
  const [reason, setReason] = useState('');
  const v = q.data;
  const stage = v?.stages?.find((s) => s.judgeGate === gate);
  const open = (v?.rejudge ?? []).filter((r) => r.gate === gate && r.status === 'OPEN');
  if (!v?.result || (!stage && !open.length)) return { blocked: null, node: null };
  const problems = stage?.blockers ?? [];
  const enforce = v.gateMode === 'enforce';
  const blocked = enforce && inputResult === 'PASS' && problems.length ? G.blocked : null;
  const node = (
    <section aria-label={G.title} data-testid="gate-wp">
      <span className="ds-eyebrow ds-eyebrow--ko">{G.title}</span>
      {stage && (
        <ul className="ds-check">
          {problems.length ? (
            problems.map((p) => (
              <li key={`${p.rule}:${p.item ?? p.kind}`} data-state={enforce ? 'FAIL' : 'INFO'}>
                <Icon name="alert" size={16} />
                <span>
                  {WORK_PRODUCT[p.kind].ko}: {p.why}
                </span>
              </li>
            ))
          ) : (
            <li data-state="PASS">
              <Icon name="check" size={16} />
              <span>{G.ok}</span>
            </li>
          )}
        </ul>
      )}
      {!!problems.length && !enforce && <p className="ds-field__hint">{G.warn}</p>}
      {!!open.length && (
        <div role="status">
          <p className="ds-field__hint" style={{ color: 'var(--danger)' }}>{G.rejudge(open.length)}</p>
          <ul className="ds-check">
            {open.map((r) => (
              <li key={r.rejudgeId} data-state="FAIL">
                <Icon name="alert" size={16} />
                <span>{alm.rejudge.detail(`${r.itemKey} ${r.itemTitle}`, r.fromVersion, r.toVersion, r.released)}</span>
                <Button disabled={!perm.ok || reason.trim().length < 2 || close.isPending} title={perm.hint} onClick={() => close.mutate({ params: { id: String(r.rejudgeId) }, body: { reason: reason.trim() } })}>
                  {G.close}
                </Button>
              </li>
            ))}
          </ul>
          <label className="ds-field ds-field--inline">
            <span className="ds-field__label">{G.reason}</span>
            <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!perm.ok} />
          </label>
          <ErrorNote error={close.error} />
        </div>
      )}
    </section>
  );
  return { blocked, node };
}
