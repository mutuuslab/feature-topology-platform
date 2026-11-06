// 확대 판정(ADS-UI11) — 정책 상세의 '확대 판정' 영역. 판정 4종(확대 가능·중단·확대 보류·동결)은 서버가 contracts expansionVerdict로 낸다(ADS-BE12 읽기).
// 노출량은 차량 보고 Active만 — 미확인 차량은 빼고 따로. 지표가 기준 시간을 넘기면 '확대 보류 — 지표 지연'. 조합별 근거는 접힘(판정을 막은 조합만 펼침).
// 이 정책의 Feature Version에 판정 입력이 없으면(404) 그리지 않는다. 동결 명령·확대 실행은 이 작업 밖(BlockedAction 사유만).
import type { ExpansionView } from '@ff/contracts';
import { useApi } from '../../api/hooks';
import { adsChange } from '../../copy/ads-change';
import { Panel, SummaryLine } from '../../design';
import { BlockedAction, fmtAt, FreshnessChip, SimulatedDataNotice, StageCounts, VerdictReason, type VerdictTone } from '../../design/ads';
import { usePermission } from '../shared';
import './ads-change.css';

const E = adsChange.exp;
const TONE: Record<string, VerdictTone> = { EXPAND: 'ok', STOP: 'danger', HOLD: 'warn', FROZEN: 'neutral' };

const delayText = (ms: number) => (ms >= 3600_000 ? E.hours(Math.round(ms / 3600_000)) : E.minutes(Math.round(ms / 60_000)));

export function ExpansionPanel({ policyId }: { policyId: string }) {
  const q = useApi<ExpansionView>('adsPolicyExpansion', { params: { id: policyId } }, { retry: false });
  const perm = usePermission(['RELEASE_MANAGER', 'OPS_LEAD']);
  const v = q.data?.result ? q.data : null;
  if (!v) return null;
  const r = v.result;
  const reason = r.reason === 'METRIC_DELAY' ? E.delay(delayText(r.maxDelayMs)) : E.reason[r.reason];
  const staleMin = Math.round(Math.min(...v.metrics.map((m) => m.staleAfterMs)) / 60_000);
  const blocking = new Set(r.combos.filter((c) => c.verdict !== 'OK').map((c) => c.comboId));
  return (
    <Panel title={E.title} id="ads-expansion">
      <div className="adc-stack" data-expansion={r.verdict}>
        <VerdictReason tone={TONE[r.verdict]} label={E.verdict[r.verdict]} reason={reason} code={r.reason} />
        <SummaryLine
          items={[
            { k: E.active, v: `${v.vehicleActive.toLocaleString('ko-KR')}대` },
            { k: E.unconfirmed, v: `${v.unconfirmed.toLocaleString('ko-KR')}대` },
            { k: E.allowed, v: `${v.policyAllowed.toLocaleString('ko-KR')}대` },
          ]}
        />
        <StageCounts
          caption={E.exposure}
          total={v.vehicleActive + v.unconfirmed}
          segments={[
            { key: 'active', label: E.active, count: v.vehicleActive, tone: 'ok' },
            { key: 'unconfirmed', label: E.unconfirmed, count: v.unconfirmed, tone: 'unknown', note: E.unconfirmedNote },
          ]}
        />
        <table className="ads-axes">
          <caption className="ads-axes__caption">{E.metrics}</caption>
          <tbody>
            {v.metrics.map((m) => (
              <tr key={m.key} data-metric={m.key}>
                <th scope="row">{E.metricName[m.key] ?? m.key}</th>
                <td className="ads-mono">{E.metricValue(m.value, m.threshold)}</td>
                <td>{m.breached ? <VerdictReason tone="danger" label={E.breached} /> : null}</td>
                <td>
                  <FreshnessChip state={r.staleMetrics.includes(m.key) ? 'DELAYED' : m.observedAt ? 'FRESH' : 'UNOBSERVED'} observedAt={m.observedAt} staleAfterMs={m.staleAfterMs} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <details className="adc-combos" open={blocking.size > 0}>
          <summary>
            {E.combos} · {E.combosHint}
          </summary>
          <table className="ads-axes">
            <caption className="ads-axes__caption">{E.combos}</caption>
            <thead>
              <tr>
                <th scope="col">{E.comboCol.combo}</th>
                <th scope="col">{E.comboCol.active}</th>
                <th scope="col">{E.comboCol.usage}</th>
                <th scope="col">{E.comboCol.errors}</th>
                <th scope="col">{E.comboCol.samples}</th>
                <th scope="col">{E.comboCol.window}</th>
                <th scope="col">{E.comboCol.verdict}</th>
              </tr>
            </thead>
            <tbody>
              {v.combos.map((c) => {
                const cv = r.combos.find((x) => x.comboId === c.comboId)?.verdict ?? 'OK';
                return (
                  <tr key={c.comboId} data-combo={cv}>
                    <th scope="row">{c.comboId}</th>
                    <td className="ads-mono">{c.vehicleActive.toLocaleString('ko-KR')}</td>
                    <td className="ads-mono">{c.usageConfirmed.toLocaleString('ko-KR')}</td>
                    <td className="ads-mono">{c.errors}</td>
                    <td className="ads-mono">{`${c.samples.toLocaleString('ko-KR')} / ${c.minSamples.toLocaleString('ko-KR')}`}</td>
                    <td>{E.hours(c.windowHours)}</td>
                    <td>
                      <VerdictReason tone={cv === 'OK' ? 'ok' : cv === 'ALERT' ? 'danger' : 'warn'} label={E.comboVerdict[cv]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
        <p className="adc-note">{v.frozen ? E.frozen(v.frozen.reason, v.frozen.scope, v.frozen.by, fmtAt(v.frozen.at)) : E.notFrozen}</p>
        {r.verdict !== 'EXPAND' ? <BlockedAction label={E.action} reason={r.reason === 'METRIC_DELAY' ? E.blockedDelay(staleMin) : E.blockedOther(reason)} /> : null}
        {!perm.ok ? <p className="adc-note">{E.noPermission}</p> : null}
        {v.assumed ? <SimulatedDataNotice /> : null}
      </div>
    </Panel>
  );
}
