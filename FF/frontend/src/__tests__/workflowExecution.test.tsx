import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ROUTES, routeUrl, snapshotFile } from '@ff/contracts';
import { WORKFLOW_EXECUTION_MODEL as M } from '../../../contracts/src/generated/workflow-execution-model';
import { AppProvider } from '../store';
import { WorkflowWorkScreen } from '../screens/procedures/WorkCases';
import { changeUiLanguage, __resetLocaleForTest } from '../locale/runtime';
vi.hoisted(()=>{vi.stubEnv('VITE_DATA_MODE','static');});

const A='FPW.18-A01',WP='WP-ANALYSIS-SCOPE';
let sim:typeof import('../api/sim'),engine:typeof import('../api/sim/engine');
const run=(name:string,body?:unknown,role='commerce',params:Record<string,string>={})=>sim.simCall<any>(ROUTES.find(r=>r.name===name)!,routeUrl(name,params),{body,role,params});
const snapshots:Record<string,unknown>={
  [snapshotFile(routeUrl('auditChain'))]:{ok:true,head:'a'.repeat(64),verified:0},
  [snapshotFile(routeUrl('events',{}, {limit:500,recent:'1'}))]:{items:[]},
  [snapshotFile(routeUrl('audit',{}, {limit:500}))]:{items:[]},
  [snapshotFile(routeUrl('notifications',{}, {limit:200}))]:{items:[],unread:0,byCategory:{}},
  [snapshotFile(routeUrl('featureDetail',{id:'FEAT-00022',ver:'1.0.0'}))]:{feature:{featureId:'FEAT-00022',version:'1.0.0',lifecycle:'RELEASED',name:'검토 대상'}},
};
beforeEach(async()=>{
  vi.stubEnv('VITE_DATA_MODE','static');localStorage.clear();
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>{const v=snapshots[String(input).replace(/^\//,'')];return v?new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}}):new Response('<!doctype html>',{headers:{'Content-Type':'text/html'}});}));
  sim=await import('../api/sim');engine=await import('../api/sim/engine');
});
afterEach(()=>{cleanup();engine?.__resetSimForTest();vi.unstubAllEnvs();vi.unstubAllGlobals();localStorage.clear();__resetLocaleForTest();});
const create=()=>run('createWorkflowCase',{processId:'FPW.18',title:'분석 범위 검토',targetRef:'FEAT-00022@1.0.0'});
const fields=()=>Object.fromEntries(M.processes.find(p=>p.id==='FPW.18')!.products.find(w=>w.key===WP)!.content.map((_,i)=>[String(i),`분석 근거 ${i}`]));
const artifact=(id:string,version:number,references:string[])=>run('createWorkflowArtifact',{version,activityId:A,productKey:WP,fields:fields(),references,files:[],reason:'범위 작성'},'commerce',{id});
const grant=(active:boolean)=>run('setWorkflowRoleGrant',{accountId:'usr-integrator',roleId:'R-DPO',active,reason:'독립 검토 배정'},'sysadmin');
function mount(path:string,role='commerce'){
  localStorage.setItem('fp.state.v2',JSON.stringify({role}));
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter initialEntries={[path]}><AppProvider><WorkflowWorkScreen/></AppProvider></MemoryRouter></QueryClientProvider>);
}
describe('실제 업무 건과 정적 시연의 권한·제출·인계',()=>{
  it('영문 WP 입력도 숫자 필드키로 저장하며 언어 변경은 작성내용과 원천 승인을 바꾸지 않는다',async()=>{
    const {item}=await create();localStorage.setItem('fp.state.v2',JSON.stringify({role:'commerce',lang:'en'}));
    await changeUiLanguage('en');
    // mount intentionally keeps the requested language so its initial preference cannot cancel EN.
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter initialEntries={[`/procedures/work?case=${item.caseId}`]}><AppProvider><WorkflowWorkScreen/></AppProvider></MemoryRouter></QueryClientProvider>);
    const first=await screen.findByRole('textbox',{name:'Purpose, population, period, data categories and processing basis',exact:true});
    fireEvent.change(first,{target:{value:'작성자가 작성한 원문 0'}});
    fireEvent.change(screen.getByRole('textbox',{name:'Pseudonymization, access, retention and cross-border transfer review, including unresolved matters',exact:true}),{target:{value:'작성자가 작성한 원문 1'}});
    await act(async()=>{await changeUiLanguage('ko');});
    expect(screen.getByRole('textbox',{name:M.processes.find(p=>p.id==='FPW.18')!.products.find(p=>p.key===WP)!.content[0],exact:true})).toBe(first);
    expect(first).toHaveValue('작성자가 작성한 원문 0');
    await act(async()=>{await changeUiLanguage('en');});
    fireEvent.change(screen.getByRole('textbox',{name:/^Evidence references/}),{target:{value:'DOC-EN-01'}});
    fireEvent.change(screen.getByLabelText('Reason for creation or revision'),{target:{value:'원문 작성 사유'}});
    fireEvent.click(screen.getByRole('button',{name:'Save new version'}));
    await screen.findAllByText('Workflow case version 2');
    const saved=(await run('workflowCase',undefined,'commerce',{id:item.caseId})).item;
    expect(saved.artifacts[0].fields).toEqual({'0':'작성자가 작성한 원문 0','1':'작성자가 작성한 원문 1'});
    expect(saved.activities[A]).toBeUndefined();
    expect(saved.artifacts[0].references).toEqual(['DOC-EN-01']);
  });
  it('필수 근거와412 충돌을 서버와 같은 규칙으로 거부하며 독립 검토·철회를 보존한다',async()=>{
    const {item}=await create(),id=item.caseId;
    await artifact(id,1,[]);
    await expect(artifact(id,1,['DOC-01'])).rejects.toMatchObject({status:412});
    await expect(run('submitWorkflowActivity',{version:2,note:'검토 요청'},'commerce',{id,activityId:A})).rejects.toMatchObject({status:422});
    await artifact(id,2,['DOC-01']);
    await run('submitWorkflowActivity',{version:3,note:'검토 요청'},'commerce',{id,activityId:A});
    await expect(run('reviewWorkflowActivity',{version:4,decision:'ACCEPT',reason:'자기 결과'},'commerce',{id,activityId:A})).rejects.toMatchObject({status:403});
    await grant(true);await grant(false);
    await expect(run('reviewWorkflowActivity',{version:4,decision:'ACCEPT',reason:'철회 후 검토'},'integrator',{id,activityId:A})).rejects.toMatchObject({status:403});
    await grant(true);
    const accepted=await run('reviewWorkflowActivity',{version:4,decision:'ACCEPT',reason:'독립 확인'},'integrator',{id,activityId:A});
    expect(accepted.item.activities[A]).toMatchObject({status:'ACCEPTED',reviewedBy:'usr-integrator'});
    expect(engine.__overlayForTest()!.audit.some(a=>a.result==='DENIED')).toBe(true);
  });
  it('인계 재시도는 같은 해시·이력을 유지하고 상대 담당자 인수 전에는 대기한다',async()=>{
    const {item}=await create(),id=item.caseId;await artifact(id,1,['DOC-02']);
    await run('submitWorkflowActivity',{version:2,note:'검토 요청'},'commerce',{id,activityId:A});await grant(true);
    await run('reviewWorkflowActivity',{version:3,decision:'ACCEPT',reason:'독립 확인'},'integrator',{id,activityId:A});
    const body={version:4,requestKey:'handoff-retry-ui',fromActivityId:A,toActivityId:'FPW.18-A02',note:'운영 담당자 전달'};
    const offered=await run('offerWorkflowHandoff',body,'commerce',{id}),retry=await run('offerWorkflowHandoff',body,'commerce',{id});
    expect(retry.history).toEqual(offered.history);expect(retry.item.handoffs[0].payloadHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(run('receiveWorkflowHandoff',{version:5,decision:'ACCEPT',reason:'자기 인수'},'commerce',{id,handoffId:offered.item.handoffs[0].handoffId})).rejects.toMatchObject({status:403});
    const received=await run('receiveWorkflowHandoff',{version:5,decision:'ACCEPT',reason:'상대 팀 인수'},'operator',{id,handoffId:offered.item.handoffs[0].handoffId});
    expect(received.item.handoffs[0].status).toBe('ACCEPTED');
  });
  it('작성 UI는 실제 WP 내용과 가이드·근거 상태·버전을 표시하고 초안을 저장한다',async()=>{
    const {item}=await create();mount(`/procedures/work?case=${item.caseId}`);
    const content=M.processes.find(p=>p.id==='FPW.18')!.products.find(p=>p.key===WP)!.content;
    await screen.findByRole('heading',{name:'산출물 작성·개정'},{timeout:5000});
    expect(await screen.findByText('정본 기록 조회됨')).toBeTruthy();
    for(const label of content)fireEvent.change(screen.getByLabelText(label),{target:{value:`작성 ${label}`}});
    fireEvent.change(screen.getByRole('textbox',{name:/근거 참조/}),{target:{value:'DOC-UI-01'}});
    fireEvent.change(screen.getByLabelText('작성·개정 사유'),{target:{value:'초안 작성'}});
    fireEvent.click(screen.getByRole('button',{name:'새 버전 저장'}));
    await waitFor(()=>expect(screen.getAllByText('업무 건 버전 2').length).toBeGreaterThan(0));
    expect((await run('workflowCase',undefined,'commerce',{id:item.caseId})).item.artifacts[0].references).toEqual(['DOC-UI-01']);
  });
  it('조회자는 자신에게 배정되지 않은 절차를 만들 수 없으며 관리자 배정 UI가 나타나지 않는다',async()=>{
    mount('/procedures/work','viewer');
    await screen.findByRole('heading',{name:'업무 건·산출물'});
    expect(screen.queryByText('usr-viewer')).toBeNull();
    await waitFor(()=>expect((screen.getByRole('button',{name:'업무 건 만들기'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'업무 건 만들기'}));
    const select=screen.getByLabelText('업무 절차') as HTMLSelectElement;
    expect([...select.options].some(o=>o.value==='FPW.18')).toBe(false);
    expect(screen.queryByRole('heading',{name:'업무 역할 배정'})).toBeNull();
  });
  it('담당 역할의 활동을 먼저 선택하고 다른 역할의 산출물 입력은 읽기 전용이다',async()=>{
    const {item}=await create();mount(`/procedures/work?case=${item.caseId}`,'operator');
    const activity=await screen.findByRole('combobox',{name:'처리할 활동'});
    expect((activity as HTMLSelectElement).value).toBe('FPW.18-A02');
    fireEvent.change(activity,{target:{value:A}});
    const label=M.processes.find(p=>p.id==='FPW.18')!.products.find(p=>p.key===WP)!.content[0];
    expect((screen.getByRole('textbox',{name:label,exact:true}) as HTMLTextAreaElement).readOnly).toBe(true);
    expect((document.querySelector('input[type=file]') as HTMLInputElement).disabled).toBe(true);
  });
});
