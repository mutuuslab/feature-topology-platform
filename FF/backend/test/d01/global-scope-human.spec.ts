import { beforeAll, afterAll, expect, it } from 'vitest';
import { FeatureRepo } from '../../src/domains/d01-policy/repos';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { actor, bootApp } from '../helpers';
let b:Awaited<ReturnType<typeof bootApp>>;
beforeAll(async()=>{b=await bootApp({showcaseFill:false});});
afterAll(()=>b.app.close());
it('requires a human actor and still checks the actual owner or system administrator',async()=>{
 const original=b.get(PolicyRepo).get('POL-00003')!;
 const f=b.get(FeatureRepo).get(original.featureId,original.featureVersion)!;
 b.get(FeatureRepo).insert({...f,version:'99.0.0',ownerId:'usr-author'},{createdBy:'usr-author',createdAt:'2026-11-09T00:00:00Z'});
 b.get(PolicyRepo).insert({...original,policyId:'POL-99990',featureVersion:'99.0.0'});
 const url='/api/policies/POL-99990/global-scope';
 const body={brands:['HYUNDAI'],regionCodes:['1'],complianceRuleIds:[],reason:'Human owner boundary fixture'};
 await b.http().post(url).set(actor('usr-author','FEATURE_AUTHOR')).send(body).expect(201);
 const before=(await b.http().get(url).expect(200)).body.scope;
 for(const role of ['SYSTEM','VEHICLE'])await b.http().put(url).set(actor('usr-author',role)).send(body).expect(403);
 expect((await b.http().get(url).expect(200)).body.scope).toEqual(before);
 // Owning the Feature is sufficient for a human; author role is not required to retain ownership.
 const owner=await b.http().put(url).set(actor('usr-author','AUDITOR')).send(body).expect(200);
 expect(owner.body.revision).toBe(2);
 await b.http().put(url).set(actor('usr-integrator','IMPLEMENTER')).send(body).expect(403);
 const admin=await b.http().put(url).set(actor('usr-sysadmin','SYSTEM_ADMIN')).send(body).expect(200);
 expect(admin.body.revision).toBe(3);
});
