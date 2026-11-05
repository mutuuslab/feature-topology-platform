// 계수 표 화면의 교정 제안·실적 오차(C4, 20-94 §6.6) — 산정 역할만(벤치마크 € 포함, 서버가 403).
// 포인트당 € 제안값은 06_교정 표본의 기하평균. 적용은 원가 기준 관리자가 '제안값으로 초안'을 만들어 발행할 때만(C4 사용자 결정).
// 실적 오차는 승인된 과제 전체의 기준 행 실적(승인 뒤 입력 포함)을 모아 컴포넌트별로 보인다.
import type { ReactNode } from 'react';
import type { CostAnchorSample, CostMreRow } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { costCalib as T } from '../../copy/cost';
import { AsyncView, Button, DataTable, KeyValue, Panel } from '../../design';
import { RefChip } from '../refdb/common';
import { CostChip, mm, pct } from './common';

interface CalibrationResponse {
  basisVersion: string;
  anchorEur: number;
  suggestion: number;
  ratio: number;
  samples: (CostAnchorSample & { nameKo: string | null })[];
  mre: {
    projects: number;
    approvedProjects: number;
    n: number;
    missing: number;
    avg: number | null;
    byComponent: { component: string; n: number; missing: number; avg: number | null }[];
    rows: (CostMreRow & { estId: string; name: string; nameKo: string | null; component: string | null })[];
  };
}

const eur = (x: number, digits = 0) => `€ ${x.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
/** 제안값을 초안 칸에 넣을 때 — 소수 첫째 자리(엑셀 표시와 같게) */
export const suggestionForDraft = (x: number) => Math.round(x * 10) / 10;

export function CostCalibration({ canDraft, why, onDraft }: { canDraft: boolean; why?: ReactNode; onDraft: (anchorEur: number) => void }) {
  const q = useApi<CalibrationResponse>('costCalibration');
  const c = q.data;
  return (
    <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
      {c && (
        <div className="ds-stack">
          <div className="ds-split">
            <Panel
              title={T.title(c.basisVersion)}
              actions={
                <Button disabled={!canDraft} reason={why} onClick={() => onDraft(suggestionForDraft(c.suggestion))}>
                  {T.draft}
                </Button>
              }
            >
              <KeyValue
                rows={[
                  { k: T.applied, v: eur(c.anchorEur, 1) },
                  { k: T.suggestion, v: eur(c.suggestion, 1), note: pct(c.ratio) },
                  { k: T.samples, v: c.samples.length },
                ]}
              />
              <p className="ds-field__hint">{T.hint}</p>
            </Panel>
            <Panel title={T.mreTitle}>
              <KeyValue
                rows={[
                  { k: T.mreAvg, v: c.mre.avg == null ? '—' : pct(c.mre.avg) },
                  { k: T.mreRows, v: c.mre.n },
                  { k: T.mreProjects, v: c.mre.projects },
                  { k: T.approvedProjects, v: c.mre.approvedProjects },
                  { k: T.mreMissing, v: c.mre.missing },
                ]}
              />
              {!c.mre.n && <p className="ds-field__hint">{T.mreNone}</p>}
              <p className="ds-field__hint">{T.missingHint}</p>
            </Panel>
          </div>
          {c.mre.byComponent.length > 0 && (
            <div className="ds-split">
              <Panel title={T.byComponent}>
                <DataTable
                  rows={c.mre.byComponent}
                  rowKey={(r) => r.component}
                  caption={T.byComponent}
                  columns={[
                    { key: 'component', header: T.cols.component, cell: (r) => r.component },
                    { key: 'n', header: T.cols.n, cell: (r) => r.n, align: 'right' },
                    { key: 'missing', header: T.mreMissing, cell: (r) => r.missing, align: 'right' },
                    { key: 'avg', header: T.cols.mre, cell: (r) => pct(r.avg), align: 'right', sort: (r) => r.avg },
                  ]}
                />
              </Panel>
              {c.mre.n > 0 && <Panel title={T.rowsTitle}>
                <DataTable
                  rows={c.mre.rows}
                  rowKey={(r) => `${r.estId}:${r.refId}`}
                  caption={T.rowsTitle}
                  columns={[
                    { key: 'est', header: T.cols.project, cell: (r) => <CostChip id={r.estId} /> },
                    { key: 'ref', header: T.cols.ref, cell: (r) => <RefChip id={r.refId} /> },
                    { key: 'e', header: T.cols.e, cell: (r) => mm(r.e), align: 'right' },
                    { key: 'actual', header: T.cols.actual, cell: (r) => mm(r.actual), align: 'right' },
                    { key: 'mre', header: T.cols.mre, cell: (r) => pct(r.mre), align: 'right', sort: (r) => r.mre },
                  ]}
                />
              </Panel>}
            </div>
          )}
          <Panel title={T.samplesTitle}>
            <DataTable
              rows={c.samples}
              rowKey={(x) => `${x.kind}:${x.id}`}
              caption={T.samplesTitle}
              columns={[
                { key: 'kind', header: T.cols.kind, cell: (x) => T.kind[x.kind], minor: true },
                { key: 'id', header: T.cols.sample, cell: (x) => (x.kind === 'single' ? <span><RefChip id={x.id} /> {x.nameKo ?? ''}</span> : x.id) },
                { key: 'eur', header: T.cols.eur, cell: (x) => eur(x.eur), align: 'right' },
                { key: 'pts', header: T.cols.pts, cell: (x) => mm(x.ptsAsil), align: 'right', minor: true },
                { key: 'per', header: T.cols.perPt, cell: (x) => eur(x.eurPerPt, 1), align: 'right', sort: (x) => x.eurPerPt },
              ]}
            />
          </Panel>
        </div>
      )}
    </AsyncView>
  );
}
