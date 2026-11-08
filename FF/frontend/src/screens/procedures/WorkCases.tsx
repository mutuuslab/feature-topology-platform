import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { WorkflowArtifact, WorkflowArtifactBody, WorkflowCaseDetail, WorkflowHandoffBody, WorkflowRoleGrant, WorkflowSourceObservation, WorkflowSourceView } from '@ff/contracts';
import { WORKFLOW_ARTIFACT_REQUEST_MAX, workflowArtifactRequestBytes } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { workflowExecution as T } from '../../copy/workflow-execution';
import { localTime, personName } from '../../data/people';
import { useWorkflowResource, useWorkflows } from '../../data/workflows';
import { AsyncView, Button, Drawer, ErrorNote, Field, PageHeader, Panel, useUnsavedGuard } from '../../design';
import { menuRouteOf } from '../../shell/departmentMenu';
import './workflow-execution.css';

interface Identity { accountId:string; accountState:string; roleIds:string[]; roles:{id:string;name:string}[]; canAssign:boolean }
interface CaseSummary { caseId:string; title:string; processId:string; targetRef:string; version:number; submitted:number; accepted:number; handoffs:number; updatedAt:string }
const INVALIDATE=['workflowCases','workflowCase','workflowIdentity','workflowRoleGrants'];
const split=(s:string)=>s.split('\n').map(v=>v.trim()).filter(Boolean);

export function WorkflowWorkScreen() {
  const {doc,retry:retryModel}=useWorkflowResource(),[sp,setSp]=useSearchParams(),id=sp.get('case')??'';
  const identity=useApi<Identity>('workflowIdentity'),list=useApi<{items:CaseSummary[]}>('workflowCases');
  const selected=useApi<WorkflowCaseDetail>('workflowCase',{params:{id}},{enabled:!!id});
  const create=useApiMutation<WorkflowCaseDetail>('createWorkflowCase',INVALIDATE);
  const [creating,setCreating]=useState(false),[form,setForm]=useState({processId:'',title:'',targetRef:''});
  const roles=identity.data?.roleIds??[];
  const processes=doc&&doc!=='fail'?doc.processes.filter(p=>p.activities.some(a=>[...a.raci.R,a.raci.A].some(r=>roles.includes(r)))):[];
  return <div className="ds-screen">
    <PageHeader title={T.title} lead={T.lead} actions={<Button variant="primary" onClick={()=>setCreating(true)} disabled={!processes.length} reason={identity.isPending||doc===null?T.identityLoading:!processes.length?T.noRole:undefined}>{T.newCase}</Button>} />
    <p className="ds-callout" data-tone="neutral">{T.boundary}</p>
    {doc===null&&<p role="status">{T.modelLoading}</p>}
    {doc==='fail'&&<div role="alert"><p>{T.modelFailure}</p><Button onClick={retryModel}>{T.retry}</Button></div>}
    <AsyncView state={asyncState(identity)} error={identity.error} onRetry={()=>identity.refetch()}/>
    <div className="wf-work">
      <Panel title={T.cases}>
        <AsyncView state={asyncState(list,!list.data?.items.length)} error={list.error} onRetry={()=>list.refetch()} empty={{title:T.noCases}}>
          <ul className="wf-cases">{list.data?.items.map(c=><li key={c.caseId}><Link to={`?case=${encodeURIComponent(c.caseId)}`} aria-current={id===c.caseId?'page':undefined}><strong>{c.title}</strong><small>{c.targetRef}</small><small>{T.caseCounts(c.submitted,c.accepted,c.handoffs)}</small><small>{T.versionLabel(c.version)} · {localTime(c.updatedAt)}</small></Link></li>)}</ul>
        </AsyncView>
      </Panel>
      {id?<AsyncView state={asyncState(selected)} error={selected.error} onRetry={()=>selected.refetch()}>{selected.data&&doc&&doc!=='fail'&&<CaseWork key={id} detail={selected.data} doc={doc} identity={identity.data} reload={()=>selected.refetch()} />}</AsyncView>:<p>{T.chooseCase}</p>}
    </div>
    {identity.data?.canAssign&&<RoleAssignments identity={identity.data} />}
    {creating&&<Drawer open title={T.newCase} onClose={()=>setCreating(false)}><div className="ds-stack">
      <Field label={T.process}><select aria-label={T.process} className="ds-input" value={form.processId} onChange={e=>setForm({...form,processId:e.target.value})}><option value="">{T.process}</option>{processes.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></Field>
      <Field label={T.caseTitle}><input className="ds-input" value={form.title} maxLength={200} onChange={e=>setForm({...form,title:e.target.value})}/></Field>
      <Field label={T.target} hint={T.targetHint}><input className="ds-input" value={form.targetRef} maxLength={300} onChange={e=>setForm({...form,targetRef:e.target.value})}/></Field>
      <ErrorNote error={create.error}/><Button variant="primary" disabled={!form.processId||form.title.trim().length<2||!form.targetRef.trim()||create.isPending} onClick={()=>create.mutate({body:form},{onSuccess:d=>{setCreating(false);setForm({processId:'',title:'',targetRef:''});setSp({case:d.item.caseId});}})}>{T.create}</Button>
    </div></Drawer>}
  </div>;
}

type Doc=NonNullable<Exclude<ReturnType<typeof useWorkflows>,'fail'>>;
interface Draft { version:number; fields:Record<string,string>; references:string; files:WorkflowArtifactBody['files']; reason:string }
function CaseWork({detail,doc,identity,reload}:{detail:WorkflowCaseDetail;doc:Doc;identity?:Identity;reload:()=>unknown}) {
  const {item}=detail,allActivities=doc.processes.flatMap(p=>p.activities.map(a=>({...a,processId:p.id}))),allProducts=doc.processes.flatMap(p=>p.workProducts);
  const available=allActivities.filter(a=>a.processId===item.processId||item.handoffs.some(h=>h.toActivityId===a.id));
  const [activityId,setActivity]=useState(available.find(a=>[...a.raci.R,a.raci.A].some(r=>detail.roleIds.includes(r)))?.id??available[0]?.id??''),[productKey,setProduct]=useState('');
  const a=available.find(v=>v.id===activityId)??available[0],record=a?item.activities[a.id]:undefined;
  const keys=[...new Set([...(a?.outputs??[]),...(a?.inputs??[])])],product=allProducts.find(w=>w.key===(keys.includes(productKey)?productKey:keys[0]));
  const [drafts,setDrafts]=useState<Record<string,Draft>>({}),[note,setNote]=useState(''),[reviewReason,setReviewReason]=useState(''),[handoffNote,setHandoffNote]=useState(''),[receiveReason,setReceiveReason]=useState(''),[nextId,setNext]=useState(''),[fileError,setFileError]=useState<string|null>(null);
  useUnsavedGuard(Object.keys(drafts).length>0);
  const pendingHandoffs=useRef<Record<string,WorkflowHandoffBody>>({});
  const sources=useApi<WorkflowSourceView>('workflowCaseSources',{params:{id:item.caseId}});
  const save=useApiMutation<WorkflowCaseDetail>('createWorkflowArtifact',INVALIDATE),submit=useApiMutation<WorkflowCaseDetail>('submitWorkflowActivity',INVALIDATE),review=useApiMutation<WorkflowCaseDetail>('reviewWorkflowActivity',INVALIDATE),offer=useApiMutation<WorkflowCaseDetail>('offerWorkflowHandoff',INVALIDATE),receive=useApiMutation<WorkflowCaseDetail>('receiveWorkflowHandoff',INVALIDATE);
  const mutations=[save,submit,review,offer,receive],reset=()=>mutations.forEach(m=>m.reset()),error=mutations.find(m=>m.error)?.error,busy=mutations.some(m=>m.isPending);
  const key=`${a?.id}|${product?.key}`,previous=[...item.artifacts].reverse().find(v=>v.activityId===a?.id&&v.productKey===product?.key);
  const draft=drafts[key]??{version:item.version,fields:{...(previous?.fields??{})},references:previous?.references.join('\n')??'',files:previous?.files.map(({name,mediaType,base64})=>({name,mediaType,base64}))??[],reason:''};
  const change=(patch:Partial<Draft>)=>setDrafts(v=>({...v,[key]:{...draft,...patch}}));
  const mine=!!a&&[...a.raci.R,a.raci.A].some(r=>detail.roleIds.includes(r));
  const locked=!mine||record?.status==='SUBMITTED'||record?.status==='ACCEPTED';
  const canReview=!!identity&&!!a&&[...a.raci.R,a.raci.A,...a.raci.C].some(r=>detail.roleIds.includes(r))&&record?.submittedBy!==identity.accountId&&!item.artifacts.some(v=>record?.artifactIds.includes(v.artifactId)&&v.by===identity.accountId);
  const native=[...new Set(a?.platform.screens.map(s=>menuRouteOf(s)?.menu).filter((x):x is string=>!!x)??[])];
  const recipient=(targetId:string)=>!!identity&&allActivities.some(v=>v.id===targetId&&[...v.raci.R,v.raci.A].some(r=>detail.roleIds.includes(r)));
  function attachSource(source:WorkflowSourceObservation) {
    const {record,...observation}=source;
    const bytes=new TextEncoder().encode(JSON.stringify({observation,record},null,2));
    if(bytes.length>256*1024||draft.files.length>=3){setFileError(T.fileError);return;}
    const base64=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
    change({files:[...draft.files,{name:`${source.kind}-${source.id.replace(/[^A-Za-z0-9._-]/g,'_')}.json`,mediaType:'application/json',base64}]});
  }
  async function files(input:FileList|null) {
    setFileError(null);if (!input) return;
    const added=[...input];if(draft.files.length+added.length>3||added.some(f=>f.size>256*1024||!f.size)){setFileError(T.fileError);return;}
    const values=await Promise.all(added.map(f=>new Promise<WorkflowArtifactBody['files'][number]>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:f.name,mediaType:f.type||'application/octet-stream',base64:String(reader.result).split(',')[1]});reader.onerror=reject;reader.readAsDataURL(f);}))).catch(()=>null);
    if(!values){setFileError(T.fileError);return;}change({files:[...draft.files,...values]});
  }
  if(!a)return <p>{T.noRole}</p>;
  return <div className="wf-case ds-why-inline">
    <header className="wf-case__identity"><h2>{item.title}</h2><p>{item.targetRef}</p><p>{T.versionLabel(item.version)}</p><Button variant="ghost" onClick={()=>void reload()}>{T.reload}</Button></header>
    <Field label={T.activity}><select aria-label={T.activity} className="ds-input" value={a.id} onChange={e=>{setActivity(e.target.value);setProduct('');reset();}}>{available.map(v=><option key={v.id} value={v.id}>{v.name} · {T.status[item.activities[v.id]?.status??'DRAFT']}</option>)}</select></Field>
    <p><strong>{T.status[record?.status??'DRAFT']}</strong>{record?.reason&&` · ${record.reason}`}</p>
    <details><summary>{T.source}</summary><ul>{native.map(path=><li key={path}><Link to={path}>{menuRouteOf(path)?.title??path}</Link></li>)}</ul></details>
    <Panel title={T.sourceRecords}><p>{T.sourceRecordHint}</p><Button variant="ghost" onClick={()=>sources.refetch()}>{T.sourceRefresh}</Button><AsyncView state={asyncState(sources)} error={sources.error} onRetry={()=>sources.refetch()}>{sources.data&&<><p>{sources.data.status==='RESOLVED'?T.sourceResolved:T.sourceDeclared}</p><p>{sources.data.limitation}</p>{!sources.data.items.length&&<p>{T.sourceNoRecords}</p>}{sources.data.items.map(s=><details className="wf-artifact" key={`${s.kind}|${s.id}`}><summary>{s.kind} · {s.id} · {s.state??'—'}</summary><p>{s.revision??'—'} · {localTime(s.observedAt)}</p><small>SHA-256 {s.recordHash}</small><pre className="wf-source-record">{JSON.stringify(s.record,null,2)}</pre><Button disabled={!mine||!product||busy||record?.status==='SUBMITTED'||record?.status==='ACCEPTED'} onClick={()=>attachSource(s)}>{T.sourceAttach}</Button></details>)}{sources.data.unavailable.length>0&&<p>{T.sourceUnavailable}: {sources.data.unavailable.join(', ')}</p>}</>}</AsyncView></Panel>
    <Panel title={T.editArtifact}><div className="ds-stack">
      <Field label={T.product}><select aria-label={T.product} className="ds-input" value={product?.key??''} onChange={e=>setProduct(e.target.value)}>{keys.map(k=><option key={k} value={k}>{allProducts.find(w=>w.key===k)?.name??k}{a.outputs.includes(k)?` · ${T.outputs}`:` · ${T.inputs}`}</option>)}</select></Field>
      {product?.content.map((label,i)=><Field label={label} key={i}><textarea className="ds-input" readOnly={locked} rows={3} value={draft.fields[String(i)]??''} maxLength={8000} onChange={e=>change({fields:{...draft.fields,[String(i)]:e.target.value}})}/></Field>)}
      <Field label={T.references} hint={T.referenceHint}><textarea className="ds-input" readOnly={locked} rows={3} value={draft.references} onChange={e=>change({references:e.target.value})}/></Field>
      <Field label={T.files} hint={T.filesHint}><input type="file" disabled={locked} multiple onChange={e=>void files(e.target.files)}/></Field>
      {draft.files.map((f,i)=><p key={`${f.name}-${i}`}>{f.name}<Button variant="ghost" disabled={locked} onClick={()=>change({files:draft.files.filter((_,n)=>n!==i)})}>{T.close}</Button></p>)}
      {fileError&&<p role="alert">{fileError}</p>}
      <Field label={T.changeReason}><input className="ds-input" readOnly={locked} value={draft.reason} maxLength={1000} onChange={e=>change({reason:e.target.value})}/></Field>
      <Button disabled={!mine||!product||draft.reason.trim().length<2||busy||record?.status==='SUBMITTED'||record?.status==='ACCEPTED'} reason={!mine?T.noRole:undefined} onClick={()=>{reset();const body={version:draft.version,activityId:a.id,productKey:product!.key,fields:draft.fields,references:split(draft.references),files:draft.files,reason:draft.reason};if(workflowArtifactRequestBytes(body)>WORKFLOW_ARTIFACT_REQUEST_MAX){setFileError(T.bodyLimit);return;}setFileError(null);save.mutate({params:{id:item.caseId},body},{onSuccess:()=>setDrafts(v=>{const n={...v};delete n[key];return n;})});}}>{T.save}</Button>
      {drafts[key]&&draft.version!==item.version&&<Button onClick={()=>change({version:item.version})}>{T.rebase}</Button>}
    </div></Panel>
    <Panel title={T.versions}>{item.artifacts.filter(v=>v.activityId===a.id).length?item.artifacts.filter(v=>v.activityId===a.id).map(v=><ArtifactView key={v.artifactId} artifact={v} name={allProducts.find(p=>p.key===v.productKey)?.name??v.productKey} content={allProducts.find(p=>p.key===v.productKey)?.content??[]}/>):<p>{T.noVersions}</p>}</Panel>
    <Panel title={T.submit}><div className="ds-stack"><p>{T.submitHint}</p><ul>{a.checks.map((check,i)=><li key={i}>{check}</li>)}</ul><Field label={T.submitNote}><textarea className="ds-input" value={note} onChange={e=>setNote(e.target.value)}/></Field><Button disabled={!mine||note.trim().length<2||busy||record?.status==='SUBMITTED'||record?.status==='ACCEPTED'} reason={!mine?T.noRole:undefined} onClick={()=>{reset();submit.mutate({params:{id:item.caseId,activityId:a.id},body:{version:item.version,note}});}}>{T.submit}</Button></div></Panel>
    {record?.status==='SUBMITTED'&&<Panel title={T.reviewReason}><div className="ds-stack"><p>{T.reviewHint}</p><Field label={T.reviewReason}><textarea className="ds-input" value={reviewReason} onChange={e=>setReviewReason(e.target.value)}/></Field><div className="wf-case__actions">{(['ACCEPT','REVISE'] as const).map(decision=><Button key={decision} disabled={!canReview||reviewReason.trim().length<2||busy} reason={!canReview?T.reviewHint:undefined} onClick={()=>{reset();review.mutate({params:{id:item.caseId,activityId:a.id},body:{version:item.version,decision,reason:reviewReason}});}}>{decision==='ACCEPT'?T.accept:T.revise}</Button>)}</div></div></Panel>}
    <Panel title={T.handoffs}><div className="ds-stack">
      {record?.status==='ACCEPTED'&&a.next.length>0&&<><Field label={T.nextActivity}><select aria-label={T.nextActivity} className="ds-input" value={a.next.includes(nextId)?nextId:a.next[0]} onChange={e=>setNext(e.target.value)}>{a.next.map(n=><option key={n} value={n}>{allActivities.find(v=>v.id===n)?.name??n}</option>)}</select></Field><Field label={T.handoffNote}><textarea className="ds-input" value={handoffNote} onChange={e=>setHandoffNote(e.target.value)}/></Field><Button disabled={!mine||handoffNote.trim().length<2||busy} onClick={()=>{reset();const toActivityId=a.next.includes(nextId)?nextId:a.next[0],k=`${a.id}|${toActivityId}`;const pending=pendingHandoffs.current[k];const body=pendingHandoffs.current[k]=pending?{...pending,version:item.version}:{version:item.version,requestKey:crypto.randomUUID(),fromActivityId:a.id,toActivityId,note:handoffNote};offer.mutate({params:{id:item.caseId},body},{onSuccess:()=>{delete pendingHandoffs.current[k];setHandoffNote('');}});}}>{T.offer}</Button></>}
      {!item.handoffs.length&&<p>{T.noHandoff}</p>}
      {item.handoffs.map(h=><div className="wf-artifact" key={h.handoffId}><h4>{allActivities.find(v=>v.id===h.toActivityId)?.name??h.toActivityId} · {T.handoffStatus[h.status]}</h4><p>{h.note}</p><Button variant="ghost" onClick={()=>{setActivity(h.fromActivityId);setProduct('');reset();}}>{T.viewHandoffArtifacts}</Button><small>{personName(h.fromAccount)} · {localTime(h.offeredAt)}</small>{h.reason&&<p>{h.reason}</p>}{h.status==='OFFERED'&&<><Field label={T.receiveReason}><textarea className="ds-input" value={receiveReason} onChange={e=>setReceiveReason(e.target.value)}/></Field><div className="wf-case__actions">{(['ACCEPT','RETURN'] as const).map(decision=><Button key={decision} disabled={receiveReason.trim().length<2||busy||h.fromAccount===identity?.accountId||!recipient(h.toActivityId)} reason={!recipient(h.toActivityId)?T.noRole:undefined} onClick={()=>{reset();receive.mutate({params:{id:item.caseId,handoffId:h.handoffId},body:{version:item.version,decision,reason:receiveReason}});}}>{decision==='ACCEPT'?T.receive:T.return}</Button>)}</div></>}</div>)}
    </div></Panel>
    <ErrorNote error={error}/>
    <Panel title={T.history}><ol className="wf-history">{detail.history.map(h=><li key={h.id}><strong>{T.actions[h.action]??h.action}</strong><span>{personName(h.by)}</span><time dateTime={h.at}>{localTime(h.at)}</time><span>{T.versionLabel(h.version)}</span></li>)}</ol></Panel>
  </div>;
}

function ArtifactView({artifact:v,name,content}:{artifact:WorkflowArtifact;name:string;content:string[]}) {
  const download=(file:WorkflowArtifact['files'][number])=>{const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=file.name;a.click();URL.revokeObjectURL(url);};
  return <article className="wf-artifact"><h4>{name} · {T.version(v.revision)}</h4><small>{personName(v.by)} · {localTime(v.at)}</small><dl>{content.map((label,i)=><div key={i}><dt>{label}</dt><dd>{v.fields[String(i)]||'—'}</dd></div>)}</dl><ul>{v.references.map((r,i)=><li key={i}>{/^https:\/\//.test(r)||r.startsWith('/')&&!r.startsWith('//')?<a href={r} target="_blank" rel="noreferrer">{r}</a>:r}</li>)}</ul>{v.files.map((f,i)=><div key={i}><Button variant="ghost" onClick={()=>download(f)}>{T.download} · {f.name}</Button><small>{f.bytes} bytes · SHA-256 {f.sha256}</small></div>)}</article>;
}

function RoleAssignments({identity}:{identity:Identity}) {
  const grants=useApi<{items:WorkflowRoleGrant[]}>('workflowRoleGrants'),accounts=useApi<{items:{id:string;state:string}[]}>('workflowAssignableAccounts');
  const mutate=useApiMutation('setWorkflowRoleGrant',INVALIDATE),[f,set]=useState({accountId:'',roleId:'',reason:''});
  return <Panel title={T.grants}><p>{T.grantHint}</p><div className="ds-stack">
    <Field label={T.account}><select aria-label={T.account} className="ds-input" value={f.accountId} onChange={e=>set({...f,accountId:e.target.value})}><option value="">{T.account}</option>{accounts.data?.items.filter(a=>a.state==='ACTIVE').map(a=><option value={a.id} key={a.id}>{personName(a.id)}</option>)}</select></Field>
    <Field label={T.role}><select aria-label={T.role} className="ds-input" value={f.roleId} onChange={e=>set({...f,roleId:e.target.value})}><option value="">{T.role}</option>{identity.roles.map(r=><option value={r.id} key={r.id}>{r.name}</option>)}</select></Field>
    <Field label={T.grantReason}><input className="ds-input" value={f.reason} onChange={e=>set({...f,reason:e.target.value})}/></Field>
    <div className="wf-case__actions">{[true,false].map(active=><Button key={String(active)} disabled={!f.accountId||!f.roleId||f.reason.trim().length<2||mutate.isPending} onClick={()=>mutate.mutate({body:{...f,active}})}>{active?T.grant:T.revoke}</Button>)}</div><ErrorNote error={mutate.error}/>
    <h3>{T.currentGrants}</h3><AsyncView state={asyncState(grants,!grants.data?.items.length)} error={grants.error} onRetry={()=>grants.refetch()} empty={{title:T.noGrants}}><ul>{grants.data?.items.map(g=><li key={g.id}>{personName(g.accountId)} · {identity.roles.find(r=>r.id===g.roleId)?.name??g.roleId} · {g.active?T.active:T.inactive} · {g.reason}{g.active&&<Button variant="ghost" disabled={f.reason.trim().length<2||mutate.isPending} onClick={()=>mutate.mutate({body:{accountId:g.accountId,roleId:g.roleId,active:false,reason:f.reason}})}>{T.revoke}</Button>}</li>)}</ul></AsyncView>
  </div></Panel>;
}
