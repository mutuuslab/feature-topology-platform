// 컴플라이언스 룰 등록 — 적용 지역 코드 기준 Variant Rule 후보(FR-CRC-001-003). 코드마다 /api/region-codes/variant-candidates를 따로 읽어
// (정적 데모는 코드 하나씩 스냅샷) 기존 Variant 조건(국가·차종·트림·UPG-VC)과 상품 구성 규칙을 합쳐 보인다. 고르는 판단은 룰 작성자 몫이다.
import { Link } from 'react-router-dom';
import type { CompositionRuleCandidate, VariantConditionCandidate } from '../../../../contracts/src/rules/region-code';
import { regionCodeDisplayLabel as regionCodeLabel } from '../../copy/taxonomy-level-names';
import { useApi } from '../../api/hooks';
import { regionCopy as R } from '../../copy/taxonomy-levels';
import { DataTable, ErrorNote, Panel } from '../../design';

interface CandidateView {
  codes: string[];
  countries: string[];
  variantConditions: VariantConditionCandidate[];
  compositions: CompositionRuleCandidate[];
}

/** 코드 하나의 후보 — 부모가 코드마다 이 훅을 부른다 */
function useCandidates(code: string) {
  return useApi<CandidateView>('regionVariantCandidates', { query: { codes: code } }, { enabled: !!code.trim() });
}

function One({ code }: { code: string }) {
  const q = useCandidates(code);
  const d = q.data;
  const C = R.cCol;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!d) return null;
  if (!d.countries.length) return <p className="ds-field__hint">{`${regionCodeLabel(code)} · ${R.general2}`}</p>;
  if (!d.variantConditions.length && !d.compositions.length) return <p className="ds-field__hint">{R.none(regionCodeLabel(code))}</p>;
  return (
    <div className="ds-stack" data-ui="regionCandidates" data-code={code}>
      <DataTable
        caption={`${regionCodeLabel(code)} · ${R.variant}`}
        rows={d.variantConditions}
        rowKey={(r) => r.key}
        maxHeight="30vh"
        columns={[
          { key: 's', header: C.scope, cell: (r) => <span className="ds-mono">{`${r.country}/${r.vehicleModel}/${r.trim}`}</span> },
          { key: 'u', header: C.upg, cell: (r) => <span className="ds-mono">{r.upgVc.join(', ') || '—'}</span> },
          { key: 'f', header: C.features, cell: (r) => <span className="ds-mono">{r.featureIds.join(', ')}</span> },
        ]}
      />
      {d.compositions.length > 0 && (
        <DataTable
          caption={`${regionCodeLabel(code)} · ${R.composition}`}
          rows={d.compositions}
          rowKey={(r) => `${r.catalogId}@${r.version}`}
          maxHeight="24vh"
          columns={[
            { key: 'p', header: C.product, cell: (r) => <Link to={`/products/${r.catalogId}/${r.version}`}>{`${r.catalogId} ${r.name}`}</Link> },
            { key: 't', header: C.type, cell: (r) => r.type },
            { key: 's', header: C.scope, cell: (r) => <span className="ds-mono">{`${r.country}/${r.vehicleModel}/${r.trim}`}</span> },
            { key: 'f', header: C.features, cell: (r) => <span className="ds-mono">{r.features.join(', ') || '—'}</span> },
          ]}
        />
      )}
    </div>
  );
}

export function RegionCandidates({ codes }: { codes: string[] }) {
  return (
    <Panel title={R.candidates} id="region-candidates">
      <p className="ds-field__hint">{codes.length ? R.candidatesLead : R.pickHint}</p>
      {codes.map((c) => (
        <One key={c} code={c} />
      ))}
      <p className="ds-field__hint">
        <Link to="/policies/global-scope?tab=codes">{R.title}</Link>
      </p>
    </Panel>
  );
}
