// OTA 설치 단계 /ops/ota-installs (ADS-OTA01 · IF-05 설치 보고) — 차량별 선형 5단계 + 갈림 상태 줄, 실패 원인(전원·통신·검증) 따로, 6축 '구성과 설치' 요약 값.
// 설치 원장은 OTA 원장(외부 위임) — 모의 보고면 SimulatedDataNotice. '설치 확인됨'은 차량 형상 보고가 매니페스트와 맞을 때만, 운행 제한은 '예상' 글자(완료 시각 약속 없음).
import { useSearchParams } from 'react-router-dom';
import { asyncState, useApi } from '../../api/hooks';
import { install as I } from '../../copy/ads-p5';
import { AsyncView, DataTable, Drawer, KeyValue, PageHeader, Panel, type KeyMessageSpec } from '../../design';
import { fmtAt, relAgo, SimulatedDataNotice, UnknownMark, VerdictReason } from '../../design/ads';
import { InstallStrip, type InstallViewModel } from './P5Panels';
import './ads-config.css';

interface Item {
  vin: string;
  label: string;
  stage: string | null;
  label2: string;
  step: number;
  branch: { kind: string; text: string } | null;
  confirmed: boolean;
  stale: boolean;
  lastAt: string | null;
  axis: string;
  failureKind: string | null;
  restriction: string | null;
  reactivation: { eligible: boolean; reason: string } | null;
}
interface ListResp {
  items: Item[];
  failures: { POWER: number; LINK: number; VERIFY: number };
  summary: { vehicles: number; confirmed: number; partialFailure: number; recoveryNeeded: number; stale: number };
}
interface VehicleResp {
  vin: string;
  view: InstallViewModel & { customerNotice: string | null };
  axis: string;
  manifest: { confirmed: boolean; partial: boolean; missing: string[] };
  reactivation: { eligible: boolean; reason: string } | null;
  history: { installId: string; stage: string; at: string; source: string }[];
  source: string | null;
}

function keyMessage(s: ListResp['summary'] | undefined): KeyMessageSpec {
  if (!s) return { tone: 'neutral', text: I.loading };
  const bad = s.partialFailure + s.recoveryNeeded;
  return { tone: bad ? 'warn' : 'ok', text: I.key(s.confirmed, bad) };
}

export default function OtaInstallsScreen() {
  const q = useApi<ListResp>('otaInstalls');
  const [sp, setSp] = useSearchParams();
  const vin = sp.get('vin');
  const items = q.data?.items ?? [];
  const f = q.data?.failures;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D04-01 · ADS-OTA01"
        title={I.title}
        lead={I.lead}
        message={keyMessage(q.data?.summary)}
        meta={
          <span className="adsc-row">
            <span className="adsc-tag" data-ext-ref>{I.ledger}</span>
            {f ? <span className="adsc-sub" data-install-failures>{`${I.failures}: ${I.failureRow(f.POWER, f.LINK, f.VERIFY)}`}</span> : null}
          </span>
        }
      />
      <SimulatedDataNotice text={I.simulated} />
      <Panel title={I.caption} id="ota-installs">
        <AsyncView state={asyncState(q, items.length === 0)} error={q.error ? I.error : null} onRetry={() => q.refetch()} empty={I.empty}>
          <DataTable
            caption={I.caption}
            rows={items}
            pageSize={0}
            rowKey={(r) => r.vin}
            onOpen={(r) => setSp({ vin: r.vin }, { replace: true })}
            columns={[
              { key: 'v', header: I.vin, cell: (r) => <span className="ds-mono">{r.vin}</span> },
              { key: 's', header: I.stage, cell: (r) => (r.stale ? <UnknownMark kind="UNCONFIRMED" reason={r.label2} /> : `${I.stepOf(r.step, 5)} · ${r.label2}`) },
              { key: 'b', header: I.branch, cell: (r) => (r.branch ? <VerdictReason tone={r.branch.kind === 'DEFERRED' ? 'neutral' : 'danger'} label={r.branch.text} /> : '—') },
              { key: 'a', header: I.axis, cell: (r) => I.axisValue[r.axis] ?? r.axis },
              { key: 'e', header: I.reactivation, cell: (r) => (r.reactivation ? <VerdictReason tone={r.reactivation.eligible ? 'ok' : 'warn'} label={r.reactivation.eligible ? I.ok : r.reactivation.reason} /> : '—') },
              { key: 'l', header: I.last, cell: (r) => (r.lastAt ? relAgo(r.lastAt) : '—') },
            ]}
          />
        </AsyncView>
      </Panel>
      <Drawer open={!!vin} title={vin ? I.detail(vin) : ''} onClose={() => setSp({}, { replace: true })}>
        {vin ? <InstallDetail vin={vin} /> : null}
      </Drawer>
    </div>
  );
}

/** 차량 한 대 설치 단계 — 차량 화면에서도 쓴다 */
export function InstallDetail({ vin }: { vin: string }) {
  const q = useApi<VehicleResp>('vehicleInstalls', { params: { vin } });
  const d = q.data;
  return (
    <AsyncView state={asyncState(q)} error={q.error ? I.error : null} onRetry={() => q.refetch()}>
      {d?.view ? (
        <div className="adsc-stack" data-install-detail={vin}>
          <InstallStrip view={d.view} />
          <KeyValue
            rows={[
              { k: I.axis, v: I.axisValue[d.axis] ?? d.axis },
              { k: I.restriction, v: d.view.customerNotice ?? '—' },
              { k: I.reactivation, v: d.reactivation ? <VerdictReason tone={d.reactivation.eligible ? 'ok' : 'warn'} label={d.reactivation.eligible ? I.ok : d.reactivation.reason} /> : '—' },
              { k: I.last, v: d.view.lastAt ? fmtAt(d.view.lastAt) : '—' },
            ]}
          />
          <p className="adsc-note">{I.manifest(d.manifest.confirmed, d.manifest.missing.join('·'))}</p>
          <details>
            <summary>{I.history}</summary>
            <ul className="adsc-list">
              {d.history.map((h, i) => (
                <li key={i} className="ds-mono">{`${h.installId} · ${h.stage} · ${fmtAt(h.at)} · ${h.source}`}</li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
    </AsyncView>
  );
}
