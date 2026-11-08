import { permissionRoleLabels as ROLE_LABEL } from '../../data/refdata';
// 변경 영향 — 승인 경로(ADS-UI09·BE08)와 릴리스 비교. /analysis/impact의 '승인 경로'·'릴리스 비교' 탭, 정책·Feature Version의 변경 종류 배지·링크·배포 서명 막힘 사유.
// 변경 종류는 서버가 diff 사실로 산출한다(contracts classifyChange). 판단 불가는 정책 변경으로 가볍게 두지 않고 따로 센다.
// 출시 뒤 열린 재-HARA가 배포·서명을 실제로 막는 서버 거부는 결함 ADS-BE06(다른 작업) — 화면은 읽은 데이터로 사유만 보인다.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type AdsChangeImpactList, type AdsChangeImpactView, type AdsImpactPath, type AdsImpactPathItem, type DiffDirection, type OddAxisValue, type ReleaseDiffRow, type ReleaseDiffView, type ReleaseListItem } from '@ff/contracts';
import { ADS_IMPACT_PATHS, PATH_CLOSER } from '../../../../contracts/src/rules/ads-change';
import { rolesFor } from '../../api/actor';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { adsChange as C } from '../../copy/ads-change';
import { ads } from '../../copy/ads';
import { AsyncView, Button, Drawer, ErrorNote, Field, IdChip, Panel, Select, StatusGlyph, SummaryLine, type KeyMessageSpec } from '../../design';
import { BlockedAction, ChangeKindBadge, fmtAt, relAgo, SimulatedDataNotice, TableScroll, UnknownMark } from '../../design/ads';
import { usePermission } from '../shared';
import './ads-change.css';

const R = C.release;
const INVALIDATE = ['adsChangeImpacts', 'audit'];

/** 승인 경로 목록 — 탭과 머리 핵심 메시지가 같은 조회를 쓴다 */
export const useChangeImpacts = (enabled = true, featureId?: string) =>
  useApi<AdsChangeImpactList>('adsChangeImpacts', { query: { featureId } }, { enabled });

/** '승인 경로' 탭 핵심 메시지 — 끝나지 않은 승인 경로 N건 — 재-HARA a · R156 영향 평가 b · SUMS c */
export function pathsMessage(d: AdsChangeImpactList | undefined): KeyMessageSpec {
  if (!d?.counts) return { tone: 'neutral', value: '—', text: C.key.loading };
  const c = d.counts;
  if (!c.total) return { tone: 'ok', text: C.key.pathsClean };
  return { tone: 'warn', value: `${c.total}건`, text: C.key.paths(c.REHARA, c.R156, c.SUMS, c.SAFETY_CASE) };
}

/** '릴리스 비교' 탭 핵심 메시지 — 운행 조건 확대 수 */
export function releaseMessage(d: ReleaseDiffView | undefined): KeyMessageSpec {
  if (!d?.summary) return { tone: 'neutral', value: '—', text: R.kind };
  const w = d.summary.widened;
  return w
    ? { tone: 'warn', value: `${w}건`, text: C.key.release(d.name, d.after.version, d.before.version) }
    : { tone: 'ok', text: C.key.releaseNone(d.name, d.after.version, d.before.version) };
}

/* ───────────── 승인 경로 탭 ───────────── */

function PathCell({ p }: { p: AdsImpactPathItem }) {
  const glyph = p.status === 'OPEN' ? 'REVIEW' : p.status === 'DONE' ? 'PASS' : 'NA';
  return (
    <div className="adc-path" data-status={p.status} data-path={p.path}>
      <span className="adc-path__state">
        <StatusGlyph kind={glyph} />
        {C.pathStatus[p.status]}
      </span>
      {p.status === 'OPEN' && p.note ? <span className="adc-note">{p.note}</span> : null}
      {p.status === 'OPEN' ? <span className="adc-note">{C.closer(ROLE_LABEL[p.closer])}</span> : null}
      {p.status === 'DONE' && p.closedAt ? <span className="adc-note">{C.closedAt(ROLE_LABEL[p.closer], `${relAgo(p.closedAt)} · ${fmtAt(p.closedAt)}`)}</span> : null}
    </div>
  );
}

function KindCell({ v }: { v: AdsChangeImpactView }) {
  if (v.cls.primary === 'UNKNOWN')
    return (
      <div className="adc-path">
        <ChangeKindBadge kind="UNKNOWN" />
        <UnknownMark kind="UNDECIDABLE" reason={C.undecidableReason} />
      </div>
    );
  return (
    <div className="adc-path">
      <span className="adc-row">
        {v.cls.kinds.map((k) => (
          <ChangeKindBadge key={k} kind={k} />
        ))}
      </span>
      {v.cls.escalated && v.declaredKind ? <span className="adc-note">{C.escalated(ads.ui.changeKind[v.declaredKind])}</span> : null}
    </div>
  );
}

/** 출시 뒤 열린 재-HARA 수 — 경로 표의 열린 재-HARA와 기존 재-HARA 요청 */
export const reharaAfterRelease = (v: AdsChangeImpactView) =>
  v.reharaOpenAfterRelease ? Math.max(v.paths.some((p) => p.path === 'REHARA' && p.status === 'OPEN') ? 1 : 0, v.reharaRequestIds.length) : 0;

/** 배포 서명 — 출시 뒤 열린 재-HARA가 있으면 버튼 대신 사유(BlockedAction). 서버 거부는 ADS-BE06이 맞춘다 */
export function SignAction({ v }: { v: AdsChangeImpactView }) {
  const k = reharaAfterRelease(v);
  if (!k) return null;
  return <BlockedAction label={C.sign} reason={C.signBlocked(k)} />;
}

export function ApprovalPathsTab() {
  const q = useChangeImpacts();
  const closer = usePermission(['SAFETY_OFFICER', 'SECURITY_OFFICER']);
  const mine = rolesFor(closer.role);
  const [closing, setClosing] = useState<{ v: AdsChangeImpactView; p: AdsImpactPath } | null>(null);
  const d = q.data?.counts ? q.data : undefined;
  const known = (d?.items ?? []).filter((v) => v.cls.primary !== 'UNKNOWN');
  return (
    <AsyncView state={asyncState(q, (d?.items.length ?? 0) === 0)} error={q.error ? C.error : null} onRetry={() => q.refetch()} empty={{ title: C.empty }}>
      {d && (
        <div className="adc-stack" data-ads-paths>
          <SummaryLine
            items={[
              { k: C.rejudge, v: d.rejudgeGates },
              { k: C.undecidableCount, v: d.counts.undecidable },
              { k: C.reviewRequired, v: d.items.filter((x) => x.scopeStatus === 'REVIEW_REQUIRED').length },
            ]}
          />
          <Panel id="ads-paths">
            <TableScroll label={C.table}>
              <table className="ads-axes">
                <caption className="ads-axes__caption">{C.table}</caption>
                <thead>
                  <tr>
                    <th scope="col">{C.col.change}</th>
                    <th scope="col">{C.col.kind}</th>
                    {ADS_IMPACT_PATHS.map((p) => (
                      <th key={p} scope="col">
                        {C.path[p]}
                      </th>
                    ))}
                    <th scope="col">{C.col.owner}</th>
                    <th scope="col">{C.col.opened}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((v) => (
                    <tr key={v.impactId} data-impact={v.impactId} data-change-kind={v.cls.primary}>
                      <th scope="row">
                        <div className="adc-path">
                          <span>{v.title}</span>
                          <span className="adc-row">
                            <IdChip id={v.featureId} version={v.version} to={`/features/${v.featureId}/${v.version}`} copy={false} />
                            <span className="adc-note">{v.name}</span>
                          </span>
                          {v.reharaRequestIds.length ? <span className="adc-note">{C.reharaReq(v.reharaRequestIds.join(', '))}</span> : null}
                        </div>
                      </th>
                      <td>
                        <KindCell v={v} />
                      </td>
                      {v.paths.map((p) => (
                        <td key={p.path}>
                          {v.cls.primary === 'UNKNOWN' ? (
                            <UnknownMark kind="UNDECIDABLE" />
                          ) : (
                            <>
                              <PathCell p={p} />
                              {p.status === 'OPEN' && closer.ok && mine.includes(p.closer) ? (
                                <Button variant="ghost" onClick={() => setClosing({ v, p: p.path })}>
                                  {C.close}
                                </Button>
                              ) : null}
                            </>
                          )}
                        </td>
                      ))}
                      <td>{v.assignee ?? '—'}</td>
                      <td className="ads-mono">{relAgo(v.openedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
          {known.filter((v) => reharaAfterRelease(v) > 0).map((v) => (
            <div key={v.impactId} className="adc-row" data-sign-blocked={v.impactId}>
              <IdChip id={v.featureId} version={v.version} copy={false} />
              <SignAction v={v} />
            </div>
          ))}
          {!closer.ok ? <p className="adc-note">{C.noPermission}</p> : null}
          <dl className="adc-gloss" aria-label={C.glossary}>
            {ADS_IMPACT_PATHS.map((p) => (
              <div key={p}>
                <dt>{C.path[p]}</dt>
                <dd>{C.pathLong[p]}</dd>
              </div>
            ))}
          </dl>
          <SimulatedDataNotice text={C.assumed} />
        </div>
      )}
      <CloseDrawer target={closing} onClose={() => setClosing(null)} />
    </AsyncView>
  );
}

function CloseDrawer({ target, onClose }: { target: { v: AdsChangeImpactView; p: AdsImpactPath } | null; onClose: () => void }) {
  const m = useApiMutation<AdsChangeImpactView>('adsCloseImpactPath', INVALIDATE);
  const [reason, setReason] = useState('');
  const [ref, setRef] = useState('');
  return (
    <Drawer open={!!target} title={target ? C.closeTitle(C.path[target.p], target.v.impactId) : ''} onClose={onClose} dirty={!!reason}>
      {target && (
        <form
          className="adc-stack"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate({ params: { id: target.v.impactId, path: target.p }, actorRole: PATH_CLOSER[target.p], body: { reason, ...(ref.trim() && { ref: ref.trim() }) } }, { onSuccess: () => (setReason(''), setRef(''), onClose()) });
          }}
        >
          <p className="adc-note">{C.pathLong[target.p]}</p>
          <Field label={C.closeReason}>
            <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label={C.closeRef}>
            <input className="ds-input ds-input--mono" value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
          <ErrorNote error={m.error} />
          <Button type="submit" variant="primary" disabled={reason.trim().length < 2 || m.isPending}>
            {C.closeSubmit}
          </Button>
        </form>
      )}
    </Drawer>
  );
}

/* ───────────── 릴리스 비교 탭 ───────────── */

/** 고른 릴리스 — ?release=FEAT-xxxxx-버전, 없으면 목록 첫 행 */
export function useReleasePick(enabled = true) {
  const [sp] = useSearchParams();
  const list = useApi<{ items: ReleaseListItem[] }>('adsReleases', {}, { enabled });
  const items = Array.isArray(list.data?.items) ? list.data!.items : [];
  const id = sp.get('release') ?? items[0]?.releaseId ?? '';
  const diff = useApi<ReleaseDiffView>('adsReleaseDiff', { params: { id } }, { enabled: enabled && !!id });
  return { list, items, id, diff };
}

const showValue = (v: unknown): string => {
  if (v == null) return R.none;
  if (typeof v === 'boolean') return v ? R.yes : R.no;
  if (Array.isArray(v)) return v.length ? v.join(' · ') : R.none;
  if (typeof v === 'object' && 'min' in (v as object)) {
    const r = v as Exclude<OddAxisValue, null | boolean | string[]>;
    return `${r.min}–${r.max} ${r.unit}`;
  }
  return String(v);
};

function Direction({ d, group }: { d: DiffDirection; group: ReleaseDiffRow['group'] }) {
  const label = d === 'WIDEN' ? (group === 'ODD' ? R.widen : R.changed) : d === 'NARROW' ? R.narrow : d === 'CHANGED' ? R.changed : R.same;
  return (
    <span className="adc-dir" data-direction={d}>
      {d === 'WIDEN' ? <StatusGlyph kind="FAIL" /> : d === 'SAME' ? null : <StatusGlyph kind="REVIEW" />}
      {label}
    </span>
  );
}

function DiffRows({ rows }: { rows: ReleaseDiffRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.field} data-direction={r.direction} data-group={r.group} data-field={r.field}>
          <th scope="row">{R.fieldName[r.field] ?? r.field}</th>
          <td>{showValue(r.before)}</td>
          <td>{showValue(r.after)}</td>
          <td>
            <Direction d={r.direction} group={r.group} />
          </td>
        </tr>
      ))}
    </>
  );
}

export function ReleaseDiffTab() {
  const [sp, setSp] = useSearchParams();
  const { list, items, id, diff } = useReleasePick();
  const [showSame, setShowSame] = useState(false);
  const d = diff.data?.rows ? diff.data : undefined;
  const visible = (r: ReleaseDiffRow) => showSame || r.direction !== 'SAME';
  const main = (d?.rows ?? []).filter((r) => r.group !== 'TERMINATION' && visible(r));
  const term = (d?.rows ?? []).filter((r) => r.group === 'TERMINATION');
  const termChanged = term.filter((r) => r.direction !== 'SAME').length;
  const head = (
    <thead>
      <tr>
        <th scope="col">{R.field}</th>
        <th scope="col">{R.before}</th>
        <th scope="col">{R.after}</th>
        <th scope="col">{R.direction}</th>
      </tr>
    </thead>
  );
  return (
    <AsyncView state={asyncState(list, items.length === 0)} error={list.error} onRetry={() => list.refetch()}>
      <div className="adc-stack" data-ads-release>
        <div className="adc-row">
          <Select
            label={R.pick}
            value={id}
            onChange={(e) => {
              const n = new URLSearchParams(sp);
              n.set('release', e.target.value);
              setSp(n, { replace: true });
            }}
          >
            {items.map((x) => (
              <option key={x.releaseId} value={x.releaseId}>
                {R.option(x.name, x.version, x.baseVersion)}
              </option>
            ))}
          </Select>
          <label className="adc-row">
            <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} />
            {R.showSame}
          </label>
        </div>
        <AsyncView state={asyncState(diff)} error={diff.error} onRetry={() => diff.refetch()}>
          {d && (
            <>
              <div className="adc-row">
                <span className="adc-note">{R.kind}</span>
                {d.cls.kinds.map((k) => (
                  <ChangeKindBadge key={k} kind={k} />
                ))}
              </div>
              <TableScroll label={R.caption(d.after.version, d.before.version)}>
                <table className="ads-axes adc-diff" data-release-diff={d.releaseId}>
                  <caption className="ads-axes__caption">{R.caption(d.after.version, d.before.version)}</caption>
                  {head}
                  <tbody>
                    <DiffRows rows={main} />
                  </tbody>
                </table>
              </TableScroll>
              <details className="adc-term" open={termChanged > 0}>
                <summary>{R.termHead(d.summary.termination.dc, d.summary.termination.fallback, d.summary.termination.mrc)}</summary>
                <TableScroll label={R.group.TERMINATION}>
                  <table className="ads-axes adc-diff">
                    <caption className="ads-axes__caption">{R.group.TERMINATION}</caption>
                    {head}
                    <tbody>
                      <DiffRows rows={term.filter(visible)} />
                    </tbody>
                  </table>
                </TableScroll>
              </details>
              <SimulatedDataNotice text={C.assumed} />
            </>
          )}
        </AsyncView>
      </div>
    </AsyncView>
  );
}

/* ───────────── 정책·Feature Version — 배지와 링크만 ───────────── */

/** 이 Feature Version의 변경 영향(있으면) */
export function useFeatureChange(featureId: string, version: string) {
  const q = useChangeImpacts(!!featureId, featureId);
  const items = Array.isArray(q.data?.items) ? q.data!.items : [];
  return items.find((v) => v.version === version && !!v.cls) ?? null;
}

/** 변경 종류 배지 + 승인 경로 탭 링크 — 변경 영향이 있는 Feature Version에만 */
export function ChangeKindChip({ featureId, version }: { featureId: string; version: string }) {
  const v = useFeatureChange(featureId, version);
  if (!v) return null;
  return (
    <span className="adc-row" data-change-chip={v.impactId}>
      <ChangeKindBadge kind={v.cls.primary} />
      <Link to={`/analysis/impact?tab=paths`}>{C.toImpact}</Link>
    </span>
  );
}
