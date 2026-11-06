// Feature 상세 '기준 행' 탭 아래 — 26580 Feature 프로필(카탈로그 위치·유형·변이성·결합 시점·변이점)과 자동 채움 이력(누가·어느 칸을·그대로/고침).
import type { AutofillHistoryRow, FeatureVariability } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { autofill as A, profile as PR } from '../../copy/ple';
import { AsyncView, DataTable, KeyValue, Panel } from '../../design';
import { personLabel } from '../../data/people';
import './ple.css';

interface VariabilityView {
  variability: FeatureVariability | null;
  source: 'AUTO' | 'EDITED' | 'SEED' | 'PROPOSED' | null;
  updatedBy: string | null;
  history: AutofillHistoryRow[];
}

const show = (v: unknown): string => (v === null || v === undefined ? '—' : Array.isArray(v) ? v.map(show).join(' · ') : typeof v === 'object' ? (('catalogueRole' in (v as object)) ? `${PR.roleOpt[(v as FeatureVariability).catalogueRole]} · ${PR.variabilityOpt[(v as FeatureVariability).variability]}` : JSON.stringify(v)) : String(v));

export function FeatureProfilePanel({ featureId, version }: { featureId: string; version: string }) {
  const q = useApi<VariabilityView>('featureVariability', { params: { id: featureId, ver: version } });
  const v = q.data?.variability;
  const h = q.data?.history ?? [];
  return (
    <Panel title={PR.title} id="feature-profile">
      <AsyncView state={asyncState(q, !v)} onRetry={() => q.refetch()} rows={3} emptyHidden>
        {v && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }} data-testid="feature-profile">
            <KeyValue
              rows={[
                { k: PR.role, v: `${PR.roleOpt[v.catalogueRole]}${v.parentRefId ? ` ← ${v.parentRefId}` : ''}` },
                { k: PR.type, v: PR.typeOpt[v.featureType] },
                { k: PR.variability, v: PR.variabilityOpt[v.variability] },
                { k: PR.binding, v: PR.bindingOpt[v.bindingTime] },
                { k: PR.vps, v: v.variationPoints.map((p) => `${PR.vpKind[p.assetKind]} ${p.asset}`).join(' · ') || '—' },
              ]}
            />
            {h.length > 0 && (
              <DataTable
                caption={A.title}
                rows={h}
                rowKey={(r) => String(r.id)}
                pageSize={0}
                columns={[
                  { key: 'f', header: A.col.field, cell: (r) => A.field[r.field] ?? r.field },
                  { key: 'v', header: A.col.value, cell: (r) => show(r.final) },
                  { key: 's', header: A.col.source, cell: (r) => <span className="af__src">{r.sourceRef ?? '—'}</span> },
                  { key: 'd', header: A.col.state, cell: (r) => <span className="ds-tag ds-ref-mark" data-ref-mark={r.decision === 'ACCEPTED' ? 'base' : 'edited'}>{r.decision === 'ACCEPTED' ? A.state.base : A.state.edited}</span> },
                  { key: 'a', header: A.col.actor, cell: (r) => <span className="ds-nowrap">{personLabel(r.actorId)}</span> },
                ]}
              />
            )}
          </div>
        )}
      </AsyncView>
    </Panel>
  );
}
