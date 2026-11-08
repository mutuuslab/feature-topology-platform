import { useRef, useState } from 'react';
import type { WorkflowCaseDetail, WorkflowCrossCaseOfferBody, WorkflowTransferTarget } from '@ff/contracts';
import { useApi, useApiMutation } from '../../api/hooks';
import { workflowArtifactsCopy } from '../../copy/workflow-artifacts';
import { workflowExecution } from '../../copy/workflow-execution';
import { localTime, personName } from '../../data/people';
import { Button, ErrorNote, Field, Panel } from '../../design';
import { WorkflowFileDownload } from './WorkflowFiles';

const INVALIDATE=['workflowCases','workflowCase','workflowTransferTargets'];
export function WorkflowTransfers({detail,activityId,accountId,names,roleLabels,products}:{detail:WorkflowCaseDetail;activityId:string;accountId?:string;names:Record<string,string>;roleLabels:Record<string,string>;products:Record<string,{name:string;content:string[]}>}) {
  const T=workflowArtifactsCopy(),{item}=detail,a=detail.model.activities.find(a=>a.id===activityId);
  const mine=!!a&&[...a.raci.R,a.raci.A].some(r=>detail.roleIds.includes(r));
  const targets=useApi<{items:WorkflowTransferTarget[]}>('workflowTransferTargets',{params:{id:item.caseId},query:{fromActivityId:activityId}},{enabled:mine&&item.activities[activityId]?.status==='ACCEPTED'});
  const offer=useApiMutation<WorkflowCaseDetail>('offerCrossCaseWorkflow',INVALIDATE),receive=useApiMutation<WorkflowCaseDetail>('receiveCrossCaseWorkflow',INVALIDATE);
  const [choice,setChoice]=useState(''),[note,setNote]=useState(''),[reasons,setReasons]=useState<Record<string,string>>({});
  const pending=useRef<Record<string,WorkflowCrossCaseOfferBody>>({});
  const options=(targets.data?.items??[]).flatMap(t=>t.activities.map(a=>({value:`${t.caseId}|${a.id}`,case:t,activity:a})));
  const picked=options.find(o=>o.value===choice)??options[0];
  const busy=offer.isPending||receive.isPending;
  const roleNames=(id:string)=>{const a=detail.model.activities.find(a=>a.id===id);return a?[...new Set([...a.raci.R,a.raci.A])].map(r=>roleLabels[r]??r).join(', '):'';};
  return <Panel title={T.title}><div className="ds-stack"><p>{T.guide}</p>
    {mine&&item.activities[activityId]?.status==='ACCEPTED'&&<>
      <Button variant="ghost" onClick={()=>targets.refetch()}>{T.refresh}</Button>
      {!targets.isPending&&!options.length&&<p>{T.none}</p>}
      {picked&&<><Field label={T.target}><select className="ds-input" aria-label={T.target} value={picked.value} onChange={e=>setChoice(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.case.title} · {names[o.activity.id]??o.activity.id} · {o.activity.productKeys.join(', ')}</option>)}</select></Field><Field label={T.note}><textarea className="ds-input" maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></Field><Button disabled={busy||note.trim().length<2} onClick={()=>{
        const key=picked.value,body=pending.current[key]??{version:item.version,targetVersion:picked.case.version,toCaseId:picked.case.caseId,fromActivityId:activityId,toActivityId:picked.activity.id,note,requestKey:crypto.randomUUID()};
        pending.current[key]=body;offer.mutate({params:{id:item.caseId},body:{...body,version:item.version,targetVersion:picked.case.version}},{onSuccess:()=>{delete pending.current[key];setNote('');}});
      }}>{T.offer}</Button></>}
    </>}
    {item.handoffs.filter(h=>h.toCaseId).map(h=>{
      const incoming=h.toCaseId===item.caseId,canReceive=incoming&&h.fromAccount!==accountId&&detail.model.activities.some(a=>a.id===h.toActivityId&&[...a.raci.R,a.raci.A].some(r=>detail.roleIds.includes(r)));
      return <article className="wf-artifact" key={h.handoffId}><h4>{incoming?T.incoming:T.outgoing} · {names[h.fromActivityId]??h.fromActivityId} → {names[h.toActivityId]??h.toActivityId} · {workflowExecution.handoffStatus[h.status]}</h4>
        <p>{T.source}: <code>{h.fromCaseId}</code> · {T.version} {h.sourceVersion}</p><p>{h.note}</p><small>{T.hash}: {h.artifactsHash}</small>
        {h.sourceReview?.reviewedBy&&<p>{workflowExecution.actions.WORKFLOW_ACTIVITY_REVIEW} · {personName(h.sourceReview.reviewedBy)} · {localTime(h.sourceReview.reviewedAt)}</p>}
        <p>{personName(h.fromAccount)} → {roleNames(h.toActivityId)||h.toActivityId}</p>
        <details><summary>{T.payload}</summary>{h.artifacts?.map(v=><div key={v.artifactId}><strong>{products[v.productKey]?.name??v.productKey} · {workflowExecution.version(v.revision)}</strong><small>{v.artifactId} · {personName(v.by)}</small><dl>{Object.entries(v.fields).map(([key,value])=><div key={key}><dt>{products[v.productKey]?.content[Number(key)]??key}</dt><dd>{value}</dd></div>)}</dl><ul>{v.references.map(r=><li key={r}>{r}</li>)}</ul>{v.files.map((f,i)=><WorkflowFileDownload key={f.fileId??i} caseId={item.caseId} file={f}/>)}</div>)}</details>
        {h.reason&&<p>{personName(h.receivedBy)} · {h.reason}</p>}
        {h.status==='OFFERED'&&incoming&&<><Field label={T.review} hint={canReceive?T.boundary:T.locked}><textarea className="ds-input" readOnly={!canReceive} maxLength={2000} value={reasons[h.handoffId]??''} onChange={e=>setReasons({...reasons,[h.handoffId]:e.target.value})}/></Field><div className="wf-case__actions">{(['ACCEPT','RETURN'] as const).map(decision=><Button key={decision} disabled={!canReceive||busy||(reasons[h.handoffId]??'').trim().length<2||!detail.transferVersions?.[h.fromCaseId!]} onClick={()=>receive.mutate({params:{id:item.caseId,handoffId:h.handoffId},body:{version:item.version,sourceVersion:detail.transferVersions![h.fromCaseId!],decision,reason:reasons[h.handoffId]}})}>{decision==='ACCEPT'?T.accept:T.reject}</Button>)}</div></>}
      </article>;
    })}
    <p className="ds-callout">{T.boundary}</p><ErrorNote error={targets.error??offer.error??receive.error}/>
  </div></Panel>;
}
