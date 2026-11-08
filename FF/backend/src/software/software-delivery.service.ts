import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Signature, type SoftwarePackageBody, type SoftwarePackageDecisionBody } from '@ff/contracts';
import type { Actor } from '../kernel/actor';
import { AuditService } from '../kernel/audit.service';
import { BinaryStore } from '../kernel/binary-store';
import { Clock } from '../kernel/clock';
import { DB, type Db } from '../kernel/db';
import { DomainError } from '../kernel/errors';
import { EventService } from '../kernel/event.service';
import { FeatureRepo } from '../domains/d01-policy/repos';
import { PolicyRepo } from '../domains/d01-policy/policy-repos';
import { ActivationService } from '../domains/d01-policy/activation/activation.service';
import { PkiService } from '../domains/d06-qsec/pki-kms/pki.service';

export interface SoftwarePackage {
  packageId:string;featureId:string;featureVersion:string;swId:string;fileId:string;
  name:string;bytes:number;sha256:string;mediaType:string;source:SoftwarePackageBody['source'];
  status:'DRAFT'|'APPROVED'|'REVOKED';revision:number;createdBy:string;createdAt:string;
  reviewedBy:string|null;reviewedAt:string|null;reason:string;signature:Signature|null;
  sbom:Record<string,unknown>;
}
const WRITERS=['IMPLEMENTER','RELEASE_MANAGER'] as const;
@Injectable()
export class SoftwareDeliveryService {
  constructor(@Inject(DB) private readonly db:Db,private readonly binary:BinaryStore,private readonly features:FeatureRepo,
    private readonly policies:PolicyRepo,private readonly activation:ActivationService,private readonly pki:PkiService,
    private readonly audit:AuditService,private readonly events:EventService,private readonly clock:Clock){}
  private writer(actor:Actor){if(!(WRITERS as readonly string[]).includes(actor.role))throw new DomainError('FORBIDDEN','SW 업로드·등록은 개발 또는 출시 담당자가 수행합니다.');}
  private scope(actor:Actor){return `software:${actor.id}`;}
  get(id:string):SoftwarePackage{const row=this.db.get<{doc:string}>('SELECT doc FROM software_package WHERE package_id=?',id);if(!row)throw new DomainError('NOT_FOUND','SW 패키지를 찾을 수 없습니다.');return JSON.parse(row.doc);}
  list(){return {items:this.db.all<{doc:string}>('SELECT doc FROM software_package ORDER BY package_id').map(r=>JSON.parse(r.doc) as SoftwarePackage)};}
  private save(item:SoftwarePackage){this.db.run('UPDATE software_package SET status=?,revision=?,doc=? WHERE package_id=?',item.status,item.revision,JSON.stringify(item),item.packageId);}
  private file(item:SoftwarePackage){
    const row=this.binary.verify(item.fileId);
    if(row.status!=='ATTACHED'||row.sha256!==item.sha256||row.bytes!==item.bytes||row.name!==item.name||row.owner_id!==item.createdBy||row.scope!==`software:${item.createdBy}`)throw new DomainError('GUARD_FAILED','SW 매니페스트와 저장된 원문이 일치하지 않습니다.');
    return row;
  }
  async upload(actor:Actor,meta:{name:string;mediaType:string;requestKey:string},input:AsyncIterable<Uint8Array>){
    this.writer(actor);
    const file=await this.binary.upload(input,{...meta,scope:this.scope(actor),ownerId:actor.id},()=>this.writer(actor));
    return {fileId:file.file_id,name:file.name,bytes:file.bytes,sha256:file.sha256,mediaType:file.media_type};
  }
  create(actor:Actor,body:SoftwarePackageBody){
    this.writer(actor);
    return this.db.tx(()=>{
      const feature=this.features.get(body.featureId,body.featureVersion);
      if(!feature)throw new DomainError('NOT_FOUND','대상 Feature 버전이 없습니다.');
      if(!feature.swIds.includes(body.swId))throw new DomainError('VALIDATION','선택한 SW는 이 Feature 버전의 구성품이어야 합니다.');
      const file=this.binary.get(body.fileId);
      if(file.scope!==this.scope(actor)||file.owner_id!==actor.id)throw new DomainError('FORBIDDEN','본인이 SW 등록 경로로 올린 파일만 연결할 수 있습니다.');
      if(file.sha256!==body.sha256)throw new DomainError('GUARD_FAILED','입력한 SW SHA-256과 실제 파일이 다릅니다.');
      const duplicate=this.db.get<{package_id:string}>('SELECT package_id FROM software_package WHERE file_id=?',body.fileId);
      if(duplicate){const old=this.get(duplicate.package_id);if(old.featureId!==body.featureId||old.featureVersion!==body.featureVersion||old.swId!==body.swId||old.source!==body.source)throw new DomainError('CONFLICT','이미 다른 구성으로 등록된 SW 파일입니다.');return old;}
      this.binary.attach(body.fileId,this.scope(actor),actor.id);
      const item:SoftwarePackage={packageId:`SWP-${randomUUID()}`,featureId:body.featureId,featureVersion:body.featureVersion,swId:body.swId,
        fileId:body.fileId,name:file.name,bytes:file.bytes,sha256:file.sha256,mediaType:file.media_type,source:body.source,status:'DRAFT',revision:1,
        createdBy:actor.id,createdAt:this.clock.iso(),reviewedBy:null,reviewedAt:null,reason:body.reason,signature:null,sbom:{}};
      const swVersion=feature.swIds.length===feature.swVersions.length?feature.swVersions[feature.swIds.indexOf(body.swId)]:null;
      item.sbom={bomFormat:'CycloneDX',specVersion:'1.5',serialNumber:`urn:uuid:${item.packageId.slice(4)}`,version:1,
        metadata:{timestamp:item.createdAt,properties:[{name:'ff:feature',value:`${item.featureId}@${item.featureVersion}`},{name:'ff:evidence-boundary',value:'file-inventory-only; not a supplier or vulnerability attestation'}]},
        components:[{type:'application','bom-ref':item.swId,name:item.swId,...(swVersion?{version:swVersion}:{}),hashes:[{alg:'SHA-256',content:item.sha256}]}]};
      this.db.run('INSERT INTO software_package(package_id,feature_id,feature_version,sw_id,status,revision,file_id,doc) VALUES(?,?,?,?,?,?,?,?)',item.packageId,item.featureId,item.featureVersion,item.swId,item.status,item.revision,item.fileId,JSON.stringify(item));
      this.record(actor,'SOFTWARE_REGISTER',item,body.reason);return item;
    });
  }
  manifest(item:SoftwarePackage){return {schema:'ff.software.v1',packageId:item.packageId,featureId:item.featureId,featureVersion:item.featureVersion,swId:item.swId,
    name:item.name,bytes:item.bytes,sha256:item.sha256,mediaType:item.mediaType,source:item.source,sbom:item.sbom,createdBy:item.createdBy,createdAt:item.createdAt,reviewedBy:item.reviewedBy,reviewedAt:item.reviewedAt};}
  review(actor:Actor,id:string,body:SoftwarePackageDecisionBody){
    if(actor.role!=='RELEASE_MANAGER')throw new DomainError('FORBIDDEN','SW 패키지 검토는 출시 담당자가 수행합니다.');
    return this.db.tx(()=>{
      const item=this.get(id);
      if(item.revision!==body.revision)throw new DomainError('PRECONDITION_FAILED','다른 담당자가 SW 패키지를 변경했습니다. 다시 조회하세요.');
      if(actor.id===item.createdBy)throw new DomainError('FORBIDDEN','SW 업로드·등록자와 검토자는 달라야 합니다.');
      if(body.decision==='APPROVE'){
        if(item.status!=='DRAFT')throw new DomainError('CONFLICT','초안 SW만 승인할 수 있습니다.');
        this.file(item);item.reviewedBy=actor.id;item.reviewedAt=this.clock.iso();item.signature=this.pki.sign(this.manifest(item),'policy');item.status='APPROVED';
      }else{if(item.status!=='APPROVED')throw new DomainError('CONFLICT','승인된 SW만 회수할 수 있습니다.');item.status='REVOKED';}
      item.revision++;item.reason=body.reason;this.save(item);this.record(actor,`SOFTWARE_${body.decision}`,item,body.reason);return item;
    });
  }
  private record(actor:Actor,action:string,item:SoftwarePackage,reason:string){
    this.audit.record(actor,action,item.packageId,{after:item,reason,componentId:'D04-01'});
    this.events.publish(action.toLowerCase().replaceAll('_','.'),item.packageId,{packageId:item.packageId,status:item.status,revision:item.revision},{componentId:'D04-01',correlationId:actor.correlationId});
  }
  async check(id:string,vin:string,flagKey:string){
    const item=this.get(id),manifest=this.manifest(item);
    let blocked:string|null=null,decision:Awaited<ReturnType<ActivationService['decide']>>|null=null;
    if(item.status!=='APPROVED')blocked=item.status==='REVOKED'?'PACKAGE_REVOKED':'PACKAGE_NOT_APPROVED';
    else if(!item.signature||!this.pki.verify(manifest,item.signature,this.pki.keys(),'policy').valid)blocked='MANIFEST_SIGNATURE_INVALID';
    const deployed=this.policies.deployed(flagKey);
    if(!blocked&&(!deployed||deployed.featureId!==item.featureId||deployed.featureVersion!==item.featureVersion))blocked='DEPLOYED_FEATURE_MISMATCH';
    if(!blocked){decision=await this.activation.decide(vin,flagKey);if(!decision.result.value||decision.result.reason!=='POLICY_MATCH')blocked=decision.result.reason;}
    if(!blocked){const feature=this.features.get(item.featureId,item.featureVersion);if(!feature?.swIds.includes(item.swId))blocked='SOFTWARE_COMPONENT_REMOVED';}
    if(!blocked){
      const fresh=this.get(id),current=this.policies.deployed(flagKey);
      if(fresh.status!=='APPROVED'||fresh.revision!==item.revision)blocked='PACKAGE_CHANGED';
      else if(!current||current.policyId!==decision!.policy.policyId||current.revision!==decision!.policy.revision||current.contentHash!==decision!.policy.contentHash)blocked='POLICY_CHANGED';
      else this.file(item);
    }
    return {allowed:blocked===null,blocked,vin,flagKey,package:item,manifest,signature:item.signature,publicKey:item.signature?this.pki.publicKey(item.signature.keyId):null,
      policy:decision?{policyId:decision.policy.policyId,revision:decision.policy.revision,featureId:decision.policy.featureId,featureVersion:decision.policy.featureVersion}:null,
      evaluation:decision?.result??null,boundary:'FILE_DOWNLOAD_ONLY'};
  }
  async download(actor:Actor,id:string,vin:string,flagKey:string){
    if(actor.role==='VEHICLE'){if(actor.id!==`vehicle:${vin}`)throw new DomainError('VEHICLE_SCOPE','자기 차량의 SW만 받을 수 있습니다.');}
    else if(!['IMPLEMENTER','RELEASE_MANAGER','OPERATOR'].includes(actor.role))throw new DomainError('FORBIDDEN','SW 다운로드 검증 권한이 없습니다.');
    const verdict=await this.check(id,vin,flagKey);
    if(!verdict.allowed)throw new DomainError('GUARD_FAILED','SW 다운로드 조건을 충족하지 못했습니다.',{blocked:verdict.blocked,flagKey,vin});
    const {row,stream}=this.binary.download(verdict.package.fileId),downloadId=`SWDL-${randomUUID()}`,at=this.clock.iso();
    this.db.tx(()=>{
      const doc={downloadId,packageId:id,vin,flagKey,actorId:actor.id,at,bytes:row.bytes,sha256:row.sha256,policy:verdict.policy,evaluation:verdict.evaluation,state:'STREAM_OPENED',boundary:'FILE_DOWNLOAD_ONLY'};
      this.db.run('INSERT INTO software_download(download_id,package_id,vin,actor_id,at,doc) VALUES(?,?,?,?,?,?)',downloadId,id,vin,actor.id,at,JSON.stringify(doc));
      this.audit.record(actor,'SOFTWARE_DOWNLOAD_OPEN',id,{after:doc,componentId:'D04-01'});
    });
    return {row,stream,downloadId};
  }
  async vehicleManifest(actor:Actor,id:string,vin:string,flagKey:string){
    if(actor.role!=='VEHICLE'||actor.id!==`vehicle:${vin}`)throw new DomainError('VEHICLE_SCOPE','자기 차량의 SW 매니페스트만 받을 수 있습니다.');
    const result=await this.check(id,vin,flagKey);
    if(!result.allowed)throw new DomainError('GUARD_FAILED','SW 매니페스트 전달 조건을 충족하지 못했습니다.',{blocked:result.blocked});
    return {manifest:result.manifest,signature:result.signature,publicKey:result.publicKey,boundary:result.boundary};
  }
  history(id:string){this.get(id);return {items:this.db.all<{doc:string}>('SELECT doc FROM software_download WHERE package_id=? ORDER BY at DESC',id).map(r=>JSON.parse(r.doc))};}
}
