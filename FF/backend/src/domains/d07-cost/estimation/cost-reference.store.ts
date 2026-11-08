import { createHash } from 'node:crypto';
import {
 canonicalCostSource,costFeatureSourceOf,costRefFactsOf,costReferenceMissing,costReferencePublic,refStatusPolicy,
 type AddCostReferenceBody,type CostBasis,type CostReferenceOrigin,type CostReferenceRevision,type CostReferenceSnapshot,type FeatureRefRow,type FeatureVersionRow,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import type { Clock } from '../../../kernel/clock';
import type { Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import type { SecretVault } from '../../../kernel/kms/key-protection';
import { openFor,sealFor } from '../../../kernel/kms/secret-columns';
import type { FeatureRepo } from '../../d01-policy/repos';
import type { RefdbRepository } from '../../d01-policy/refdb/refdb.repository';

const digest=(value:unknown)=>createHash('sha256').update(canonicalCostSource(value)).digest('hex');
interface RevisionRow {
 est_id:string;line_no:number;revision:number;ref_id:string;ref_release:string;reference_sha256:string;feature_sha256:string|null;captured_by:string;captured_at:string;reason:string;doc_sealed:string;
}
const metadata=(row:RevisionRow):CostReferenceRevision=>({revision:row.revision,release:row.ref_release,referenceSha256:row.reference_sha256,featureSha256:row.feature_sha256,capturedBy:row.captured_by,capturedAt:row.captured_at,reason:row.reason});
export interface ValidatedCostReference { reference:FeatureRefRow;relatedReferences:FeatureRefRow[];feature:FeatureVersionRow|null;release:string;referenceSha256:string;featureSha256:string|null;ord:number }

/** Keeps original reference/Feature evidence separately from editable estimate inputs and approval results. */
export class CostReferenceStore {
 private ordCache:{key:string;values:Map<string,number>}|null=null;
 constructor(private db:Db,private refs:RefdbRepository,private features:FeatureRepo,private vault:SecretVault,private clock:Clock,private basis:(version:string)=>CostBasis) {}
 private related(reference:FeatureRefRow) {const target=reference.duplicateOf?this.refs.getRef(reference.duplicateOf):undefined;return target?[target]:[];}
 private ordinal(refId:string) {
  const key=`${this.refs.latestRelease()?.release ?? ''}:${this.db.get<{n:number}>('SELECT count(*) AS n FROM feature_ref')!.n}`;
  if(this.ordCache?.key!==key)this.ordCache={key,values:new Map(this.refs.listRefs({}).map((row,index)=>[row.refId,index]))};
  return this.ordCache.values.get(refId) ?? -1;
 }

 preview(refId:string,basisVersion:string) {
  const reference=this.refs.getRef(refId);
  if(!reference) throw new DomainError('NOT_FOUND',`기준 행 ${refId}이 없습니다.`);
  const release=this.refs.latestRelease()?.release ?? null;
  const missing=costReferenceMissing(reference,this.basis(basisVersion));
  const referenceSha256=digest(reference);
  const features=this.features.all().filter(feature=>(feature.featureRefs ?? []).some(link=>link.refId===refId)).map(feature=>({featureId:feature.featureId,version:feature.version,name:feature.name,asil:feature.asil,lifecycle:feature.lifecycle,sha256:digest(costFeatureSourceOf(feature))}));
  return {ref:reference,relatedReferences:this.related(reference),ord:this.ordinal(refId),basisVersion,refRelease:release,referenceSha256,usable:!!release && refStatusPolicy(reference.status).costUsable && !missing.length,missing:[...(!release?['REFERENCE_RELEASE']:[]),...missing],features,sources:this.refs.sources().filter(source=>reference.sourceIds.includes(source.sourceId))};
 }

 validate(selection:AddCostReferenceBody,basisVersion:string,projectRelease:string|null):ValidatedCostReference {
  const release=this.refs.latestRelease()?.release;
  if(!release || selection.refRelease!==release || selection.refRelease!==projectRelease)
   throw new DomainError('CONFLICT','Feature DB 발행 버전이 달라졌습니다 — 과제의 최신 기준을 확인한 뒤 다시 선택하세요.',{field:'refRelease'});
  const reference=this.refs.getRef(selection.refId);
  if(!reference) throw new DomainError('NOT_FOUND',`기준 행 ${selection.refId}이 없습니다.`);
  if(!refStatusPolicy(reference.status).costUsable) throw new DomainError('VALIDATION','요청 중이거나 폐기된 기준 행은 산정에 쓸 수 없습니다.',{field:'refId',refId:reference.refId});
  const referenceSha256=digest(reference);
  if(referenceSha256!==selection.referenceSha256) throw new DomainError('CONFLICT','선택한 기준 행의 내용이 변경됐습니다 — 출처를 다시 확인하세요.',{field:'referenceSha256'});
  const missing=costReferenceMissing(reference,this.basis(basisVersion));
  if(missing.length) throw new DomainError('VALIDATION','현재 계수 표에 필요한 산정 기준이 없습니다. 임의의 0이나 기본값으로 계산하지 않습니다.',{field:'refId',missing});
  let feature:FeatureVersionRow|null=null;
  if(selection.feature) {
   feature=this.features.get(selection.feature.featureId,selection.feature.version) ?? null;
   if(!feature) throw new DomainError('NOT_FOUND','연결할 등록 Feature 버전이 없습니다.',{field:'feature'});
   if(!(feature.featureRefs ?? []).some(link=>link.refId===reference.refId)) throw new DomainError('VALIDATION','선택한 기준 행을 참조하는 실제 Feature만 연결할 수 있습니다.',{field:'feature'});
   if(digest(costFeatureSourceOf(feature))!==selection.feature.sha256) throw new DomainError('CONFLICT','연결할 Feature 내용이 변경됐습니다 — 후보를 다시 확인하세요.',{field:'feature'});
  }
  return {reference,relatedReferences:this.related(reference),feature,release,referenceSha256,featureSha256:feature?digest(costFeatureSourceOf(feature)):null,ord:this.ordinal(reference.refId)};
 }

 /** Legacy Feature-add remains compatible while creating source evidence for newly added lines. */
 fromFeature(reference:FeatureRefRow,feature:FeatureVersionRow,basisVersion:string,projectRelease:string|null):ValidatedCostReference {
  return this.validate({refId:reference.refId,refRelease:this.refs.latestRelease()?.release ?? '',referenceSha256:digest(reference),feature:{featureId:feature.featureId,version:feature.version,sha256:digest(costFeatureSourceOf(feature))}},basisVersion,projectRelease);
 }

 capture(actor:Actor,estId:string,lineNo:number,value:ValidatedCostReference,reason:string):CostReferenceRevision {
  const revision=(this.db.get<{revision:number|null}>('SELECT max(revision) AS revision FROM cost_reference_revision WHERE est_id=? AND line_no=?',estId,lineNo)?.revision ?? 0)+1;
  const snapshot:CostReferenceSnapshot={reference:value.reference,relatedReferences:value.relatedReferences,facts:costRefFactsOf(value.reference,value.ord),feature:value.feature?costFeatureSourceOf(value.feature):null,sources:this.refs.sources().filter(source=>value.reference.sourceIds.includes(source.sourceId))};
  const capturedAt=this.clock.iso();
  this.db.run('INSERT INTO cost_reference_revision(est_id,line_no,revision,ref_id,ref_release,reference_sha256,feature_sha256,captured_by,captured_at,reason,doc_sealed) VALUES(?,?,?,?,?,?,?,?,?,?,?)',estId,lineNo,revision,value.reference.refId,value.release,value.referenceSha256,value.featureSha256,actor.id,capturedAt,reason,sealFor(this.vault,'cost_reference_revision','doc_sealed',`${estId}:${lineNo}:${revision}`,JSON.stringify(snapshot)));
  return {revision,release:value.release,referenceSha256:value.referenceSha256,featureSha256:value.featureSha256,capturedBy:actor.id,capturedAt,reason};
 }

 load(estId:string,lineNo:number,revision:number):{snapshot:CostReferenceSnapshot;metadata:CostReferenceRevision} {
  const row=this.db.get<RevisionRow>('SELECT * FROM cost_reference_revision WHERE est_id=? AND line_no=? AND revision=?',estId,lineNo,revision);
  if(!row) throw new DomainError('INTERNAL','산정 원천 개정 기록이 없습니다.');
  const snapshot=JSON.parse(openFor(this.vault,'cost_reference_revision','doc_sealed',`${estId}:${lineNo}:${revision}`,row.doc_sealed)) as CostReferenceSnapshot;
  if(digest(snapshot.reference)!==row.reference_sha256 || (snapshot.feature?digest(snapshot.feature):null)!==row.feature_sha256) throw new DomainError('INTERNAL','산정 원천 개정의 무결성 확인에 실패했습니다.');
  return {snapshot,metadata:metadata(row)};
 }

 view(estId:string,lineNo:number,revision:number):CostReferenceOrigin {
  const {snapshot,metadata:captured}=this.load(estId,lineNo,revision);
  const current=this.refs.getRef(snapshot.reference.refId);
  const currentReferenceSha256=current?digest(current):null;
  const f=snapshot.feature?this.features.get(snapshot.feature.featureId,snapshot.feature.version):null;
  const featureSha=f?digest(costFeatureSourceOf(f)):null;
  const relatedStale=(snapshot.relatedReferences ?? []).some(ref=>digest(this.refs.getRef(ref.refId) ?? null)!==digest(ref));
  return {...captured,kind:snapshot.feature?'REGISTERED_FEATURE':'FEATURE_DB',stale:relatedStale || captured.referenceSha256!==currentReferenceSha256 || captured.featureSha256!==featureSha,latestRelease:this.refs.latestRelease()?.release ?? null,currentReferenceSha256,reference:costReferencePublic(snapshot.reference),feature:snapshot.feature,sources:snapshot.sources,history:this.db.all<RevisionRow>('SELECT * FROM cost_reference_revision WHERE est_id=? AND line_no=? ORDER BY revision',estId,lineNo).map(metadata)};
 }

 nextLineNo(estId:string):number {
  return (this.db.get<{maximum:number|null}>('SELECT max(line_no) AS maximum FROM (SELECT line_no FROM cost_line WHERE est_id=? UNION ALL SELECT line_no FROM cost_reference_revision WHERE est_id=?)',estId,estId)?.maximum ?? 0)+1;
 }
}
