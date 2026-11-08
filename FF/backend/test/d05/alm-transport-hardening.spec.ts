import { afterEach,describe,expect,it,vi } from 'vitest';
import { LiveAdapter } from '../../src/domains/d05-ext/api-gateway/ext-sync/live-adapters';
const cfg=(system='JIRA')=>{for(const [k,v] of Object.entries(system==='JIRA'?{JIRA_URL:'https://jira.demo.test',JIRA_TOKEN:'demo-token',JIRA_API:'3'}:{CODEBEAMER_URL:'https://cb.demo.test',CODEBEAMER_USER:'demo',CODEBEAMER_TOKEN:'demo-token'}))vi.stubEnv(k,v);};
afterEach(()=>vi.unstubAllEnvs());
const json=(body:unknown,status=200,headers?:Record<string,string>)=>new Response(status===204?null:JSON.stringify(body),{status,headers});
describe('ALM transport correctness',()=>{
 it('keeps HTML 401 as an authentication error and never includes response bodies',async()=>{
   cfg();const fetch=vi.fn(async()=>new Response('private remote error body',{status:401}));
   const adapter=new LiveAdapter('JIRA',()=> 'live',fetch as unknown as typeof globalThis.fetch);
   await expect(adapter.read('FFE-1')).rejects.toMatchObject({status:401});
   await expect(adapter.read('FFE-1')).rejects.not.toThrow('private remote error body');
   expect(fetch).toHaveBeenCalledTimes(3); // failed /myself is not re-learned for every read.
   expect((fetch.mock.calls[0] as unknown as [string,RequestInit])[1].redirect).toBe('error');
 });
 it('rejects a malformed successful response instead of treating it as an empty record',async()=>{
   cfg('CODEBEAMER');const adapter=new LiveAdapter('CODEBEAMER',()=> 'live',(async()=>new Response('<html>login</html>',{status:200})) as typeof fetch);
   await expect(adapter.read('CB-1')).rejects.toThrow('JSON이 아닙니다');
 });
 it.each([{items:[{id:1},{id:2}],total:2},{items:[{id:1}],total:2}])('never arbitrarily binds ambiguous codeBeamer requirement results %j',async result=>{
   cfg('CODEBEAMER');const fetch=vi.fn(async()=>json(result));const adapter=new LiveAdapter('CODEBEAMER',()=> 'live',fetch as unknown as typeof globalThis.fetch);
   await expect(adapter.findRequirement('REQ-DEMO-DUP')).rejects.toThrow('여러 항목');expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('detects a repeated Jira Cloud cursor even when pages contain no issues',async()=>{
   cfg();let searches=0;const fetch=vi.fn(async(url:string)=>url.endsWith('/myself')?json({},404):(searches++,json({issues:[],nextPageToken:'same-token'})));
   await expect(new LiveAdapter('JIRA',()=> 'live',fetch as unknown as typeof globalThis.fetch).recent(20)).rejects.toThrow('커서가 반복');expect(searches).toBe(2);
 });
 it('does not call an incomplete Jira Cloud page a completed reconciliation',async()=>{
   cfg();const fetch=vi.fn(async(url:string)=>url.endsWith('/myself')?json({},404):json({issues:[],isLast:false}));
   await expect(new LiveAdapter('JIRA',()=> 'live',fetch as unknown as typeof globalThis.fetch).recent(20)).rejects.toThrow('다음 페이지');
 });
 it('honors a server-capped Jira v2 page size and reads every issue',async()=>{
   cfg();vi.stubEnv('JIRA_API','2');const starts:number[]=[];
   const issue=(n:number)=>({key:`FFE-${n}`,fields:{updated:'2026-11-09T00:00:00Z',reporter:{name:'demo-author'}}});
   const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
     if(url.endsWith('/myself'))return json({},404);
     if(url.endsWith('/search')){const body=JSON.parse(String(init?.body));starts.push(body.startAt);return json({issues:body.startAt===0?[issue(1),issue(2)]:[issue(3)],total:3,maxResults:2});}
     return json({changelog:{histories:[]}});
   });
   const rows=await new LiveAdapter('JIRA',()=> 'live',fetch as unknown as typeof globalThis.fetch).recent(20);
   expect(rows.map(r=>r.key)).toEqual(['FFE-1','FFE-2','FFE-3']);expect(starts).toEqual([0,2]);
 });
 it('reports a nonterminal 5,000-issue limit as incomplete without applying partial data',async()=>{
   cfg();const fetch=vi.fn(async(url:string)=>url.endsWith('/myself')?json({},404):json({issues:Array.from({length:5000},(_,i)=>({key:`FFE-${i}`,fields:{}})),nextPageToken:'more'}));
   await expect(new LiveAdapter('JIRA',()=> 'live',fetch as unknown as typeof globalThis.fetch).recent(20)).rejects.toThrow('조회 한도');
 });
 it('defers a long Retry-After to the durable outbox without an early repeat call',async()=>{
   cfg('CODEBEAMER');const fetch=vi.fn(async()=>json({},429,{'retry-after':'120'}));
   await expect(new LiveAdapter('CODEBEAMER',()=> 'live',fetch as unknown as typeof globalThis.fetch).read('CB-1')).rejects.toMatchObject({status:429,retryAfterMs:120000});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('retains an earlier human transition when a busy Cloud issue has several history pages',async()=>{
   cfg();const starts:number[]=[];
   const fetch=vi.fn(async(url:string)=>{
     if(url.endsWith('/myself'))return json({},404);
     if(url.endsWith('/search/jql'))return json({issues:[{key:'FFE-1',fields:{updated:'2026-11-09T00:00:00Z'}}],isLast:true});
     const start=Number(new URL(url).searchParams.get('startAt'));starts.push(start);
     return json({total:3,maxResults:2,startAt:start,values:start===0?[{author:{accountId:'human'},created:'2026-11-08T23:59:00Z',items:[{field:'status',fromString:'Proposed',toString:'Approved'}]},{author:{accountId:'service'},created:'2026-11-08T23:59:10Z',items:[]}]:[{author:{accountId:'service'},created:'2026-11-09T00:00:00Z',items:[]}]});
   });
   const rows=await new LiveAdapter('JIRA',()=> 'live',fetch as unknown as typeof globalThis.fetch).recent(20);
   expect(rows[0].histories).toHaveLength(3);expect(rows[0].histories[0].author).toBe('human');expect(starts).toEqual([0,2]);
 });
 it('does not report truncated Jira v2 expanded history as fully reconciled',async()=>{
   cfg();vi.stubEnv('JIRA_API','2');const fetch=vi.fn(async(url:string)=>{
     if(url.endsWith('/myself'))return json({},404);
     if(url.endsWith('/search'))return json({issues:[{key:'FFE-1',fields:{updated:'2026-11-09T00:00:00Z'}}],total:1});
     return json({changelog:{total:2,histories:[{author:{name:'service'},created:'2026-11-09T00:00:00Z',items:[]}]}});
   });await expect(new LiveAdapter('JIRA',()=> 'live',fetch as unknown as typeof globalThis.fetch).recent(20)).rejects.toThrow('일부만');
 });
});
