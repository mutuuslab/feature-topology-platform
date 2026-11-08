// Feature 상세 — 분류 경로(FR-CAT-004-009·010, FR-REG-001-008). 분류 수준, 배치 노드와 L0부터의 경로, 배치 노드 아래 구성(SW·Flag·신호),
// 같은 수준의 노드로 배치·옮기기. 값은 /api/features/:id/taxonomy 그대로, 배치 규칙(같은 수준만)은 서버가 정한다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { FeaturePlacement, TaxonomyLevelCode, TaxonomyTreeNode } from '../../../../contracts/src/schemas/taxonomy-tree';
import { TAXONOMY_PLACEMENT_ROLES } from '../../../../contracts/src/rules/taxonomy-tree';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { taxonomyCopy as T } from '../../copy/taxonomy-levels';
import { AsyncView, Button, ErrorNote, Field, Panel, Select, SummaryLine } from '../../design';
import { usePermission, when } from '../shared';
import { who } from './TraceLinksTab';

export interface FeatureTaxonomyView {
  featureId: string;
  version: string;
  name: string;
  taxonomyLevel: TaxonomyLevelCode;
  placement: FeaturePlacement | null;
  path: TaxonomyTreeNode[];
  below: TaxonomyTreeNode[];
  candidates: { nodeId: string; name: string; path: string }[];
}

const INVALIDATE = ['featureTaxonomy', 'taxonomyLevels', 'taxonomyLevel', 'taxonomyNodes', 'audit', 'events'];
const F = T.feature;

export default function TaxonomyTab({ id }: { id: string }) {
  const q = useApi<FeatureTaxonomyView>('featureTaxonomy', { params: { id } });
  const d = q.data;
  return (
    <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
      {d && (
        <div className="ds-stack" data-ui="featureTaxonomy">
          <SummaryLine
            items={[
              { k: F.level, v: T.levelName(d.taxonomyLevel) },
              { k: F.placement, v: d.placement ? `${d.placement.nodeId} · ${F.placedBy(who(d.placement.placedBy), when(d.placement.placedAt))}` : '—' },
            ]}
          />
          <Panel title={F.path} id="taxonomy-path">
            {d.path.length ? (
              <ol className="ds-stack" aria-label={F.path}>
                {[...d.path, ...d.below].map((n) => (
                  <li key={n.nodeId} data-placed={n.nodeId === d.placement?.nodeId || undefined}>
                    <span className="ds-tag">{n.level}</span> <span className="ds-field__hint">{T.levelKo[n.level]}</span> <span className="ds-mono">{n.nodeId}</span> {n.nodeId === d.placement?.nodeId ? <b>{n.name}</b> : n.name}
                    {d.below.includes(n) && n === d.below[0] && <span className="ds-field__hint"> · {F.below}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="ds-callout" data-tone="warn" role="status">
                {F.unplaced}
              </p>
            )}
            {d.path.length > 0 && !d.below.length && <p className="ds-field__hint">{F.belowNone}</p>}
            <p className="ds-field__hint">
              <Link to="/master/taxonomy/levels">{F.toTree}</Link>
            </p>
          </Panel>
          <PlaceForm d={d} />
        </div>
      )}
    </AsyncView>
  );
}

function PlaceForm({ d }: { d: FeatureTaxonomyView }) {
  const perm = usePermission(TAXONOMY_PLACEMENT_ROLES);
  const m = useApiMutation<FeaturePlacement>('placeFeatureTaxonomy', INVALIDATE);
  const [nodeId, setNodeId] = useState('');
  const [reason, setReason] = useState('');
  const options = d.candidates.filter((c) => c.nodeId !== d.placement?.nodeId);
  const pick = nodeId || options[0]?.nodeId || '';
  return (
    <Panel title={d.placement ? F.replace : F.place} id="taxonomy-place">
      <div className="ds-toolbar">
        <Select label={`${F.node} · ${T.levelName(d.taxonomyLevel)}`} value={pick} onChange={(e) => setNodeId(e.target.value)}>
          {options.map((c) => (
            <option key={c.nodeId} value={c.nodeId}>{`${c.path} (${c.nodeId})`}</option>
          ))}
        </Select>
        <Field label={F.reason}>
          <input className="ds-input" name="placeReason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <ErrorNote error={m.error} />
      {m.data && <p className="ds-ok" role="status">{F.placed(m.data.nodeId)}</p>}
      <Button variant="primary" disabled={!perm.ok || !pick || m.isPending} title={perm.hint} onClick={() => m.mutate({ params: { id: d.featureId }, body: { nodeId: pick, ...(reason.trim().length >= 2 ? { reason: reason.trim() } : {}) } })}>
        {d.placement ? F.replace : F.place}
      </Button>
    </Panel>
  );
}
