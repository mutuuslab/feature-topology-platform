// ② 자동 채움 확인(20-60 §5.3) — 대표 기준 행에서 채운 칸과 출처, 적용 범위 후보, 관련 Feature 후보, 중복·유사 경고, 26580 Feature 프로필.
// 자동 채움은 작성 보조 — 값은 모두 고칠 수 있고, 서버가 등록 때 다시 계산해 칸별 결정(그대로·고침)을 이력에 남긴다.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData } from '@tanstack/react-query';
import { autofillFromRef, jcs, type AutofillResult, type FeatureVariability, type PleFeature, type PleRef, type VariationPoint } from '@ff/contracts';
import { STATIC_MODE } from '../../../api/client';
import { useApi } from '../../../api/hooks';
import { autofill as A, profile as PR } from '../../../copy/ple';
import { Field } from '../../../design';
import type { RefLite } from './prefill';
import '../../ple/ple.css';

export interface Scope {
  country: string;
  vehicleModel: string;
  trim: string;
}

/** 프로필 편집 상태 — 변이점은 자동 채움 결과에서 고른 제어점만 남긴다 */
export type ProfileDraft = Omit<FeatureVariability, 'variationPoints'>;

const CP_OF: Record<string, string> = { FLAG: 'Flag', PARAMETER: 'Parameter', SIGNAL: 'Signal', DTC: 'DTC' };
/** 제출할 변이점 — 자동 채움 변이점 중 지금 고른 제어점의 것과 SW 컴포넌트 */
export const variationPointsFor = (vps: readonly VariationPoint[], cps: readonly string[]) => vps.filter((v) => !CP_OF[v.assetKind] || cps.includes(CP_OF[v.assetKind]));
export const scopeKey = (s: Scope) => `${s.country}|${s.vehicleModel}|${s.trim}`;

function useDebounced<T>(v: T, ms = 400): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = window.setTimeout(() => setD(v), ms);
    return () => window.clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** 자동 채움 조회 — 실서버는 GET /api/ple/autofill, 공개 데모는 받아 둔 Feature 목록과 고른 행으로 같은 규칙 */
export function useAutofill(primary: RefLite | null, picked: readonly RefLite[], name: string, scope: Scope) {
  const q = useDebounced({ refId: primary?.refId ?? '', name: name.trim(), ...scope });
  const { refId, ...query } = q;
  const live = useApi<AutofillResult>('featureAutofill', { params: { refId }, query }, { enabled: !STATIC_MODE && !!refId, placeholderData: keepPreviousData });
  const feats = useApi<{ items: PleFeature[] }>('listFeatures', { query: { latestOnly: true } }, { enabled: STATIC_MODE && !!primary });
  const local = useMemo(() => {
    if (!STATIC_MODE || !primary || !feats.data) return undefined;
    const refs = new Map<string, PleRef>(picked.map((r) => [r.refId, r as unknown as PleRef]));
    return autofillFromRef(primary as unknown as PleRef, { features: feats.data.items, refsById: refs, scope, name });
  }, [primary, picked, feats.data, scope, name]);
  const data = STATIC_MODE ? local : live.data?.refId === primary?.refId ? live.data : undefined;
  return { data, pending: !data && (STATIC_MODE ? feats.isPending : live.isPending) };
}

export function AutofillPanel({
  result,
  form,
  cps,
  scope,
  onScope,
  profile,
  onProfile,
}: {
  result: AutofillResult;
  form: { name: string; description: string; asil: string; tags: string; owner: string };
  cps: readonly string[];
  scope: Scope;
  onScope: (s: Scope) => void;
  profile: ProfileDraft;
  onProfile: (p: ProfileDraft) => void;
}) {
  const field = (k: string) => result.fields.find((f) => f.key === k);
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).sort().join('\u0000');
  const same = (k: string): boolean | null => {
    const f = field(k);
    if (!f) return null;
    if (k === 'tags') return list(form.tags) === [...(f.value as string[])].sort().join('\u0000');
    if (k === 'controlPoints') return [...cps].sort().join() === [...(f.value as string[])].sort().join();
    if (k === 'scope') return result.scopeCandidates.some((s) => scopeKey(s) === scopeKey(scope));
    if (k === 'variability') return jcs({ ...profile, variationPoints: [] }) === jcs({ ...result.variability, variationPoints: [] });
    if (k === 'name' || k === 'description' || k === 'asil' || k === 'owner') return String(form[k]).trim() === String(f.value).trim();
    return null; // 참고 칸(도메인·컴포넌트·SW 계층·T-shirt·규제) — 태그·규제로 저장
  };
  const show = (v: string | string[]) => (Array.isArray(v) ? v.join(' · ') : v);
  const vps = variationPointsFor(result.variability.variationPoints, cps);
  const setP = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => onProfile({ ...profile, [k]: v });

  return (
    <div className="af" data-testid="autofill" data-autofill-ref={result.refId}>
      <section aria-labelledby="af-h">
        <h3 id="af-h" style={{ marginTop: 0 }}>
          {A.title}
        </h3>
        <p className="ds-field__hint">{A.lead(result.refId)}</p>
        <table className="af__table" aria-labelledby="af-h">
          <thead>
            <tr>
              <th scope="col">{A.col.field}</th>
              <th scope="col">{A.col.value}</th>
              <th scope="col">{A.col.source}</th>
              <th scope="col">{A.col.state}</th>
            </tr>
          </thead>
          <tbody>
            {result.fields.map((f) => {
              const s = same(f.key);
              return (
                <tr key={f.key} data-af-field={f.key}>
                  <th scope="row">{A.field[f.key] ?? f.key}</th>
                  <td>{f.key === 'variability' ? `${PR.roleOpt[profile.catalogueRole]} · ${PR.typeOpt[profile.featureType]} · ${PR.variabilityOpt[profile.variability]} · ${PR.bindingOpt[profile.bindingTime]}` : f.key === 'scope' ? show([scope.country, scope.vehicleModel, scope.trim]) : f.key === 'controlPoints' ? cps.join(' · ') : show(f.value)}</td>
                  <td className="af__src">
                    <b>{A.sourceKind[f.source.kind]}</b> {f.source.kind === 'REF' ? <span className="ds-mono">{f.source.ref}</span> : null} {f.source.column}
                    {f.note ? <div>{f.note}</div> : null}
                  </td>
                  <td>
                    <span className="ds-tag ds-ref-mark" data-ref-mark={s === null ? 'info' : s ? 'base' : 'edited'}>
                      {s === null ? A.state.info : s ? A.state.base : A.state.edited}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="af__grid">
        <section className="af__box" aria-labelledby="af-scope-h" data-testid="af-scopes">
          <h3 id="af-scope-h">{A.scopeTitle}</h3>
          <p className="ds-field__hint">{A.scopeHint}</p>
          <ul className="af__chips">
            {result.scopeCandidates.map((s) => {
              const on = scopeKey(s) === scopeKey(scope);
              const label = `${s.country} · ${s.vehicleModel} · ${s.trim}`;
              return (
                <li key={scopeKey(s)}>
                  <button type="button" className="af__chip" aria-pressed={on} title={s.reason} aria-label={A.scopeApply(label)} onClick={() => onScope({ country: s.country, vehicleModel: s.vehicleModel, trim: s.trim })}>
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="af__box" aria-labelledby="af-dup-h" data-testid="af-duplicates">
          <h3 id="af-dup-h">{A.dupTitle}</h3>
          {result.duplicates.length ? (
            <ul className="af__list">
              {result.duplicates.map((d) => (
                <li key={`${d.kind}-${d.featureId}`} data-dup={d.kind}>
                  <span className={`ds-tag${d.blocking ? ' ds-tag--warn' : ''}`}>{A.dupKind[d.kind]}</span>
                  <Link to={`/features/${d.featureId}/${d.version}`} className="ds-mono">
                    {d.featureId}
                  </Link>
                  <span>{d.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ds-field__hint">{A.dupNone}</p>
          )}
        </section>

        <section className="af__box" aria-labelledby="af-rel-h" data-testid="af-related">
          <h3 id="af-rel-h">{A.relatedTitle}</h3>
          <p className="ds-field__hint">{A.relatedHint}</p>
          <ul className="af__list">
            {result.related.slice(0, 8).map((r) => (
              <li key={`${r.kind}-${r.featureId}`} data-related={r.kind}>
                <span className="ds-tag">{A.relatedKind[r.kind]}</span>
                <Link to={`/features/${r.featureId}/${r.version}`} className="ds-mono">
                  {r.featureId}
                </Link>
                <span>{r.name}</span>
                <span className="af__src">{`${r.scope.country} · ${r.scope.vehicleModel}`}</span>
              </li>
            ))}
          </ul>
          <Link to="/arch/topology">{A.relatedTopology} →</Link>
        </section>
      </div>

      <fieldset className="af__profile" data-testid="af-profile">
        <legend className="ds-field__label">{PR.title}</legend>
        <p className="ds-field__hint" style={{ margin: 0 }}>
          {PR.lead}
        </p>
        <div className="af__profile-grid">
          <Field label={PR.role}>
            <select className="ds-select" name="catalogueRole" value={profile.catalogueRole} onChange={(e) => setP('catalogueRole', e.target.value as ProfileDraft['catalogueRole'])}>
              {Object.entries(PR.roleOpt).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label={PR.parent} hint={PR.parentHint}>
            <input className="ds-input ds-input--mono" name="parentRefId" value={profile.parentRefId ?? ''} onChange={(e) => setP('parentRefId', e.target.value.trim() || null)} />
          </Field>
          <Field label={PR.type}>
            <select className="ds-select" name="featureType" value={profile.featureType} onChange={(e) => setP('featureType', e.target.value as ProfileDraft['featureType'])}>
              {Object.entries(PR.typeOpt).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label={PR.variability}>
            <select className="ds-select" name="variability" value={profile.variability} onChange={(e) => setP('variability', e.target.value as ProfileDraft['variability'])}>
              {Object.entries(PR.variabilityOpt).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label={PR.binding}>
            <select className="ds-select" name="bindingTime" value={profile.bindingTime} onChange={(e) => setP('bindingTime', e.target.value as ProfileDraft['bindingTime'])}>
              {Object.entries(PR.bindingOpt).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        {profile.variability === 'MANDATORY' && (
          <p className="ds-callout" data-tone="warn" role="note">
            {PR.mandatoryNote}
          </p>
        )}
        <div>
          <p className="ds-field__label" style={{ margin: 0 }}>{PR.vps}</p>
          <p className="ds-field__hint" style={{ margin: 0 }}>{PR.vpsHint}</p>
          <ul className="af__list" data-testid="af-vps">
            {vps.map((v) => (
              <li key={v.vpId}>
                <span className="ds-tag">{PR.vpKind[v.assetKind]}</span>
                <span className="ds-mono">{v.asset}</span>
                <span className="af__src">{v.mapping}</span>
              </li>
            ))}
          </ul>
        </div>
      </fieldset>
    </div>
  );
}
