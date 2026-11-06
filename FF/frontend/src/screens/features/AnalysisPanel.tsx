// Feature 상세 › 안전 분류 탭 › 분석 근거(D01-02, 담당자 웨이브 P3-1·P3-3) — HARA(Safety Manager)·TARA(CSM)·SOTIF(아키텍트)·형식승인 영향(법규 담당)을
// 담당 역할이 개인 서명으로 남기고, G7 Safety/Security 서명(SM·CSM 서로 다른 두 사람)을 받는다. 대표 ASIL 변경 사유도 여기서 보인다(G2 패널과 같은 블록).
import { useState } from 'react';
import { ANALYSIS_AUTHOR_ROLE, ANALYSIS_KINDS, CALS, HOMOLOGATION_DECISIONS, HOMOLOGATION_REGULATIONS, type AnalysisKind, type AnalysisRecord, type AnalysisView, type Role } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { analysis as A } from '../../copy/analysis';
import { ko } from '../../copy/ko';
import { DEMO_ACCOUNTS } from '../../data/demoAccounts';
import { AsyncView, Button, Drawer, ErrorNote, Field, Icon, KeyValue, Panel, Select, whyDisabled } from '../../design';
import { usePermission, when } from '../shared';

const INVALIDATE = ['analysisEvidence', 'gates', 'audit'];
const ROUTE: Record<AnalysisKind, string> = { HARA: 'recordHara', TARA: 'recordTara', SOTIF: 'recordSotif', HOMOLOGATION: 'recordHomologation' };
const ASILS = ['QM', 'A', 'B', 'C', 'D'] as const;

/** 조회 계약의 필수 구조가 없으면 근거가 준비된 것으로 취급하지 않는다. */
export function analysisViewOf(v: AnalysisView | undefined): AnalysisView | undefined {
  return v && v.current && !Array.isArray(v.current) && Array.isArray(v.g7) && v.security && typeof v.security.relevant === 'boolean' ? v : undefined;
}

/** 서명자 — 데모 계정은 이름·담당, 그 밖은 회사 계정 ID(내부 데모 ID는 보이지 않는다) */
export function personName(id: string): string {
  const a = DEMO_ACCOUNTS.find((x) => x.id === id);
  if (a) return `${a.name}(${a.label})`;
  return id.startsWith('usr-') ? A.someone : id;
}

/** 대표 ASIL 변경 블록 — 안전 분류 탭과 G2 판정 패널이 같이 쓴다(P3-1) */
export function AsilDeviationBlock({ v, children }: { v: AnalysisView; children?: React.ReactNode }) {
  const d = v.asilDeviation;
  const haraAsil = (v.current?.HARA?.content as { asil?: string } | undefined)?.asil;
  if (!d)
    return (
      <p className="ds-field__hint" data-testid="asil-deviation" style={{ margin: 0 }}>
        {A.deviation.none}
      </p>
    );
  return (
    <div className="ds-callout" data-tone="warn" data-testid="asil-deviation" role="note" style={{ display: 'grid', gap: 'var(--sp-1)' }}>
      <strong>
        {A.deviation.line(d.from, d.to)} · {d.reason}
      </strong>
      {d.refId && <span className="ds-field__hint ds-mono">{A.deviation.ref(d.refId)}</span>}
      {haraAsil && <span className="ds-field__hint">{A.deviation.hara(haraAsil, haraAsil === d.to)}</span>}
      {children}
    </div>
  );
}

function summary(r: AnalysisRecord): string {
  const c = r.content as Record<string, any>;
  if (r.kind === 'HARA') return `${A.asilEval} ${c.asil} · ${A.goals} ${(c.safetyGoals ?? []).map((g: any) => `${g.id}(${g.asil})`).join(', ')}`;
  if (r.kind === 'TARA') return `${A.threats} ${(c.threats ?? []).map((t: any) => `${t.id}(${t.cal})`).join(', ')}`;
  if (r.kind === 'SOTIF') return (c.triggeringConditions ?? []).join(' · ');
  return `${A.decisionLabel[c.decision] ?? c.decision}${c.regulations?.length ? ` · ${c.regulations.join(', ')}` : ''}${c.rxswin?.length ? ` · ${c.rxswin.join(', ')}` : ''}`;
}

type Row = { id: string; text: string; level: string };
const newRow = (level: string): Row => ({ id: '', text: '', level });

/** 분석 기록 서랍 — 종류마다 칸이 다르다. 사유와 함께 개인 서명 */
function RecordDrawer({ kind, id, ver, onClose }: { kind: AnalysisKind; id: string; ver: string; onClose: () => void }) {
  const save = useApiMutation<AnalysisRecord>(ROUTE[kind], INVALIDATE);
  const [docId, setDocId] = useState('');
  const [asil, setAsil] = useState('B');
  const [rows, setRows] = useState<Row[]>([newRow(kind === 'TARA' ? 'CAL2' : 'B')]);
  const [lines, setLines] = useState('');
  const [regs, setRegs] = useState<string[]>([]);
  const [decision, setDecision] = useState<string>('NO_IMPACT');
  const [rxswin, setRxswin] = useState('');
  const [reason, setReason] = useState('');
  const levels = kind === 'TARA' ? CALS : ASILS;
  const body = () => {
    const base = { reason: reason.trim() };
    if (kind === 'HARA') return { ...base, docId: docId.trim(), asil, safetyGoals: rows.map((r) => ({ id: r.id.trim(), text: r.text.trim(), asil: r.level })) };
    if (kind === 'TARA') return { ...base, docId: docId.trim(), threats: rows.map((r) => ({ id: r.id.trim(), text: r.text.trim(), cal: r.level })) };
    if (kind === 'SOTIF') return { ...base, docId: docId.trim(), triggeringConditions: lines.split('\n').map((x) => x.trim()).filter(Boolean) };
    return { ...base, regulations: regs, decision, rxswin: rxswin.split(',').map((x) => x.trim()).filter(Boolean) };
  };
  const missingRows = (kind === 'HARA' || kind === 'TARA') && rows.some((r) => r.id.trim().length < 2 || r.text.trim().length < 2);
  const missingDoc = kind !== 'HOMOLOGATION' && docId.trim().length < 2;
  const missingLines = kind === 'SOTIF' && !lines.trim();
  const missingRegs = kind === 'HOMOLOGATION' && decision !== 'NO_IMPACT' && regs.length === 0;
  const blocked = whyDisabled([missingDoc, A.docId], [missingRows, kind === 'HARA' ? A.goals : A.threats], [missingLines, A.triggers], [missingRegs, A.regulations], [reason.trim().length < 2, ko.why.reason]);
  const set = (i: number, k: keyof Row, val: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  return (
    <Drawer open title={`${A.kind[kind]} — ${A.sign}`} onClose={onClose} dirty={!!reason || !!docId}>
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }} data-testid={`analysis-form-${kind}`}>
        {kind !== 'HOMOLOGATION' && (
          <Field label={A.docId}>
            <input className="ds-input ds-input--mono" value={docId} onChange={(e) => setDocId(e.target.value)} />
          </Field>
        )}
        {kind === 'HARA' && (
          <Select label={A.asilEval} value={asil} onChange={(e) => setAsil(e.target.value)}>
            {ASILS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        )}
        {(kind === 'HARA' || kind === 'TARA') && (
          <fieldset className="ds-fieldset">
            <legend className="ds-eyebrow ds-eyebrow--ko">{kind === 'HARA' ? A.goals : A.threats}</legend>
            {rows.map((r, i) => (
              <div key={i} className="ds-form-grid">
                <Field label={kind === 'HARA' ? A.goalId : A.threatId}>
                  <input className="ds-input ds-input--mono" value={r.id} onChange={(e) => set(i, 'id', e.target.value)} />
                </Field>
                <Field label={kind === 'HARA' ? A.goalText : A.threatText}>
                  <input className="ds-input" value={r.text} onChange={(e) => set(i, 'text', e.target.value)} />
                </Field>
                <Select label={kind === 'HARA' ? A.goalAsil : A.cal} value={r.level} onChange={(e) => set(i, 'level', e.target.value)}>
                  {levels.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              </div>
            ))}
            <Button onClick={() => setRows((rs) => [...rs, newRow(kind === 'TARA' ? 'CAL2' : 'B')])}>
              {kind === 'HARA' ? A.goals : A.threats} +
            </Button>
          </fieldset>
        )}
        {kind === 'SOTIF' && (
          <Field label={A.triggers}>
            <textarea className="ds-input" value={lines} onChange={(e) => setLines(e.target.value)} />
          </Field>
        )}
        {kind === 'HOMOLOGATION' && (
          <>
            <Select label={A.decision} value={decision} onChange={(e) => setDecision(e.target.value)}>
              {HOMOLOGATION_DECISIONS.map((x) => (
                <option key={x} value={x}>
                  {A.decisionLabel[x]}
                </option>
              ))}
            </Select>
            <fieldset className="ds-fieldset">
              <legend className="ds-eyebrow ds-eyebrow--ko">{A.regulations}</legend>
              <div className="ds-cls-row">
                {HOMOLOGATION_REGULATIONS.map((x) => (
                  <label key={x} className="ds-field ds-field--inline">
                    <input type="checkbox" checked={regs.includes(x)} onChange={(e) => setRegs((rs) => (e.target.checked ? [...rs, x] : rs.filter((y) => y !== x)))} />
                    <span className="ds-field__label ds-mono">{x}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label={A.rxswin}>
              <input className="ds-input ds-input--mono" value={rxswin} onChange={(e) => setRxswin(e.target.value)} />
            </Field>
          </>
        )}
        <Field label={A.reason}>
          <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
        </Field>
        <ErrorNote error={save.error && { ...save.error, message: save.error.message, code: undefined }} />
        <Button variant="primary" icon="pen" disabled={!!blocked || save.isPending} reason={blocked} onClick={() => save.mutate({ params: { id, ver }, body: body() }, { onSuccess: onClose })}>
          {A.sign}
        </Button>
      </div>
    </Drawer>
  );
}

function KindRow({ kind, v, id, ver, readOnly, tour }: { kind: AnalysisKind; v: AnalysisView; id: string; ver: string; readOnly: boolean; tour?: string }) {
  const perm = usePermission([ANALYSIS_AUTHOR_ROLE[kind] as Role]);
  const [open, setOpen] = useState(false);
  const r = v.current[kind];
  const older = (v.history ?? []).filter((h) => h.kind === kind).length - (r ? 1 : 0);
  return (
    <li data-kind={kind} data-state={!r ? 'INFO' : r.valid ? 'PASS' : 'FAIL'} data-tour={tour} style={{ gridTemplateColumns: readOnly ? '22px 1fr' : '22px 1fr auto', alignItems: 'start' }}>
      <Icon name={r?.valid ? 'check' : 'alert'} size={16} />
      <span style={{ display: 'grid', gap: 'var(--sp-1)', flex: 1 }}>
        <strong>{A.kind[kind]}</strong>
        {r ? (
          <>
            <span>
              {r.docId && <span className="ds-mono">{r.docId} · </span>}
              {summary(r)}
            </span>
            <span className="ds-check__detail">
              <span className="ds-mono">{r.recordId}</span> · {r.provenance === 'IMPORT' ? A.imported : A.signedBy(personName(r.signedBy), when(r.signedAt))}
              {!r.valid && ` — ${A.invalid}`}
              {older > 0 && ` · ${A.history(older)}`}
            </span>
          </>
        ) : (
          <span className="ds-check__detail">{A.pending(A.author[kind])}</span>
        )}
      </span>
      {!readOnly && (
        <Button icon="pen" disabled={!perm.ok} reason={perm.hint} onClick={() => setOpen(true)} data-ui={ROUTE[kind]}>
          {r ? A.rewrite : A.sign}
        </Button>
      )}
      {open && <RecordDrawer kind={kind} id={id} ver={ver} onClose={() => setOpen(false)} />}
    </li>
  );
}

function G7Signoffs({ v, id, ver, readOnly }: { v: AnalysisView; id: string; ver: string; readOnly: boolean }) {
  const smPerm = usePermission(['SAFETY_OFFICER']);
  const csmPerm = usePermission(['SECURITY_OFFICER']);
  const sm = useApiMutation('signG7Safety', INVALIDATE);
  const csm = useApiMutation('signG7Security', INVALIDATE);
  const [reason, setReason] = useState('');
  const row = (role: 'SAFETY_OFFICER' | 'SECURITY_OFFICER') => v.g7.find((s) => s.role === role);
  const line = (role: 'SAFETY_OFFICER' | 'SECURITY_OFFICER', label: string) => {
    const s = row(role);
    return { k: label, v: s ? (s.valid ? A.signedBy(personName(s.signedBy), when(s.signedAt)) : s.stale ? A.g7.stale : A.invalid) : A.g7.waiting };
  };
  const err = sm.error ?? csm.error;
  const short = reason.trim().length < 2;
  return (
    <section aria-label={A.g7.title} data-testid="g7-signoffs" style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <h3 className="ds-eyebrow ds-eyebrow--ko" style={{ margin: 0 }}>
        {A.g7.title}
      </h3>
      <p className="ds-field__hint" style={{ margin: 0 }}>
        {A.g7.lead}
      </p>
      <KeyValue rows={[line('SAFETY_OFFICER', A.g7.safety), line('SECURITY_OFFICER', A.g7.security)]} />
      {!readOnly && (smPerm.ok || csmPerm.ok) && (
        <>
          <Field label={A.reason}>
            <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={err && { ...err, message: err.message, code: undefined }} />
          <div className="ds-cls-row">
            {smPerm.ok && (
              <Button icon="pen" disabled={short || !!row('SAFETY_OFFICER')?.valid || sm.isPending} reason={whyDisabled([short, ko.why.reason])} onClick={() => sm.mutate({ params: { id, ver }, body: { reason }, actorRole: 'SAFETY_OFFICER' }, { onSuccess: () => setReason('') })}>
                {A.g7.signSafety}
              </Button>
            )}
            {csmPerm.ok && (
              <Button icon="pen" disabled={short || !!row('SECURITY_OFFICER')?.valid || csm.isPending} reason={whyDisabled([short, ko.why.reason])} onClick={() => csm.mutate({ params: { id, ver }, body: { reason }, actorRole: 'SECURITY_OFFICER' }, { onSuccess: () => setReason('') })}>
                {A.g7.signSecurity}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** 분석 근거 패널 — 안전 분류 탭 */
export function AnalysisPanel({ id, ver }: { id: string; ver: string }) {
  const q = useApi<AnalysisView>('analysisEvidence', { params: { id, ver } });
  const v = analysisViewOf(q.data);
  const invalid = !q.isPending && !q.isError && !v;
  const readOnly = !!v && ['RELEASED', 'DEPRECATED', 'RETIRED'].includes(v.lifecycle);
  return (
    <Panel title={A.title} id="safety-analysis">
      <AsyncView state={invalid ? 'error' : asyncState(q)} error={invalid ? { message: A.gate.unavailableAnalysis } : q.error} onRetry={() => q.refetch()}>
        {v && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }} data-testid="analysis-panel">
            <p className="ds-field__hint" style={{ margin: 0 }}>
              {A.lead}
            </p>
            <AsilDeviationBlock v={v} />
            <p className="ds-field__hint" data-testid="security-relevance" style={{ margin: 0 }}>
              {v.security?.relevant ? A.security.relevant(v.security.why) : A.security.notRelevant(v.security?.why ?? '—')}
            </p>
            <ul className="ds-check">
              {ANALYSIS_KINDS.map((k) => (
                <KindRow key={k} kind={k} v={v} id={id} ver={ver} readOnly={readOnly} tour={k === 'HOMOLOGATION' ? 'analysis-homologation' : k === 'SOTIF' ? 'analysis-sotif' : undefined} />
              ))}
            </ul>
            <G7Signoffs v={v} id={id} ver={ver} readOnly={readOnly} />
          </div>
        )}
      </AsyncView>
    </Panel>
  );
}
