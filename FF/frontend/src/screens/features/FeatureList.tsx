// /features — Feature Registry 목록 (v2). 백엔드 GET /api/features (D01-01).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { F_CLASSES, LIFECYCLE, type FClass, type Lifecycle, type SafetyProfile, type SyncState } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { extSync } from '../../copy/ext-sync';
import { ko } from '../../copy/ko';
import { ExtRefChip } from '../../design/ext-ref';
import { AsyncView, ClassBadges, DataTable, IdChip, LifecycleBadge, PageHeader, Segmented, Select, SummaryLine, Toolbar } from '../../design';
import { MiniGates, scopeOf, Segments } from '../shared';
import type { FeatureList as FeatureListT } from '../types';

const T = ko.registry;
const X = extSync.feature;

/** GET /api/integrations/sync/epics — Feature 버전별 JIRA Epic(한 번 조회) */
interface FeatureEpic {
  feature: string;
  key: string;
  url: string;
  status: string;
  syncState: SyncState;
  /** 플랫폼 Lifecycle 기준 JIRA 상태 */
  expected: string | null;
}

export default function FeatureList() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const qParam = sp.get('q') ?? '';
  const [q, setQ] = useState(qParam);
  // 상단 검색창처럼 URL로 들어온 검색어를 입력칸에 반영한다(같은 화면에서 다시 검색해도 어긋나지 않게)
  useEffect(() => {
    setQ(qParam);
  }, [qParam]);
  const lifecycle = (sp.get('lifecycle') ?? '') as Lifecycle | '';
  const country = sp.get('country') ?? '';
  const latestOnly = sp.get('latest') !== '0';
  const fClass = (sp.get('f') ?? '') as FClass | '';
  const withParam = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    return n;
  };
  const set = (k: string, v: string) => setSp(withParam(k, v), { replace: true });
  // 검색어는 URL에도 남기되(공유·뒤로가기) 목록은 서버 왕복 없이 즉시 거른다
  const search = (v: string) => {
    setQ(v);
    const n = new URLSearchParams(sp);
    if (v) n.set('q', v);
    else n.delete('q');
    setSp(n, { replace: true });
  };

  // 모든 Version을 한 번 받아 칩·국가 수·표를 같은 규칙으로 거른다 — 서버 facets는 필터와 무관한 전체 Version 수라
  // 홈 'VERIFIED 3'(최신 Version)을 눌러 오면 칩 6·표 3행처럼 어긋났다(UI 하네스 2판 5단계).
  // 검색어(q)도 서버로 보내지 않는다 — 정적 데모는 임의 검색어의 스냅샷을 미리 뜰 수 없다
  const all = useApi<FeatureListT>('listFeatures', { query: { latestOnly: false } });

  const stats = useMemo(() => {
    const items = all.data?.items ?? [];
    return {
      versions: items.length,
      ids: new Set(items.map((i) => i.featureId)).size,
      // 핵심 메시지 = 행동이 필요한 수(UX3-08): 승인을 기다리는 제안 — Feature별 최신 Version 기준
      proposed: items.filter((i) => i.isLatest !== false && i.lifecycle === 'PROPOSED').length,
    };
  }, [all.data]);

  // 안전 분류(보고서 5장)는 별도 Registry — Feature@Version으로 붙인다
  const profiles = useApi<{ items: SafetyProfile[] }>('safetyProfiles');
  // Lifecycle은 플랫폼·JIRA 양쪽에서 관리한다(사용자 결정 2026-10-23) — Epic 상태를 Lifecycle 옆에
  const epics = useApi<{ items: FeatureEpic[] }>('extFeatureEpics');
  const epicOf = useMemo(() => new Map((epics.data?.items ?? []).map((e) => [e.feature, e])), [epics.data]);
  const cls = useMemo(() => new Map((profiles.data?.items ?? []).map((p) => [`${p.featureId}@${p.version}`, p])), [profiles.data]);
  const fCount = useMemo(() => Object.fromEntries(F_CLASSES.map((f) => [f, (profiles.data?.items ?? []).filter((p) => p.fClass === f).length])), [profiles.data]);
  const needle = q.trim().toLowerCase();
  // 칩은 Lifecycle을 뺀 모든 필터, 국가 목록은 국가를 뺀 모든 필터를 적용해 센다 — 고른 칩의 수 = 표 행 수
  const base = (all.data?.items ?? [])
    .filter((r) => !latestOnly || r.isLatest !== false)
    .filter((r) => !fClass || cls.get(`${r.featureId}@${r.version}`)?.fClass === fClass)
    .filter((r) => !needle || [r.featureId, r.name, r.ownerId, ...(r.tags ?? [])].join(' ').toLowerCase().includes(needle));
  const filtered = !!(needle || lifecycle || country || fClass);
  const inCountry = base.filter((r) => !country || r.country === country);
  const rows = inCountry.filter((r) => !lifecycle || r.lifecycle === lifecycle);
  const tally = (items: typeof base, k: 'lifecycle' | 'country') => items.reduce<Record<string, number>>((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {});
  const facets = all.data ? { lifecycle: tally(inCountry, 'lifecycle'), country: tally(base.filter((r) => !lifecycle || r.lifecycle === lifecycle), 'country') } : undefined;
  // 국가 목록은 데이터에 있는 국가 전부(0건이어도 고를 수 있게)
  const countries = useMemo(() => [...new Set((all.data?.items ?? []).map((r) => r.country))].sort(), [all.data]);

  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · FEATURE REGISTRY"
        title={T.title}
        lead={T.lead}
        message={
          all.data
            ? {
                tone: stats.proposed ? 'warn' : 'neutral',
                value: stats.proposed,
                text: T.key.proposed,
                action: stats.proposed && lifecycle !== 'PROPOSED' ? <Link to={{ search: `?${withParam('lifecycle', 'PROPOSED')}` }} replace>{T.key.showProposed}</Link> : undefined,
              }
            : { tone: 'neutral', value: '—', text: T.key.proposed }
        }
      />
      {/* 전체 개수는 보조 요약으로 — 핵심 메시지는 행동이 필요한 수(3초 테스트 S4: "68 Feature · Version 80개"는 개수뿐) */}
      <SummaryLine items={[{ k: T.kpiIds, v: all.data ? stats.ids : '—' }, { k: T.kpiVersions, v: all.data ? stats.versions : '—' }]} />

      <Toolbar label={T.title}>
        <input
          className="ds-input"
          type="search"
          aria-label={T.search}
          placeholder={T.search}
          value={q}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && search('')}
        />
        <Segmented
          label="Lifecycle"
          value={lifecycle}
          onChange={(v) => set('lifecycle', v)}
          options={[
            { value: '' as const, label: ko.page.all, count: facets ? inCountry.length : undefined },
            // 탭 이름은 한글(일반 서체) — 대문자 코드는 툴팁으로 남긴다(UX3-08, 추적성)
            ...LIFECYCLE.map((l) => ({ value: l, label: <span title={l}>{ko.lifecycle[l]}</span>, count: facets?.lifecycle[l] ?? 0 })),
          ]}
        />
        <Select label={T.country} value={country} onChange={(e) => set('country', e.target.value)}>
          <option value="">{ko.page.all}</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c} ({facets?.country[c] ?? 0})
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

      <AsyncView state={asyncState(all, rows.length === 0)} error={all.error?.message} onRetry={() => all.refetch()} filtered={filtered} empty={filtered ? undefined : { title: T.empty }}>
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
            { key: 'name', header: T.col.name, cell: (r) => <span className="ds-name-cell">{r.name}</span>, sort: (r) => r.name, width: '20%' },
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
              key: 'epic',
              header: X.epic,
              cell: (r) => {
                const e = epicOf.get(`${r.featureId}@${r.version}`);
                if (!e) return <span style={{ color: 'var(--faint)' }}>{epics.data ? X.noEpic : '—'}</span>;
                const drift = !!e.expected && e.status !== e.expected;
                return (
                  <span className="ds-epic-cell">
                    <ExtRefChip r={{ system: 'JIRA', kind: 'EPIC', key: e.key, url: e.url, status: e.status, syncState: e.syncState, stale: false, title: '' }} />
                    {drift && (
                      <span className="ds-ext__sync" data-trouble>
                        {X.epicDrift(e.expected!)}
                      </span>
                    )}
                  </span>
                );
              },
              sort: (r) => epicOf.get(`${r.featureId}@${r.version}`)?.status ?? '',
            },
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
