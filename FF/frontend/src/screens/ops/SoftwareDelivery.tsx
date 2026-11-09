import './software-delivery.css';
import { localTime, personName } from '../../data/people';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { asyncState,useApi,useApiMutation } from '../../api/hooks';
import { actorFor } from '../../api/actor';
import { downloadSoftware,sha256,softwareTraceTone,uploadSoftware,type SoftwarePackageView,type SoftwareVerdict } from '../../api/software';
import { softwareDelivery as T } from '../../copy/software-delivery';
import { useUiLocale } from '../../locale/react';
import { useAppShell } from '../../store';
import { AsyncView,Button,DataTable,ErrorNote,Field,PageHeader,Panel } from '../../design';
import { usePermission } from '../shared';

interface Feature {featureId:string;version:string;name:string;swIds:string[];country:string;vehicleModel:string;trim:string}
interface Policy {policyId:string;flagKey:string;featureId:string;featureVersion:string;status:string}
interface Vehicle {vin:string;label:string;country:string;vehicleModel:string;trim:string}
export default function SoftwareDelivery(){
 useUiLocale();const {role}=useAppShell(),write=usePermission(['IMPLEMENTER','RELEASE_MANAGER']),review=usePermission(['RELEASE_MANAGER']),read=usePermission(['IMPLEMENTER','RELEASE_MANAGER','OPERATOR','AUDITOR']),download=usePermission(['IMPLEMENTER','RELEASE_MANAGER','OPERATOR']);
 const features=useApi<{items:Feature[]}>('listFeatures'),policies=useApi<{items:Policy[]}>('listPolicies'),vehicles=useApi<{items:Vehicle[]}>('vehicles');
 const packages=useApi<{items:SoftwarePackageView[]}>('softwarePackages');
 const create=useApiMutation<SoftwarePackageView>('createSoftwarePackage',['softwarePackages']);
 const decision=useApiMutation<SoftwarePackageView>('reviewSoftwarePackage',['softwarePackages','softwarePackage','softwareDownloadHistory']);
 const [featureKey,setFeature]=useState(''),[swId,setSw]=useState(''),[file,setFile]=useState<File|null>(null),[source,setSource]=useState<'UPLOADED_SOFTWARE'|'EXECUTABLE_DEMO'>('UPLOADED_SOFTWARE'),[reason,setReason]=useState(''),[selected,setSelected]=useState(''),[vin,setVin]=useState(''),[flag,setFlag]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[verdict,setVerdict]=useState<SoftwareVerdict|null>(null),[verified,setVerified]=useState(false);
 const check=useApiMutation<SoftwareVerdict>('checkSoftwareDownload',[]);
 const selectedFeature=features.data?.items.find(x=>`${x.featureId}@${x.version}`===featureKey);
 const detail=useApi<{feature:Feature}>('featureDetail',{params:{id:selectedFeature?.featureId??'',ver:selectedFeature?.version??''}},{enabled:!!selectedFeature});
 const f=detail.data?.feature,sw=swId||f?.swIds?.[0]||'';
 const item=packages.data?.items.find(p=>p.packageId===selected);
 const possible=policies.data?.items.filter(p=>p.status==='DEPLOYED'&&p.featureId===item?.featureId&&p.featureVersion===item?.featureVersion)??[];
 const flagKey=possible.some(p=>p.flagKey===flag)?flag:possible[0]?.flagKey??'';
 const currentFeature=features.data?.items.find(f=>f.featureId===item?.featureId&&f.version===item?.featureVersion);
 const fleet=vehicles.data?.items.filter(v=>!currentFeature||v.country===currentFeature.country&&v.vehicleModel===currentFeature.vehicleModel&&v.trim===currentFeature.trim)??[];
 const history=useApi<{items:{downloadId:string;vin:string;at:string;bytes:number;sha256:string;state:string}[]}>('softwareDownloadHistory',{params:{id:selected}},{enabled:!!selected});
 const reset=()=>{setVerdict(null);setVerified(false);setError(null);};
 function demo(){if(!f)return;const metadata={featureId:f.featureId,featureVersion:f.version,swId:sw,source:'EXECUTABLE_DEMO',installationPerformed:false};const code=`// Feature Platform executable test software. No ECU installation.\nexport const metadata = ${JSON.stringify(metadata,null,2)};\nexport function calculate(a, b) { return Number(a) + Number(b); }\nconsole.log(JSON.stringify({ ...metadata, selfTest: calculate(2, 3) === 5 }));\n`;setFile(new File([code],`${f.featureId}-${f.version}-demo.mjs`,{type:'text/javascript'}));setSource('EXECUTABLE_DEMO');}
 async function register(){if(!f||!file)return;setBusy(true);reset();try{const hash=await sha256(file),uploaded=await uploadSoftware(file,role);if(uploaded.sha256!==hash||uploaded.bytes!==file.size)throw new Error('SOFTWARE_INTEGRITY');const created=await create.mutateAsync({body:{fileId:uploaded.fileId,featureId:f.featureId,featureVersion:f.version,swId:sw,sha256:hash,source,reason}});setSelected(created.packageId);setFile(null);}catch(e){setError(e);}finally{setBusy(false);}}
 async function getFile(){if(!verdict)return;setBusy(true);setVerified(false);setError(null);try{const blob=await downloadSoftware(verdict,role),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=verdict.package.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setVerified(true);await history.refetch();}catch(e){setError(e);setVerdict(null);}finally{setBusy(false);}}
 return <div className="ds-screen"><PageHeader title={T.title} lead={T.lead} message={{tone:'neutral',value:packages.data?.items.length??'—',text:T.key}} actions={<Link to="/deployments">←</Link>}/>
   <Panel title={T.guide}><ol className="software-guide">{T.steps.map(step=><li key={step}>{step}</li>)}</ol><p className="ds-callout" data-tone="neutral">{T.boundary}</p></Panel>
   <Panel title={T.register}><div className="ds-stack">
     <AsyncView state={asyncState(features)} error={features.error} onRetry={()=>features.refetch()}/>
     <Field label={T.feature}><select className="ds-input" aria-label={T.feature} value={featureKey} onChange={e=>{setFeature(e.target.value);setSw('');setFile(null);}}><option value="">{T.choose}</option>{features.data?.items.map(f=><option key={`${f.featureId}@${f.version}`} value={`${f.featureId}@${f.version}`}>{f.featureId}@{f.version} · {f.name}</option>)}</select></Field>
     {!!selectedFeature&&<AsyncView state={asyncState(detail)} error={detail.error} onRetry={()=>detail.refetch()}/>}
     {f&&!f.swIds.length&&<p>{T.noSw} <Link to={`/features/${f.featureId}/${f.version}`}>{T.featureDetail} →</Link></p>}<Field label={T.sw}><select className="ds-input" aria-label={T.sw} value={sw} onChange={e=>{setSw(e.target.value);setFile(null);}} disabled={!f}><option value="">{T.choose}</option>{f?.swIds.map(id=><option key={id}>{id}</option>)}</select></Field>
     <Field label={T.file}><input type="file" aria-label={T.file} disabled={!write.ok||!sw||busy} onChange={e=>{setFile(e.target.files?.[0]??null);setSource('UPLOADED_SOFTWARE');}}/>{file&&<p>{file.name} · {file.size.toLocaleString()} B</p>}</Field>
     <Button onClick={demo} disabled={!write.ok||!sw||busy} reason={write.hint}>{T.demo}</Button><p className="ds-field__hint">{T.demoHint}</p>
     <Field label={T.reason} hint={T.reasonHint}><textarea className="ds-input" aria-label={T.reason} value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)}/></Field>
     <Button variant="primary" onClick={register} disabled={!write.ok||!file||!sw||reason.trim().length<4||busy} reason={write.hint}>{busy?T.uploading:T.upload}</Button>
   </div></Panel>
   <Panel title={T.packages}><AsyncView state={asyncState(packages,!packages.data?.items.length)} error={packages.error} onRetry={()=>packages.refetch()} empty={{title:T.noPackages}}>
     <Field label={T.package}><select className="ds-input" aria-label={T.package} value={selected} onChange={e=>{setSelected(e.target.value);setVin('');setFlag('');reset();}}><option value="">{T.choose}</option>{packages.data?.items.map(p=><option value={p.packageId} key={p.packageId}>{p.name} · {p.featureId}@{p.featureVersion} · {T.states[p.status]}</option>)}</select></Field>
   </AsyncView></Panel>
   {item&&<><Panel title={T.decision}>{item.provenance&&<p className="ds-callout" data-tone="neutral">{T.provenance[item.provenance]} · {T.staticBoundary}</p>}<dl className="software-meta"><dt>{T.status}</dt><dd>{T.states[item.status]}</dd><dt>{T.source}</dt><dd>{T.sources[item.source]}</dd><dt>{T.sw}</dt><dd>{item.swId}</dd><dt>{T.bytes}</dt><dd>{item.bytes.toLocaleString()} B</dd><dt>{T.hash}</dt><dd style={{overflowWrap:'anywhere'}}>{item.sha256}</dd><dt>{T.author}</dt><dd>{personName(item.createdBy)}</dd><dt>{T.reviewer}</dt><dd>{item.reviewedBy?personName(item.reviewedBy):'—'}</dd></dl>
     <p>{T.independent}</p><Button disabled={!review.ok||item.createdBy===actorFor(role).id||reason.trim().length<4||decision.isPending||item.status==='REVOKED'} reason={review.hint} onClick={()=>{reset();decision.mutate({params:{id:item.packageId},body:{revision:item.revision,decision:item.status==='DRAFT'?'APPROVE':'REVOKE',reason}});}}>{item.status==='DRAFT'?T.approve:T.revoke}</Button>
     <Field label={T.flag}><select className="ds-input" aria-label={T.flag} value={flagKey} onChange={e=>{setFlag(e.target.value);reset();}}><option value="">{T.choose}</option>{possible.map(p=><option key={p.policyId} value={p.flagKey}>{p.flagKey} · {p.policyId}</option>)}</select></Field>{!possible.length&&<p>{T.noPolicy}</p>}
     <Field label={T.vin}><select className="ds-input" aria-label={T.vin} value={vin} onChange={e=>{setVin(e.target.value);reset();}}><option value="">{T.choose}</option>{fleet.map(v=><option key={v.vin} value={v.vin}>{v.vin} · {v.label}</option>)}</select></Field>
     <Button disabled={!read.ok||!flagKey||!vin||check.isPending||busy} reason={read.hint} onClick={()=>{reset();check.mutate({params:{id:item.packageId},body:{vin,flagKey}},{onSuccess:setVerdict});}}>{check.isPending?T.checking:T.check}</Button>
     {verdict&&<div role="status"><strong>{verdict.allowed?T.allowed:T.blocked}</strong>{verdict.blocked&&<p>{T.causes[verdict.blocked as keyof typeof T.causes]??verdict.blocked}</p>}<dl className="software-meta"><dt>{T.policy}</dt><dd>{verdict.policy?`${verdict.policy.policyId} · r${verdict.policy.revision}`:'—'}</dd><dt>{T.flag}</dt><dd>{verdict.flagKey} · {String(verdict.evaluation?.value??'—')} · {verdict.evaluation?.reason??'—'}</dd><dt>{T.publicKey}</dt><dd>{verdict.signature?.keyId??'—'}</dd><dt>{T.keyExpiry}</dt><dd>{verdict.publicKey?.notAfter??'—'}</dd></dl><Button variant="primary" disabled={!verdict.allowed||!download.ok||busy} reason={download.hint} onClick={getFile}>{busy?T.downloading:T.download}</Button></div>}
          {verdict?.evaluation?.trace&&<section aria-label={T.evaluationTrace}><h3>{T.evaluationTrace}</h3>{verdict.checkedAt&&<p>{T.checkedAt} · {localTime(verdict.checkedAt)}</p>}<ol className="software-trace">{verdict.evaluation.trace.map((step,i)=><li key={`${step.step}-${i}`} data-result={step.result} data-tone={softwareTraceTone(step)}><strong>{i+1}. {T.traceSteps[step.step as keyof typeof T.traceSteps]??step.step}</strong><small>{T.traceStates[softwareTraceTone(step)]} · {step.detail}</small></li>)}</ol></section>}
     {verdict?.signatureCheck&&<p>{T.signature} · {T.signatureReasons[verdict.signatureCheck.reason as keyof typeof T.signatureReasons]??verdict.signatureCheck.reason}</p>}
     {verdict?.signature&&<Button onClick={()=>{const blob=new Blob([JSON.stringify({manifest:verdict.manifest,signature:verdict.signature,publicKey:verdict.publicKey},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${verdict.package.packageId}-manifest.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>{T.manifestDownload}</Button>}
     <p className="ds-field__hint">{T.fresh}</p><p className="ds-field__hint">{T.apiHint}</p>{verified&&<p role="status">{T.verified}</p>}
   </Panel><Panel title={T.history}><p>{T.historyBoundary}</p><DataTable caption={T.history} rows={history.data?.items??[]} rowKey={r=>r.downloadId} columns={[{key:'vin',header:T.vin,cell:r=>r.vin},{key:'bytes',header:T.bytes,cell:r=>`${r.bytes.toLocaleString()} B`},{key:'hash',header:T.hash,cell:r=><span style={{overflowWrap:'anywhere'}}>{r.sha256}</span>},{key:'state',header:T.status,cell:r=>r.state}]}/></Panel></>}
   <ErrorNote error={create.error??decision.error??check.error}/>{!!error&&<p role="alert">{error instanceof Error&&error.message==='SOFTWARE_INTEGRITY'?T.integrityError:T.downloadError}</p>}
 </div>;
}
