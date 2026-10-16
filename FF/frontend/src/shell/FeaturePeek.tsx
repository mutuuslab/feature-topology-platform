// Feature 요약 서랍 — 어느 화면에서든 IdChip의 '요약 보기'가 연다(설계안 2.1 우측 컨텍스트 서랍).
// Version이 없으면 최신 Version을 고른다. 고치는 일은 상세 화면에서 한다 — 서랍은 읽기만.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GATES } from '@ff/contracts';
import { asyncState, useApi } from '../api/hooks';
import { ko } from '../copy/ko';
import { AsyncView, Drawer, FEATURE_PEEK_EVENT, GateRail, IdChip, KeyValue, LifecycleBadge } from '../design';
import { scopeOf } from '../screens/shared';
import type { FeatureDetail } from '../screens/types';

const T = ko.p11.peek;

type Target = { featureId: string; version: string | null };

export function FeaturePeek() {
  const [t, setT] = useState<Target | null>(null);
  useEffect(() => {
    const on = (e: Event) => setT((e as CustomEvent<Target>).detail);
    window.addEventListener(FEATURE_PEEK_EVENT, on);
    return () => window.removeEventListener(FEATURE_PEEK_EVENT, on);
  }, []);
  return (
    <Drawer open={!!t} title={t ? t.featureId : ''} onClose={() => setT(null)}>
      {t && <PeekBody key={`${t.featureId}@${t.version ?? ''}`} featureId={t.featureId} version={t.version} onNavigate={() => setT(null)} />}
    </Drawer>
  );
}

function PeekBody({ featureId, version, onNavigate }: Target & { onNavigate: () => void }) {
  const vs = useApi<{ latestVersion: string }>('featureVersions', { params: { id: featureId } }, { enabled: !version });
  const ver = version ?? vs.data?.latestVersion ?? '';
  const q = useApi<FeatureDetail>('featureDetail', { params: { id: featureId, ver } }, { enabled: !!ver });
  const state = !version && !vs.data ? asyncState(vs) : asyncState(q);
  const d = q.data;
  return (
    <AsyncView state={state} error={(vs.error ?? q.error)?.message} onRetry={() => (vs.isError ? vs.refetch() : q.refetch())}>
      {d && (
        <div className="sh-peek" data-testid="feature-peek">
          <p className="ds-field__hint">{T.lead}</p>
          <h3 className="sh-peek__name">
            {d.feature.name} <LifecycleBadge value={d.feature.lifecycle} showKo />
          </h3>
          <KeyValue
            rows={[
              { k: T.version, v: <IdChip id={d.feature.featureId} version={d.feature.version} copy={false} /> },
              { k: T.scope, v: scopeOf(d.feature) },
              { k: T.asil, v: d.feature.asil },
              { k: T.owner, v: d.feature.ownerId },
              { k: T.baseline, v: d.feature.baselineId ? <IdChip id={d.feature.baselineId} copy={false} /> : T.noBaseline },
              { k: T.products, v: d.products.length ? d.products.map((p) => p.catalogId).join(', ') : T.noProducts },
              { k: ko.detail.tabs.deps, v: T.deps(d.dependencies.outgoing.length, d.dependencies.incoming.length) },
            ]}
          />
          <h4 className="sh-peek__sub">{T.gates}</h4>
          <GateRail statuses={Object.fromEntries(GATES.map((g) => [g, d.gates[g]?.status ?? null]))} />
          <p>
            <Link className="ds-btn ds-btn--primary" to={`/features/${d.feature.featureId}/${d.feature.version}`} onClick={onNavigate}>
              {T.open}
            </Link>
          </p>
        </div>
      )}
    </AsyncView>
  );
}
