// 전송 캠페인 /deployments/campaigns/:id (ADS-BE17 · FFP-F017) — campaign ID로 정책 게시본·정책 릴리스를 찾는다(게시본 → 캠페인은 배포 상세).
import { Link, useParams } from 'react-router-dom';
import { asyncState, useApi } from '../../api/hooks';
import { campaign as C } from '../../copy/ads-p5';
import { AsyncView, DataTable, PageHeader, Panel, type KeyMessageSpec } from '../../design';
import './ads-config.css';

interface Resp {
  campaignId: string;
  publications: { publicationId: string; kind: string; status: string; featureId: string; featureVersion: string; flagKey: string | null; targets: number; bundleDigest: string | null }[];
  policies: { policyId: string; flagKey: string | null; featureId: string | null; featureVersion: string | null; status: string | null }[];
}

export default function CampaignScreen() {
  const { id = '' } = useParams();
  const q = useApi<Resp>('campaign', { params: { id } });
  const d = q.data;
  const message: KeyMessageSpec = d ? (d.publications.length ? { tone: 'ok', text: C.key(d.publications.length, d.policies.length) } : { tone: 'neutral', text: C.keyEmpty }) : { tone: 'neutral', text: C.title(id) };
  return (
    <div className="ds-screen">
      <PageHeader codes="D04-01 · ADS-BE17" title={C.title(id)} lead={C.lead} message={message} />
      <AsyncView state={asyncState(q)} error={q.error ? C.error : null} onRetry={() => q.refetch()}>
        {d ? (
          <>
            <Panel title={C.publications} id="campaign-pubs">
              <DataTable
                caption={C.publications}
                rows={d.publications}
                pageSize={0}
                rowKey={(r) => r.publicationId}
                columns={[
                  { key: 'p', header: C.pub, cell: (r) => <Link className="ds-mono" to={`/deployments/${r.publicationId}`}>{r.publicationId}</Link> },
                  { key: 'k', header: C.kind, cell: (r) => r.kind },
                  { key: 'f', header: C.flag, cell: (r) => <span className="ds-mono">{r.flagKey ?? r.featureId}</span> },
                  { key: 't', header: C.targets, cell: (r) => r.targets },
                  { key: 'd', header: C.digest, cell: (r) => <span className="ds-mono">{r.bundleDigest ? `${r.bundleDigest.slice(0, 19)}…` : '—'}</span> },
                ]}
              />
            </Panel>
            <Panel title={C.policies} id="campaign-policies">
              <DataTable
                caption={C.policies}
                rows={d.policies}
                pageSize={0}
                rowKey={(r) => r.policyId}
                columns={[
                  { key: 'p', header: C.policy, cell: (r) => <Link className="ds-mono" to={`/policies/${r.policyId}`}>{r.policyId}</Link> },
                  { key: 'f', header: C.flag, cell: (r) => <span className="ds-mono">{r.flagKey}</span> },
                  { key: 's', header: C.status, cell: (r) => r.status ?? '—' },
                ]}
              />
            </Panel>
          </>
        ) : null}
      </AsyncView>
    </div>
  );
}
