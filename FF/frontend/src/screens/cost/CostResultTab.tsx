// 산정 결과 탭 — 엑셀 01_대시보드: 원가 구성, 신뢰수준별 금액, AACE 추정 범위, 벤치마크 대비, 입력 품질, 산정 경로.
// 금액 칸은 서버가 산정 역할에만 준다 — 없으면 공수만 보인다. 금액은 과제 통화로 환산 표시(D-COST-10).
import { costResult as T } from '../../copy/cost';
import { DataTable, KeyValue, Panel } from '../../design';
import { mm, money, pct, type CostDetailResponse } from './common';

export function CostResultTab({ d }: { d: CostDetailResponse }) {
  const r = d.result;
  if (!r) return <p className="ds-field__hint">{`${T.error}: ${d.error ?? ''}`}</p>;
  const t = r.totals;
  const cur = d.project.currency;
  const fx = d.fx;
  const $ = (x: number | undefined) => money(x, cur, fx);
  const full = r.view === 'FULL';
  const c = r.counts;
  return (
    <div className="ds-stack">
      <div className="ds-split">
        <Panel title={T.totals}>
          <KeyValue
            rows={[
              { k: T.rows.eFeat, v: mm(t.eFeat) },
              { k: T.rows.common, v: mm(r.common?.mm) },
              { k: T.rows.totalMm, v: mm(t.totalMm) },
              ...(full
                ? [
                    { k: T.rows.labor, v: $(t.laborKrw) },
                    { k: T.rows.overhead, v: $(t.overheadKrw), note: pct(r.factors?.oh) },
                    { k: T.rows.fee, v: $(t.feeKrw), note: pct(r.factors?.fee) },
                    { k: T.rows.direct, v: $(t.directKrw) },
                    { k: T.rows.base, v: $(t.baseCost) },
                    { k: T.rows.reserve, v: $(t.reserveKrw), note: d.project.settings.confidence },
                    { k: T.rows.total, v: <b>{$(t.totalCost)}</b> },
                    { k: T.rows.vat, v: $(t.vatKrw) },
                    { k: T.rows.withVat, v: $(t.totalWithVat) },
                  ]
                : []),
            ]}
          />
        </Panel>
        <Panel title={T.quality}>
          <KeyValue
            rows={[
              { k: T.qualityRows.selected, v: c.selected },
              { k: T.qualityRows.bundled, v: c.bundleIncluded },
              { k: T.qualityRows.checks, v: c.checks },
              { k: T.qualityRows.commonMissing, v: c.commonMissing },
              { k: T.qualityRows.notOwned, v: c.notOwned },
              { k: T.qualityRows.evidence, v: pct(r.sizeEvidenceShare.A + r.sizeEvidenceShare.B) },
              { k: T.qualityRows.mre, v: c.actuals ? pct(c.mreAvg) : '—' },
            ]}
          />
          <KeyValue
            rows={[
              { k: T.pathRows.tshirt, v: c.tshirt },
              { k: T.pathRows.mbd, v: c.mbd },
              { k: T.pathRows.direct, v: c.direct },
            ]}
          />
        </Panel>
      </div>
      {full && r.confidenceTable && r.aaceRange && r.benchmark && (
        <div className="ds-split">
          <Panel title={T.confidence}>
            <DataTable
              rows={r.confidenceTable}
              rowKey={(x) => x.level}
              caption={T.confidence}
              columns={[
                { key: 'level', header: T.confidenceCols.level, cell: (x) => (x.level === d.project.settings.confidence ? <b>{x.level}</b> : x.level) },
                { key: 'amount', header: T.confidenceCols.amount, cell: (x) => $(x.amount), align: 'right' },
                { key: 'vs', header: T.confidenceCols.vs, cell: (x) => pct(x.vsBase), align: 'right' },
              ]}
            />
          </Panel>
          <div className="ds-stack">
            <Panel title={T.aace(d.project.settings.aace)}>
              <KeyValue
                rows={r.aaceRange.map((x, i) => ({ k: `${i < 2 ? T.aaceLow : T.aaceHigh} ${pct(x.ratio)}`, v: $(x.amount) }))}
              />
            </Panel>
            <Panel title={T.bench}>
              <KeyValue
                rows={[
                  { k: T.benchRows.eur, v: `€ ${Math.round(r.benchmark.eur).toLocaleString('ko-KR')}` },
                  { k: T.benchRows.krw, v: $(r.benchmark.krw) },
                  { k: T.benchRows.gap, v: pct(r.benchmark.gap) },
                ]}
              />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
