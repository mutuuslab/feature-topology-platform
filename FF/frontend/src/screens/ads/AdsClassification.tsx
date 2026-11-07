// Feature 분류·시장 기준선(ADS-UI12) — Feature Version 상세 '안전 분류' 탭의 ADS 분류 패널, Feature 등록(/master/define) 목록의 'ADS 분류' 열·미분류 핵심 메시지.
// 판정은 확정 여부만(contracts classificationCompleteness) — 추정(INFERRED)은 '추정 — 확정 전' 배지로 보이되 미분류로 센다.
// 출시 전이 거부 규칙은 분류 행이 있는 Version에서 켜진다(ADS-BE16) — 행이 없는 Version은 막힘 사유와 빈칸 목록만(기존 Feature 일괄 막힘 방지).
// 입력(Feature 작성자)·확정(기능안전 담당)·시장 기준선 입력(법규 담당)·지원 종료 연습(ADS-LC02)은 P5Panels.
import { type ClassificationView, type UnclassifiedRow, type UnclassifiedView } from '@ff/contracts';
import { CLASS_GAPS, LIFECYCLE_OWNER_STATES, LIFECYCLE_TO_OWNER_STATE } from '../../../../contracts/src/rules/ads-change';
import { asyncState, useApi } from '../../api/hooks';
import { adsChange } from '../../copy/ads-change';
import { AsyncView, IdChip, KeyValue, Panel, StatusGlyph, SummaryLine, type KeyMessageSpec } from '../../design';
import { BlockedAction, fmtAt, SimulatedDataNotice, TableScroll, UnknownMark, VerdictReason } from '../../design/ads';
import { usePermission } from '../shared';
import { BaselineAction, ClassificationActions, SupportDrillPanel } from './P5Panels';
import './ads-change.css';

const L = adsChange.cls;
const B = adsChange.baseline;
const PRE_RELEASE = new Set(['PROPOSED', 'APPROVED', 'DEVELOPING', 'VERIFIED']);

/** '추정 — 확정 전' 글자 배지 */
export function InferredTag() {
  return (
    <span className="adc-tag" data-tone="warn" data-inferred>
      <StatusGlyph kind="REVIEW" />
      {L.inferred}
    </span>
  );
}

/** 빈 축 글자 목록 — 빈칸·대시가 아니라 축 이름 */
export function GapList({ gaps }: { gaps: readonly string[] }) {
  return (
    <span className="adc-gaps" data-gaps={gaps.join(',')}>
      {gaps.map((g) => (
        <span key={g} className="adc-tag">
          {L.gap[g] ?? g}
        </span>
      ))}
    </span>
  );
}

/** 값이 없으면 '미분류' 글자 */
const orUnclassified = (v: string | null | undefined) => v ?? <span className="adc-tag" data-tone="warn">{L.unclassified}</span>;

/** Feature Version 상세 › 안전 분류 탭 — ADS 분류·Lifecycle 단계별 책임자·시장 기준선 */
export function AdsClassificationPanel({ id, ver, lifecycle }: { id: string; ver: string; lifecycle: string }) {
  const q = useApi<ClassificationView>('adsClassification', { params: { id, ver } });
  const editor = usePermission(['FEATURE_AUTHOR', 'SAFETY_OFFICER']);
  // 다른 응답 모양(시험 기본 응답 등)은 그리지 않는다
  const v = q.data?.completeness ? q.data : undefined;
  const c = v?.classification ?? null;
  const done = v?.completeness.classified ?? false;
  const nowState = LIFECYCLE_TO_OWNER_STATE[lifecycle];
  return (
    <AsyncView state={asyncState(q)} error={q.error ? L.error : null} onRetry={() => q.refetch()}>
      {v && (
        <div className="adc-stack" data-ads-classification={done ? 'classified' : 'unclassified'}>
          <Panel title={L.tab} id="ads-class">
            <div className="adc-stack">
              <div className="adc-row">
                {done ? (
                  <VerdictReason tone="ok" label={L.classified} reason={c?.confirmedAt ? L.confirmed(fmtAt(c.confirmedAt)) : undefined} />
                ) : (
                  <VerdictReason tone="danger" label={L.unclassified} reason={<GapList gaps={v.completeness.gaps} />} />
                )}
                {v.completeness.inferred ? <InferredTag /> : null}
              </div>
              <KeyValue
                rows={[
                  { k: L.ads, v: c?.adsFeature == null ? orUnclassified(null) : L.adsValue(c.adsFeature) },
                  { k: L.ddt, v: orUnclassified(c?.ddtImpact ? L.ddtValue[c.ddtImpact] : null) },
                  { k: L.safety, v: c?.safetyRelated == null ? orUnclassified(null) : L.safetyValue(c.safetyRelated) },
                  { k: L.owner, v: orUnclassified(c?.owner) },
                  { k: L.status, v: c?.status === 'CONFIRMED' ? L.classified : c ? L.draft : orUnclassified(null) },
                ]}
              />
              {!done && PRE_RELEASE.has(lifecycle) ? (
                <>
                  <BlockedAction label={L.releaseAction} reason={L.releaseBlocked} />
                  {v.ruleEnabled ? null : <p className="adc-note">{L.ruleOff}</p>}
                </>
              ) : null}
              <p className="adc-note">{L.countRule}</p>
              <ClassificationActions v={v} />
              {!editor.ok ? <p className="adc-note">{L.noPermission}</p> : null}
            </div>
          </Panel>
          <Panel title={L.lcOwners} id="ads-lc-owners">
            <TableScroll label={L.lcOwners}>
              <table className="ads-axes">
                <caption className="ads-axes__caption">{L.lcOwners}</caption>
                <thead>
                  <tr>
                    <th scope="col">{L.lcCol.state}</th>
                    <th scope="col">{L.lcCol.owner}</th>
                    <th scope="col">{L.lcCol.now}</th>
                  </tr>
                </thead>
                <tbody>
                  {LIFECYCLE_OWNER_STATES.map((s) => (
                    <tr key={s} data-lc-owner={s}>
                      <th scope="row">{L.lcState[s]}</th>
                      <td>{c?.lifecycleOwners?.[s] ?? <span className="adc-tag" data-tone="warn">{L.noOwner}</span>}</td>
                      <td>{nowState === s ? L.current : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
          {/* 시장 기준선 — 미분류 Feature는 출시 시장을 정하기 전이라 영역을 그리지 않는다 */}
          {(v.baselines ?? []).length || done ? (
          <Panel title={B.title} id="ads-baselines">
            {(v.baselines ?? []).length ? (
              <div className="adc-stack">
                <TableScroll label={B.caption}>
                  <table className="ads-axes">
                    <caption className="ads-axes__caption">{B.caption}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{B.market}</th>
                        <th scope="col">{B.type}</th>
                        <th scope="col">{B.regs}</th>
                        <th scope="col">{B.odd}</th>
                        <th scope="col">{B.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(v.baselines ?? []).map((b) => (
                        <tr key={b.market} data-market={b.market}>
                          <th scope="row">{b.market}</th>
                          <td>{B.typeValue[b.approvalType]}</td>
                          <td className="ads-mono">{b.regulations.map((r) => `${r.reg} ${r.series}`).join(' · ')}</td>
                          <td>{b.oddProfileRef ? <IdChip id={b.oddProfileRef} to="/config/odd" copy={false} /> : '—'}</td>
                          <td>
                            {b.approvalStatus === 'UNKNOWN' ? (
                              <UnknownMark kind="UNDECIDABLE" reason={B.unknownReason} />
                            ) : (
                              <VerdictReason tone={b.approvalStatus === 'APPROVED' ? 'ok' : 'warn'} label={B.statusValue[b.approvalStatus]} />
                            )}
                            {b.note ? <span className="adc-note"> {b.note}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
                <p className="adc-note">{B.source}</p>
                <BaselineAction v={v} />
                {(v.baselines ?? []).some((b) => b.assumed) ? <SimulatedDataNotice text={B.assumed} /> : null}
              </div>
            ) : (
              <p className="adc-note">{B.empty}</p>
            )}
          </Panel>
          ) : null}
          <SupportDrillPanel id={id} ver={ver} />
        </div>
      )}
    </AsyncView>
  );
}

/* ───────────── Feature 등록(/master/define) ───────────── */

export const useUnclassified = () => useApi<UnclassifiedView>('adsUnclassified');

/** /master/define 핵심 메시지 — 미분류 Feature N건 — 출시 전이 거부 규칙을 켜기 전 점검 */
export function unclassifiedMessage(v: UnclassifiedView | undefined): KeyMessageSpec | null {
  if (!v || !Array.isArray(v.items)) return null;
  return v.items.length ? { tone: 'warn', value: `${v.items.length}건`, text: adsChange.define.key } : null;
}

/** 축별 빈칸 수(배타 아님 — 보조 줄) */
export function GapSummary({ v }: { v: UnclassifiedView }) {
  const count = (g: string) => v.items.filter((x) => (x.gaps ?? []).includes(g as never)).length;
  return (
    <SummaryLine
      label={adsChange.define.gapCounts}
      items={[{ k: adsChange.define.gapCounts, v: adsChange.define.scope(v.scope) }, ...CLASS_GAPS.map((g) => ({ k: L.gap[g], v: count(g) })), { k: L.inferred, v: v.items.filter((x) => x.inferred).length }]}
    />
  );
}

/** 'ADS 분류' 열 — 미분류면 '미분류'와 빈 축 글자, 추정이면 배지 */
export function AdsClassCell({ row }: { row: UnclassifiedRow | undefined }) {
  if (!row)
    return (
      <span className="adc-tag" data-classified>
        <StatusGlyph kind="PASS" />
        {L.classified}
      </span>
    );
  return (
    <span className="adc-row" data-unclassified={row.featureId}>
      <span className="adc-tag" data-tone="warn">
        {L.unclassified}
      </span>
      <GapList gaps={row.gaps ?? []} />
      {row.inferred ? <InferredTag /> : null}
    </span>
  );
}
