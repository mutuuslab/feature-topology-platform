// 진행 중인 Feature 등록(20-60 §6) — PROPOSED Feature마다 등록 단계(제출·검토·정의 승인), G1~G3, 승인 전에 채울 칸, 자동 채움 결정 수.
// 등록 현황(/master/define)은 표로, 기획 스튜디오는 짧은 목록으로 같은 응답(GET /api/ple/registrations)을 쓴다.
import { Link } from 'react-router-dom';
import { INPUT_LABEL } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { registrations as R } from '../../copy/ple';
import { AsyncView, DataTable, GateBadge } from '../../design';
import { RegistrationMini } from './RegistrationSteps';
import './ple.css';

export interface RegistrationRow {
  featureId: string;
  version: string;
  name: string;
  country?: string;
  vehicleModel?: string;
  trim?: string;
  createdBy?: string | null;
  primaryRef?: { refId: string; nameKo: string | null } | null;
  gates?: Partial<Record<'G1' | 'G2' | 'G3', string | null>>;
  missing?: string[];
  stageIndex?: number;
  autofill?: { ACCEPTED: number; EDITED: number; ADDED: number } | null;
  mine?: boolean;
}

export interface RegistrationsResponse {
  items: RegistrationRow[];
  mine?: number;
}

export function useRegistrations() {
  return useApi<RegistrationsResponse>('featureRegistrations');
}

/** 단계 칸 — 제출(2)부터. 응답에 단계가 없으면 제출 */
const stageOf = (r: RegistrationRow) => (typeof r.stageIndex === 'number' ? r.stageIndex : 2);
const missingLabel = (k: string) => INPUT_LABEL[k as keyof typeof INPUT_LABEL] ?? k;

/** 등록 현황 표 */
export function RegistrationsTable({ rows }: { rows: RegistrationRow[] }) {
  return (
    <DataTable
      caption={R.title}
      rows={rows}
      rowKey={(r) => `${r.featureId}@${r.version}`}
      maxHeight="48vh"
      columns={[
        {
          key: 'f',
          header: R.col.feature,
          cell: (r) => (
            <span>
              <Link to={`/features/${r.featureId}/${r.version}`} className="ds-mono">{`${r.featureId}@${r.version}`}</Link> {r.name} {r.mine && <span className="ds-tag">{R.mine}</span>}
            </span>
          ),
          sort: (r) => r.featureId,
        },
        { key: 's', header: R.col.stage, cell: (r) => <RegistrationMini current={stageOf(r)} />, sort: (r) => stageOf(r) },
        { key: 'r', header: R.col.ref, cell: (r) => (r.primaryRef ? <span><Link to={`/master/feature-db/${r.primaryRef.refId}`} className="ds-mono">{r.primaryRef.refId}</Link> {r.primaryRef.nameKo}</span> : R.none) },
        {
          key: 'g',
          header: R.col.gates,
          cell: (r) => (
            <span className="ds-nowrap">
              {(['G1', 'G2', 'G3'] as const).map((g) => (
                <GateBadge key={g} status={r.gates?.[g] ?? null} />
              ))}
            </span>
          ),
        },
        { key: 'm', header: R.col.missing, cell: (r) => (r.missing?.length ? r.missing.map(missingLabel).join(' · ') : R.none) },
        { key: 'a', header: R.col.autofill, cell: (r) => (r.autofill ? R.autofillCount(r.autofill.ACCEPTED, r.autofill.EDITED) : R.none) },
      ]}
    />
  );
}

/** 짧은 목록 — 기획 스튜디오 '등록 진행 중' */
export function RegistrationsList({ rows, limit = 5 }: { rows: RegistrationRow[]; limit?: number }) {
  return (
    <>
      <ol className="ws-work ws-work--dense" data-registrations>
        {rows.slice(0, limit).map((r) => (
          <li key={`${r.featureId}@${r.version}`}>
            <RegistrationMini current={stageOf(r)} />
            <Link to={`/features/${r.featureId}/${r.version}`} className="ws-work__name">
              {r.name}
            </Link>
            <span className="ws-work__proc ds-mono">
              {r.featureId}@{r.version}
            </span>
          </li>
        ))}
      </ol>
      {rows.length > limit && (
        <Link className="ws-more" to="/master/define">
          {R.more(rows.length - limit)} →
        </Link>
      )}
    </>
  );
}

/** 등록 현황 패널 내용 — 불러오기·오류 포함 */
export function RegistrationsView({ compact = false }: { compact?: boolean }) {
  const q = useRegistrations();
  const rows = q.data?.items ?? [];
  return (
    <AsyncView state={asyncState(q, !rows.length)} onRetry={() => q.refetch()} rows={4} emptyHidden>
      {compact ? <RegistrationsList rows={rows} /> : <RegistrationsTable rows={rows} />}
    </AsyncView>
  );
}
