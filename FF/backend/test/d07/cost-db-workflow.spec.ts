// In-process domain services and SQLite only; never creates an HTTP/TCP server.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {CreateCostProjectBody,costReviewSyntheticExample,type FeatureRefRow} from '@ff/contracts';
import {SqliteDb,migrate,type Db} from '../../src/kernel/db';
import {MIGRATIONS} from '../../src/kernel/migrations';
import {LocalKek,SecretVault} from '../../src/kernel/kms/key-protection';
import {Clock} from '../../src/kernel/clock';
import {Scheduler} from '../../src/kernel/scheduler';
import {AuditService} from '../../src/kernel/audit.service';
import {FeatureRepo} from '../../src/domains/d01-policy/repos';
import {RefdbRepository} from '../../src/domains/d01-policy/refdb/refdb.repository';
import {CostService} from '../../src/domains/d07-cost/estimation/cost.service';
import type {Actor} from '../../src/kernel/actor';
const writer:Actor={id:'local-cost-writer',role:'COST_ESTIMATOR',correlationId:'cost-workflow-test'},tech:Actor={id:'local-tech-reviewer',role:'IMPLEMENTER',correlationId:'cost-workflow-test'},approver:Actor={id:'local-cost-approver',role:'COST_APPROVER',correlationId:'cost-workflow-test'};
describe('real Feature DB to cost purchasing workflow without a server',()=>{
 let db:Db,clock:Clock,scheduler:Scheduler,refs:RefdbRepository,cost:CostService,ref:FeatureRefRow;
 beforeAll(()=>{vi.stubEnv('FF_ENV','test');vi.stubEnv('FF_SCHEDULER','manual');vi.stubEnv('FF_AUDIT_ANCHOR_FILE','');vi.stubEnv('FF_AUDIT_KEY','');vi.stubEnv('FF_COST_BASIS_FILE',join(__dirname,'../../../data/reference/cost-basis/v1.3.json'));db=new SqliteDb(':memory:');migrate(db,MIGRATIONS);clock=new Clock();clock.set('2026-11-09T01:00:00Z');scheduler=new Scheduler(clock);const audit=new AuditService(db,clock,scheduler);audit.onModuleInit();refs=new RefdbRepository(db);const rows=JSON.parse(readFileSync(join(__dirname,'../../../data/reference/feature-db/v1.3/refs.json'),'utf8'))as FeatureRefRow[];for(const r of rows)refs.insertRef(r,clock.iso());ref=rows.find(r=>r.refId==='BC-BCM-004')!;refs.insertRelease({release:'v1.3',publishedBy:'fixture',publishedAt:clock.iso(),hash:'a'.repeat(64)}as any);cost=new CostService(db,audit,clock,new SecretVault(new LocalKek(randomBytes(32),'cost-workflow-test')),new FeatureRepo(db),refs);cost.onModuleInit();});
 afterAll(()=>{scheduler?.onApplicationShutdown();db?.close();vi.unstubAllEnvs();});
 it('uses a published reference without fake Feature; maps impact; preserves inputs and requires fresh approval after baseline change',async()=>{
  const p=cost.reference(writer,ref.refId)as any,selection={refId:ref.refId,refRelease:p.refRelease,referenceSha256:p.referenceSha256,feature:null};
  const created=cost.create(writer,CreateCostProjectBody.parse({name:'In-process FDB estimate',references:[selection]}));const estId=created.estId;
  const d=cost.detail(writer,estId)as any;expect(d.lines[0].featureId).toBeNull();expect(d.result.totals.totalMm).toBeGreaterThan(0);expect(db.get<{n:number}>('SELECT count(*) n FROM feature_version')!.n).toBe(0);
  expect(refs.linkedCostProjects(ref.refId)).toEqual([expect.objectContaining({estId,lineNos:[1]})]);
  let v=cost.createReview(writer,estId,{kind:'QUOTE',title:'Synthetic quote review'})as any;const caseId=v.document.caseId;
  v=await cost.updateReview(writer,estId,caseId,{revision:v.document.revision,inputs:await costReviewSyntheticExample('QUOTE'),reason:'Attach verified source'});
  const act=(action:any,actor=writer)=>{v=cost.actReview(actor,estId,caseId,{revision:v.document.revision,action,reason:'Actual domain workflow review'})as any;};
  act('SUBMIT');act('TECHNICAL_AGREE',tech);act('APPROVE',approver);const approved=v.document.revision,prior=v.document.contentSha256;
  refs.updateRef({...ref,benchmarkEur:(ref.benchmarkEur??0)+100},clock.iso());expect((cost.review(writer,estId,caseId)as any).baselineStale).toBe(true);
  expect(()=>act('HANDOFF')).toThrow('산정 기준');act('REVISE');expect(()=>act('REFRESH_BASELINE')).toThrow('원천');
  cost.update(writer,estId,{useLatestBasis:true});act('REFRESH_BASELINE');expect(v.document.inputs.offers[0].quotedTotal.value).toBe(2000);expect(v.document.approval).toBeNull();expect(v.document.contentSha256).not.toBe(prior);
  act('SUBMIT');expect(()=>act('APPROVE',approver)).toThrow('기술 검토자');act('TECHNICAL_AGREE',tech);act('APPROVE',approver);act('HANDOFF');expect(v.document.handoff.state).toBe('PREPARED');expect((cost.review(writer,estId,caseId,approved)as any).document.contentSha256).toBe(prior);
 });
});
