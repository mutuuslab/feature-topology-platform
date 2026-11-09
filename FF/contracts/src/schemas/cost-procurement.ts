// Purchasing review inputs. Null, confirmed zero and non-applicability are distinct.
import { z } from 'zod';
const text=z.string().trim().max(1000),id=z.string().trim().min(1).max(100);
export const CostReviewKind=z.enum(['SCOPE','TUNING','CHANGE','QUOTE','PRICE','MCU']);
export type CostReviewKind=z.infer<typeof CostReviewKind>;
export const CostReviewValue=z.object({value:z.number().finite().min(-1e12).max(1e12).nullable(),state:z.enum(['UNCONFIRMED','CONFIRMED','NOT_APPLICABLE']).default('UNCONFIRMED'),sourceId:text.default(''),note:text.default('')}).strict();
export type CostReviewValue=z.infer<typeof CostReviewValue>;
export const CostReviewEvidence=z.object({id,revision:id,sha256:z.string().regex(/^[a-f0-9]{64}$/),location:z.string().trim().min(1).max(1000),confirmed:z.boolean(),synthetic:z.boolean().default(false),filename:z.string().max(180).optional(),mediaType:z.string().max(120).optional(),bodyBase64:z.string().max(710000).optional()}).strict();
const Requirement=z.object({id,revision:id,title:text,sourceId:text,testWaiverSource:text.default('')}).strict();
const Rate=z.object({amount:CostReviewValue,unit:z.enum(['MM','DAY','HOUR']),daysPerMonth:CostReviewValue,hoursPerDay:CostReviewValue}).strict();
const Work=z.object({id,title:text,requirementIds:z.array(id).max(100),referenceLineNos:z.array(z.number().int().positive()).max(100),kind:z.enum(['PARAMETER','NEW_LOGIC','PORTING','TEST','OTHER','UNKNOWN']),basisKind:z.enum(['PARAMETER','NEW_LOGIC','PORTING','TEST','OTHER','UNKNOWN']),effort:CostReviewValue,effortUnit:z.enum(['MM','DAY','HOUR']),rate:Rate,executionId:text,scopeKey:text,standardRevision:text,variant:text,sampleCount:CostReviewValue,deliverable:text,sourceId:text,disposition:z.enum(['INCLUDED','EXCLUDED','UNCONFIRMED']),exclusionReason:text.default('')}).strict();
const Charge=z.object({id,title:text,quantity:CostReviewValue,unitPrice:CostReviewValue,sourceId:text}).strict();
const License=z.object({model:z.enum(['ONE_TIME','PER_UNIT','ANNUAL','COMBINED','UNKNOWN']),sourceId:text,oneTime:CostReviewValue,perUnit:CostReviewValue,annual:CostReviewValue,volume:CostReviewValue,years:CostReviewValue,modelScope:text,derivativeTerms:text,maintenanceTerms:text,reuseTerms:text,confirmed:z.boolean()}).strict();
const Offer=z.object({id,supplier:text,region:text,currency:z.string().length(3),tax:z.enum(['EXCLUDED','INCLUDED','UNKNOWN']),period:text,quoteRevision:text,sourceId:text,quotedTotal:CostReviewValue,works:z.array(Work).max(500),extras:z.array(Charge).max(100),license:License.nullable()}).strict();
const Claim=z.object({id,changeId:text,baselineApproval:text,requirementIds:z.array(id).max(100),workIds:z.array(id).max(100),executionId:text,scopeKey:text,sourceId:text,contractIncluded:z.enum(['YES','NO','UNKNOWN']),claimed:CostReviewValue,recognizedProposal:CostReviewValue,reason:text}).strict();
const Price=z.object({contractId:text,sourceId:text,model:z.enum(['FIXED_PLUS_UNIT','UNIT_ONLY','UNKNOWN']),termsConfirmed:z.boolean(),ownershipTerms:text,recoveryTerms:text,tierTerms:text,period:text,originalFixed:CostReviewValue,originalUnit:CostReviewValue,requestedUnit:CostReviewValue,baseVolume:CostReviewValue,scenarioVolumes:z.array(CostReviewValue).max(10),factors:z.array(z.object({id,title:text,amountPerUnit:CostReviewValue,sourceId:text}).strict()).max(100)}).strict();
const Allocation=z.object({ecuId:id,mcu:text,unitsPerVehicle:CostReviewValue,unitPrice:CostReviewValue,royalty:CostReviewValue,porting:CostReviewValue,validation:CostReviewValue,startup:CostReviewValue,sharedCostId:text,sharedCost:CostReviewValue,sourceId:text,scopeKey:text,started:z.enum(['YES','NO','UNKNOWN']),constraints:text}).strict();
const Candidate=z.object({id,title:text,baseline:z.boolean(),allocations:z.array(Allocation).max(100)}).strict();
export const CostReviewInputs=z.object({requirements:z.array(Requirement).max(500),evidence:z.array(CostReviewEvidence).max(500),offers:z.array(Offer).max(20),claims:z.array(Claim).max(100),price:Price.nullable(),ecuIds:z.array(id).max(100),candidates:z.array(Candidate).max(20),scenarioVolumes:z.array(CostReviewValue).max(10),selectedOfferId:text,selectedCandidateId:text,decisionReason:text}).strict();
export type CostReviewInputs=z.infer<typeof CostReviewInputs>;
export const CreateCostReviewBody=z.object({kind:CostReviewKind,title:z.string().trim().min(2).max(200)}).strict();
export const PutCostReviewBody=z.object({revision:z.number().int().positive(),inputs:CostReviewInputs,reason:z.string().trim().min(2).max(1000)}).strict();
export const COST_REVIEW_ACTIONS=['REFRESH_BASELINE','SUBMIT','TECHNICAL_AGREE','TECHNICAL_CHANGES','TERMS_CONFIRMED','TERMS_CHANGES','APPROVE','REJECT','REVISE','HANDOFF'] as const;
export const ActCostReviewBody=z.object({revision:z.number().int().positive(),action:z.enum(COST_REVIEW_ACTIONS),reason:z.string().trim().min(2).max(1000)}).strict();
export type CreateCostReviewBody=z.infer<typeof CreateCostReviewBody>;
export type PutCostReviewBody=z.infer<typeof PutCostReviewBody>;
export type ActCostReviewBody=z.infer<typeof ActCostReviewBody>;
export interface CostReviewBaseline {fingerprint:string;basisVersion:string;refRelease:string|null;referenceIds:string[];estimateTotalMm:number|null;estimateCost:number|null;valid:boolean;error:string|null}
export interface CostReviewOpinion {kind:'TECHNICAL'|'TERMS';by:string;role:string;at:string;contentSha256:string;decision:'AGREE'|'CHANGES';reason:string}
export interface CostReviewApproval {by:string;role:string;at:string;reason:string;contentSha256:string;baselineFingerprint:string}
export interface CostReviewDocument {caseId:string;estId:string;kind:CostReviewKind;title:string;revision:number;status:'DRAFT'|'SUBMITTED'|'APPROVED';createdBy:string;createdAt:string;updatedAt:string;updatedBy:string;baseline:CostReviewBaseline;inputs:CostReviewInputs;contentSha256:string;opinions:CostReviewOpinion[];approval:CostReviewApproval|null;handoff:{handoffId:string;preparedBy:string;preparedAt:string;approvedSha256:string;state:'PREPARED';boundary:'NO_EXTERNAL_PAYMENT'}|null;lastReason:string}
