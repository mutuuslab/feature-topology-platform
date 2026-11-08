import { ModuleRef } from '@nestjs/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ensureShowcaseSupplierEvidence } from '../../src/demo-activity/showcase-supplier';
import { FeatureRepo } from '../../src/domains/d01-policy/repos';
import { SupplierService } from '../../src/domains/d05-ext/supplier/supplier.service';
import { DB, type Db } from '../../src/kernel/db';
import { bootApp } from '../helpers';
let b: Awaited<ReturnType<typeof bootApp>>;
beforeAll(async()=> { b=await bootApp({showcaseFill:false}); });
afterAll(()=>b.app.close());
it('uses ten verified DEMO bodies and an independent reviewer, and does not duplicate the accepted package',()=> {
  const f=b.get(FeatureRepo).get('FEAT-00022','1.0.0')!;
  const db=b.app.get<Db>(DB),modules=b.get(ModuleRef),service=b.get(SupplierService);
  const author={id:'usr-integrator',role:'IMPLEMENTER' as const,correlationId:'test:showcase-supplier'};
  const reviewer={id:'usr-quality',role:'GATE_JUDGE' as const,correlationId:'test:showcase-supplier'};
  expect(service.gate(f.featureId,f.version).blockers.length).toBeGreaterThan(0);
  expect(()=>ensureShowcaseSupplierEvidence(db,modules,f,author,{...reviewer,id:author.id})).toThrow('separate participants');
  const result=ensureShowcaseSupplierEvidence(db,modules,f,author,reviewer);
  expect(result.blockers).toEqual([]);
  expect(result.accepted.length).toBeGreaterThan(0);
  for(const id of result.accepted){
    const d=service.detail(id);
    expect(d.artifacts).toHaveLength(10);
    expect(d.artifacts.every(a=>a.integrity==='VERIFIED')).toBe(true);
    expect(d.reviews.at(-1)?.reviewedBy).not.toBe(d.package.submittedBy);
    for(const a of d.artifacts){
      const content=service.content(a.recordId);
      expect(content.verified).toBe(true);
      expect(content.text).toContain('Not a real supplier test');
      expect(a.title).toContain('DEMO');
    }
  }
  expect(ensureShowcaseSupplierEvidence(db,modules,f,author,reviewer)).toEqual(result);
  expect(service.packages({featureId:f.featureId,featureVersion:f.version}).items).toHaveLength(result.accepted.length);
});
