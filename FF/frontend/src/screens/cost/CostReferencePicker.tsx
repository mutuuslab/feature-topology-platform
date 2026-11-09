import { useState } from 'react';
import type { AddCostReferenceBody,FeatureRefRow,RefSource } from '@ff/contracts';
import { asyncState,useApi } from '../../api/hooks';
import {costPurchasing as CP} from '../../copy/cost-purchasing';
import { costReference as T } from '../../copy/cost';
import { AsyncView,Button,DataTable,ErrorNote,Field,Panel } from '../../design';
import { useUiLocale } from '../../locale/react';
import { RefChip,RefStatusBadge } from '../refdb/common';
import { useRefSearch,type RefSearchRow } from '../refdb/refSearch';

export interface CostReferencePreview {
 provenance?:{kind:string};ref:FeatureRefRow;basisVersion:string;refRelease:string|null;referenceSha256:string;usable:boolean;missing:string[];
 features:{featureId:string;version:string;name:string;asil:string;lifecycle:string;sha256:string}[];sources:RefSource[];
}
export function CostReferencePicker({basisVersion,initialRef,excluded=[],onChoose,pending=false}:{basisVersion?:string;initialRef?:string;excluded?:string[];pending?:boolean;onChoose:(selection:AddCostReferenceBody,preview:CostReferencePreview)=>void}) {
 const locale=useUiLocale();const [text,setText]=useState('');const [domain,setDomain]=useState('');const [offset,setOffset]=useState(0);const [selected,setSelected]=useState(initialRef ?? '');const [feature,setFeature]=useState('');
 const q=useRefSearch<RefSearchRow>({q:text.trim()||undefined,domain:domain||undefined,limit:10,offset});
 const preview=useApi<CostReferencePreview>('costReference',{params:{refId:selected},query:{basisVersion}},{enabled:!!selected});
 const p=preview.data?.ref?preview.data:undefined;const rows=q.data?.items ?? [];const domains=Object.keys(q.data?.facets?.domain ?? {});
 const name=(r:Pick<FeatureRefRow,'nameKo'|'nameEn'>)=>locale.language==='en'?r.nameEn:r.nameKo;
 return <div className="ds-stack">
  <p className="ds-field__hint">{T.guide}</p>
  {!initialRef && <>
   <div className="ds-form-grid">
    <Field label={T.search}><input className="ds-input" value={text} onChange={e=>{setText(e.target.value);setOffset(0);}} /></Field>
    <Field label={T.domain}><select className="ds-select" value={domain} onChange={e=>{setDomain(e.target.value);setOffset(0);}}><option value="">{T.all}</option>{[...new Set([...domains,domain].filter(Boolean))].map(d=><option key={d}>{d}</option>)}</select></Field>
   </div>
   <AsyncView state={asyncState(q,!rows.length)} error={q.error} onRetry={()=>q.refetch()} filtered>
    <DataTable rows={rows} rowKey={r=>r.refId} caption={T.title} columns={[
     {key:'name',header:T.selected,cell:r=><span><RefChip id={r.refId}/> {name(r as FeatureRefRow)}</span>},
     {key:'status',header:T.scope,cell:r=><RefStatusBadge status={r.status}/>},
     {key:'choose',header:T.choose,cell:r=><Button disabled={excluded.includes(r.refId)} onClick={()=>{setSelected(r.refId);setFeature('');}}>{r.refId===selected?T.selected:T.choose}</Button>},
    ]}/>
   </AsyncView>
   <div><Button disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-10))}>{T.previous}</Button>{' '}<Button disabled={offset+rows.length >= (q.data?.total ?? 0)} onClick={()=>setOffset(n=>n+10)}>{T.next}</Button></div>
  </>}
  {selected && <AsyncView state={asyncState(preview)} error={preview.error} onRetry={()=>preview.refetch()}>
   {p && <Panel title={`${p.ref.refId} · ${name(p.ref)}`}>
    <div className="ds-stack">
     <dl><dt>{T.scope}</dt><dd>{p.ref.domain} › {p.ref.component}</dd><dt>{T.facts}</dt><dd>{p.ref.tshirt} · ASIL {p.ref.asilRep} · {p.ref.lifecycle} · {p.ref.autoQuality}</dd><dt>{T.release}</dt><dd>{p.refRelease ?? '—'}</dd><dt>{T.basis}</dt><dd>{p.basisVersion}</dd><dt>{T.hash}</dt><dd className="ds-mono" style={{overflowWrap:'anywhere'}}>{p.referenceSha256}</dd></dl>
     <p>{p.ref.definition?.summary || '—'}</p>
     <p>{T.scopeIn}: {p.ref.definition?.scopeIn?.join(' · ') || '—'} / {T.scopeOut}: {p.ref.definition?.scopeOut?.join(' · ') || '—'}</p>
     {p.provenance?.kind==='WORKBOOK_DERIVED_REFERENCE'&&<p className="ds-field__hint">{CP.derivedSource}</p>}<dl><dt>{T.procurement}</dt><dd>{p.ref.procurement || '—'} · {p.ref.swPackage || '—'}</dd><dt>{T.license}</dt><dd>{p.ref.licenseItem || '—'} · {p.ref.billing || '—'}</dd><dt>{T.evidence}</dt><dd>{p.ref.sizeEvidenceGrade || '—'} · {p.ref.evidenceCheckedAt || '—'} · {p.ref.registeredIn || '—'}</dd></dl>
     {p.ref.adminMemo && <p>{p.ref.adminMemo}</p>}
     <p className="ds-field__hint">{T.source}: {p.ref.sourceIds.join(', ') || '—'} · {p.ref.sourceDetail || '—'}</p>
     <Field label={T.feature} hint={T.featureHint}><select className="ds-select" value={feature} onChange={e=>setFeature(e.target.value)}><option value="">{T.none}</option>{p.features.map(f=><option key={`${f.featureId}@${f.version}`} value={`${f.featureId}@${f.version}`}>{f.featureId} @ {f.version} · {f.name}</option>)}</select></Field>
     {!p.usable && <p role="alert">{T.blocked} {p.missing.length>0?`${T.missing}: ${p.missing.join(', ')}`:''}</p>}
     <Button variant="primary" disabled={!p.usable || !p.refRelease || pending} onClick={()=>{const f=p.features.find(f=>`${f.featureId}@${f.version}`===feature);onChoose({refId:p.ref.refId,refRelease:p.refRelease!,referenceSha256:p.referenceSha256,feature:f?{featureId:f.featureId,version:f.version,sha256:f.sha256}:null},p);}}>{T.choose}</Button>
     <p className="ds-field__hint">{T.assumptions}</p>
    </div>
   </Panel>}
  </AsyncView>}
 </div>;
}
