import type { INestApplication } from '@nestjs/common';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { bootApp } from '../helpers';
import { MockExtStore } from '../../src/domains/d05-ext/api-gateway/ext-sync/mock-ext.store';
import { ExtAdapters } from '../../src/domains/d05-ext/api-gateway/ext-sync/adapters';
import { ExtSyncRepo } from '../../src/domains/d05-ext/api-gateway/ext-sync/ext-sync.repo';
import { Clock } from '../../src/kernel/clock';
describe('existing demo ALM hardening',()=>{
 let app:INestApplication;
 beforeAll(async()=>{({app}=await bootApp({at:'2026-11-09T00:00:00Z'}));});afterAll(()=>app.close());
 it('the existing codeBeamer demo also rejects duplicate requirement IDs',async()=>{
   const store=app.get(MockExtStore);
   for(const n of [1,2])store.create('CODEBEAMER','REQUIREMENT',{title:`Duplicate ${n}`,body:'Demo only',status:'Draft',by:'demo-author',fields:{reqId:'REQ-DEMO-AMBIGUOUS'}});
   await expect(app.get(ExtAdapters).of('CODEBEAMER').findRequirement('REQ-DEMO-AMBIGUOUS')).rejects.toThrow('여러 항목');
 });
 it('the durable outbox never retries before the remote Retry-After, even beyond one day',()=>{
   const repo=app.get(ExtSyncRepo),clock=app.get(Clock);
   repo.enqueue('JIRA',{op:'COMMENT',key:'FFE-DEMO',text:'Retry after test'},'review-retry-after-test');
   const job=repo.jobs({system:'JIRA'}).find(j=>j.job.op==='COMMENT'&&j.job.key==='FFE-DEMO')!;
   repo.retry(job,'remote throttled',3*86400000);
   const later=repo.job(job.jobId)!;expect(Date.parse(later.nextAt)-clock.now().getTime()).toBe(3*86400000);
   expect(repo.due().some(j=>j.jobId===job.jobId)).toBe(false);
 });
});
