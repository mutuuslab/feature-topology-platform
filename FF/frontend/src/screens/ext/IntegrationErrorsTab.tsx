// 외부 연계 현황 '오류 이력' 탭(D04-04, 기능명세서 B6) — Legacy·과금·정책 서명·CI/CD 파이프라인 실패를 유형·시점·대상·내용으로.
// 기록은 추가만(지울 수 없다), 같은 기록에서 수신자 규칙대로 담당자 알림이 나간다. 탭을 열 때만 읽는다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { INTEGRATION_ERROR_SYSTEM_LABEL, INTEGRATION_ERROR_SYSTEMS, INTEGRATION_ERROR_TYPE_LABEL, type IntegrationError, type IntegrationErrorSystem } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { integrationErrors as X } from '../../copy/records';
import { AsyncView, DataTable, Select, Toolbar, VerdictBadge } from '../../design';
import { personLabel, personName } from '../../data/people';
import { when } from '../shared';
import { PeriodFilter, type Period } from '../governance/AuditTools';

export default function IntegrationErrorsTab() {
  const [system, setSystem] = useState<IntegrationErrorSystem | ''>('');
  const [period, setPeriod] = useState<Period>({ from: '', to: '' });
  const q = useApi<{ items: IntegrationError[]; counts: Record<string, number> }>('integrationErrors', { query: { system: system || undefined, from: period.from || undefined, to: period.to || undefined } });
  const rows = q.data?.items ?? [];
  const C = X.col;
  return (
    <div className="ds-stack" data-testid="integration-errors">
      <p className="ds-field__hint">{X.lead}</p>
      <Toolbar label={X.tab}>
        <Select label={X.system} value={system} onChange={(e) => setSystem(e.target.value as IntegrationErrorSystem | '')}>
          <option value="">{X.all}</option>
          {INTEGRATION_ERROR_SYSTEMS.map((s) => (
            <option key={s} value={s}>
              {INTEGRATION_ERROR_SYSTEM_LABEL[s]}
            </option>
          ))}
        </Select>
        <PeriodFilter value={period} onChange={setPeriod} />
        <span className="ds-badge">{X.key(rows.length)}</span>
        <Link className="ds-btn" to="/notifications/rules">
          {X.rules}
        </Link>
      </Toolbar>
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()} filtered={!!(system || period.from || period.to)}>
        <DataTable
          caption={X.tab}
          rows={rows}
          rowKey={(r) => r.errorId}
          initialSort={{ key: 'at', dir: 'desc' }}
          columns={[
            { key: 'at', header: C.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.at)}</span>, sort: (r) => r.at },
            { key: 's', header: C.system, cell: (r) => r.systemName, sort: (r) => r.system },
            { key: 't', header: C.type, cell: (r) => <VerdictBadge value="FAIL" label={INTEGRATION_ERROR_TYPE_LABEL[r.errorType] ?? r.errorType} />, sort: (r) => r.errorType },
            { key: 'g', header: C.target, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.target}</span> },
            { key: 'm', header: C.message, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.message}</span> },
            { key: 'a', header: C.actor, cell: (r) => <span className="ds-nowrap" title={personLabel(r.actorId)}>{personName(r.actorId)}</span> },
          ]}
        />
      </AsyncView>
    </div>
  );
}
