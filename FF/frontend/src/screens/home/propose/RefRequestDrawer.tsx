// 'Feature DB에 없음 → 요청'(30-95 §6.4, D-REF-7) — 최소 정보로 추가 요청. 서버가 정식 ID를 바로 주고 요청 중(PENDING) 행을 만든다.
// 성공하면 그 행을 돌려준다 — 화면이 대표 행으로 쓴다(승인 전에는 Feature 승인이 막힌다).
import { useState } from 'react';
import { SIZE_CLASSES } from '@ff/contracts';
import { ASIL_VALUES, type TaxonomyNodeLite } from './taxonomy';
import { fieldErrors } from '../../../api/field-errors';
import { useApiMutation } from '../../../api/hooks';
import { propose as P, proposeRefMore as PM } from '../../../copy/propose';
import { Button, Drawer, ErrorNote, Field, whyDisabled } from '../../../design';
import { usePermission } from '../../shared';
import { list, type RefLite } from './prefill';

const NEW = '__new__';
const EMPTY = { domain: '', component: '', componentName: '', componentAbbr: '', nameEn: '', nameKo: '', tshirt: '', asilRep: '', sourceIds: '', basisNote: '', swStack: '', lifecycle: '', techStack: '' };

export function RefRequestDrawer({ open, onClose, onCreated, nodes, initialDomain = '' }: { open: boolean; onClose: () => void; onCreated: (ref: RefLite) => void; nodes: TaxonomyNodeLite[]; initialDomain?: string }) {
  const R = P.request;
  const [f, setF] = useState({ ...EMPTY, domain: initialDomain });
  // 서버 requestRefAdd와 같은 역할 — 열기 버튼도 막지만, 역할이 바뀌어도 보내기 전에 한 번 더 본다. 공개 데모는 읽기 전용
  const perm = usePermission(['FEATURE_AUTHOR', 'REFDB_ADMIN']);
  const req = useApiMutation<RefLite | { ref: RefLite }>('requestRefAdd', ['listRefs', 'refQuality', 'listRefChanges']);
  const fe = fieldErrors(req.error);
  const domains = nodes.filter((n) => n.level === 'DOMAIN');
  const domainNode = domains.find((d) => d.nameEn === f.domain);
  const comps = nodes.filter((n) => n.level === 'COMPONENT' && n.parentId === domainNode?.nodeId);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'domain' ? { component: '' } : {}) }));
  const isNew = f.component === NEW;
  const component = isNew ? f.componentName.trim() : f.component;
  const dirty = Object.entries(f).some(([k, v]) => v !== (k === 'domain' ? initialDomain : ''));
  const why = whyDisabled(
    [!perm.ok, perm.hint],
    [!f.domain || !component || !f.nameEn.trim() || !f.nameKo.trim() || !f.tshirt || !f.asilRep, R.requiredWhy],
    [!list(f.sourceIds).length && f.basisNote.trim().length < 2, R.sourceOrBasis],
  );
  const submit = () =>
    req.mutate(
      {
        body: {
          domain: f.domain,
          component,
          ...(isNew && f.componentAbbr.trim() ? { componentAbbr: f.componentAbbr.trim().toUpperCase() } : {}),
          nameEn: f.nameEn.trim(),
          nameKo: f.nameKo.trim(),
          tshirt: f.tshirt,
          asilRep: f.asilRep,
          sourceIds: list(f.sourceIds),
          basisNote: f.basisNote.trim(),
          // 분류 속성 — 비우면 승인 뒤 '검토 필요'(P5-8)
          swStack: f.swStack,
          lifecycle: f.lifecycle,
          techStack: f.techStack.trim(),
        },
      },
      {
        onSuccess: (r) => {
          const ref = 'ref' in r && r.ref ? r.ref : (r as RefLite);
          setF({ ...EMPTY, domain: initialDomain });
          onCreated(ref);
        },
      },
    );
  return (
    <Drawer open={open} title={R.title} onClose={onClose} dirty={dirty && !req.isPending}>
      <div className="ds-stack">
        <p className="ds-field__hint">{R.lead}</p>
        <Field label={R.domain} error={fe.domain}>
          <select className="ds-select" name="domain" value={f.domain} onChange={set('domain')}>
            <option value="">{R.choose}</option>
            {domains.map((d) => (
              <option key={d.nodeId} value={d.nameEn}>{d.nameKo || d.nameEn}</option>
            ))}
          </select>
        </Field>
        <Field label={R.component} error={fe.component}>
          <select className="ds-select" name="component" value={f.component} onChange={set('component')} disabled={!f.domain}>
            <option value="">{R.choose}</option>
            {comps.map((c) => (
              <option key={c.nodeId} value={c.nameEn}>{c.nameKo || c.nameEn}</option>
            ))}
            <option value={NEW}>{R.newComponent}</option>
          </select>
        </Field>
        {isNew && (
          <>
            <Field label={R.componentName}>
              <input className="ds-input" name="componentName" value={f.componentName} onChange={set('componentName')} />
            </Field>
            <Field label={R.componentAbbr} error={fe.componentAbbr}>
              <input className="ds-input ds-input--mono" name="componentAbbr" value={f.componentAbbr} onChange={set('componentAbbr')} maxLength={4} />
            </Field>
          </>
        )}
        <Field label={R.nameKo} error={fe.nameKo}>
          <input className="ds-input" name="nameKo" value={f.nameKo} onChange={set('nameKo')} />
        </Field>
        <Field label={R.nameEn} error={fe.nameEn}>
          <input className="ds-input" name="nameEn" value={f.nameEn} onChange={set('nameEn')} />
        </Field>
        <Field label={R.tshirt} error={fe.tshirt}>
          <select className="ds-select" name="tshirt" value={f.tshirt} onChange={set('tshirt')}>
            <option value="">{R.choose}</option>
            {SIZE_CLASSES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label={R.asilRep} error={fe.asilRep}>
          <select className="ds-select" name="asilRep" value={f.asilRep} onChange={set('asilRep')}>
            <option value="">{R.choose}</option>
            {ASIL_VALUES.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </Field>
        <fieldset className="ds-fieldset" data-testid="ref-request-attr">
          <legend>{PM.attr.legend}</legend>
          <p className="ds-field__hint">{PM.attr.hint}</p>
          <div className="ds-form-grid">
            <Field label={PM.attr.swStack} error={fe.swStack}>
              <select className="ds-select" name="swStack" value={f.swStack} onChange={set('swStack')}>
                <option value="">{R.choose}</option>
                {PM.attr.swStackOptions.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </Field>
            <Field label={PM.attr.lifecycle} error={fe.lifecycle}>
              <select className="ds-select" name="lifecycle" value={f.lifecycle} onChange={set('lifecycle')}>
                <option value="">{R.choose}</option>
                {PM.attr.lifecycleOptions.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </Field>
            <Field label={PM.attr.techStack} error={fe.techStack}>
              <input className="ds-input" name="techStack" value={f.techStack} onChange={set('techStack')} />
            </Field>
          </div>
        </fieldset>
        <Field label={R.sourceIds} error={fe.sourceIds} hint={R.sourceIdsHint}>
          <input className="ds-input ds-input--mono" name="sourceIds" value={f.sourceIds} onChange={set('sourceIds')} />
        </Field>
        <Field label={R.basisNote} error={fe.basisNote}>
          <textarea className="ds-input" name="basisNote" value={f.basisNote} onChange={set('basisNote')} rows={3} />
        </Field>
        <ErrorNote error={req.error} />
        <div>
          <Button variant="primary" data-ui="requestRefAdd" disabled={!!why || req.isPending} reason={why} onClick={submit}>
            {R.submit}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
