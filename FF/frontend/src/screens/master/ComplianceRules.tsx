// 컴플라이언스 룰 레지스트리 (D03-01, 기능명세서 FR-CRC-001·002) — /verify/compliance?tab=registry.
// 룰 목록·필터, 상세(버전·변경 이력·승인 요청·적용 대상 Feature 후보)와 승인 요청·승인/반려, 등록·수정 폼(계약 스키마로 먼저 검사),
// 배포 검증 결과(정책 검증·배포 시점 재판정의 미충족 룰·항목)와 정책에 지금 적용할 룰. 판정은 서버(계약 rules/compliance-rule)가 한다.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  COMPLIANCE_CHECK_LABEL,
  COMPLIANCE_CHECKS,
  COMPLIANCE_ROLLOUT_MODES,
  COMPLIANCE_RULE_ROLES,
  COMPLIANCE_RULE_STATUS_LABEL,
  COMPLIANCE_RULE_TYPE_LABEL,
  COMPLIANCE_RULE_TYPES,
  CALS,
  complianceCandidateQuery,
  CreateComplianceRuleBody,
  criterionLabel,
  GATES,
  MARKETS,
  UpdateComplianceRuleBody,
  type ApplicableRule,
  type ComplianceCriterion,
  type ComplianceRule,
  type ComplianceRuleDetail,
  type ComplianceRuleStatus,
  type Role,
} from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { actorFor, PLATFORM_ROLES } from '../../api/actor';
import { complianceRules as C } from '../../copy/compliance-rules';
import { DEMO_ACCOUNTS } from '../../data/demoAccounts';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, Panel, Segmented, Select, SummaryLine, Toolbar, VerdictBadge } from '../../design';
import { usePermission } from '../shared';
import { personLabel } from '../ops/shared';

const ROLES = COMPLIANCE_RULE_ROLES as readonly Role[];
const INVALIDATE = ['complianceRules', 'complianceRule', 'complianceValidations', 'complianceRulesApplicable'];
const ASILS = ['QM', 'A', 'B', 'C', 'D'] as const;
const STATUS_VERDICT: Record<ComplianceRuleStatus, string> = { APPROVED: 'PASS', PROPOSED: 'CONDITIONAL', REJECTED: 'FAIL', RETIRED: 'UNJUDGED' };
const t16 = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');

const StatusBadge = ({ s }: { s: ComplianceRuleStatus }) => <VerdictBadge value={STATUS_VERDICT[s]} label={COMPLIANCE_RULE_STATUS_LABEL[s]} />;
const people = (ids: string[]) => ids.map(personLabel).join(', ') || '—';
const show = (v: unknown) => (v == null || (Array.isArray(v) && !v.length) ? '—' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));
/** 변경 이력 값 — 상태·검증 기준·승인 대상자·배포 유형은 화면 이름으로 */
const changeValue = (field: string, v: unknown): string => {
  if (v == null) return '—';
  if (field === 'status' && typeof v === 'string') return COMPLIANCE_RULE_STATUS_LABEL[v as ComplianceRuleStatus] ?? v;
  if (field === 'type' && typeof v === 'string') return COMPLIANCE_RULE_TYPE_LABEL[v as keyof typeof COMPLIANCE_RULE_TYPE_LABEL] ?? v;
  if (field === 'criteria' && Array.isArray(v)) return v.map((x) => itemLabel(String(x))).join(', ');
  if (field === 'approverIds' && Array.isArray(v)) return people(v.map(String));
  if (field === 'scope.rolloutModes' && Array.isArray(v)) return v.map((x) => C.form.rollouts[String(x)] ?? String(x)).join(', ') || '—';
  if (field === 'approvalRequest' && typeof v === 'object') return people(((v as { approverIds?: string[] }).approverIds ?? []).map(String));
  return show(v);
};
const itemLabel = (item: string | null) => {
  if (!item) return '';
  const [check, gate] = item.split(':');
  return (COMPLIANCE_CHECKS as readonly string[]).includes(check) ? criterionLabel({ check: check as ComplianceCriterion['check'], gate: gate as ComplianceCriterion['gate'] }) : item;
};

export function ComplianceRegistryTab() {
  const q = useApi<{ items: ComplianceRule[] }>('complianceRules');
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState<'all' | ComplianceRuleStatus>('all');
  const [type, setType] = useState('');
  const [market, setMarket] = useState('');
  const [form, setForm] = useState<{ rule: ComplianceRule | null } | null>(null);
  const perm = usePermission(ROLES);
  const all = q.data?.items ?? [];
  const rows = all.filter((r) => (status === 'all' || r.status === status) && (!type || r.type === type) && (!market || (r.scope.markets as string[]).includes(market)));
  const count = (s: ComplianceRuleStatus) => all.filter((r) => r.status === s).length;
  const selected = sp.get('rule');
  const open = (id: string | null) =>
    setSp(
      (p) => {
        const n = new URLSearchParams(p);
        if (id) n.set('rule', id);
        else n.delete('rule');
        return n;
      },
      { replace: true },
    );
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <SummaryLine
        items={[
          { k: C.kpi.total, v: all.length },
          { k: C.kpi.approved, v: count('APPROVED') },
          { k: C.kpi.waiting, v: count('PROPOSED') },
          { k: C.kpi.rejected, v: count('REJECTED') },
          { k: C.kpi.retired, v: count('RETIRED') },
        ]}
      />
      <Toolbar label={C.filter}>
        <Segmented
          label={C.filter}
          options={[{ value: 'all' as const, label: C.all }, ...(['APPROVED', 'PROPOSED', 'REJECTED', 'RETIRED'] as const).map((s) => ({ value: s, label: COMPLIANCE_RULE_STATUS_LABEL[s], count: count(s) }))]}
          value={status}
          onChange={(v) => setStatus(v as typeof status)}
        />
        <Select label={C.typeFilter} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{C.all}</option>
          {COMPLIANCE_RULE_TYPES.map((t) => (
            <option key={t} value={t}>
              {COMPLIANCE_RULE_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <Select label={C.marketFilter} value={market} onChange={(e) => setMarket(e.target.value)}>
          <option value="">{C.all}</option>
          {MARKETS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Button variant="primary" disabled={!perm.ok} reason={perm.hint} onClick={() => setForm({ rule: null })}>
          {C.create}
        </Button>
      </Toolbar>
      <AsyncView state={asyncState(q)} onRetry={() => q.refetch()}>
        <DataTable
          caption={C.table}
          rows={rows}
          rowKey={(r) => r.ruleId}
          onOpen={(r) => open(r.ruleId)}
          maxHeight="52vh"
          columns={[
            {
              key: 'r',
              header: C.col.rule,
              cell: (r) => (
                <>
                  <span className="ds-mono ds-nowrap">{r.ruleId}</span> {r.name}
                </>
              ),
              sort: (r) => r.ruleId,
            },
            { key: 't', header: C.col.type, cell: (r) => COMPLIANCE_RULE_TYPE_LABEL[r.type], sort: (r) => r.type },
            { key: 'm', header: C.col.markets, cell: (r) => <span className="ds-mono">{r.scope.markets.join(', ')}</span> },
            { key: 'c', header: C.col.criteria, cell: (r) => r.criteria.map(criterionLabel).join(' · ') },
            { key: 's', header: C.col.status, cell: (r) => <StatusBadge s={r.status} />, sort: (r) => r.status },
            { key: 'v', header: C.col.version, cell: (r) => <span className="ds-mono">{r.version}</span> },
            { key: 'd', header: C.col.valid, cell: (r) => <span className="ds-mono ds-nowrap">{C.validRange(r.validFrom, r.validTo)}</span>, sort: (r) => r.validTo ?? '9999' },
            { key: 'a', header: C.col.approvers, cell: (r) => people(r.approverIds) },
          ]}
        />
      </AsyncView>
      <ComplianceChecksPanel />
      {selected && <RuleDrawer ruleId={selected} onClose={() => open(null)} onEdit={(r) => setForm({ rule: r })} />}
      {form && <RuleForm rule={form.rule} onClose={() => setForm(null)} onSaved={(id) => (setForm(null), open(id))} />}
    </div>
  );
}

function RuleDrawer({ ruleId, onClose, onEdit }: { ruleId: string; onClose: () => void; onEdit: (r: ComplianceRule) => void }) {
  const D = C.detail;
  const q = useApi<ComplianceRuleDetail>('complianceRule', { params: { id: ruleId } });
  const r = q.data?.rule;
  const cand = useApi<{ items: { featureId: string; version: string; name: string; country: string; asil: string; ownerId: string }[]; total: number }>('complianceRuleCandidates', { query: r ? complianceCandidateQuery(r.scope) : {} }, { enabled: !!r });
  const perm = usePermission(ROLES);
  const me = actorFor(perm.role, ROLES).id;
  const request = useApiMutation('requestComplianceApproval', INVALIDATE);
  const decide = useApiMutation('decideComplianceRule', INVALIDATE);
  const [reason, setReason] = useState('');
  const openReq = q.data?.requests.find((x) => x.status === 'OPEN');
  const editWhy = !r ? null : r.status === 'RETIRED' ? C.act.retired : r.ownerId !== me ? C.act.onlyOwner : null;
  const requestWhy = !r ? null : r.status !== 'PROPOSED' ? C.act.notProposed : openReq ? C.act.openRequest : null;
  const decideWhy = !r || !openReq ? null : [r.ownerId, r.updatedBy, openReq.requestedBy].includes(me) ? C.act.selfApproval : !openReq.approverIds.includes(me) ? C.act.notApprover : null;
  const s = r?.scope;
  return (
    <Drawer open title={D.title(ruleId)} onClose={onClose}>
      <AsyncView state={asyncState(q)} onRetry={() => q.refetch()}>
        {r && s && (
          <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            <KeyValue
              rows={[
                { k: C.form.name, v: r.name },
                { k: C.col.type, v: COMPLIANCE_RULE_TYPE_LABEL[r.type] },
                { k: C.col.status, v: <StatusBadge s={r.status} /> },
                { k: C.col.version, v: <span className="ds-mono">{r.version}</span> },
                { k: C.col.markets, v: <span className="ds-mono">{s.markets.join(', ')}</span> },
                {
                  k: D.scope,
                  v: [
                    `${D.features} ${s.featureIds.join(', ') || D.scopeAll}`,
                    `${D.rollout} ${s.rolloutModes.map((m) => C.form.rollouts[m]).join(', ') || D.scopeAll}`,
                    `${D.asil} ${s.asil.join(', ') || D.scopeAll}`,
                    `${D.cal} ${s.cal.join(', ') || D.scopeAll}`,
                  ].join(' · '),
                },
                { k: C.col.criteria, v: r.criteria.map(criterionLabel).join(' · ') },
                { k: C.col.approvers, v: people(r.approverIds) },
                {
                  k: D.evidence,
                  v: (
                    <>
                      {r.evidence.docName && <span>{r.evidence.docName}</span>} {r.evidence.clause && <span className="ds-mono">{r.evidence.clause}</span>}
                      {r.evidence.url && (
                        <>
                          {' '}
                          <a href={r.evidence.url} target="_blank" rel="noreferrer noopener">
                            {D.evidenceLink}
                          </a>
                        </>
                      )}
                    </>
                  ),
                  note: r.evidence.memo ?? undefined,
                },
                { k: C.col.valid, v: <span className="ds-mono">{C.validRange(r.validFrom, r.validTo)}</span> },
                { k: D.owner, v: personLabel(r.ownerId) },
                { k: D.decided, v: r.decidedBy ? `${personLabel(r.decidedBy)} · ${t16(r.decidedAt)}` : '—' },
              ]}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
              <Button disabled={!perm.ok || !!editWhy} reason={perm.hint ?? editWhy ?? undefined} onClick={() => onEdit(r)}>
                {C.act.edit}
              </Button>
              <Button disabled={!perm.ok || !!requestWhy || request.isPending} reason={perm.hint ?? requestWhy ?? undefined} onClick={() => request.mutate({ params: { id: r.ruleId }, body: {} })}>
                {C.act.request}
              </Button>
            </div>
            <ErrorNote error={request.error} />
            {openReq && (
              <Panel title={C.act.approve}>
                <Field label={C.act.reason}>
                  <textarea className="ds-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                {(decideWhy || perm.hint) && <p className="ds-field__hint">{perm.hint ?? decideWhy}</p>}
                <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
                  {(['APPROVE', 'REJECT'] as const).map((d) => (
                    <Button
                      key={d}
                      variant={d === 'APPROVE' ? 'primary' : 'danger'}
                      disabled={!perm.ok || !!decideWhy || reason.trim().length < 2 || decide.isPending}
                      onClick={() => decide.mutate({ params: { id: r.ruleId }, body: { decision: d, reason: reason.trim() } }, { onSuccess: () => setReason('') })}
                    >
                      {d === 'APPROVE' ? C.act.approve : C.act.reject}
                    </Button>
                  ))}
                </div>
                <ErrorNote error={decide.error} />
              </Panel>
            )}
            <DataTable
              caption={D.versions}
              rows={q.data!.versions}
              rowKey={(v) => v.version}
              pageSize={0}
              columns={[
                { key: 'v', header: D.versionCol.version, cell: (v) => <span className="ds-mono">{v.version}</span> },
                { key: 's', header: D.versionCol.status, cell: (v) => <StatusBadge s={v.status} /> },
                { key: 'b', header: D.versionCol.by, cell: (v) => `${personLabel(v.createdBy)} · ${t16(v.createdAt)}` },
                { key: 'd', header: D.versionCol.decided, cell: (v) => (v.decidedBy ? `${personLabel(v.decidedBy)} · ${t16(v.decidedAt)}` : '—') },
              ]}
            />
            <DataTable
              caption={D.requests}
              rows={q.data!.requests}
              rowKey={(x) => x.requestId}
              pageSize={0}
              columns={[
                { key: 'id', header: D.requests, cell: (x) => <span className="ds-mono">{x.requestId}</span> },
                { key: 'at', header: D.requestCol.at, cell: (x) => t16(x.requestedAt) },
                { key: 'by', header: D.requestCol.by, cell: (x) => personLabel(x.requestedBy) },
                { key: 'v', header: D.requestCol.version, cell: (x) => <span className="ds-mono">{x.version}</span> },
                { key: 'a', header: D.requestCol.approvers, cell: (x) => people(x.approverIds) },
                { key: 's', header: D.requestCol.status, cell: (x) => `${D.requestStatus[x.status]}${x.reason ? ` — ${x.reason}` : ''}` },
              ]}
            />
            <DataTable
              caption={D.changes}
              rows={q.data!.changes}
              rowKey={(c) => String(c.id)}
              pageSize={0}
              columns={[
                { key: 'at', header: D.changeCol.at, cell: (c) => <span className="ds-nowrap">{t16(c.at)}</span> },
                { key: 'by', header: D.changeCol.by, cell: (c) => personLabel(c.by) },
                { key: 'a', header: D.changeCol.action, cell: (c) => `${D.actions[c.action] ?? c.action} · ${c.version}` },
                { key: 'f', header: D.changeCol.field, cell: (c) => D.fields[c.field] ?? c.field },
                { key: 'b', header: D.changeCol.before, cell: (c) => changeValue(c.field, c.before) },
                { key: 'af', header: D.changeCol.after, cell: (c) => changeValue(c.field, c.after) },
              ]}
            />
            <Panel title={D.candidates}>
              <AsyncView state={asyncState(cand)} onRetry={() => cand.refetch()}>
                <p className="ds-field__hint">{D.candidateCount(cand.data?.total ?? 0)}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                  {(cand.data?.items ?? []).slice(0, 30).map((f) => (
                    <IdChip key={`${f.featureId}@${f.version}`} id={f.featureId} version={f.version} to={`/features/${f.featureId}/${f.version}`} copy={false} />
                  ))}
                </div>
              </AsyncView>
            </Panel>
          </div>
        )}
      </AsyncView>
    </Drawer>
  );
}

type Draft = {
  ruleId: string;
  name: string;
  type: string;
  markets: string[];
  featureIds: string;
  rolloutModes: string[];
  asil: string[];
  cal: string[];
  criteria: ComplianceCriterion[];
  approverIds: string[];
  url: string;
  docName: string;
  clause: string;
  memo: string;
  validFrom: string;
  validTo: string;
  reason: string;
};

const draftOf = (r: ComplianceRule | null): Draft => ({
  ruleId: r?.ruleId ?? '',
  name: r?.name ?? '',
  type: r?.type ?? 'LEGAL',
  markets: [...(r?.scope.markets ?? [])],
  featureIds: (r?.scope.featureIds ?? []).join(', '),
  rolloutModes: [...(r?.scope.rolloutModes ?? [])],
  asil: [...(r?.scope.asil ?? [])],
  cal: [...(r?.scope.cal ?? [])],
  criteria: [...(r?.criteria ?? [])],
  approverIds: [...(r?.approverIds ?? [])],
  url: r?.evidence.url ?? '',
  docName: r?.evidence.docName ?? '',
  clause: r?.evidence.clause ?? '',
  memo: r?.evidence.memo ?? '',
  validFrom: r?.validFrom ?? '',
  validTo: r?.validTo ?? '',
  reason: '',
});

const bodyOf = (d: Draft) => {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  return {
    name: d.name.trim(),
    type: d.type,
    scope: {
      markets: d.markets,
      featureIds: d.featureIds
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      rolloutModes: d.rolloutModes,
      asil: d.asil,
      cal: d.cal,
    },
    criteria: d.criteria,
    approverIds: d.approverIds,
    evidence: { url: opt(d.url), docName: opt(d.docName), clause: opt(d.clause), memo: opt(d.memo) },
    validFrom: d.validFrom,
    validTo: opt(d.validTo),
  };
};

/** 칸 오류 위치 — 계약 스키마 오류 경로 → 화면 칸 */
const FIELD_OF: Record<string, keyof Draft> = { ruleId: 'ruleId', name: 'name', type: 'type', 'scope.markets': 'markets', 'scope.featureIds': 'featureIds', criteria: 'criteria', approverIds: 'approverIds', 'evidence.url': 'url', 'evidence.docName': 'docName', validFrom: 'validFrom', validTo: 'validTo', reason: 'reason' };

function Checks<T extends string>({ legend, options, value, onChange, label = (x) => x, error }: { legend: string; options: readonly T[]; value: string[]; onChange: (v: T[]) => void; label?: (x: T) => string; error?: string }) {
  return (
    <fieldset className="ds-fieldset" aria-invalid={error ? true : undefined}>
      <legend className="ds-eyebrow ds-eyebrow--ko">{legend}</legend>
      <div className="ds-cls-row">
        {options.map((x) => (
          <label key={x} className="ds-field ds-field--inline">
            <input type="checkbox" checked={value.includes(x)} onChange={(e) => onChange((e.target.checked ? [...value, x] : value.filter((y) => y !== x)) as T[])} />
            <span className="ds-field__label">{label(x)}</span>
          </label>
        ))}
      </div>
      {error && <span className="ds-field__error">{error}</span>}
    </fieldset>
  );
}

function RuleForm({ rule, onClose, onSaved }: { rule: ComplianceRule | null; onClose: () => void; onSaved: (id: string) => void }) {
  const F = C.form;
  const perm = usePermission(ROLES);
  const me = actorFor(perm.role, ROLES).id;
  const [d, setD] = useState<Draft>(() => draftOf(rule));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft | 'other', string>>>({});
  const create = useApiMutation<ComplianceRule>('createComplianceRule', INVALIDATE);
  const update = useApiMutation<ComplianceRule>('updateComplianceRule', INVALIDATE);
  const m = rule ? update : create;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  // 승인 대상자 후보 — 룰 역할을 맡은 데모 계정(본인 제외, 작성자≠승인자)
  const approvers = useMemo(() => DEMO_ACCOUNTS.filter((a) => a.id !== me && (PLATFORM_ROLES[a.key] ?? []).some((r) => ROLES.includes(r))), [me]);
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(rule));
  const save = () => {
    const full = bodyOf(d);
    const parsed = rule ? UpdateComplianceRuleBody.safeParse({ ...full, reason: d.reason.trim() }) : CreateComplianceRuleBody.safeParse({ ruleId: d.ruleId.trim(), ...full, ...(d.reason.trim() ? { reason: d.reason.trim() } : {}) });
    if (!parsed.success) {
      const out: typeof errors = {};
      for (const i of parsed.error.issues) {
        const path = i.path.join('.');
        const key = FIELD_OF[path] ?? FIELD_OF[String(i.path[0])] ?? (path.startsWith('evidence') ? 'docName' : path.startsWith('criteria') ? 'criteria' : 'other');
        out[key] ??= i.message;
      }
      setErrors(out);
      return;
    }
    setErrors({});
    const done = (r: ComplianceRule) => onSaved(r.ruleId);
    if (rule) update.mutate({ params: { id: rule.ruleId }, body: parsed.data }, { onSuccess: done });
    else create.mutate({ body: parsed.data }, { onSuccess: done });
  };
  const gateOf = d.criteria.find((c) => c.check === 'GATE_PASS')?.gate ?? 'G7';
  return (
    <Drawer open title={rule ? F.editTitle(rule.ruleId) : F.createTitle} onClose={onClose} dirty={dirty}>
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        {rule && <p className="ds-field__hint">{F.versionHint}</p>}
        <div className="ds-form-grid">
          {!rule && (
            <Field label={F.ruleId} hint={F.ruleIdHint} error={errors.ruleId}>
              <input className="ds-input ds-input--mono" value={d.ruleId} onChange={(e) => set('ruleId', e.target.value.toUpperCase())} />
            </Field>
          )}
          <Field label={F.name} error={errors.name}>
            <input className="ds-input" value={d.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Select label={F.type} value={d.type} onChange={(e) => set('type', e.target.value)}>
            {COMPLIANCE_RULE_TYPES.map((t) => (
              <option key={t} value={t}>
                {COMPLIANCE_RULE_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
        <Checks legend={F.markets} options={MARKETS} value={d.markets} onChange={(v) => set('markets', v)} error={errors.markets} />
        <Field label={F.featureIds} error={errors.featureIds}>
          <input className="ds-input ds-input--mono" value={d.featureIds} onChange={(e) => set('featureIds', e.target.value)} />
        </Field>
        <Checks legend={F.rollout} options={COMPLIANCE_ROLLOUT_MODES} value={d.rolloutModes} onChange={(v) => set('rolloutModes', v)} label={(x) => F.rollouts[x]} />
        <Checks legend={F.asil} options={ASILS} value={d.asil} onChange={(v) => set('asil', v)} />
        <Checks legend={F.cal} options={CALS} value={d.cal} onChange={(v) => set('cal', v)} />
        <Checks
          legend={F.criteria}
          options={COMPLIANCE_CHECKS}
          value={d.criteria.map((c) => c.check)}
          label={(x) => COMPLIANCE_CHECK_LABEL[x]}
          error={errors.criteria}
          onChange={(v) => set('criteria', v.map((check) => (check === 'GATE_PASS' ? { check, gate: gateOf } : { check })))}
        />
        {d.criteria.some((c) => c.check === 'GATE_PASS') && (
          <Select label={F.gate} value={gateOf} onChange={(e) => set('criteria', d.criteria.map((c) => (c.check === 'GATE_PASS' ? { ...c, gate: e.target.value as ComplianceCriterion['gate'] } : c)))}>
            {GATES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        )}
        <Checks legend={F.approvers} options={approvers.map((a) => a.id)} value={d.approverIds} onChange={(v) => set('approverIds', v)} label={personLabel} error={errors.approverIds} />
        <div className="ds-form-grid">
          <Field label={F.url} error={errors.url}>
            <input className="ds-input ds-input--mono" value={d.url} onChange={(e) => set('url', e.target.value)} />
          </Field>
          <Field label={F.docName} error={errors.docName}>
            <input className="ds-input" value={d.docName} onChange={(e) => set('docName', e.target.value)} />
          </Field>
          <Field label={F.clause}>
            <input className="ds-input ds-input--mono" value={d.clause} onChange={(e) => set('clause', e.target.value)} />
          </Field>
          <Field label={F.validFrom} error={errors.validFrom}>
            <input className="ds-input ds-input--mono" type="date" value={d.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
          </Field>
          <Field label={F.validTo} error={errors.validTo}>
            <input className="ds-input ds-input--mono" type="date" value={d.validTo} onChange={(e) => set('validTo', e.target.value)} />
          </Field>
        </div>
        <Field label={F.memo}>
          <textarea className="ds-input" rows={2} value={d.memo} onChange={(e) => set('memo', e.target.value)} />
        </Field>
        <Field label={F.reason} error={errors.reason}>
          <input className="ds-input" value={d.reason} onChange={(e) => set('reason', e.target.value)} />
        </Field>
        {errors.other && <p className="ds-field__error">{errors.other}</p>}
        <ErrorNote error={m.error} />
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <Button variant="primary" disabled={!perm.ok || m.isPending} reason={perm.hint} onClick={save}>
            {F.save}
          </Button>
          <Button onClick={onClose}>{F.cancel}</Button>
        </div>
      </div>
    </Drawer>
  );
}

interface CheckRow {
  stage: 'VALIDATE' | 'DEPLOY';
  checkId: string;
  policyId: string;
  featureId: string;
  featureVersion: string;
  market: string;
  at: string;
  result: string;
  decision: string;
  unmet: { ruleId: string | null; item: string | null; message: string }[];
}

/** 배포 검증 결과(FR-CRC-002-004·007·008) — 정책 검증·배포 시점 재판정, 고른 정책에 지금 적용할 룰(FR-CRC-002-001~003) */
function ComplianceChecksPanel() {
  const K = C.checks;
  const q = useApi<{ items: CheckRow[] }>('complianceValidations');
  const [feature, setFeature] = useState('');
  const [market, setMarket] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const items = q.data?.items ?? [];
  const rows = items.filter((x) => (!feature || x.featureId === feature) && (!market || x.market === market));
  const policyId = pick ?? rows[0]?.policyId ?? null;
  const app = useApi<{ policyId: string; market: string; rolloutMode: string; asil: string; cal: string | null; rules: ApplicableRule[] }>('complianceRulesApplicable', { query: { policyId: policyId ?? '' } }, { enabled: !!policyId });
  const features = [...new Set(items.map((x) => x.featureId))].sort();
  const markets = [...new Set(items.map((x) => x.market))].sort();
  return (
    <Panel title={K.title} eyebrow={K.lead}>
      <Toolbar label={K.title}>
        <Select label={K.featureFilter} value={feature} onChange={(e) => setFeature(e.target.value)}>
          <option value="">{C.all}</option>
          {features.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
        <Select label={C.marketFilter} value={market} onChange={(e) => setMarket(e.target.value)}>
          <option value="">{C.all}</option>
          {markets.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Toolbar>
      <AsyncView state={asyncState(q)} onRetry={() => q.refetch()}>
        <DataTable
          caption={K.title}
          rows={rows}
          rowKey={(x) => `${x.stage}-${x.checkId}`}
          onOpen={(x) => setPick(x.policyId)}
          maxHeight="40vh"
          columns={[
            { key: 'at', header: K.col.at, cell: (x) => <span className="ds-nowrap">{t16(x.at)}</span>, sort: (x) => x.at },
            { key: 's', header: K.col.stage, cell: (x) => K.stage[x.stage] },
            { key: 'p', header: K.col.policy, cell: (x) => <span className="ds-mono">{x.policyId}</span> },
            { key: 'f', header: K.col.feature, cell: (x) => <IdChip id={x.featureId} version={x.featureVersion} to={`/features/${x.featureId}/${x.featureVersion}`} copy={false} /> },
            { key: 'm', header: K.col.market, cell: (x) => <span className="ds-mono">{x.market}</span> },
            { key: 'r', header: K.col.result, cell: (x) => <VerdictBadge value={x.result} label={x.stage === 'VALIDATE' ? `${x.result} · ${x.decision}` : x.decision} /> },
            {
              key: 'u',
              header: K.col.unmet,
              cell: (x) =>
                x.unmet.length ? (
                  <ul className="ds-linklist">
                    {x.unmet.map((u, i) => (
                      <li key={i} title={u.message}>
                        {u.ruleId && <span className="ds-mono">{u.ruleId}</span>} {itemLabel(u.item)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  K.none
                ),
            },
          ]}
        />
      </AsyncView>
      {policyId && (
        <AsyncView state={asyncState(app)} onRetry={() => app.refetch()}>
          {app.data && (
            <div style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
              <p className="ds-field__hint">{K.context(app.data.market, C.form.rollouts[app.data.rolloutMode] ?? app.data.rolloutMode, app.data.asil, app.data.cal)}</p>
              <DataTable
                caption={K.applicable(app.data.policyId)}
                rows={app.data.rules}
                rowKey={(x) => x.ruleId}
                pageSize={0}
                columns={[
                  {
                    key: 'r',
                    header: K.applicableCol.rule,
                    cell: (x) => (
                      <>
                        <span className="ds-mono">{x.ruleId}</span> {x.name} <span className="ds-mono">v{x.version}</span>
                      </>
                    ),
                  },
                  { key: 's', header: K.applicableCol.status, cell: (x) => <StatusBadge s={x.status} /> },
                  { key: 'a', header: K.applicableCol.applied, cell: (x) => (x.applied ? K.applied : K.notApplied) },
                  { key: 'w', header: K.applicableCol.reason, cell: (x) => x.reason },
                ]}
              />
            </div>
          )}
        </AsyncView>
      )}
    </Panel>
  );
}
