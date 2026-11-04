// Feature 상세 '기준 행' 탭 — 초안(PROPOSED)의 기준 행 연결 바꾸기(30-95 §5.3·§6.2).
// 연결이 없는 초안은 정의 승인이 막히고(REFDB_LINK_BLOCKED, 사용자 결정 2026-11-04), 대표 행의 대표 ASIL이 Feature ASIL과 다르면
// 지금 대표 ASIL 기준 사유가 있어야 한다 — 여기서 대표·포함 행을 고르고 ASIL 사유를 함께 저장한다(PATCH updateDraft).
// 대표를 같은 범위 다른 Feature가 쓰는 행으로 바꾸면 등록과 같이 409 REFDB_DUPLICATE_IN_SCOPE → 사유를 적고 확인한다.
import { useEffect, useRef, useState } from 'react';
import type { FeatureRefLink, FeatureRefRole } from '@ff/contracts';
import { useQueries } from '@tanstack/react-query';
import { call, isPersonal, STATIC_MODE } from '../../api/client';
import { fieldErrors } from '../../api/field-errors';
import { useApi, useApiMutation } from '../../api/hooks';
import { featureRefsTab as T, propose as P } from '../../copy/propose';
import { Button, ErrorNote, Field, whyDisabled } from '../../design';
import { useAppShell } from '../../store';
import { RefPicker } from '../home/propose/RefPicker';
import { choosePicked, makePrimaryPicked, primaryOf, removePicked, type PickedRef, type RefLite } from '../home/propose/prefill';
import type { TaxonomyNodeLite } from '../home/propose/taxonomy';
import { usePermission } from '../shared';

const DUPLICATE = 'REFDB_DUPLICATE_IN_SCOPE';

/** 연결을 바꿀 초안 — 상세 응답의 feature 일부 */
export interface DraftFeature {
  featureId: string;
  version: string;
  asil: string;
  asilDeviation?: { from: string; to: string; reason: string } | null;
}

const sameLinks = (a: readonly { refId: string; role: FeatureRefRole }[], b: readonly { refId: string; role: FeatureRefRole }[]) =>
  a.length === b.length && a.every((x) => b.some((y) => y.refId === x.refId && y.role === x.role));

export function RefLinkEditor({ f, links, onClose }: { f: DraftFeature; links: FeatureRefLink[]; onClose: () => void }) {
  const { role } = useAppShell();
  const perm = usePermission(['FEATURE_AUTHOR']);
  const taxonomy = useApi<{ items: TaxonomyNodeLite[] }>('refTaxonomy');
  const save = useApiMutation('updateDraft', ['featureDetail', 'listFeatures', 'audit', 'gates', 'refDetail']);
  // 지금 연결의 기준 행 — 상세(행 전체)로 고른 목록을 채운다. 행 칸과 같은 쿼리 키(역할마다 다른 응답은 키에 역할)
  const personal = isPersonal('refDetail');
  const details = useQueries({
    queries: links.map((l) => ({
      queryKey: personal ? ['refDetail', { refId: l.refId }, {}, role] : ['refDetail', { refId: l.refId }, {}],
      queryFn: ({ signal }: { signal: AbortSignal }) => call<{ ref: RefLite }>('refDetail', { params: { refId: l.refId }, signal, ...(personal ? { role } : {}) }),
    })),
  });
  const [picked, setPicked] = useState<PickedRef[] | null>(links.length ? null : []);
  const ready = details.every((q) => q.data || q.isError);
  useEffect(() => {
    if (picked !== null || !ready) return;
    // 읽지 못한 행은 고른 목록에 넣지 않는다 — 저장하면 그 연결이 빠지므로 화면에 안내가 남는다(아래 lost)
    setPicked(links.flatMap((l, i) => (details[i].data ? [{ ref: details[i].data!.ref, role: l.role }] : [])));
  }, [ready, picked, links, details]);
  const lost = links.filter((_, i) => details[i].isError).map((l) => l.refId);

  const [domain, setDomain] = useState('');
  const cur = picked ?? [];
  const primary = primaryOf(cur);
  // 대표 행의 대표 ASIL과 Feature ASIL이 다르면 지금 대표 ASIL 기준 사유가 필요하다(정의 승인 다시 확인)
  const asilDiff = !!primary && primary.asilRep !== f.asil;
  const devOk = !!f.asilDeviation && !!primary && f.asilDeviation.from === primary.asilRep && f.asilDeviation.to === f.asil;
  const [asilReason, setAsilReason] = useState(f.asilDeviation?.reason ?? '');
  const [dupReason, setDupReason] = useState('');
  const next = cur.map((p) => ({ refId: p.ref.refId, role: p.role }));
  const changed = !sameLinks(next, links) || (asilDiff && !devOk);
  const duplicate = save.error?.code === DUPLICATE;
  const dupHead = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (duplicate) dupHead.current?.focus();
  }, [duplicate]);
  const fe = fieldErrors(save.error);
  const why = whyDisabled([!perm.ok, perm.hint], [picked === null, T.edit.loading], [!primary, P.nextWhy], [!changed, T.edit.noChange], [asilDiff && asilReason.trim().length < 2, P.asilReasonWhy]);

  const submit = (confirmDuplicate = false) =>
    save.mutate(
      {
        params: { id: f.featureId, ver: f.version },
        body: {
          featureRefs: next,
          ...(asilDiff && primary ? { asilDeviation: { from: primary.asilRep, to: f.asil, reason: asilReason.trim() } } : {}),
          ...(confirmDuplicate ? { confirmDuplicate: true, duplicateReason: dupReason.trim() } : {}),
        },
      },
      { onSuccess: onClose },
    );

  return (
    <section className="ds-stack" aria-labelledby="ref-edit-h" data-testid="ref-link-editor">
      <h3 id="ref-edit-h">{T.edit.title}</h3>
      <p className="ds-field__hint">{T.edit.lead}</p>
      {lost.length > 0 && <p className="ds-field__error">{T.edit.lost(lost.join(', '))}</p>}
      {picked !== null && (
        <RefPicker
          picked={cur}
          onChoose={(ref, r) => setPicked((xs) => choosePicked(xs ?? [], ref, r))}
          onRemove={(id) => setPicked((xs) => removePicked(xs ?? [], id))}
          onMakePrimary={(id) => setPicked((xs) => makePrimaryPicked(xs ?? [], id))}
          nodes={taxonomy.data?.items ?? []}
          domain={domain}
          setDomain={setDomain}
        />
      )}
      {asilDiff && primary && (
        <div className="ds-callout" data-tone="warn" data-testid="ref-edit-asil">
          <Field label={P.asilReason} error={fe.asilDeviation} hint={P.asilReasonHint(primary.asilRep, f.asil)}>
            <textarea className="ds-input" name="asilDeviation" value={asilReason} onChange={(e) => setAsilReason(e.target.value)} rows={2} />
          </Field>
        </div>
      )}
      {duplicate ? (
        <section className="ds-panel" aria-labelledby="ref-edit-dup-h" data-testid="ref-edit-duplicate" style={{ padding: 'var(--sp-3)' }}>
          <h3 id="ref-edit-dup-h" ref={dupHead} tabIndex={-1}>
            {P.duplicate.title}
          </h3>
          <p role="alert">{save.error?.message}</p>
          <Field label={P.duplicate.reason} hint={P.duplicate.hint} error={fe.duplicateReason}>
            <textarea className="ds-input" name="duplicateReason" value={dupReason} onChange={(e) => setDupReason(e.target.value)} rows={2} />
          </Field>
          <Button variant="primary" disabled={dupReason.trim().length < 2 || save.isPending} reason={dupReason.trim().length < 2 ? P.duplicate.reasonWhy : undefined} onClick={() => submit(true)}>
            {P.duplicate.confirm}
          </Button>
        </section>
      ) : (
        <ErrorNote error={save.error} />
      )}
      <div className="ds-toolbar">
        <Button variant="primary" data-ui="saveFeatureRefs" disabled={!!why || STATIC_MODE || save.isPending} reason={why} onClick={() => submit(false)}>
          {T.edit.save}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {T.edit.cancel}
        </Button>
      </div>
    </section>
  );
}
