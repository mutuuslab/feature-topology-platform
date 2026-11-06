// /master/feature-db/:refId — 기준 행 상세(30-95 §5.1·§5.2·§8.3). 식별·분류 경로·03b 정의·특성·규모·근거·별칭·관계,
// 이 행을 쓰는 Feature, 컴포넌트의 세부기능 후보(읽기 전용), 상태에 따른 사용 규칙, 변경 요청 작성(자동 점검 결과를 바로 보인다).
// 벤치마크 €는 서버가 산정 역할에만 준다 — 응답에 있을 때만 그린다.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EVIDENCE_STALE_MONTHS, REF_ASIL_LIST, REF_ID_PATTERN, REF_STATUS_POLICY, refAttrMissing, REGISTRATION_CRITERIA, SIZE_CLASSES, sizePoints, type RefChange, type RefChangeKind, type RefCriterionResult, type RefGlossary, type RefSource } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { refChangeForm as F, refDetail as T, KIND_LABEL, CHANGE_STATUS_LABEL, refAwaiting as AW, refBenchmark as BM, refQualityCopy as QC } from '../../copy/refdb';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, Icon, IdChip, KeyValue, LifecycleBadge, PageHeader, Panel, Segmented, SummaryLine, whyDisabled } from '../../design';
import { usePermission } from '../shared';
import { changePath, FeatureLink, RefChip, RefChips, RefStatusBadge, TextLink, type RefDetailPolicy, type RefDetailResponse, type RefRowView, type RefUsage } from './common';
import { SourceTitleLinks } from './sourceLinks';

const REQUESTERS = ['FEATURE_AUTHOR', 'FEATURE_APPROVER', 'PRODUCT_AUTHOR', 'IMPLEMENTER', 'VARIANT_OWNER', 'REFDB_ADMIN', 'DOMAIN_REVIEWER'] as const;

const has = (v: unknown) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
const list = (v: readonly string[] | undefined | null) => (v && v.length ? v.join(', ') : '—');
const keep = <T extends { v: unknown }>(rows: T[]) => rows.filter((r) => has(r.v));

export function RefDetailScreen() {
  const { refId = '' } = useParams();
  const q = useApi<RefDetailResponse>('refDetail', { params: { refId } });
  const changes = useApi<{ items: RefChange[] }>('listRefChanges', { query: { refId } });
  const [open, setOpen] = useState(false);
  const perm = usePermission(REQUESTERS);
  const d = q.data;
  const r = d?.ref;
  const policy = r ? REF_STATUS_POLICY[r.status] : null;
  // 요청 중이지만 추가 요청이 이미 승인됨(발행 전) — '관리자 승인 전'이 아니다(P5-3)
  const awaiting = d?.awaitingPublish ?? null;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · FEATURE DB"
        title={r?.nameKo ?? refId}
        meta={
          <>
            <IdChip id={refId} />
            {/* 고를 때 가장 먼저 보는 두 값 — 대표 ASIL·T-shirt를 머리 칩으로(본문 특성·규모 칸과 같은 값) */}
            {r && (
              <>
                <span className="ds-tag ds-meta-chip" data-meta="asil">
                  <span>{T.f.asilRep}</span> <span className="ds-mono">{r.asilRep}</span>
                </span>
                <span className="ds-tag ds-meta-chip" data-meta="tshirt">
                  <span>{T.f.tshirt}</span> <span className="ds-mono">{r.tshirt}</span>
                </span>
              </>
            )}
          </>
        }
        message={
          r && policy
            ? { tone: 'neutral', value: d!.usedBy.length, text: T.key, status: awaiting ? { label: AW.pill, tone: 'warn' } : { label: policy.ko, tone: policy.blocksApproval ? 'danger' : policy.warn ? 'warn' : 'ok' } }
            : { tone: 'neutral', text: T.title }
        }
        actions={
          <>
            <TextLink to="/master/feature-db">{T.back}</TextLink>
            <Button variant="primary" disabled={!perm.ok || !r} reason={whyDisabled([!perm.ok, perm.hint])} onClick={() => setOpen(true)}>
              {T.change}
            </Button>
          </>
        }
      />
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {r && d && (
          <>
            <RowQuality r={r} />
            <div className="ds-split ds-split--wide-side">
              <div className="ds-stack">
                <Identity r={r} glossary={d.glossary ?? []} />
                {/* 이 행을 쓰는 Feature — 이름·범위·상태 열이 있어 넓은 칸에 둔다(좁은 칸이면 표 최소 폭이 칸을 밀어낸다) */}
                <Linked usedBy={d.usedBy} />
                {r.definition && <Definition r={r} />}
                <Sizes r={r} />
                {'benchmarkEur' in r && <Benchmark r={r} />}
                <Sources r={r} sources={(d.sources ?? []).flatMap((x) => (x.source ? [x.source] : []))} />
              </div>
              <div className="ds-stack">
                <Policy r={r} replacedBy={d.policy?.replacedBy ?? null} awaiting={awaiting} />
                <Relations r={r} />
                <Subfunctions items={d.subfunctions} />
                <Panel title={T.changes} eyebrow={changes.data ? String(changes.data.items.length) : undefined}>
                  {changes.data?.items.length ? (
                    <ul className="ds-linklist">
                      {changes.data.items.map((c) => (
                        <li key={c.changeId}>
                          <Link to={changePath(c.changeId)}>{`${c.changeId} · ${KIND_LABEL[c.kind]} · ${CHANGE_STATUS_LABEL[c.status]}`}</Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ds-field__hint">{T.changesNone}</p>
                  )}
                </Panel>
              </div>
            </div>
            {/* 기준 행마다 새로 — 같은 화면에서 A → B → A로 오가면(캐시된 A는 바로 그린다) 앞 행의 입력값이 남아 MODIFY 차이가 틀렸다 */}
            <ChangeDrawer key={r.refId} open={open} onClose={() => setOpen(false)} r={r} />
          </>
        )}
      </AsyncView>
    </div>
  );
}

function Identity({ r, glossary }: { r: RefRowView; glossary: RefGlossary[] }) {
  const f = T.f;
  return (
    <Panel title={T.identity} id="ref-identity">
      <KeyValue
        rows={keep([
          { k: f.status, v: <RefStatusBadge status={r.status} /> },
          { k: f.path, v: [r.domain, r.cluster, r.component].filter(Boolean).join(' › ') },
          { k: f.replacedBy, v: r.replacedBy ? <RefChip id={r.replacedBy} /> : null },
          { k: f.registeredIn, v: r.registeredIn },
          { k: f.evidenceCheckedAt, v: r.evidenceCheckedAt },
          { k: f.duplicateOf, v: r.duplicateOf ? <RefChip id={r.duplicateOf} /> : null },
          { k: f.swStack, v: r.swStack },
          { k: f.lifecycle, v: r.lifecycle },
          { k: f.techStack, v: r.techStack },
          { k: f.vehicleType, v: r.vehicleType },
          { k: f.region, v: r.region },
          { k: f.procurement, v: r.procurement },
          { k: T.aliases, v: r.aliases.length ? list(r.aliases) : null },
          { k: T.glossary, v: glossary.length ? list(glossary.map((g) => (g.meaning ? `${g.term} (${g.meaning})` : g.term))) : null },
        ])}
      />
    </Panel>
  );
}

function Definition({ r }: { r: RefRowView }) {
  const x = r.definition!;
  const D = T.def;
  const drivers = x.drivers ? [x.drivers.states, x.drivers.dtcs, x.drivers.calibrations, x.drivers.variants].map((v) => v || '—').join(' · ') : null;
  return (
    <Panel title={T.definition} id="ref-definition">
      <KeyValue
        rows={keep([
          { k: D.level, v: x.level },
          { k: D.parentRefId, v: x.parentRefId },
          { k: D.summary, v: x.summary },
          { k: D.trigger, v: x.trigger },
          { k: D.scopeIn, v: x.scopeIn?.length ? list(x.scopeIn) : null },
          { k: D.scopeOut, v: x.scopeOut?.length ? list(x.scopeOut) : null },
          { k: D.scopeOutRefs, v: x.scopeOutRefs?.length ? <RefChips ids={x.scopeOutRefs.filter((id) => REF_ID_PATTERN.test(id))} /> : null },
          { k: D.entry, v: x.io?.entry },
          { k: D.exit, v: x.io?.exit },
          { k: D.read, v: x.io?.read },
          { k: D.write, v: x.io?.write },
          { k: D.drivers, v: drivers },
          { k: D.regulations, v: x.regulations },
          { k: D.verification, v: x.verification },
          { k: D.typicalChanges, v: x.typicalChanges },
          { k: D.sharedFunctions, v: x.sharedFunctions },
          { k: D.authoringStatus, v: x.authoringStatus },
        ])}
      />
    </Panel>
  );
}

function Sizes({ r }: { r: RefRowView }) {
  const f = T.f;
  const points = sizePoints(r.tshirt);
  return (
    <Panel title={T.sizes} id="ref-sizes">
      <KeyValue
        rows={keep([
          { k: f.asilRep, v: <span className="ds-mono">{r.asilRep}</span> },
          { k: f.tshirt, v: <span className="ds-mono">{r.tshirt}</span> },
          { k: f.points, v: points },
          { k: f.sizeEvidenceGrade, v: r.sizeEvidenceGrade },
          { k: f.bundleId, v: r.bundleId },
          { k: f.method, v: r.method },
          { k: f.autoQuality, v: r.autoQuality },
          { k: f.techQuality, v: r.techQuality },
        ])}
      />
    </Panel>
  );
}

function Benchmark({ r }: { r: RefRowView }) {
  const none = r.benchmarkEur == null && !r.kearneyNote;
  return (
    <Panel title={T.benchmark} id="ref-benchmark">
      {/* 값이 없으면 '—' 두 줄 대신 이유를 말한다 — 공개 벤치마크가 있는 행은 일부뿐(P5-9) */}
      {none ? (
        <p className="ds-field__hint" data-benchmark-none>
          {BM.none}
        </p>
      ) : (
      <KeyValue
        rows={[
          { k: T.f.benchmarkEur, v: r.benchmarkEur != null ? <span className="ds-mono">{r.benchmarkEur.toLocaleString('ko-KR')}</span> : T.none },
          { k: T.f.kearneyNote, v: r.kearneyNote || T.none },
        ]}
      />
      )}
    </Panel>
  );
}

const monthsAgo = (months: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

/** 이 행의 품질 한 줄 — 출처·근거 확인일·분류 속성·규모 근거(P5-7) */
function RowQuality({ r }: { r: RefRowView }) {
  const R = QC.row;
  const stale = !r.evidenceCheckedAt || r.evidenceCheckedAt < monthsAgo(EVIDENCE_STALE_MONTHS);
  return (
    <SummaryLine
      label={R.title}
      items={[
        { k: R.title, v: R.sources(r.sourceIds.length) },
        { k: '', v: R.checked(r.evidenceCheckedAt, stale) },
        { k: '', v: R.attr(refAttrMissing(r)) },
        { k: '', v: R.grade(r.sizeEvidenceGrade) },
      ]}
    />
  );
}

function Sources({ r, sources }: { r: RefRowView; sources: RefSource[] }) {
  const byId = new Map(sources.map((s) => [s.sourceId, s]));
  return (
    <Panel title={T.sources} id="ref-sources">
      {r.sourceIds.length > 0 && (
        <ul className="ds-linklist">
          {r.sourceIds.map((id) => {
            const s = byId.get(id);
            return (
              <li key={id} data-source={id}>
                <span className="ds-mono">{id}</span>{' '}
                {s ? (
                  <SourceTitleLinks url={s.url} title={[s.title, s.publisher, s.version].filter(Boolean).join(' · ')} />
                ) : (
                  <span className="ds-field__hint">{T.sourceUnknown}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <KeyValue
        rows={keep([
          { k: T.f.sourceDetail, v: r.sourceDetail },
          { k: T.f.basisType, v: r.basisType },
          { k: T.f.remark, v: r.remark },
          { k: T.f.adminMemo, v: r.adminMemo },
        ])}
      />
    </Panel>
  );
}

function Policy({ r, replacedBy, awaiting }: { r: RefRowView; replacedBy: RefDetailPolicy['replacedBy']; awaiting: RefDetailResponse['awaitingPublish'] }) {
  const p = REF_STATUS_POLICY[r.status];
  const P = T.pol;
  return (
    <Panel title={T.policy} id="ref-policy">
      {awaiting ? (
        <p data-policy-hint data-awaiting-publish={awaiting.changeId}>
          <strong>{AW.pill}</strong> — {awaiting.hint} <Link to={changePath(awaiting.changeId)}>{AW.change(awaiting.changeId)}</Link>
        </p>
      ) : (
        <p data-policy-hint>{p.hint}</p>
      )}
      <KeyValue
        rows={[
          { k: P.selectable, v: p.selectable ? P.yes : P.no },
          { k: P.warn, v: p.warn ? P.warnYes : P.warnNo },
          { k: P.approval, v: p.blocksApproval ? <strong>{P.blocked}</strong> : P.pass },
          { k: P.cost, v: !p.costUsable ? P.costNo : p.costWarn ? P.costWarn : P.costUse },
        ]}
      />
      {replacedBy ? (
        <p data-replaced-by={replacedBy.refId}>
          {T.replacement(replacedBy.nameKo)} <RefChip id={replacedBy.refId} />
        </p>
      ) : null}
      {p.warn && r.adminMemo ? <p className="ds-field__hint">{r.adminMemo}</p> : null}
    </Panel>
  );
}

function Linked({ usedBy }: { usedBy: RefUsage[] }) {
  return (
    <Panel title={T.linked} id="ref-linked" eyebrow={String(usedBy.length)}>
      {usedBy.length ? <UsageTable rows={usedBy} caption={T.linkedCaption} /> : <p className="ds-field__hint">{T.linkedNone}</p>}
    </Panel>
  );
}

/** 이 행을 쓰는 Feature 표 — 상세와 변경 요청 영향 표시가 같이 쓴다 */
export function UsageTable({ rows, caption }: { rows: RefUsage[]; caption: string }) {
  const C = T.linkedCol;
  // 상세·영향 응답은 이름·상태·적용 범위를 함께 준다 — 있을 때만 열을 둔다
  const named = rows.some((u) => u.name);
  const scoped = rows.some((u) => u.country || u.vehicleModel || u.trim);
  const staged = rows.some((u) => u.lifecycle);
  return (
    <DataTable<RefUsage>
      caption={caption}
      rows={rows}
      rowKey={(u) => `${u.featureId}@${u.version}`}
      columns={[
        { key: 'f', header: C.feature, cell: (u) => <FeatureLink u={u} /> },
        ...(named ? [{ key: 'n', header: C.name, cell: (u: RefUsage) => u.name ?? '—' }] : []),
        ...(scoped ? [{ key: 's', header: C.scope, cell: (u: RefUsage) => [u.country, u.vehicleModel, u.trim].filter(Boolean).join(' · ') || '—', minor: true }] : []),
        ...(staged ? [{ key: 'l', header: C.lifecycle, cell: (u: RefUsage) => (u.lifecycle ? <LifecycleBadge value={u.lifecycle} /> : '—') }] : []),
        { key: 'r', header: C.role, cell: (u) => T.role[u.role] ?? u.role },
        { key: 'v', header: C.refVersion, cell: (u) => <span className="ds-mono">{u.refVersion}</span> },
      ]}
    />
  );
}

function Relations({ r }: { r: RefRowView }) {
  return (
    <Panel title={T.relations} id="ref-relations">
      <KeyValue
        rows={[
          { k: T.f.requires, v: <RefChips ids={r.requires} /> },
          { k: T.f.excludes, v: <RefChips ids={r.excludes} /> },
        ]}
      />
    </Panel>
  );
}

function Subfunctions({ items }: { items: RefDetailResponse['subfunctions'] }) {
  return (
    <Panel title={T.subfunctions} id="ref-subfunctions" eyebrow={String(items.length)}>
      {items.length ? (
        <ul className="ds-linklist">
          {items.map((s, i) => (
            <li key={`${s.name}-${i}`}>
              {s.name}
              {s.note ? <span className="ds-field__hint">{` · ${s.note}`}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ds-field__hint">{T.subfunctionsNone}</p>
      )}
    </Panel>
  );
}

// ── 변경 요청 작성 ──────────────────────────────────────────────

const EDIT_TEXT = ['nameKo', 'nameEn', 'sourceDetail', 'remark', 'adminMemo'] as const;
const EDIT_LIST = ['aliases', 'sourceIds'] as const;
type EditKey = (typeof EDIT_TEXT)[number] | (typeof EDIT_LIST)[number] | 'asilRep' | 'tshirt';

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function initialEdits(r: RefRowView): Record<EditKey, string> {
  return {
    nameKo: r.nameKo,
    nameEn: r.nameEn,
    sourceDetail: r.sourceDetail,
    remark: r.remark,
    adminMemo: r.adminMemo,
    aliases: r.aliases.join(', '),
    sourceIds: r.sourceIds.join(', '),
    asilRep: r.asilRep,
    tshirt: r.tshirt,
  };
}

/** 바뀐 칸만 after에 — 목록 칸은 쉼표로 나눠 비교한다 */
export function changedFields(r: RefRowView, edits: Record<EditKey, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of [...EDIT_TEXT, 'asilRep', 'tshirt'] as const) if (edits[k].trim() !== String(r[k] ?? '')) out[k] = edits[k].trim();
  for (const k of EDIT_LIST) {
    const next = splitList(edits[k]);
    if (next.join('\u0000') !== r[k].join('\u0000')) out[k] = next;
  }
  return out;
}

function ChangeDrawer({ open, onClose, r }: { open: boolean; onClose: () => void; r: RefRowView }) {
  const perm = usePermission(REQUESTERS);
  const create = useApiMutation<RefChange | { change: RefChange }>('createRefChange', ['listRefChanges', 'refQuality', 'refDetail']);
  const [kind, setKind] = useState<Exclude<RefChangeKind, 'ADD'>>('MODIFY');
  const [edits, setEdits] = useState(() => initialEdits(r));
  const [replacedBy, setReplacedBy] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<RefChange | null>(null);
  const diff = changedFields(r, edits);
  const rep = replacedBy.trim();
  const repBad = kind === 'DEPRECATE' && rep !== '' && !REF_ID_PATTERN.test(rep);
  const repSelf = kind === 'DEPRECATE' && rep === r.refId;
  const dirty = !done && (Object.keys(diff).length > 0 || reason.trim().length > 0 || rep !== '');
  const why = whyDisabled(
    [!perm.ok, perm.hint],
    [kind === 'MODIFY' && Object.keys(diff).length === 0, F.why.noEdit],
    [repBad, F.why.replacedBy],
    [repSelf, F.why.sameRef],
    [reason.trim().length < 2, F.why.reason],
  );
  const close = () => {
    setDone(null);
    setReason('');
    setReplacedBy('');
    setEdits(initialEdits(r));
    create.reset();
    onClose();
  };
  const after = kind === 'MODIFY' ? diff : kind === 'DEPRECATE' ? { status: 'DEPRECATED', replacedBy: rep || null } : { status: 'RETIRED' };
  const setEdit = (k: EditKey, v: string) => setEdits((e) => ({ ...e, [k]: v }));
  const label = T.f;
  return (
    <Drawer open={open} title={F.title(r.refId)} onClose={close} dirty={dirty}>
      {done ? (
        <div className="ds-stack">
          <p role="status">{F.done(done.changeId)}</p>
          <Checks checks={done.checks ?? []} />
          <TextLink to={changePath(done.changeId)}>{F.open}</TextLink>
        </div>
      ) : (
        <form
          className="ds-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (why) return;
            create.mutate(
              { body: { kind, refId: r.refId, after, reason: reason.trim() } },
              { onSuccess: (res) => setDone('change' in res && res.change ? res.change : (res as RefChange)) },
            );
          }}
        >
          <Segmented<Exclude<RefChangeKind, 'ADD'>>
            label={F.kind}
            value={kind}
            onChange={setKind}
            options={(['MODIFY', 'DEPRECATE', 'RETIRE'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
          {kind === 'MODIFY' && (
            <fieldset className="ds-fieldset">
              <legend>{F.edits}</legend>
              <p className="ds-field__hint">{F.editsHint}</p>
              <div className="ds-form-grid">
                <Field label={label.asilRep}>
                  <select className="ds-select" value={edits.asilRep} onChange={(e) => setEdit('asilRep', e.target.value)}>
                    {REF_ASIL_LIST.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={label.tshirt}>
                  <select className="ds-select" value={edits.tshirt} onChange={(e) => setEdit('tshirt', e.target.value)}>
                    {SIZE_CLASSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {EDIT_TEXT.map((k) => (
                <Field key={k} label={label[k]}>
                  <input className="ds-input" value={edits[k]} onChange={(e) => setEdit(k, e.target.value)} />
                </Field>
              ))}
              {EDIT_LIST.map((k) => (
                <Field key={k} label={k === 'aliases' ? T.aliases : label.sourceIds} hint={F.listHint}>
                  <input className={k === 'sourceIds' ? 'ds-input ds-input--mono' : 'ds-input'} value={edits[k]} onChange={(e) => setEdit(k, e.target.value)} />
                </Field>
              ))}
            </fieldset>
          )}
          {kind === 'DEPRECATE' && (
            <Field label={F.replacedBy} error={repBad ? F.why.replacedBy : repSelf ? F.why.sameRef : undefined}>
              <input className="ds-input ds-input--mono" value={replacedBy} onChange={(e) => setReplacedBy(e.target.value.toUpperCase())} />
            </Field>
          )}
          <Field label={F.reason}>
            <textarea className="ds-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={create.error} />
          <Button type="submit" variant="primary" disabled={!!why || create.isPending} reason={why}>
            {F.submit}
          </Button>
        </form>
      )}
    </Drawer>
  );
}

const CRITERION = new Map(REGISTRATION_CRITERIA.map((c) => [c.id as string, c]));

/** 자동 점검 결과 — 막는 실패는 FAIL, 보완 필요는 안내. 통과한 항목은 서버가 문장을 비워 주므로 등록 기준 표의 항목·규칙으로 보인다 */
export function Checks({ checks }: { checks: RefCriterionResult[] }) {
  if (!checks.length) return <p className="ds-field__hint">{F.checksNone}</p>;
  return (
    <ul className="ds-check" aria-label={F.checks}>
      {checks.map((c) => {
        const k = CRITERION.get(c.id);
        return (
          <li key={c.id} data-state={c.ok ? 'PASS' : c.blocking ? 'FAIL' : 'INFO'} data-check={c.id}>
            <Icon name={c.ok ? 'check' : 'alert'} size={16} />
            <span>
              {c.message || k?.item || c.id}
              <span className="ds-check__detail">{c.ok ? (k?.rule ?? F.passed) : c.blocking ? F.blocking : F.advisory}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
