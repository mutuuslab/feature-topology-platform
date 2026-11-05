import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { FeatureFlagRow } from '@ff/contracts';
import { useApi } from '../../api/hooks';
import { catalogExperience as C } from '../../copy/catalog-experience';
import { LifecycleBadge } from '../../design';
import { personLabel } from '../../data/people';
import type { Composition, Product, ProductMeta } from './Products';
import './catalog-experience.css';

export function catalogTheme(p: Pick<Product, 'name' | 'tags'>): keyof typeof C.theme {
  const text = `${p.name} ${(p.tags ?? []).join(' ')}`;
  if (/parking|주차/i.test(text)) return 'parking';
  if (/energy|battery|충전|에너지/i.test(text)) return 'energy';
  if (/climate|공조|열 관리/i.test(text)) return 'climate';
  if (/connected|digital|디지털|연결/i.test(text)) return 'connected';
  if (/adas|highway|주행/i.test(text)) return 'road';
  return 'bundle';
}

/** Decorative product identity derived from its actual name/tags, never a vehicle state. */
export function CatalogCover({ product: p }: { product: Product }) {
  const theme = catalogTheme(p);
  return <div className="catalog-cover" data-theme={theme}>
    <svg viewBox="0 0 280 140" aria-hidden="true" focusable="false">
      {theme === 'parking' ? <>
        <path className="catalog-cover__minor" d="M30 115V25H95 M185 25H250V115 M40 50H85 M195 50H240 M40 90H85 M195 90H240" />
        <rect x="111" y="24" width="58" height="94" rx="14" /><path d="M119 48H161L158 83H122Z M123 31H157 M124 105H156 M99 40V58 M181 40V58 M99 88V106 M181 88V106" />
      </> : theme === 'road' ? <>
        <path d="M55 135C80 90 104 57 125 5 M225 135C200 90 176 57 155 5" /><path className="catalog-cover__minor" d="M140 8V28 M140 43V66 M140 81V104 M140 119V139 M29 135C65 72 83 36 95 5 M251 135C215 72 197 36 185 5" /><rect x="120" y="76" width="40" height="49" rx="9" /><path d="M127 89H153 M130 115H150 M112 66Q140 44 168 66" />
      </> : theme === 'energy' ? <>
        <rect x="62" y="35" width="150" height="76" rx="8" /><path d="M212 58H224V88H212 M97 53V93 M124 53V93 M151 53V93 M178 53V93" /><path className="catalog-cover__minor" d="M86 18Q96 4 106 18 M129 18Q139 4 149 18 M172 18Q182 4 192 18 M86 128Q96 114 106 128 M129 128Q139 114 149 128 M172 128Q182 114 192 128" />
      </> : theme === 'connected' ? <>
        <circle cx="105" cy="73" r="29" /><circle cx="105" cy="73" r="9" /><path d="M133 73H211V87H196V99H179V87H159 M151 31Q177 35 187 54 M155 13Q193 19 207 47" /><path className="catalog-cover__minor" d="M57 22H29V50 M224 113V133H198 M64 114Q94 135 121 117" />
      </> : theme === 'climate' ? <>
        <circle cx="140" cy="72" r="13" /><path d="M135 58C104 14 145 4 151 30L147 58 M153 76C207 67 201 108 175 104L151 85 M131 82C110 129 80 100 98 80L126 72" /><path className="catalog-cover__minor" d="M33 37Q52 25 72 37 M210 43Q232 30 252 43 M28 101Q49 88 69 101 M211 114Q233 101 254 114" />
      </> : <>
        <path d="M140 17L219 55L140 93L61 55Z M61 76L140 114L219 76 M61 97L140 135L219 97" />
        {p.baselineIds.slice(0, 4).map((id, i) => <circle key={id} cx={105 + i * 23} cy="55" r="5" />)}
      </>}
    </svg>
    <span>{C.theme[theme]}</span>
  </div>;
}

export function CatalogCard({ product: p }: { product: Product }) {
  return <article className="catalog-product" aria-label={`${p.catalogId} ${p.name}`}>
    <CatalogCover product={p} />
    <div className="catalog-product__body">
      <div className="catalog-product__facts"><code>{`${p.catalogId}@${p.version}`}</code><LifecycleBadge value={p.lifecycle} /></div>
      <h2><Link to={`/products/${p.catalogId}/${p.version}`}>{p.name}</Link></h2>
      <p>{p.description || C.unknown}</p>
      <div className="catalog-product__facts"><strong>{typeof p.featureCount === 'number' ? C.featureCount(p.featureCount) : C.featureUnknown}</strong><span>{C.baselineCount(p.baselineIds.length)}</span><span className="ds-tag">{p.saleType || C.unknown}</span></div>
      <p>{`${p.country || C.unknown} / ${p.vehicleModel || C.unknown} / ${p.trim || C.unknown}`}</p>
    </div>
    <footer className="catalog-product__footer"><span>{C.priceUnknown}</span><Link to={`/products/${p.catalogId}/${p.version}`}>{C.open}</Link></footer>
  </article>;
}

export function CatalogIdentity({ product: p, composition }: { product: Product; composition: Composition }) {
  const count = new Set(composition.features.map((f) => `${f.featureId}@${f.version}`)).size;
  const facts = [
    [C.included, C.featureCount(count)], [C.includedBaseline, C.baselineCount(p.baselineIds.length)],
    [C.country, p.country || C.unknown], [C.model, [p.vehicleModel, p.trim].filter(Boolean).join(' / ') || C.unknown],
    [C.validity, `${p.validFrom ?? C.unknown} ~ ${p.validTo ?? C.unknown}`], [C.price, C.unknown],
  ];
  return <section className="catalog-identity" aria-label={C.identity}>
    <CatalogCover product={p} />
    <div className="catalog-identity__body"><h2>{C.identity}</h2><dl className="catalog-identity__facts">{facts.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><p className="catalog-boundary">{C.boundary}</p></div>
  </section>;
}

interface PolicyCondition { policyId: string; entitlementCatalogId: string | null }
const flagRows = FeatureFlagRow.array();

export function CatalogAssembly({ product: p, composition }: { product: Product; composition: Composition }) {
  const features = composition.features;
  const [selectedId, setSelectedId] = useState(features[0]?.baselineId ?? '');
  const selected = features.find((f) => f.baselineId === selectedId) ?? features[0];
  const flags = useApi<unknown>('featureFlags', {}, { enabled: !!features.length });
  const parsed = flagRows.safeParse(flags.data);
  const selectedFlags = parsed.success && selected ? parsed.data.filter((row) => row.featureId === selected.featureId && row.version === selected.version) : [];
  const policies = useApi<{ items: PolicyCondition[] }>('listPolicies', {}, { enabled: selectedFlags.some((f) => f.policy) });
  const [playing, setPlaying] = useState(false);
  const [replay, setReplay] = useState(0);
  const [hidden, setHidden] = useState(document.hidden);
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const marker = `catalog-${useId().replace(/:/g, '')}`;
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const visibility = () => setHidden(document.hidden);
    const preference = () => setReduced(media?.matches ?? false);
    document.addEventListener('visibilitychange', visibility);
    media?.addEventListener('change', preference);
    return () => { document.removeEventListener('visibilitychange', visibility); media?.removeEventListener('change', preference); };
  }, []);
  return <section className="catalog-assembly" aria-label={C.explanation}>
    <h2>{C.explanation}</h2>
    {!selected ? <p className="catalog-boundary">{C.noFeatures}</p> : <>
      <div className="catalog-assembly__features" role="group" aria-label={C.choose}>{features.map((feature) => <button type="button" className="ds-btn" key={feature.baselineId} aria-pressed={feature.baselineId === selected.baselineId} onClick={() => { setSelectedId(feature.baselineId); setPlaying(false); setReplay((n) => n + 1); }}><span>{feature.name}</span><small>{`${feature.featureId}@${feature.version}`}</small></button>)}</div>
      <div className="catalog-flow" data-running={playing && !hidden && !reduced}>
        <ol className="catalog-flow__steps">
          <li><h3>{C.flow[0]}</h3><Link to={`/features/${selected.featureId}/${selected.version}`}>{selected.name}</Link><p><code>{selected.baselineId}</code></p><LifecycleBadge value={selected.lifecycle} /></li>
          <li><h3>{C.flow[1]}</h3><strong>{p.name}</strong><p><code>{`${p.catalogId}@${p.version}`}</code></p><p>{p.saleType || C.unknown}</p></li>
          <li><h3>{C.flow[2]}</h3><strong>{`${p.country} / ${p.vehicleModel} / ${p.trim}`}</strong><p>{`${p.validFrom ?? C.unknown} ~ ${p.validTo ?? C.unknown}`}</p><p>{C.scopeStep}</p></li>
          <li><h3>{C.flow[3]}</h3><strong>{C.vehicleStep}</strong><p>{C.boundary}</p></li>
        </ol>
        <svg className="catalog-flow__track" viewBox="0 0 1000 80" aria-hidden="true" focusable="false">
          <defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10Z" fill="currentColor" stroke="none" /></marker></defs>
          <path d="M60 40H940" fill="none" markerEnd={`url(#${marker})`} />{[60, 350, 650, 940].map((x) => <circle key={x} cx={x} cy="40" r="10" />)}
          {!reduced && <circle key={replay} className="catalog-flow__dot" r="6" />}
        </svg>
        <div className="catalog-flow__controls"><button type="button" className="ds-btn" disabled={reduced} onClick={() => setPlaying((value) => !value)}>{playing ? C.pause : C.play}</button><button type="button" className="ds-btn" disabled={reduced} onClick={() => { setReplay((value) => value + 1); setPlaying(true); }}>{C.replay}</button><span role="status">{reduced ? C.reduced : hidden ? C.hidden : playing ? C.playing : C.paused}</span></div>
        <p className="catalog-flow__hint">{C.flowHint}</p>
      </div>
      <section className="catalog-flags" aria-label={C.flags}><h3>{C.flags}</h3>
        {flags.isPending ? <p>{C.flagsPending}</p> : flags.isError || !parsed.success ? <p>{C.flagsError} <button type="button" className="ds-btn" onClick={() => void flags.refetch()}>{C.retry}</button></p> : !selectedFlags.length ? <p>{C.noFlags}</p> : <ul>{selectedFlags.map((row) => {
          const condition = row.policy && Array.isArray(policies.data?.items) ? policies.data.items.find((policy) => policy?.policyId === row.policy.policyId && (policy.entitlementCatalogId === null || (typeof policy.entitlementCatalogId === 'string' && /^CAT-\d{5}$/.test(policy.entitlementCatalogId)))) : undefined;
          return <li key={row.flagKey}>
            <Link to={`/features/${selected.featureId}/${selected.version}?tab=flags#flag-${encodeURIComponent(row.flagKey)}`}><code>{row.flagKey}</code></Link>
            {row.policy ? <Link to={`/policies/${row.policy.policyId}`}>{`${row.policy.policyId} · r${row.policy.revision} · ${row.policy.status}`}</Link> : <span>{C.noPolicy}</span>}
            {row.sources[0] && <a href={row.sources[0].url} target="_blank" rel="noopener noreferrer">{C.source}</a>}
            {row.publication && <span>{`${C.publication} ${row.publication.confirmed}/${row.publication.denominator}`}</span>}
            <span className="catalog-flags__condition" aria-busy={!!row.policy && policies.isPending}>{C.entitlement}: {row.policy && policies.isPending ? C.conditionPending : condition?.entitlementCatalogId ? C.needsEntitlement(condition.entitlementCatalogId) : condition?.entitlementCatalogId === null ? C.noEntitlement : C.unknown}</span>
          </li>;
        })}</ul>}
      </section>
    </>}
  </section>;
}

export function CatalogApproval({ product: p, meta, transitions, eligibility }: { product: Product; meta?: ProductMeta; transitions: { ko: string; approval: string | null; to: string }[]; eligibility: { eligible: boolean; reasons: string[] } }) {
  const next = transitions.find((t) => t.approval) ?? transitions[0];
  const role = next?.approval === 'CONFIG' ? C.configRole : next?.approval === 'RELEASE' ? C.releaseRole : C.productRole;
  const facts = [[C.owner, p.ownerId || C.unknown], [C.createdBy, meta?.createdBy ? personLabel(meta.createdBy) : C.unknown], [C.configBy, meta?.configApprovedBy ? personLabel(meta.configApprovedBy) : C.noApproval], [C.releaseBy, meta?.releaseApprovedBy ? personLabel(meta.releaseApprovedBy) : C.noApproval]];
  return <section className="catalog-approval" aria-label={C.approval}><h2>{C.approval}</h2><dl>{facts.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><p className="catalog-approval__next"><strong>{C.next}</strong>: {next ? `${next.ko} · ${role}` : C.noNext}<br />{C.eligibility}: {eligibility.eligible ? C.eligible : C.blocked}</p></section>;
}
