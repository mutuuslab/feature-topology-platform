// ① 기획 스튜디오(상품기획) — Feature를 Lifecycle 칸반 보드로 본다. 넓은 여백, 카드, 제안 버튼이 가장 앞.
import { Link } from 'react-router-dom';
import type { DepartmentSummary } from '@ff/contracts';
import { useApi, asyncState } from '../../api/hooks';
import { departments as D } from '../../copy/departments';
import { AsyncView, PageHeader, Panel } from '../../design';
import type { FeatureList } from '../types';
import { Handoffs, MyWork, useDeptDoc } from './common';

const COLUMNS = ['PROPOSED', 'APPROVED', 'VERIFIED', 'RELEASED'] as const;
const PER_COLUMN = 5;

export default function StudioHome({ dept }: { dept: DepartmentSummary }) {
  const S = D.studio;
  const q = useApi<FeatureList>('listFeatures', { query: { latestOnly: true } });
  const products = useApi<{ items: { catalogId: string }[] }>('listProducts');
  const d = useDeptDoc(dept);
  const items = q.data?.items ?? [];
  const active = items.filter((f) => f.lifecycle !== 'RELEASED' && f.lifecycle !== 'DEPRECATED' && f.lifecycle !== 'RETIRED').length;
  return (
    <div className="ds-screen ws ws--studio" data-workspace-home="studio">
      <PageHeader
        codes={S.eyebrow}
        title={S.title(dept.name)}
        lead={S.lead}
        message={q.isPending ? { tone: 'neutral', value: '—', text: S.key(0).text } : { tone: 'neutral', ...S.key(active) }}
        actions={
          <div className="ws-actions">
            <Link className="ds-btn ds-btn--primary" to="/feature/propose">
              {S.propose}
            </Link>
            <Link className="ds-btn" to="/products">
              {S.products}
              {products.data && <span className="ws-pill">{S.productCount(products.data.items.length)}</span>}
            </Link>
          </div>
        }
      />
      <section className="ws-board" aria-label={S.board}>
        <AsyncView state={asyncState(q, !items.length)} onRetry={() => q.refetch()} rows={5}>
          <div className="ws-board__cols">
            {COLUMNS.map((lc) => {
              const col = items.filter((f) => f.lifecycle === lc || (lc === 'APPROVED' && f.lifecycle === 'DEVELOPING'));
              return (
                <div key={lc} className="ws-col" data-lifecycle={lc}>
                  <h2 className="ws-col__head">
                    {S.column[lc]} <span className="ws-col__n">{col.length}</span>
                  </h2>
                  <ul className="ws-cards">
                    {col.slice(0, PER_COLUMN).map((f) => (
                      <li key={`${f.featureId}@${f.version}`} className="ws-card">
                        <Link to={`/features/${f.featureId}/${f.version}`} className="ws-card__name">
                          {f.name}
                        </Link>
                        <span className="ws-card__id">
                          {f.featureId}@{f.version}
                        </span>
                        <span className="ws-card__meta">
                          {f.country} · {f.vehicleModel} · {f.asil}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {col.length > PER_COLUMN && (
                    <Link className="ws-more" to={`/features?lifecycle=${lc}`}>
                      {S.more(col.length - PER_COLUMN)} →
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </AsyncView>
      </section>
      <div className="ws-split">
        <Panel title={D.home.myWork}>
          <MyWork d={d} limit={6} />
        </Panel>
        <Panel title={`${D.home.handoffIn} · ${D.home.handoffOut}`}>
          <Handoffs d={d} />
        </Panel>
      </div>
    </div>
  );
}
