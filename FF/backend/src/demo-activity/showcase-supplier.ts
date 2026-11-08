// Demo-only supplier evidence for the existing recovery story. Never used by live imports.
// Body verification proves JSON/checksum binding, not execution or certification of vehicle SW.
import { createHash } from 'node:crypto';
import type { ModuleRef } from '@nestjs/core';
import { CreateSupplierCriteriaBody, CreateSupplierMappingBody, CreateSupplierPackageBody, ReviewSupplierPackageBody, SubmitSupplierArtifactBody, SubmitSupplierPackageBody, SUPPLIER_ARTIFACT_TYPES, type FeatureVersionRow } from '@ff/contracts';
import type { Actor } from '../kernel/actor';
import type { Db } from '../kernel/db';
import { TopologyRepo } from '../domains/d01-policy/repos';
import { SupplierService } from '../domains/d05-ext/supplier/supplier.service';

export function ensureShowcaseSupplierEvidence(db: Db, modules: ModuleRef, f: FeatureVersionRow, author: Actor, reviewer: Actor) {
  const service = modules.get(SupplierService, {strict:false});
  const topology = modules.get(TopologyRepo, {strict:false});
  const current = service.gate(f.featureId, f.version);
  if (!current.applicable || !current.blockers.length) return current;
  if (author.id === reviewer.id) throw new Error('Demo supplier review requires separate participants');
  return db.tx(() => {
    if (!service.criteria(f.featureId).items.length) service.createCriteria(reviewer, CreateSupplierCriteriaBody.parse({
      featureId:f.featureId, reason:'DEMO — 가상 시연 패키지의 본문·적용 범위 검수 기준. 실차 인증 근거가 아님',
      items:[{kind:'MIN_COVERAGE',threshold:80},{kind:'ALL_TESTS_PASS'},{kind:'BUILD_CLEAN',threshold:0},{kind:'ASIL_COVERS_FEATURE'},{kind:'VARIANT_COVERS_FEATURE'},{kind:'CAPABILITY_COVERS_SW'},{kind:'BREAKING_HAS_MIGRATION'}],
    }));
    for (const supplier of current.suppliers) {
      const existing = service.packages({featureId:f.featureId, supplier}).items;
      const major = Math.max(Number(f.version.split('.')[0]), ...existing.map(p=>Number(p.version.split('.')[0])+1));
      const version = `${major}.0.0`;
      const mapping = service.mappings(f.featureId).items.find(m=>m.supplier===supplier) ?? service.createMapping(author, CreateSupplierMappingBody.parse({featureId:f.featureId,supplier,supplierFunctionId:`DEMO-${f.featureId}`,name:`DEMO — ${f.name}`}));
      const pkg = service.createPackage(author, CreateSupplierPackageBody.parse({featureId:f.featureId,featureVersion:f.version,supplier,version}));
      const ecu = topology.allEcu().filter(e=>f.ecuPnos.includes(e.ecuPno));
      const metadata: Record<string, object> = {
        API_CONTRACT:{apiFormat:'OPENAPI'}, HUMAN_DOC:{}, FEATURE_MAPPING:{mappingIds:[mapping.mapId]},
        CAPABILITY_MANIFEST:{capability:{hwVersions:ecu.map(e=>e.hwRevision),swVersions:f.swIds.map((swId,i)=>({swId,version:f.swVersions[i]})),ecuCapabilities:ecu.map(e=>({ecuPno:e.ecuPno,capabilities:['DEMO-CAPABILITY']}))}},
        VARIANT_COMPAT:{variants:[{vehicleModel:f.vehicleModel,region:f.country,trim:f.trim,modelYears:[2026]}]},
        DIAGNOSTICS:{diagnostics:{dtcs:[],events:['DEMO-SCENARIO']}},
        SAFETY_SECURITY:{safety:{asil:f.asil,cybersecurityClaim:'DEMO — 가상 검수 시나리오. 실제 인증·실차 보안 시험 근거가 아님',certRef:null}},
        // Explicit synthetic demonstration inputs. These counts do not report a real supplier test run.
        TEST_EVIDENCE:{testEvidence:{unitPassed:1,unitTotal:1,integrationPassed:1,integrationTotal:1,coveragePct:100,buildStatus:'SUCCESS',buildWarnings:0,evidenceIds:['DEMO-SYNTHETIC-NOT-VEHICLE-TEST']}},
        RELEASE_NOTE:{releaseNote:{releaseId:`DEMO-${f.featureId}-${f.version}`,breakingChanges:false,migration:null}},
      };
      for (const type of SUPPLIER_ARTIFACT_TYPES) {
        const binding = {featureId:f.featureId,featureVersion:f.version,packageVersion:version};
        const provenance = {source:'DEMO',synthetic:true,warning:'Demonstration only. Not a real supplier test, safety approval or vehicle certification.'};
        const text = JSON.stringify(type==='API_CONTRACT' ? {openapi:'3.2.0',info:{title:'DEMO contract',version},paths:{},'x-ff-package':binding,'x-ff-provenance':provenance} : {title:`DEMO ${type}`,package:binding,provenance,...metadata[type]});
        service.artifact(author,pkg.packageId,SubmitSupplierArtifactBody.parse({type,version,title:`DEMO — ${type}`,uri:`https://supplier.example/demo/${pkg.packageId}/${type}`,checksum:`sha256:${createHash('sha256').update(text).digest('hex')}`,text,...metadata[type]}));
      }
      service.submit(author,pkg.packageId,SubmitSupplierPackageBody.parse({note:'DEMO — 가상 산출물 검수 시연, 실차·실제 협력사 검증을 뜻하지 않음'}));
      service.review(reviewer,pkg.packageId,ReviewSupplierPackageBody.parse({decision:'ACCEPT',comment:'DEMO — 가상 10항목 본문·범위·검수 분리 시연. 실차 인증 근거가 아님',items:SUPPLIER_ARTIFACT_TYPES.map(type=>({type,result:'PASS',comment:'DEMO only'}))}));
    }
    const final = service.gate(f.featureId,f.version);
    if (final.blockers.length) throw new Error(`Demo supplier prerequisites remain: ${final.blockers.join(' / ')}`);
    return final;
  });
}
