// 긴급 차단 화면의 사건 단위 패널(P11a) — 차단 요청 접수함(외부 시스템·중단 필요), 사건별 종료 차단(ADS-BE02·UI02),
// 영향 차량 3분류(ADS-BE21), 종료 결과 분포(핵심 메시지 '종료 결과 미확인 차량 N대'), 복원 3단 상태(복구 검증·종료 차단 해제·활성화 가능 여부).
// 조회가 비거나 실패하면 패널을 그리지 않는다(시연 화면에 빈 상자를 두지 않는다).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { terminationSummary, TERMINATION_OUTCOMES } from '../../../../contracts/src/rules/kill-scope';
import { useApi, useApiMutation } from '../../api/hooks';
import { killScope as S } from '../../copy/kill-scope';
import { Button, DataTable, ErrorNote, Field, KeyValue, Panel } from '../../design';
import { usePermission, when } from '../shared';

interface Intake {
  intakeId: string;
  source: 'EXTERNAL' | 'ANOMALY';
  status: string;
  featureId: string;
  featureVersion: string;
  reason: string;
  vins: string[];
  anomalyId: string | null;
  externalRef: string | null;
  receivedAt: string;
}

/** 차단 요청 접수함 — 검토 대기(RECEIVED)만. 옮기기는 새 차단 요청 폼을 그 Feature·접수로 연다 */
export function IntakeQueue() {
  const q = useApi<{ items: Intake[] }>('killIntakes', { query: { status: 'RECEIVED' } });
  const perm = usePermission(['OPERATOR', 'SAFETY_OFFICER']);
  const dismiss = useApiMutation('dismissKillIntake', ['killIntakes']);
  const [closing, setClosing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const rows = q.data?.items ?? [];
  if (!rows.length) return null;
  return (
    <Panel title={S.intake.title} id="kill-intake">
      <p className="ds-field__hint">{S.intake.lead}</p>
      <DataTable
        caption={S.intake.title}
        rows={rows}
        rowKey={(i) => i.intakeId}
        columns={[
          { key: 'id', header: S.intake.col.id, cell: (i) => <span className="ds-mono ds-nowrap">{i.intakeId}</span> },
          { key: 's', header: S.intake.col.source, cell: (i) => (i.source === 'ANOMALY' && i.anomalyId ? <Link to={`/ops/anomalies?id=${i.anomalyId}`}>{`${S.intake.source.ANOMALY} · ${i.anomalyId}`}</Link> : `${S.intake.source.EXTERNAL}${i.externalRef ? ` · ${i.externalRef}` : ''}`) },
          { key: 'f', header: S.intake.col.feature, cell: (i) => <span className="ds-mono">{i.featureId}</span> },
          { key: 'v', header: S.intake.col.vehicles, cell: (i) => <span className="ds-mono">{i.vins.length}</span> },
          { key: 'r', header: S.intake.col.reason, cell: (i) => i.reason },
          { key: 'a', header: S.intake.col.at, cell: (i) => when(i.receivedAt) },
          {
            key: 'x',
            header: S.intake.col.action,
            cell: (i) => (
              <span style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                <Link className="ds-btn ds-btn--primary" to={`/ops/kill?featureId=${i.featureId}&version=${i.featureVersion}&intake=${i.intakeId}${i.anomalyId ? `&anomaly=${i.anomalyId}` : ''}`}>
                  {S.intake.convert}
                </Link>
                <Button disabled={!perm.ok} title={perm.hint} onClick={() => (setClosing(i.intakeId), setReason(''))}>
                  {S.intake.dismiss}
                </Button>
              </span>
            ),
          },
        ]}
      />
      {closing && (
        <div style={{ display: 'grid', gap: 'var(--sp-2)' }} data-testid="intake-dismiss">
          <Field label={S.intake.dismissReason}>
            <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={dismiss.error} />
          <Button disabled={reason.trim().length < 2 || dismiss.isPending} onClick={() => dismiss.mutate({ params: { id: closing }, body: { reason } }, { onSuccess: () => setClosing(null) })}>
            {S.intake.dismiss} — {closing}
          </Button>
        </div>
      )}
    </Panel>
  );
}

interface InhibitView {
  incidents: { incidentId: string; featureId: string; killId: string; active: number; released: number; setAt: string; releasedAt: string | null }[];
  vehicles: { vin: string; incidents: string[] }[];
}

/** 사건별 종료 차단 — 이 Feature의 사건 → 차량 수·설정·해제 시각, 이 차단 차량 중 다른 사건 차단이 남는 차량 */
export function IncidentInhibits({ featureId, incidentId, vins }: { featureId: string; incidentId: string; vins: string[] }) {
  const q = useApi<InhibitView>('terminationInhibits', { query: { featureId } });
  const d = q.data;
  if (!d?.incidents.length) return null;
  const mine = new Set(vins);
  const held = d.vehicles.filter((v) => mine.has(v.vin) && v.incidents.some((i) => i !== incidentId));
  const C = S.incident.col;
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-1)', minWidth: 0 }} data-testid="kill-incidents">
      <DataTable
        caption={S.incident.title}
        rows={d.incidents}
        rowKey={(i) => `${i.incidentId}/${i.featureId}`}
        columns={[
          { key: 'i', header: C.incident, cell: (i) => <span className="ds-mono ds-nowrap" title={i.incidentId === incidentId ? S.incident.mine(i.incidentId) : i.killId}>{i.incidentId === incidentId ? `● ${i.incidentId}` : i.incidentId}</span> },
          { key: 'f', header: C.feature, cell: (i) => <span className="ds-mono">{i.featureId}</span> },
          { key: 'a', header: C.active, cell: (i) => <span className="ds-mono">{i.active}</span> },
          { key: 'r', header: C.released, cell: (i) => <span className="ds-mono">{i.released}</span> },
          { key: 's', header: C.setAt, cell: (i) => when(i.setAt) },
          { key: 't', header: C.releasedAt, cell: (i) => (i.releasedAt ? when(i.releasedAt) : S.incident.none) },
        ]}
      />
      {!!held.length && (
        <p className="ds-stale" role="status" data-testid="held-by-other">
          {S.incident.heldByOther(held.map((h) => `${h.vin}(${h.incidents.filter((i) => i !== incidentId).join(', ')})`).join(', '))}
        </p>
      )}
    </div>
  );
}

interface ImpactView {
  current: { setId: string; configAsOf: string | null; counts: Record<string, number> } | null;
  history: unknown[];
  accuracy: { status: 'UNKNOWN' | 'KNOWN'; value: number | null; candidates: number; confirmed: number; matched: number };
}

/** 영향 차량 산정 — 후보·구성 미확인·통신 미수신 3열과 식별 정확도 */
export function ImpactSetPanel({ incidentId }: { incidentId: string }) {
  const q = useApi<ImpactView>('impactSet', { params: { id: incidentId } });
  const d = q.data;
  if (!d?.current) return null;
  const c = d.current.counts;
  return (
    <div data-testid="kill-impact">
      <KeyValue
        rows={[
          ...(['CANDIDATE', 'CONFIG_UNKNOWN', 'NO_CONTACT'] as const).map((k) => ({ k: S.impact.cls[k], v: <span className="ds-mono">{c[k] ?? 0}</span> })),
          {
            k: S.impact.accuracy,
            v: d.accuracy.status === 'KNOWN' && d.accuracy.value != null ? S.impact.accuracyValue(Math.round(d.accuracy.value * 100), d.accuracy.matched, d.accuracy.candidates) : S.impact.accuracyUnknown,
            note: `${d.current.configAsOf ? S.impact.asOf(when(d.current.configAsOf)) : ''} · ${S.impact.history(d.history.length)}`,
          },
        ]}
      />
    </div>
  );
}

interface TimelineView {
  items: { vin: string; deactivate: { accepted: { trust: 'TRUSTED' | 'UNCERTAIN' } | null; completed: { trust: 'TRUSTED' | 'UNCERTAIN' } | null; mrc: { trust: 'TRUSTED' | 'UNCERTAIN' } | null } | null; uncertain: string[] }[];
}

/** 핵심 메시지 — 종료 결과 미확인 차량 N대, 배타 구간 분포(MRC 도달·비활성 확인·전환 중·미수신·시간 초과·증거 부족) */
export function TerminationOutcome({ killId, deadlinePassed }: { killId: string; deadlinePassed: boolean }) {
  const q = useApi<TimelineView>('killTimeline', { params: { id: killId } });
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  const s = terminationSummary(items as never, deadlinePassed);
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-1)' }} data-testid="kill-outcome" data-unconfirmed={s.unconfirmed}>
      <p className={s.unconfirmed ? 'ds-stale' : 'ds-field__hint'} role="status" style={{ margin: 0, fontWeight: 600 }}>
        {s.unconfirmed ? S.outcome.key(s.unconfirmed) : S.outcome.allConfirmed(s.total)}
      </p>
      <p className="ds-field__hint" style={{ margin: 0 }}>
        {TERMINATION_OUTCOMES.filter((o) => s.counts[o])
          .map((o) => `${S.outcome.label[o]} ${s.counts[o]}`)
          .join(' · ')}
      </p>
    </div>
  );
}

/** 복원 3단 표시 — 복구 검증 완료 / 종료 차단 해제 / 현재 활성화 가능(활성화 불가도 정상) */
export function RestoreThreeState({ verified, released, activatable }: { verified: boolean; released: boolean; activatable: boolean }) {
  const yn = (b: boolean) => (b ? S.restore3.yes : S.restore3.no);
  return (
    <div data-testid="restore-3state">
      <KeyValue
        rows={[
          { k: S.restore3.verified, v: yn(verified) },
          { k: S.restore3.released, v: yn(released) },
          { k: S.restore3.activatable, v: yn(activatable), note: S.restore3.note },
        ]}
      />
    </div>
  );
}
