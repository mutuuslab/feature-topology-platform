import type { Role } from '../../enums';
import type { CostReviewBaseline,CostReviewInputs,CostReviewKind,CostReviewValue,CostReviewDocument,ActCostReviewBody } from '../../schemas/cost-procurement';
export const COST_REVIEW_TECH_ROLES:readonly Role[]=['IMPLEMENTER','DOMAIN_REVIEWER'];
export const COST_REVIEW_TERMS_ROLES:readonly Role[]=['COST_BASIS_ADMIN'];
export const emptyCostReviewInputs=():CostReviewInputs=>({requirements:[],evidence:[],offers:[],claims:[],price:null,ecuIds:[],candidates:[],scenarioVolumes:[],selectedOfferId:'',selectedCandidateId:'',decisionReason:''});
export const unknownCostValue=():CostReviewValue=>({value:null,state:'UNCONFIRMED',sourceId:'',note:''});
export interface CostReviewFinding {code:string;subject:string;message:string}
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
/** Shared by native and browser replay. No unavailable input is silently converted to zero. */
export function evaluateCostReview(kind:CostReviewKind,input:CostReviewInputs,baseline:CostReviewBaseline){
 const findings:CostReviewFinding[]=[];
 const fail=(code:string,subject:string,message:string)=>{if(!findings.some(f=>f.code===code&&f.subject===subject))findings.push({code,subject,message});};
 const sources=new Map(input.evidence.map(e=>[e.id,e]));
 const evidence=(id:string,subject:string)=>{const e=sources.get(id);if(!e?.confirmed)fail('EVIDENCE_REQUIRED',subject,'개정·해시·위치가 있는 확인된 근거가 필요합니다.');return !!e?.confirmed;};
 const unique=(values:string[],subject:string)=>{if(new Set(values).size!==values.length)fail('DUPLICATE_ID',subject,'같은 식별자를 중복 사용했습니다.');};
 unique(input.evidence.map(e=>e.id),'근거');unique(input.requirements.map(e=>e.id),'요구사항');unique(input.offers.map(e=>e.id),'견적');
 const value=(v:CostReviewValue,subject:string,negative=false):number|null=>{
  if(v.state==='NOT_APPLICABLE'){if(!v.note.trim()||!evidence(v.sourceId,subject)||v.value!==null)fail('NOT_APPLICABLE_REASON',subject,'비적용은 근거·사유를 적고 숫자는 비워 둡니다.');else return 0;return null;}
  if(v.state!=='CONFIRMED'||v.value===null||!Number.isFinite(v.value)||!negative&&v.value<0){fail('VALUE_UNCONFIRMED',subject,'미확정 값은 0으로 계산하지 않습니다. 자료 확인 후 값을 확정하세요.');return null;}
  return evidence(v.sourceId,subject)?v.value:null;
 };
 const sum=(xs:(number|null)[])=>xs.some(x=>x===null)?null:round((xs as number[]).reduce((a,b)=>a+b,0));
 const product=(a:number|null,b:number|null)=>a===null||b===null?null:round(a*b);
 if(!baseline.valid)fail('BASELINE_INVALID','산정 기준',baseline.error??'Feature DB·계수·산정 기준을 최신으로 확인하세요.');
 if(!input.evidence.length)fail('EVIDENCE_REQUIRED','검토 근거','검토할 원문 자료가 없습니다.');
 for(const req of input.requirements)evidence(req.sourceId,req.id);
 if(['SCOPE','TUNING','CHANGE','QUOTE'].includes(kind)&&!input.requirements.length)fail('REQUIREMENTS_REQUIRED','업무 범위','실제 요구와 작업의 연결이 필요합니다.');
 const reqs=new Set(input.requirements.map(r=>r.id));
 const neededOffers=['SCOPE','TUNING','CHANGE','QUOTE'].includes(kind);
 if(neededOffers&&input.offers.length<(kind==='SCOPE'?2:1))fail('OFFERS_REQUIRED','견적','동일 범위를 비교할 견적·지역·업체를 구분해 등록하세요.');
 const workIds=new Set(input.offers.flatMap(o=>o.works.map(w=>w.id)));
 const totals=(neededOffers?input.offers:[]).map(offer=>{
  evidence(offer.sourceId,offer.id);if(!offer.supplier||!offer.region||!offer.period||!offer.quoteRevision||offer.tax==='UNKNOWN')fail('QUOTE_BASIS_REQUIRED',offer.id,'공급사·지역·기간·원문 개정·세금 기준을 확인하세요.');
  unique(offer.works.map(w=>w.id),offer.id);unique(offer.extras.map(e=>e.id),offer.id+' 별도비');
  const executions=new Set<string>();let mm:number|null=0;
  const costs=offer.works.map(w=>{
   if(w.disposition==='EXCLUDED'){if(!w.exclusionReason||!evidence(w.sourceId,w.id))fail('EXCLUSION_REASON',w.id,'제외 판단의 근거와 사유가 필요합니다.');return 0;}
   if(w.disposition!=='INCLUDED'){fail('WORK_UNCONFIRMED',w.id,'작업 포함 여부가 미확정입니다.');return null;}
   evidence(w.sourceId,w.id);if(!w.requirementIds.length||w.requirementIds.some(id=>!reqs.has(id)))fail('WORK_REQUIREMENT_LINK',w.id,'작업과 실제 요구를 연결하세요. 같은 작업은 여러 요구에 연결해도 한 번만 합산합니다.');
   if(!w.referenceLineNos.length)fail('REFERENCE_LINE_REQUIRED',w.id,'Feature DB 산정 줄과 작업을 연결하세요.');
   if(!w.scopeKey)fail('WORK_SCOPE_REQUIRED',w.id,'작업 범위 식별 근거가 필요합니다.');
   if(w.kind==='UNKNOWN'||w.basisKind==='UNKNOWN')fail('WORK_KIND_UNKNOWN',w.id,'실제 작업과 적용한 공수 기준의 유형을 확인하세요.');
   if(w.kind==='NEW_LOGIC'&&w.basisKind==='PARAMETER')fail('WORK_BASIS_MISMATCH',w.id,'신규 로직에 파라미터 조정 기준을 적용할 수 없습니다.');
   if(w.executionId){const key=w.executionId+'|'+w.scopeKey+'|'+w.requirementIds.slice().sort().join(',');if(executions.has(key))fail('DUPLICATE_EXECUTION',w.id,'같은 수행 ID와 범위의 작업 비용이 겹칩니다. 보고서 이름만 같다는 이유로 중복 처리하지는 않습니다.');executions.add(key);}
   if(w.kind==='TEST'){if(!w.executionId||!w.scopeKey||!w.standardRevision||!w.variant)fail('TEST_SCOPE_REQUIRED',w.id,'시험 수행·범위·규격 개정·사양이 있어야 같은 시험인지 비교할 수 있습니다.');value(w.sampleCount,w.id+' 시험 표본');}
   const effort=value(w.effort,w.id+' 공수'),rate=value(w.rate.amount,w.id+' 단가');let days:number|null=null,hours:number|null=null;
   if(w.effortUnit!=='MM'||w.rate.unit!=='MM')days=value(w.rate.daysPerMonth,w.id+' 월 작업일');
   if(w.effortUnit==='HOUR'||w.rate.unit==='HOUR')hours=value(w.rate.hoursPerDay,w.id+' 일 작업시간');
   if(days===0||hours===0){fail('UNIT_ZERO',w.id,'단위 환산의 작업일·시간은 0보다 커야 합니다.');days=null;hours=null;}
   const effortMm=effort===null?null:w.effortUnit==='MM'?effort:days===null?null:w.effortUnit==='DAY'?effort/days:hours===null?null:effort/(days*hours);
   mm=mm===null||effortMm===null?null:mm+effortMm;
   const units=effortMm===null?null:w.rate.unit==='MM'?effortMm:days===null?null:w.rate.unit==='DAY'?effortMm*days:hours===null?null:effortMm*days*hours;
   return product(units,rate);
  });
  if(neededOffers)for(const req of input.requirements){const linked=offer.works.filter(w=>w.disposition==='INCLUDED'&&w.requirementIds.includes(req.id));if(!linked.length)fail('REQUIREMENT_UNCOVERED',offer.id+'/'+req.id,'요구에 연결된 작업이 없습니다.');if(!linked.some(w=>w.kind==='TEST')&&!req.testWaiverSource)fail('TEST_MISSING',offer.id+'/'+req.id,'해당 요구의 시험 작업 또는 명시적인 시험 면제 근거가 필요합니다.');if(req.testWaiverSource)evidence(req.testWaiverSource,req.id+' 시험 면제');}
  const extras=offer.extras.map(e=>{evidence(e.sourceId,e.id);return product(value(e.quantity,e.id+' 수량'),value(e.unitPrice,e.id+' 단가'));});
  let license:number|null=0;
  if(offer.license){const l=offer.license;evidence(l.sourceId,offer.id+' 라이선스');if(!l.confirmed||l.model==='UNKNOWN'||!l.modelScope||!l.derivativeTerms||!l.maintenanceTerms||!l.reuseTerms)fail('LICENSE_TERMS_REQUIRED',offer.id,'과금 방식·차종·파생·유지보수·재사용 조건을 원문과 확인하세요.');
   const one=l.model==='ONE_TIME'||l.model==='COMBINED'?value(l.oneTime,offer.id+' 일시금'):0;
   const unit=l.model==='PER_UNIT'||l.model==='COMBINED'?product(value(l.perUnit,offer.id+' 대당 사용권'),value(l.volume,offer.id+' 물량')):0;
   const annual=l.model==='ANNUAL'||l.model==='COMBINED'?product(value(l.annual,offer.id+' 연간 사용권'),value(l.years,offer.id+' 기간')):0;license=sum([one,unit,annual]);}
  const calculated=sum([...costs,...extras,license]),quoted=value(offer.quotedTotal,offer.id+' 제출 총액'),gap=calculated===null||quoted===null?null:round(quoted-calculated);
  if(gap!==null&&gap!==0)fail('QUOTE_RESIDUAL',offer.id,'제출 총액과 공수·별도비·사용권 합계의 차액을 설명하고 원문을 보완하세요. 자동 삭감하지 않습니다.');
  return {offerId:offer.id,supplier:offer.supplier,region:offer.region,currency:offer.currency,tax:offer.tax,period:offer.period,labor:sum(costs),extras:sum(extras),license,calculated,quoted,residual:gap,effortMm:mm===null?null:round(mm)};
 });
 const comparison:{left:string;right:string;comparable:boolean;differences:string[]}[]=[];
 if(kind==='SCOPE')for(let a=0;a<input.offers.length;a++)for(let b=a+1;b<input.offers.length;b++){
  const x=input.offers[a],y=input.offers[b],differences:string[]=[];
  for(const key of ['currency','tax','period']as const)if(x[key]!==y[key])differences.push(key);
  const signature=(o:typeof x)=>o.works.filter(w=>w.disposition==='INCLUDED').map(w=>[w.kind,w.requirementIds.slice().sort().join(','),w.scopeKey,w.standardRevision,w.variant,w.sampleCount.value].join('|')).sort().join(';');
  if([...x.works,...y.works].some(w=>w.disposition==='INCLUDED'&&(!w.scopeKey||w.kind==='TEST'&&(!w.standardRevision||!w.variant||w.sampleCount.state!=='CONFIRMED'||w.sampleCount.value===null))))differences.push('시험·작업 범위 미확정');
  if(signature(x)!==signature(y))differences.push('작업·시험·규격·사양·표본 범위');
  if(differences.length)fail('SCOPE_NOT_EQUIVALENT',x.id+'/'+y.id,'동등 범위가 확인되지 않았습니다. 인증 개수·기관·보고서명만으로 차액을 인정하거나 삭감하지 않습니다.');
  comparison.push({left:x.id,right:y.id,comparable:!differences.length,differences});
 }
 let claimTotal:number|null=null;
 if(kind==='CHANGE'){
  if(!input.claims.length)fail('CLAIMS_REQUIRED','변경청구','변경 요청·승인 기준선·작업·비용 근거를 연결하세요.');unique(input.claims.map(c=>c.id),'변경청구');const seen=new Set<string>();
  claimTotal=sum(input.claims.map(c=>{evidence(c.sourceId,c.id);if(!c.changeId||!c.baselineApproval||!c.reason||!c.workIds.length||c.workIds.some(id=>!workIds.has(id))||!c.requirementIds.length||c.requirementIds.some(id=>!reqs.has(id)))fail('CHANGE_TRACE_REQUIRED',c.id,'전후 요구·승인 기준선·변경점·작업·사유를 연결하세요.');const key=c.executionId+'|'+c.scopeKey;if(c.executionId&&seen.has(key))fail('DUPLICATE_CLAIM',c.id,'같은 수행·범위의 청구가 겹칩니다.');seen.add(key);if(c.contractIncluded==='UNKNOWN')fail('CONTRACT_SCOPE_UNKNOWN',c.id,'원 계약 포함 여부가 미확정입니다.');const claimed=value(c.claimed,c.id+' 청구액'),recognized=value(c.recognizedProposal,c.id+' 인정 제안액');if(recognized!==null&&claimed!==null&&recognized>claimed)fail('RECOGNITION_EXCEEDS_CLAIM',c.id,'인정 제안액이 청구액을 넘습니다.');if(c.contractIncluded==='YES'&&recognized!==null&&recognized!==0)fail('CONTRACT_ALREADY_INCLUDED',c.id,'계약에 포함된 작업을 추가 비용으로 다시 인정할 수 없습니다.');return recognized;}));
 }
 let price:null|{increase:number|null;explained:number|null;residual:number|null;scenarios:{volume:number|null;original:number|null;requested:number|null}[]}=null;
 if(kind==='PRICE'){
  const p=input.price;if(!p)fail('PRICE_TERMS_REQUIRED','가격 기준','최초 가격·물량·기간·Terms와 인상 요인을 등록하세요.');else{
   evidence(p.sourceId,'최초 Terms');if(!p.contractId||p.model==='UNKNOWN'||!p.termsConfirmed||!p.ownershipTerms||!p.recoveryTerms||!p.tierTerms||!p.period)fail('PRICE_TERMS_REQUIRED','최초 Terms','최초 가격 모델·귀속·회수·물량 구간·기간 확인이 필요합니다. 협의 가격에서 고정비를 역산하지 않습니다.');
   const fixed=p.model==='FIXED_PLUS_UNIT'?value(p.originalFixed,'최초 고정비'):0,old=value(p.originalUnit,'최초 대당가'),next=value(p.requestedUnit,'인상 요청 대당가');value(p.baseVolume,'최초 물량');
   if(!p.factors.length)fail('INCREASE_FACTORS_REQUIRED','인상 요인','인상 요청이 비어 있으면 검토 완료로 보지 않습니다.');unique(p.factors.map(f=>f.id),'인상 요인');
   const explained=sum(p.factors.map(f=>{evidence(f.sourceId,f.id);return value(f.amountPerUnit,f.id+' 대당 영향',true);})),increase=old===null||next===null?null:round(next-old),residual=increase===null||explained===null?null:round(increase-explained);
   if(residual!==null&&residual!==0)fail('INCREASE_RESIDUAL','미설명 인상액','원인별 인상 합계와 요청 차액이 일치하지 않습니다. 미설명 잔차를 보완하세요.');
   if(!p.scenarioVolumes.length)fail('VOLUME_SCENARIOS_REQUIRED','물량 시나리오','검토할 물량 조건이 없습니다.');
   price={increase,explained,residual,scenarios:p.scenarioVolumes.map((v,i)=>{const volume=value(v,'물량 조건 '+(i+1));return {volume,original:sum([fixed,product(old,volume)]),requested:sum([fixed,product(next,volume)])};})};
  }
 }
 const alternatives:{candidateId:string;baseline:boolean;nre:number|null;perVehicle:number|null;scenarios:{volume:number|null;total:number|null}[];breakEvenVolume:number|null}[]=[];
 if(kind==='MCU'){
  unique(input.ecuIds,'ECU');unique(input.candidates.map(c=>c.id),'MCU 대안');if(!input.ecuIds.length||input.candidates.length<2||input.candidates.filter(c=>c.baseline).length!==1)fail('MCU_COMPARISON_REQUIRED','MCU 대안','기준 대안 하나와 비교 대안, 실제 ECU 배정을 등록하세요.');
  if(!input.scenarioVolumes.length)fail('VOLUME_SCENARIOS_REQUIRED','물량 시나리오','검토할 물량 조건이 없습니다.');const volumes=input.scenarioVolumes.map((v,i)=>value(v,'물량 조건 '+(i+1)));
  for(const c of input.candidates){unique(c.allocations.map(a=>a.ecuId),c.id+' ECU 배정');const allocationComplete=!input.ecuIds.some(id=>!c.allocations.some(a=>a.ecuId===id))&&!c.allocations.some(a=>!input.ecuIds.includes(a.ecuId))&&new Set(c.allocations.map(a=>a.ecuId)).size===c.allocations.length;if(!allocationComplete)fail('ECU_ALLOCATION_INCOMPLETE',c.id,'대안마다 같은 ECU 전체에 배정해야 합니다. 누락 ECU를 0으로 보지 않습니다.');let sharedConflict=false;const shared=new Map<string,number|null>();const fixed:(number|null)[]=[],variable:(number|null)[]=[];
   for(const a of c.allocations){evidence(a.sourceId,c.id+'/'+a.ecuId);if(!a.mcu||!a.scopeKey||!a.constraints||a.started==='UNKNOWN')fail('MCU_SCOPE_REQUIRED',c.id+'/'+a.ecuId,'MCU·동등 기능/검증 범위·비재무 제약·착수 여부가 필요합니다.');fixed.push(value(a.porting,a.ecuId+' 포팅'),value(a.validation,a.ecuId+' 검증'),value(a.startup,a.ecuId+' 착수'));variable.push(product(value(a.unitsPerVehicle,a.ecuId+' 대당 수량'),sum([value(a.unitPrice,a.ecuId+' 부품가'),value(a.royalty,a.ecuId+' 사용권')])));if(a.sharedCostId){const amount=value(a.sharedCost,c.id+' 공통비 '+a.sharedCostId);if(shared.has(a.sharedCostId)&&shared.get(a.sharedCostId)!==amount){sharedConflict=true;fail('SHARED_COST_CONFLICT',a.sharedCostId,'같은 공통비의 금액이 다릅니다.');}shared.set(a.sharedCostId,amount);}else if(a.sharedCost.state!=='NOT_APPLICABLE')fail('SHARED_COST_SCOPE',a.ecuId,'공통비 식별자를 지정하거나 비적용 근거를 남기세요.');}
   const nre=allocationComplete&&!sharedConflict?sum([...fixed,...shared.values()]):null,perVehicle=allocationComplete?sum(variable):null;alternatives.push({candidateId:c.id,baseline:c.baseline,nre,perVehicle,scenarios:volumes.map(volume=>({volume,total:sum([nre,product(perVehicle,volume)])})),breakEvenVolume:null});
  }
  const b=alternatives.find(a=>a.baseline);for(const c of alternatives)if(!c.baseline&&b&&b.nre!==null&&c.nre!==null&&b.perVehicle!==null&&c.perVehicle!==null){const savings=b.perVehicle-c.perVehicle;c.breakEvenVolume=savings>0?Math.max(0,Math.ceil((c.nre-b.nre)/savings)):null;}
 }
 const chosen=kind==='MCU'?input.selectedCandidateId:input.selectedOfferId;
 if(['SCOPE','TUNING','CHANGE','QUOTE'].includes(kind)&&!input.offers.some(o=>o.id===chosen)||kind==='MCU'&&!input.candidates.some(c=>c.id===chosen))fail('DECISION_TARGET_REQUIRED','검토 제안','선택한 견적 또는 대안을 명시하세요.');
 if(!input.decisionReason.trim())fail('DECISION_REASON_REQUIRED','검토 제안','판단 근거와 미해결 사항을 기록하세요.');
 if(totals.some(t=>t.calculated!==null&&(!Number.isFinite(t.calculated)||Math.abs(t.calculated)>Number.MAX_SAFE_INTEGER)))fail('CALCULATION_RANGE','합계','계산 범위가 지원 정밀도를 넘었습니다.');
 return {ready:findings.length===0,findings,offers:totals,comparison,claimTotal,price,alternatives,termsRequired:kind==='PRICE'||input.offers.some(o=>!!o.license),technicalRequired:kind!=='PRICE',boundary:'INTERNAL_REVIEW_NOT_CONTRACT_OR_PAYMENT' as const};
}
export function costReviewActionRole(action:string,role:Role){return action.startsWith('TECHNICAL_')?COST_REVIEW_TECH_ROLES.includes(role):action.startsWith('TERMS_')?COST_REVIEW_TERMS_ROLES.includes(role):action==='APPROVE'||action==='REJECT'?role==='COST_APPROVER':role==='COST_ESTIMATOR';}
export function costReviewView(doc:CostReviewDocument,money:boolean){if(money)return doc;return {caseId:doc.caseId,estId:doc.estId,kind:doc.kind,title:doc.title,status:doc.status,revision:doc.revision,createdBy:doc.createdBy,updatedAt:doc.updatedAt,contentSha256:doc.contentSha256,baseline:{basisVersion:doc.baseline.basisVersion,refRelease:doc.baseline.refRelease,referenceIds:doc.baseline.referenceIds},scope:{requirements:doc.inputs.requirements,works:doc.inputs.offers.map(o=>({offerId:o.id,works:o.works.map(w=>({id:w.id,title:w.title,kind:w.kind,requirementIds:w.requirementIds,referenceLineNos:w.referenceLineNos,effort:w.effort,effortUnit:w.effortUnit,executionId:w.executionId,scopeKey:w.scopeKey,standardRevision:w.standardRevision,variant:w.variant,deliverable:w.deliverable}))}))},opinions:doc.opinions.map(o=>({kind:o.kind,by:o.by,role:o.role,at:o.at,decision:o.decision,contentSha256:o.contentSha256}))};}

export class CostReviewRuleError extends Error {constructor(readonly code:'FORBIDDEN'|'PRECONDITION_FAILED'|'CONFLICT'|'SEPARATION_OF_DUTY'|'GUARD_FAILED',message:string,readonly details?:unknown){super(message);}}
export function costReviewAction(doc:CostReviewDocument,body:ActCostReviewBody,actor:{id:string;role:Role},live:CostReviewBaseline,at:string,handoffId:string):CostReviewDocument{
 const deny=(code:CostReviewRuleError['code'],message:string,details?:unknown):never=>{throw new CostReviewRuleError(code,message,details);};
 if(!costReviewActionRole(body.action,actor.role))deny('FORBIDDEN','이 검토 조치를 수행할 역할이 없습니다.');
 if(body.action==='HANDOFF'&&doc.handoff&&doc.status==='APPROVED'&&doc.approval?.contentSha256===doc.contentSha256&&doc.baseline.fingerprint===live.fingerprint)return doc;
 if(body.revision!==doc.revision)deny('PRECONDITION_FAILED','다른 사람이 검토 기록을 바꿨습니다. 최신 내용을 다시 확인하세요.');
 const next=structuredClone(doc);next.revision++;next.updatedAt=at;next.updatedBy=actor.id;next.lastReason=body.reason;
 const stale=doc.baseline.fingerprint!==live.fingerprint||!live.valid;
 const assessment=evaluateCostReview(doc.kind,doc.inputs,doc.baseline);
 const self=()=>{if(actor.id===doc.createdBy)deny('SEPARATION_OF_DUTY','작성자는 자기 검토를 확인·승인할 수 없습니다.');};
 const requireState=(state:CostReviewDocument['status'])=>{if(doc.status!==state)deny('CONFLICT','현재 상태에서는 이 조치를 수행할 수 없습니다.');};
 const fresh=()=>{if(stale)deny('GUARD_FAILED','산정 기준이 바뀌었거나 미확정입니다. 과제 원천 갱신과 검토 기준 재확인이 필요합니다.');};
 const latest=(kind:'TECHNICAL'|'TERMS')=>[...doc.opinions].reverse().find(o=>o.kind===kind&&o.contentSha256===doc.contentSha256);
 if(body.action==='REVISE'){requireState('APPROVED');next.status='DRAFT';next.approval=null;next.handoff=null;next.opinions=[];return next;}
 if(body.action==='REFRESH_BASELINE'){requireState('DRAFT');if(!live.valid)deny('GUARD_FAILED',live.error??'과제 기준이 미확정입니다.');next.baseline=structuredClone(live);next.opinions=[];next.approval=null;next.handoff=null;return next;}
 fresh();
 if(body.action==='SUBMIT'){requireState('DRAFT');if(!assessment.ready)deny('GUARD_FAILED','미확정·누락·불일치 항목을 해결한 뒤 검토를 요청하세요.',assessment.findings);next.status='SUBMITTED';return next;}
 if(body.action.startsWith('TECHNICAL_')||body.action.startsWith('TERMS_')){
  requireState('SUBMITTED');self();const kind=body.action.startsWith('TECHNICAL_')?'TECHNICAL':'TERMS',decision=body.action.endsWith('CHANGES')?'CHANGES':'AGREE';
  next.opinions.push({kind,by:actor.id,role:actor.role,at,contentSha256:doc.contentSha256,decision,reason:body.reason});if(decision==='CHANGES')next.status='DRAFT';return next;
 }
 if(body.action==='REJECT'){requireState('SUBMITTED');self();next.status='DRAFT';next.approval=null;next.handoff=null;return next;}
 if(body.action==='APPROVE'){
  requireState('SUBMITTED');self();if(!assessment.ready)deny('GUARD_FAILED','검토할 입력이 미확정입니다.',assessment.findings);
  const tech=latest('TECHNICAL'),terms=latest('TERMS');
  if(assessment.technicalRequired&&(!tech||tech.decision!=='AGREE'||tech.by===doc.createdBy||tech.by===actor.id))deny('SEPARATION_OF_DUTY','작성자·원가 승인자와 다른 기술 검토자의 최신 의견이 필요합니다.');
  if(assessment.termsRequired&&(!terms||terms.decision!=='AGREE'||terms.by===doc.createdBy))deny('GUARD_FAILED','최신 계약·사용권 자료의 독립 확인 기록이 필요합니다. 회사 계약 승인을 대신하지 않습니다.');
  next.status='APPROVED';next.approval={by:actor.id,role:actor.role,at,reason:body.reason,contentSha256:doc.contentSha256,baselineFingerprint:doc.baseline.fingerprint};return next;
 }
 if(body.action==='HANDOFF'){
  requireState('APPROVED');if(!doc.approval||doc.approval.contentSha256!==doc.contentSha256||doc.approval.baselineFingerprint!==live.fingerprint)deny('GUARD_FAILED','승인한 입력·기준 지문이 현재 기록과 다릅니다.');
  next.handoff={handoffId,preparedBy:actor.id,preparedAt:at,approvedSha256:doc.contentSha256,state:'PREPARED',boundary:'NO_EXTERNAL_PAYMENT'};return next;
 }
 return deny('CONFLICT','지원하지 않는 검토 조치입니다.');
}

/** Verify attached original bytes; a hash typed by the user never substitutes for this check. */
export async function verifyCostReviewEvidence(input:CostReviewInputs){
 for(const e of input.evidence){if(e.bodyBase64===undefined)continue;let bytes:Uint8Array<ArrayBuffer>;try{const raw=atob(e.bodyBase64);bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));}catch{throw new CostReviewRuleError('GUARD_FAILED','첨부 원문의 base64가 올바르지 않습니다.');}
  if(bytes.length===0||bytes.length>512*1024||!e.filename||/[\\/\x00-\x1f]/.test(e.filename)||!e.mediaType||!/^[-a-zA-Z0-9.+]+\/[-a-zA-Z0-9.+]+$/.test(e.mediaType))throw new CostReviewRuleError('GUARD_FAILED','원문 첨부는 정상 이름·유형의 512KiB 이하 파일이어야 합니다.');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');if(digest!==e.sha256)throw new CostReviewRuleError('GUARD_FAILED','첨부 원문의 SHA-256이 출처 기록과 다릅니다.');
 }
}
