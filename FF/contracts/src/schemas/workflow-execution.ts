import { z } from 'zod';

const text = z.string().trim();
const expected = z.number().int().positive();
export const WORKFLOW_ARTIFACT_REQUEST_MAX = 96 * 1024;
export const workflowArtifactRequestBytes = (body:unknown) => new TextEncoder().encode(JSON.stringify(body)).length;
const ref = text.min(1).max(500).refine((v) => !/^(?:javascript|data|file):/i.test(v), '실행 주소는 근거 참조로 사용할 수 없습니다.');
export const CreateWorkflowCaseBody = z.object({ processId: text.regex(/^FPW\.\d+$/), title: text.min(2).max(200), targetRef: text.min(1).max(300) }).strict();
export const WorkflowRoleGrantBody = z.object({ accountId: text.min(1).max(120), roleId: text.regex(/^R-[A-Z]+$/), active: z.boolean(), reason: text.min(2).max(1000) }).strict();
export const WorkflowFile = z.object({ name: text.min(1).max(180), mediaType: text.min(1).max(100), base64: z.string().max(350_000) }).strict();
export const WorkflowArtifactBody = z.object({ version: expected, activityId: text.regex(/^FPW\.\d+-A\d+$/), productKey: text.regex(/^WP-[A-Z0-9-]+$/), fields: z.record(z.string(), text.max(8000)), references: z.array(ref).max(20).default([]), files: z.array(WorkflowFile).max(3).default([]), fileIds: z.array(z.string().uuid()).max(20).optional(), reason: text.min(2).max(1000) }).strict().refine(body=>workflowArtifactRequestBytes(body)<=WORKFLOW_ARTIFACT_REQUEST_MAX,'한 번의 산출물 내용은 96KiB 이하여야 합니다. 큰 파일은 별도 첨부 업로드를 사용하세요.');
export const WorkflowActivitySubmitBody = z.object({ version: expected, note: text.min(2).max(2000) }).strict();
export const WorkflowActivityReviewBody = z.object({ version: expected, decision: z.enum(['ACCEPT','REVISE']), reason: text.min(2).max(2000) }).strict();
export const WorkflowHandoffBody = z.object({ version: expected, requestKey: text.min(8).max(100), fromActivityId: text.regex(/^FPW\.\d+-A\d+$/), toActivityId: text.regex(/^FPW\.\d+-A\d+$/), note: text.min(2).max(2000) }).strict();
export const WorkflowHandoffReceiveBody = z.object({ version: expected, decision: z.enum(['ACCEPT','RETURN']), reason: text.min(2).max(2000) }).strict();
export const WorkflowCrossCaseOfferBody = z.object({ version: expected, targetVersion: expected, toCaseId: text.min(1).max(100), requestKey: text.min(8).max(100), fromActivityId: text.regex(/^FPW\.\d+-A\d+$/), toActivityId: text.regex(/^FPW\.\d+-A\d+$/), note: text.min(2).max(2000) }).strict();
export const WorkflowCrossCaseReceiveBody = z.object({ version: expected, sourceVersion: expected, decision: z.enum(['ACCEPT','RETURN']), reason: text.min(2).max(2000) }).strict();
export type WorkflowCrossCaseOfferBody = z.infer<typeof WorkflowCrossCaseOfferBody>;
export type WorkflowCrossCaseReceiveBody = z.infer<typeof WorkflowCrossCaseReceiveBody>;
export interface WorkflowTransferTarget { caseId: string; title: string; processId: string; version: number; activities: { id: string; productKeys: string[] }[] }
export type CreateWorkflowCaseBody = z.infer<typeof CreateWorkflowCaseBody>;
export type WorkflowRoleGrantBody = z.infer<typeof WorkflowRoleGrantBody>;
export type WorkflowArtifactBody = z.infer<typeof WorkflowArtifactBody>;
export type WorkflowActivitySubmitBody = z.infer<typeof WorkflowActivitySubmitBody>;
export type WorkflowActivityReviewBody = z.infer<typeof WorkflowActivityReviewBody>;
export type WorkflowHandoffBody = z.infer<typeof WorkflowHandoffBody>;
export type WorkflowHandoffReceiveBody = z.infer<typeof WorkflowHandoffReceiveBody>;

export interface WorkflowExecutionProduct { key: string; name: string; content: string[] }
export interface WorkflowExecutionActivity { id: string; name: string; processId: string; raci: { R: string[]; A: string; C: string[]; I: string[] }; inputs: string[]; outputs: string[]; next: string[]; screens: string[]; actions: string[]; checks: string[] }
export interface WorkflowExecutionModel { roles: { id: string; name: string; platformRoles: string[] }[]; personas: Record<string,string[]>; processes: { id: string; name: string; activities: WorkflowExecutionActivity[]; products: WorkflowExecutionProduct[] }[] }
export interface WorkflowRoleGrant { id: number; accountId: string; roleId: string; active: boolean; by: string; at: string; reason: string }
export interface WorkflowStoredFile { name: string; mediaType: string; base64: string; sha256: string; bytes: number; fileId?: string; uploadedBy?: string }
export interface WorkflowArtifact { artifactId: string; activityId: string; productKey: string; revision: number; by: string; at: string; fields: Record<string,string>; references: string[]; files: WorkflowStoredFile[]; reason: string }
export interface WorkflowActivityRecord { status: 'SUBMITTED'|'ACCEPTED'|'RETURNED'; submittedBy: string; submittedAt: string; artifactIds: string[]; note: string; reviewedBy?: string; reviewedAt?: string; reason?: string }
export interface WorkflowHandoff { handoffId: string; requestKey: string; payloadHash: string; fromActivityId: string; toActivityId: string; fromAccount: string; offeredAt: string; note: string; status: 'OFFERED'|'ACCEPTED'|'RETURNED'; receivedBy?: string; receivedAt?: string; reason?: string; fromCaseId?: string; toCaseId?: string; sourceVersion?: number; sourceReview?: WorkflowActivityRecord; artifactsHash?: string; artifacts?: WorkflowArtifact[] }
export interface WorkflowCase { caseId: string; processId: string; title: string; targetRef: string; version: number; createdBy: string; createdAt: string; updatedAt: string; activities: Record<string,WorkflowActivityRecord>; artifacts: WorkflowArtifact[]; handoffs: WorkflowHandoff[] }
export interface WorkflowCaseHistory { id: number; caseId: string; version: number; action: string; by: string; at: string; detail: Record<string,unknown> }
export interface WorkflowCaseDetail { item: WorkflowCase; model: WorkflowExecutionModel['processes'][number]; roleIds: string[]; history: WorkflowCaseHistory[]; transferVersions?: Record<string,number> }
