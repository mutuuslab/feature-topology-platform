// 구현 연결(담당자 웨이브 P2-2/P3-8) — 기능 → SW·Version → 제어기 P/N을 SW·Artifact 기준정보에서 고른다(자유 입력 아님).
// 정의 승인 뒤에는 Version을 고칠 수 없으므로, 승인 서랍은 구현 미입력을 미리 알리고(막지는 않는다 — 검증 완료 규칙이 요구한다),
// 이미 승인된 Version이 비어 있으면 '새 Version 만들기' 길을 보인다.
import { Link, useNavigate } from 'react-router-dom';
import { INPUT_LABEL, missingImplInputs, type FeatureVersionRow } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { planning as W } from '../../copy/planning';
import { AsyncView, Button, Field, Icon } from '../../design';
import { usePermission } from '../shared';

export interface ImplRow {
  functionId?: string;
  label: string;
  /** `${swId}@${version}` — 기준정보 한 행 */
  sw: string;
  ecuPno: string;
}

export interface ImplSource {
  functions?: { functionId: string; label: string }[];
  swIds?: string[];
  swVersions?: string[];
  ecuPnos?: string[];
}

export interface SwOption {
  swId: string;
  version: string;
  name: string;
  ecuPno: string;
  lifecycle?: string;
}

/** Feature 행 → 편집 행(같은 순번끼리 짝) */
export function implRowsOf(f: ImplSource): ImplRow[] {
  const n = Math.max(f.functions?.length ?? 0, f.swIds?.length ?? 0);
  return Array.from({ length: n }, (_, i) => ({
    functionId: f.functions?.[i]?.functionId,
    label: f.functions?.[i]?.label ?? '',
    sw: f.swIds?.[i] ? `${f.swIds[i]}@${f.swVersions?.[i] ?? ''}` : '',
    ecuPno: f.ecuPnos?.[i] ?? '',
  }));
}

/** 편집 행 → 요청 본문 — 새 기능은 이름만(서버가 FUNC 번호를 매긴다) */
export function implBody(rows: ImplRow[]) {
  return {
    functions: rows.map((r) => (r.functionId ? { functionId: r.functionId, label: r.label.trim() } : { label: r.label.trim() })),
    swIds: rows.map((r) => r.sw.split('@')[0]),
    swVersions: rows.map((r) => r.sw.split('@')[1] ?? ''),
    ecuPnos: rows.map((r) => r.ecuPno),
  };
}

export const implComplete = (rows: ImplRow[]) => rows.every((r) => r.label.trim() && r.sw && r.ecuPno);

/** 비어 있는 구현 칸의 화면 이름 — "기능(Function) · SW ID …" */
export const missingImplText = (f: ImplSource) =>
  missingImplInputs({ functions: f.functions ?? [], swIds: f.swIds ?? [], swVersions: f.swVersions ?? [], ecuPnos: f.ecuPnos ?? [] } as Pick<FeatureVersionRow, 'functions' | 'swIds' | 'swVersions' | 'ecuPnos'>)
    .map((k) => INPUT_LABEL[k] ?? String(k))
    .join(' · ');

/** 구현 행 편집기 — SW·Version은 기준정보 목록에서만 고른다 */
export function ImplLinksEditor({ rows, onChange }: { rows: ImplRow[]; onChange: (rows: ImplRow[]) => void }) {
  const q = useApi<{ items: SwOption[] }>('masterSw', { query: {} });
  const options = (q.data?.items ?? []).filter((s) => s.lifecycle !== 'RETIRED');
  const set = (i: number, patch: Partial<ImplRow>) => onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="ds-stack" data-testid="impl-links" style={{ border: 0, padding: 0, margin: 0, gap: 'var(--sp-2)' }}>
      <legend className="ds-field__label">{W.impl.title}</legend>
      <p className="ds-field__hint" style={{ margin: 0 }}>
        {W.impl.lead} <Link to="/master/artifacts">{W.impl.toMaster}</Link>
      </p>
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        <>
          {rows.length === 0 && <p className="ds-field__hint" style={{ margin: 0 }}>{W.impl.none}</p>}
          {rows.map((r, i) => {
            // 기준정보에 없는 옛 짝(시드)은 선택지에 그대로 보여 지우지 않게 한다
            const known = options.some((s) => `${s.swId}@${s.version}` === r.sw);
            return (
              <div key={i} className="ds-split" data-impl-row={i} style={{ alignItems: 'end' }}>
                <Field label={W.impl.fn}>
                  <input className="ds-input" name={`impl-fn-${i}`} value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
                </Field>
                <Field label={W.impl.sw} hint={r.ecuPno ? `${W.impl.ecu} ${r.ecuPno}` : undefined}>
                  <select
                    className="ds-select"
                    name={`impl-sw-${i}`}
                    value={r.sw}
                    onChange={(e) => {
                      const s = options.find((x) => `${x.swId}@${x.version}` === e.target.value);
                      set(i, { sw: e.target.value, ecuPno: s?.ecuPno ?? '' });
                    }}
                  >
                    <option value="">{W.impl.pick}</option>
                    {!known && r.sw && <option value={r.sw}>{`${r.sw.replace('@', ' ')} (제어기 ${r.ecuPno || '—'})`}</option>}
                    {options.map((s) => (
                      <option key={`${s.swId}@${s.version}@${s.ecuPno}`} value={`${s.swId}@${s.version}`}>
                        {W.impl.option(s.swId, s.version, s.name, s.ecuPno)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button variant="ghost" icon="close" aria-label={W.impl.remove(i + 1)} onClick={() => onChange(rows.filter((_, n) => n !== i))} />
              </div>
            );
          })}
        </>
      </AsyncView>
      <div>
        <Button onClick={() => onChange([...rows, { label: '', sw: '', ecuPno: '' }])}>
          {W.impl.add}
        </Button>
      </div>
    </fieldset>
  );
}

/** 정의 승인 서랍 — 구현 미입력 경고(막지 않는다). 작성자·SW 통합 담당에게는 초안으로 가는 길 */
export function ImplMissingNotice({ f, onEdit }: { f: ImplSource; onEdit?: () => void }) {
  // 초안을 고칠 수 있는 사람(작성자·SW 통합 담당 등)에게만 초안으로 가는 길 — 승인자는 요청한다
  const editor = usePermission(['FEATURE_AUTHOR', 'SAFETY_OFFICER', 'VARIANT_OWNER', 'IMPLEMENTER']);
  const missing = missingImplText(f);
  if (!missing) return null;
  return (
    <section className="ds-callout" data-tone="warn" role="status" data-testid="impl-missing" aria-labelledby="impl-missing-h">
      <p className="ds-callout__title" id="impl-missing-h">
        <Icon name="alert" size={16} /> {W.approval.implMissingTitle}
      </p>
      <p style={{ margin: 0 }}>{W.approval.implMissing(missing)}</p>
      <p className="ds-field__hint" style={{ margin: 0 }}>{W.approval.implMissingNext}</p>
      {editor.ok && (
        <Link to={{ search: '?edit=impl' }} onClick={onEdit} data-ui="toImplDraft">
          {W.approval.toDraft}
        </Link>
      )}
    </section>
  );
}

/** 승인된 뒤 구현이 비어 검증 완료로 못 가는 Version — 새 Version으로 가는 길 */
export function ImplDeadEnd({ f, lifecycle, latest }: { f: ImplSource; lifecycle: string; latest: boolean }) {
  const nav = useNavigate();
  const author = usePermission(['FEATURE_AUTHOR']);
  const missing = missingImplText(f);
  if (!missing || !['APPROVED', 'DEVELOPING'].includes(lifecycle)) return null;
  const why = !latest ? W.deadEnd.notLatest : author.ok ? undefined : W.deadEnd.ctaWhy;
  return (
    <section className="ds-callout" data-tone="warn" data-testid="impl-dead-end" aria-labelledby="impl-dead-end-h">
      <p className="ds-callout__title" id="impl-dead-end-h">{W.deadEnd.title}</p>
      <p style={{ margin: 0 }}>{W.deadEnd.body(missing)}</p>
      <div>
        <Button variant="primary" disabled={!!why} reason={why} onClick={() => nav({ search: '?edit=version' })}>
          {W.deadEnd.cta}
        </Button>
      </div>
    </section>
  );
}

/** 등록 직후 — 다음 할 일(정의 승인 필수 칸·구현 연결·G1~G3·정의 승인) */
export function RegisteredGuide({ f, gatesPassed }: { f: ImplSource & { requirementIds?: string[] }; gatesPassed: boolean }) {
  const S = W.registered.steps;
  const steps: [string, boolean][] = [
    [S.requirements, !!f.requirementIds?.length],
    [S.impl, !missingImplText(f)],
    [S.gates, gatesPassed],
    [S.approve, false],
  ];
  return (
    <section className="ds-callout" role="status" data-testid="registered-guide" aria-labelledby="registered-guide-h">
      <p className="ds-callout__title" id="registered-guide-h">{W.registered.title}</p>
      <ol style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
        {steps.map(([text, done]) => (
          <li key={text} data-done={done || undefined}>
            {text}
            {done && <span className="ds-tag" style={{ marginLeft: 'var(--sp-1)' }}>{W.registered.done}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
