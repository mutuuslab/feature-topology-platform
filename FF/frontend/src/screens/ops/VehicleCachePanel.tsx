// 차량 정책 캐시 패널(P9) — 차량 런타임 '기록' 탭. GET /api/vehicles/:vin/runtime 의 cache·killHistory를 그린다(지연 적재).
// FR-LPC-001-003 유효 기간 · FR-LPC-003-003 손상 제외·대체 · FR-SDM-002-002 무결성 위반 표시 · FR-RTE-004-003 차량 쪽 차단 이력
import { DataTable, IdChip, Lozenge, Panel, type LozengeAppearance } from '../../design';
import { ko } from '../../copy/ko';
import { vehicleCache as C } from '../../copy/vehicle-cache';
import { when } from '../shared';

export interface VehicleCacheRow {
  flagKey: string;
  featureId: string;
  publicationId: string;
  sequence: number;
  validUntil: string | null;
  status: string | null;
  use: 'CURRENT' | 'PREVIOUS' | 'SAFE_DEFAULT';
  delegation: string | null;
  excluded: string | null;
}
export interface KillHistoryRow {
  at: string;
  publicationId: string;
  kind: string;
  result: string;
  detail: string;
}

const STATUS_LOZENGE: Record<string, LozengeAppearance> = { VALID: 'success', EXPIRED: 'moved', UNVERIFIED: 'moved', SIGNATURE_INVALID: 'removed', INTEGRITY_MISMATCH: 'removed' };
const USE_LOZENGE: Record<string, LozengeAppearance> = { CURRENT: 'success', PREVIOUS: 'moved', SAFE_DEFAULT: 'removed' };

export function VehicleCachePanel({ cache, killHistory }: { cache: VehicleCacheRow[]; killHistory: KillHistoryRow[] }) {
  const broken = cache.filter((c) => c.excluded && (c.status === 'SIGNATURE_INVALID' || c.status === 'INTEGRITY_MISMATCH')).length;
  const attention = cache.filter((c) => c.use === 'SAFE_DEFAULT' || c.excluded).length;
  return (
    <>
      <Panel title={C.title} id="policy-cache">
        <p className="ds-field__hint">{C.lead}</p>
        <p className="ds-field__hint" role={attention ? 'alert' : undefined} data-integrity={broken ? 'violation' : 'ok'}>
          {broken ? C.integrityAlert(broken) : attention ? C.attention(attention) : C.ok}
        </p>
        <DataTable
          caption={C.caption}
          rows={cache}
          rowKey={(c) => c.flagKey}
          columns={[
            { key: 'f', header: C.col.flag, cell: (c) => <span className="ds-mono">{c.flagKey}</span> },
            { key: 's', header: C.col.status, cell: (c) => (c.status ? <Lozenge appearance={STATUS_LOZENGE[c.status] ?? 'default'}>{C.status[c.status] ?? c.status}</Lozenge> : '—') },
            { key: 'v', header: C.col.validUntil, cell: (c) => <span className="ds-mono ds-nowrap">{c.validUntil ? when(c.validUntil) : '—'}</span> },
            { key: 'u', header: C.col.use, cell: (c) => <Lozenge appearance={USE_LOZENGE[c.use] ?? 'default'}>{C.use[c.use] ?? c.use}</Lozenge> },
            { key: 'r', header: C.col.reason, cell: (c) => <span style={{ fontSize: 'var(--fs-xs)' }}>{C.reason[c.delegation ?? c.excluded ?? ''] ?? '—'}</span> },
          ]}
        />
      </Panel>
      {killHistory.length > 0 && (
        <Panel title={C.killHistory} id="kill-history">
          <DataTable
            caption={C.killHistory}
            rows={[...killHistory].reverse()}
            rowKey={(l) => `${l.at}-${l.publicationId}-${l.detail}`}
            columns={[
              { key: 'at', header: ko.audit.col.at, cell: (l) => <span className="ds-mono ds-nowrap">{when(l.at)}</span> },
              { key: 'p', header: ko.deploy.col.id, cell: (l) => <IdChip id={l.publicationId} to={`/deployments/${l.publicationId}`} copy={false} /> },
              { key: 'k', header: ko.deploy.col.kind, cell: (l) => <span className="ds-tag">{l.kind}</span> },
              { key: 'd', header: ko.audit.col.reason, cell: (l) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{l.detail}</span> },
            ]}
          />
        </Panel>
      )}
    </>
  );
}
