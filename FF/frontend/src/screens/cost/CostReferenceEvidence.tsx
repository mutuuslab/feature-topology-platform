import { useState } from 'react';
import type { CostReferenceOrigin } from '@ff/contracts';
import { asyncState,useApi,useApiMutation } from '../../api/hooks';
import { costReference as T } from '../../copy/cost';
import { AsyncView,Button,Drawer,ErrorNote,Field,Panel } from '../../design';
import type { CostDetailResponse,CostLineRow } from './common';
import { CostReferencePicker } from './CostReferencePicker';

export function CostReferenceEvidence({d,line,editable,onClose}:{d:CostDetailResponse;line:Pick<CostLineRow,'lineNo'|'refId'|'sourceRevision'|'source'>;editable:boolean;onClose:()=>void}) {
 const [revision,setRevision]=useState(line.sourceRevision ?? 0);const [changing,setChanging]=useState(false);const [reason,setReason]=useState('');
 const history=useApi<CostReferenceOrigin>('costReferenceHistory',{params:{estId:d.project.estId,lineNo:String(line.lineNo),revision:String(revision)}},{enabled:revision>0});
 const update=useApiMutation('costReferenceUpdate',['costProject','costProjects']);const source=history.data ?? line.source;
 return <Drawer open title={`${line.refId} · ${T.source}`} onClose={onClose} dirty={!!reason}>
  <div className="ds-stack">
   <p>{T.sourceGuide}</p>
   {!line.sourceRevision?<p role="status">{T.legacy}</p>:<AsyncView state={asyncState(history)} error={history.error} onRetry={()=>history.refetch()}>
    {source && <>
     <Field label={T.history}><select className="ds-select" value={revision} onChange={e=>setRevision(Number(e.target.value))}>{source.history.map(r=><option key={r.revision} value={r.revision}>{T.revision} {r.revision} · {r.release} · {r.capturedAt}</option>)}</select></Field>
     <Panel title={source.reference?.nameKo ?? line.refId}>
      {source.stale && <p role="status">{T.stale}</p>}
      <dl><dt>{T.release}</dt><dd>{source.release}</dd><dt>{T.hash}</dt><dd className="ds-mono" style={{overflowWrap:'anywhere'}}>{source.referenceSha256}</dd><dt>{T.feature}</dt><dd>{source.feature?`${source.feature.featureId} @ ${source.feature.version} · ${source.feature.name}`:T.none}</dd><dt>{T.scope}</dt><dd>{source.reference?.domain} › {source.reference?.component} · {source.feature?.requirementIds.join(', ') || '—'}</dd><dt>{T.reason}</dt><dd>{source.reason} · {source.capturedBy} · {source.capturedAt}</dd></dl>
      <p>{source.reference?.definition?.summary || '—'}</p>
      <p>{T.scopeIn}: {source.reference?.definition?.scopeIn?.join(' · ') || '—'} / {T.scopeOut}: {source.reference?.definition?.scopeOut?.join(' · ') || '—'}</p>
      <dl><dt>{T.procurement}</dt><dd>{source.reference?.procurement || '—'} · {source.reference?.swPackage || '—'}</dd><dt>{T.license}</dt><dd>{source.reference?.licenseItem || '—'} · {source.reference?.billing || '—'}</dd><dt>{T.evidence}</dt><dd>{source.reference?.sizeEvidenceGrade || '—'} · {source.reference?.evidenceCheckedAt || '—'} · {source.reference?.registeredIn || '—'}</dd></dl>
      <p>{source.reference?.sourceDetail || '—'}</p>
      <ul>{source.sources.map(s=><li key={s.sourceId}>{s.sourceId} · {s.title} · {s.url}</li>)}</ul>
     </Panel>
    </>}
   </AsyncView>}
   {editable && <Button onClick={()=>setChanging(v=>!v)}>{T.change}</Button>}
   {changing && <>
    <Field label={T.reason}><input className="ds-input" value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></Field>
    <CostReferencePicker initialRef={line.refId} basisVersion={d.project.basisVersion} pending={update.isPending || reason.trim().length<2} onChoose={selection=>update.mutate({params:{estId:d.project.estId,lineNo:String(line.lineNo)},body:{selection,revision:line.sourceRevision ?? 0,reason:reason.trim()}},{onSuccess:onClose})}/>
    <ErrorNote error={update.error}/>
   </>}
   <p className="ds-field__hint">{T.boundary}</p>
  </div>
 </Drawer>;
}
