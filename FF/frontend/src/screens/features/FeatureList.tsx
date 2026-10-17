// /features — Feature Registry 목록 (v2). 백엔드 GET /api/features (D01-01).
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { F_CLASSES, LIFECYCLE, type FClass, type Lifecycle, type SafetyProfile } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, ClassBadges, DataTable, IdChip, LifecycleBadge, PageHeader, Segmented, Select, SummaryLine, Toolbar } from '../../design';
import { MiniGates, scopeOf, Segments } from '../shared';
import type { FeatureList as FeatureListT } from '../types';

const T = ko.registry;

export default function FeatureList() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const lifecycle = (sp.get('lifecycle') ?? '') as Lifecycle | '';
  const country = sp.get('country') ?? '';
  const latestOnly = sp.get('latest') !== '0';
  const fClass = (sp.get('f') ?? '') as FClass | '';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };

  const all = useApi<FeatureListT>('listFeatures', { query: { latestOnly: false } });
  const list = useApi<FeatureListT>('listFeatures', { query: { q: sp.get('q') ?? undefined, lifecycle: lifecycle || undefined, country: country || undefined, latestOnly } });

  const stats = useMemo(() => {
    const items = all.data?.items ?? [];
    return {
      versions: items.length,
      ids: new Set(items.map((i) => i.featureId)).size,
      released: items.filter((i) => i.lifecycle === 'RELEASED').length,
      proposed: items.filter((i) => i.lifecycle === 'PROPOSED').length,
      baselined: items.filter((i) => i.baselineId).length,
    };
  }, [all.data]);

  // 안전 분류(보고서 5장)는 별도 Registry — Feature@Version으로 붙인다
  const profiles = useApi<{ items: SafetyProfile[] }>('safetyProfiles');
  const cls = useMemo(() => new Map((profiles.data?.items ?? []).map((p) => [`${p.featureId}@${p.version}`, p])), [profiles.data]);
  const fCount = useMemo(() => Object.fromEntries(F_CLASSES.map((f) => [f, (profiles.data?.items ?? []).filter((p) => p.fClass === f).length])), [profiles.data]);
  const rows = (list.data?.items ?? []).filter((r) => !fClass || cls.get(`${r.featureId}@${r.version}`)?.fClass === fClass);
  const facets = all.data?.facets;

  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · FEATURE REGISTRY"
        title={T.title}
        lead={T.lead}
        message={{ tone: 'neutral', value: all.data ? stats.ids : '—', text: `${T.key.ids} · ${T.key.versions(stats.versions)}` }}
      />
      <SummaryLine items={[{ k: T.kpiBaselined, v: all.data ? stats.baselined : '—' }]} />

      <Toolbar label={T.title}>
        <input
          className="ds-input"
          type="search"
          aria-label={T.search}
          placeholder={T.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && set('q', q.trim())}
          onBlur={() => set('q', q.trim())}
        />
        <Segmented
          label="Lifecycle"
          value={lifecycle}
          onChange={(v) => set('lifecycle', v)}
          options={[
            { value: '' as const, label: ko.page.all, count: facets ? Object.values(facets.lifecycle).reduce((a, b) => a + b, 0) : undefined },
            ...LIFECYCLE.map((l) => ({ value: l, label: l, count: facets?.lifecycle[l] ?? 0 })),
          ]}
        />
        <Select label={T.country} value={country} onChange={(e) => set('country', e.target.value)}>
          <option value="">{ko.page.all}</option>
          {Object.entries(facets?.country ?? {}).map(([c, n]) => (
            <option key={c} value={c}>
              {c} ({n})
            </option>
          ))}
        </Select>
        <Select label={T.fFilter} value={fClass} onChange={(e) => set('f', e.target.value)}>
          <option value="">{ko.page.all}</option>
          {F_CLASSES.map((f) => (
            <option key={f} value={f}>
              {f} ({fCount[f] ?? 0})
            </option>
          ))}
        </Select>
        <label className="ds-field ds-field--inline">
          <input type="checkbox" checked={latestOnly} onChange={(e) => set('latest', e.target.checked ? '' : '0')} />
          <span className="ds-field__label">{T.latestOnly}</span>
        </label>
      </Toolbar>

      <AsyncView state={asyncState(list, rows.length === 0)} error={list.error?.message} onRetry={() => list.refetch()} empty={{ title: T.empty }}>
        <DataTable
          caption={T.title}
          rows={rows}
          rowKey={(r) => `${r.featureId}@${r.version}`}
          onOpen={(r) => nav(`/features/${r.featureId}/${r.version}`)}
          maxHeight="calc(100vh - 360px)"
          initialSort={{ key: 'id', dir: 'asc' }}
          columns={[
            {
              key: 'id',
              header: T.col.id,
              cell: (r) => <IdChip id={r.featureId} version={r.version} to={`/features/${r.featureId}/${r.version}`} />,
              sort: (r) => `${r.featureId}@${r.version.padStart(8, '0')}`,
              width: '190px',
            },
            { key: 'name', header: T.col.name, cell: (r) => r.name, sort: (r) => r.name, width: '20%' },
            {
              key: 'scope',
              header: T.col.scope,
              cell: (r) => (
                <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                  <Segments items={[r.country, r.vehicleModel, r.trim]} />
                </span>
              ),
              sort: (r) => scopeOf(r),
            },
            { key: 'lc', header: T.col.lifecycle, cell: (r) => <LifecycleBadge value={r.lifecycle} />, sort: (r) => LIFECYCLE.indexOf(r.lifecycle) },
            {
              key: 'cls',
              header: T.safetyCols,
              cell: (r) => {
                const p = cls.get(`${r.featureId}@${r.version}`);
                return p ? (
                  <span className="ds-cls-row--nowrap" title={ko.safety.typeShort[p.flagType]}>
                    <ClassBadges f={p.fClass} dc={p.deactClass} r={p.regClass} short />
                  </span>
                ) : (
                  <span style={{ color: 'var(--faint)' }}>—</span>
                );
              },
              sort: (r) => cls.get(`${r.featureId}@${r.version}`)?.fClass ?? '',
            },
            { key: 'gates', header: T.col.gates, cell: (r) => <MiniGates gates={r.gates} /> },
            {
              key: 'bl',
              header: T.col.baseline,
              cell: (r) => (r.baselineId ? <span className="ds-mono">{r.baselineId}</span> : <span style={{ color: 'var(--faint)' }}>—</span>),
              sort: (r) => r.baselineId ?? '',
            },
            { key: 'asil', header: T.col.asil, cell: (r) => <span className="ds-mono">{r.asil}</span>, sort: (r) => r.asil, minor: true },
            { key: 'owner', header: T.col.owner, cell: (r) => r.ownerId, sort: (r) => r.ownerId, minor: true },
          ]}
        />
      </AsyncView>
    </div>
  );
}
