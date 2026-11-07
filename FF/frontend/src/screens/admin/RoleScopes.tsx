// /admin/iam › 권한 범위(ADS-BE15 · FFP-F057) — 계정별 시장·Feature·환경. 긴급 차단·해제·정책 배포 명령은 대상이 범위 안이어야 한다(서버가 거부·감사).
import type { RoleScope } from '@ff/contracts';
import { scopeAxisText } from '../../../../contracts/src/rules/role-scope';
import { asyncState, useApi } from '../../api/hooks';
import { roleScope as R } from '../../copy/ads-ac';
import { personName } from '../../data/people';
import { AsyncView, DataTable, Panel } from '../../design';
import { when } from '../shared';

interface ScopesView {
  items: RoleScope[];
  environment: string;
  commands: string[];
}

export function RoleScopePanel() {
  const q = useApi<ScopesView>('roleScopes');
  const d = q.data;
  return (
    <Panel title={R.title} id="role-scopes">
      <AsyncView state={asyncState(q, (d?.items ?? []).length === 0)} error={q.error ? R.error : null} onRetry={() => q.refetch()} rows={3}>
        <p className="ds-field__hint">{R.lead}</p>
        {d?.environment ? <p className="ds-field__hint">{`${R.env(d.environment)} · ${R.commands}: ${(d.commands ?? []).map((c) => R.command[c] ?? c).join(', ')}`}</p> : null}
        <DataTable
          caption={R.title}
          rows={d?.items ?? []}
          rowKey={(r) => r.accountId}
          columns={[
            { key: 'a', header: R.col.account, cell: (r) => personName(r.accountId) },
            { key: 'm', header: R.col.markets, cell: (r) => <span className="ds-mono">{scopeAxisText(r.markets)}</span> },
            { key: 'f', header: R.col.features, cell: (r) => <span className="ds-mono">{scopeAxisText(r.featureIds)}</span> },
            { key: 'e', header: R.col.envs, cell: (r) => <span className="ds-mono">{scopeAxisText(r.environments)}</span> },
            { key: 'r', header: R.col.reason, cell: (r) => r.reason },
            { key: 'b', header: R.col.by, cell: (r) => <span>{`${personName(r.assignedBy)} · ${when(r.assignedAt)}`}</span> },
          ]}
        />
        <p className="ds-field__hint">{R.analysisOnly}</p>
      </AsyncView>
    </Panel>
  );
}
