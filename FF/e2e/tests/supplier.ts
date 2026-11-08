// Explicit synthetic E2E evidence, submitted through the real supplier APIs.
// SHA verification binds these fixture bodies; it does not certify real supplier tests.
import { createHash } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { SUPPLIER_ARTIFACT_TYPES } from '../../contracts/src/schemas/supplier';
const API=`http://localhost:${process.env.E2E_API_PORT??9111}`;
const IMPL={'X-Actor-Id':'usr-integrator','X-Actor-Role':'IMPLEMENTER'};
const JUDGE={'X-Actor-Id':'usr-quality','X-Actor-Role':'GATE_JUDGE'};
export async function acceptSupplierFixture(request:APIRequestContext, featureId:string, featureVersion:string){
  const get=async(path:string)=>{const r=await request.get(API+path);expect(r.status(),await r.text()).toBe(200);return r.json();};
  const post=async(path:string,data:unknown,headers=IMPL,status=201)=>{const r=await request.post(API+path,{headers,data});expect(r.status(),await r.text()).toBe(status);return r.json();};
  const facts=await get(`/api/features/${featureId}/versions/${featureVersion}/supplier-gate`);
  if(!facts.applicable||!facts.blockers.length)return;
  const f=(await get(`/api/features/${featureId}/versions/${featureVersion}`)).feature;
  await post('/api/supplier-criteria',{featureId,reason:'E2E synthetic fixture, not vehicle certification',items:[{kind:'MIN_COVERAGE',threshold:80},{kind:'ALL_TESTS_PASS'},{kind:'BUILD_CLEAN',threshold:0},{kind:'ASIL_COVERS_FEATURE'},{kind:'VARIANT_COVERS_FEATURE'},{kind:'CAPABILITY_COVERS_SW'},{kind:'BREAKING_HAS_MIGRATION'}]},JUDGE);
  for(const supplier of facts.suppliers){
    const version='1.0.0';
    const mapping=await post('/api/supplier-mappings',{featureId,supplier,supplierFunctionId:`E2E-${featureId}`,name:'E2E synthetic supplier mapping'});
    const pkg=await post('/api/supplier-packages',{featureId,featureVersion,supplier,version});
    const metadata:Record<string,object>={
      API_CONTRACT:{apiFormat:'OPENAPI'},HUMAN_DOC:{},FEATURE_MAPPING:{mappingIds:[mapping.mapId]},
      CAPABILITY_MANIFEST:{capability:{hwVersions:['E2E-TEST-ONLY'],swVersions:f.swIds.map((swId:string,i:number)=>({swId,version:f.swVersions[i]})),ecuCapabilities:f.ecuPnos.map((ecuPno:string)=>({ecuPno,capabilities:['E2E-TEST-ONLY']}))}},
      VARIANT_COMPAT:{variants:[{vehicleModel:f.vehicleModel,region:f.country,trim:f.trim,modelYears:[2026]}]},
      DIAGNOSTICS:{diagnostics:{dtcs:[],events:['E2E-TEST']}},
      SAFETY_SECURITY:{safety:{asil:f.asil,cybersecurityClaim:'E2E fixture; no real security certification',certRef:null}},
      TEST_EVIDENCE:{testEvidence:{unitPassed:1,unitTotal:1,integrationPassed:1,integrationTotal:1,coveragePct:100,buildStatus:'SUCCESS',buildWarnings:0,evidenceIds:['E2E-SYNTHETIC-NOT-VEHICLE-TEST']}},
      RELEASE_NOTE:{releaseNote:{releaseId:`E2E-${featureId}`,breakingChanges:false,migration:null}},
    };
    for(const type of SUPPLIER_ARTIFACT_TYPES){
      const binding={featureId,featureVersion,packageVersion:version};
      const provenance={source:'E2E_TEST_FIXTURE',synthetic:true,warning:'Not a real supplier test or vehicle certification'};
      const text=JSON.stringify(type==='API_CONTRACT'?{openapi:'3.2.0',info:{title:'E2E fixture',version},paths:{},'x-ff-package':binding,'x-ff-provenance':provenance}:{package:binding,provenance,...metadata[type]});
      await post(`/api/supplier-packages/${pkg.packageId}/artifacts`,{type,version,title:`E2E fixture ${type}`,uri:`https://supplier.example/e2e/${pkg.packageId}/${type}`,checksum:`sha256:${createHash('sha256').update(text).digest('hex')}`,text,...metadata[type]});
    }
    await post(`/api/supplier-packages/${pkg.packageId}/submit`,{note:'E2E synthetic fixture submission'},IMPL,200);
    const accepted=await post(`/api/supplier-packages/${pkg.packageId}/reviews`,{decision:'ACCEPT',comment:'E2E separate reviewer of synthetic fixture bodies',items:SUPPLIER_ARTIFACT_TYPES.map(type=>({type,result:'PASS',comment:'E2E fixture only'}))},JUDGE);
    expect(accepted.check.verdict).toBe('MET');
  }
  expect((await get(`/api/features/${featureId}/versions/${featureVersion}/supplier-gate`)).blockers).toEqual([]);
}
