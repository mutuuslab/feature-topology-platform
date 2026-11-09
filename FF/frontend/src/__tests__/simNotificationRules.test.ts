import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { ROUTES,routeUrl,snapshotFile } from '@ff/contracts';
const files=new Map<string,unknown>();
let sim:typeof import('../api/sim'),engine:typeof import('../api/sim/engine');
const run=(name:string,role:string,body?:unknown,params:Record<string,string>={},query:Record<string,unknown>={})=>sim.simCall<any>(ROUTES.find(r=>r.name===name)!,routeUrl(name,params,query as any),{role,body,params});
beforeEach(async()=>{
 vi.resetModules();vi.stubEnv('VITE_DATA_MODE','static');localStorage.clear();files.clear();
 const put=(name:string,data:unknown,q:Record<string,unknown>={})=>files.set('/'+snapshotFile(routeUrl(name,{},q as any)),data);
 put('listFeatures',{items:[{featureId:'FEAT-1',version:'1.0.0',ownerId:'ADAS기획팀'}]},{latestOnly:false});
 put('notificationRules',{items:[],teams:['ADAS기획팀']});
 vi.stubGlobal('fetch',vi.fn(async(u:string)=>new Response(JSON.stringify(files.get(u)??{items:[]}),{headers:{'Content-Type':'application/json'}})));
 sim=await import('../api/sim');engine=await import('../api/sim/engine');
});
afterEach(()=>{engine?.__resetSimForTest();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('sends a real recipient-specific notification and returns its actual receipt ID',async()=>{
 const b={title:'협의 요청',message:'변경 근거를 검토해 주세요',recipients:[{kind:'user',id:'usr-approver'}],link:'/admin/approval'};
 const r=await run('sendNotification','coordinator',b);
 expect(r.notificationId).toMatch(/^NTF-/);expect(engine.__overlayForTest()!.notifications[0]).toMatchObject({notificationId:r.notificationId,category:'DIRECT',title:b.title,exclude:['usr-coordinator']});
 expect((await run('notifications','approver',undefined,{}, {limit:200})).items).toContainEqual(expect.objectContaining({notificationId:r.notificationId,title:b.title}));
 expect((await run('notifications','author',undefined,{}, {limit:200})).items.some((n:any)=>n.notificationId===r.notificationId)).toBe(false);
 expect((await run('notifications','coordinator',undefined,{}, {limit:200})).items.some((n:any)=>n.notificationId===r.notificationId)).toBe(false);
});
it('persists additions without removing mandatory recipients, and refuses fixed/direct rules and unknown teams',async()=>{
 const r=await run('setNotificationRule','opslead',{recipients:[{kind:'user',id:'usr-author'}],reason:'기획 담당자도 검토'}, {eventType:'gate.judged'});
 expect(r).toMatchObject({added:[{kind:'user',id:'usr-author'}],updatedBy:'usr-opslead'});expect(r.recipients.length).toBeGreaterThan(0);
 expect((await run('notificationRules','viewer')).items.find((r:any)=>r.event==='gate.judged').added).toEqual(r.added);
 await expect(run('setNotificationRule','opslead',{recipients:[],reason:'개인 알림 수신 시도'}, {eventType:'notification.sent'})).rejects.toMatchObject({code:'VALIDATION'});
 await expect(run('setNotificationRule','opslead',{recipients:[{kind:'team',team:'없는팀'}],reason:'잘못된 팀'}, {eventType:'gate.judged'})).rejects.toMatchObject({code:'VALIDATION'});
});
it('denies self-only sending and enforces the hourly quota without a partial notification',async()=>{
 await expect(run('sendNotification','coordinator',{title:'자기 알림',message:'본인만 수신',recipients:[{kind:'user',id:'usr-coordinator'}]})).rejects.toMatchObject({code:'VALIDATION'});
 const b={title:'승인 요청',message:'요청 건 확인',recipients:[{kind:'user',id:'usr-approver'}]};
 for(let n=0;n<20;n++)await run('sendNotification','coordinator',b);
 const before=engine.__overlayForTest()!.notifications.length;
 await expect(run('sendNotification','coordinator',b)).rejects.toMatchObject({status:429,code:'RATE_LIMITED'});
 expect(engine.__overlayForTest()!.notifications).toHaveLength(before);
});
