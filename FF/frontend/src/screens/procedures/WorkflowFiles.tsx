import { useState } from 'react';
import type { WorkflowStoredFile } from '@ff/contracts';
import { workflowFileBlob, uploadWorkflowFile } from '../../api/workflow-files';
import { workflowArtifactsCopy } from '../../copy/workflow-artifacts';
import { Button, ErrorNote, Field } from '../../design';
import { useAppShell } from '../../store';

export function WorkflowFileDownload({caseId,file}:{caseId:string;file:WorkflowStoredFile}) {
  const {role}=useAppShell(),T=workflowArtifactsCopy(),[busy,setBusy]=useState(false),[error,setError]=useState<Error|null>(null);
  async function download(){setBusy(true);setError(null);try{const blob=await workflowFileBlob(caseId,file,role),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e as Error);}finally{setBusy(false);}}
  return <div><Button variant="ghost" disabled={busy} onClick={()=>void download()}>{busy?T.checking:T.download} · {file.name}</Button><small>{file.bytes} bytes · SHA-256 {file.sha256}</small><ErrorNote error={error}/></div>;
}
export function WorkflowFileUpload({caseId,activityId,version,disabled,files,onChange}:{caseId:string;activityId:string;version:number;disabled:boolean;files:WorkflowStoredFile[];onChange:(files:WorkflowStoredFile[])=>void}) {
  const {role}=useAppShell(),T=workflowArtifactsCopy(),[busy,setBusy]=useState(false),[error,setError]=useState<Error|null>(null);
  async function upload(input:FileList|null){if(!input)return;setError(null);setBusy(true);const added:WorkflowStoredFile[]=[];try{
    if(input.length+files.length>20)throw new Error(T.fileGuide);
    for(const file of Array.from(input))added.push(await uploadWorkflowFile(caseId,activityId,version,file,role,crypto.randomUUID()));
  }catch(e){setError(e as Error);}finally{if(added.length)onChange([...files,...added]);setBusy(false);}}
  return <div><Field label={T.files} hint={T.fileGuide}><input type="file" disabled={disabled||busy} multiple onChange={e=>{void upload(e.target.files);e.target.value='';}}/></Field>{busy&&<p role="status">{T.uploading}</p>}<ul>{files.map(f=><li key={f.fileId}>{f.name} · {f.bytes} bytes <Button variant="ghost" disabled={disabled||busy} onClick={()=>onChange(files.filter(v=>v.fileId!==f.fileId))}>{T.remove}</Button></li>)}</ul><ErrorNote error={error}/></div>;
}
