// Inert role values shared by routes and IAM. Never import routes or access here.
import {ROLES,type Role} from '../enums';
import type {ApproverRole} from '../schemas/safety';

/** Human roles exclude vehicle identities and system automation. */
export const HUMAN_ROLES=ROLES.filter(role=>role!=='VEHICLE' && role!=='SYSTEM') as Role[];

/** Report approval vocabulary mapped to the existing platform roles. */
export const REPORT_APPROVER_ROLES:Record<ApproverRole,Role>={
 FSM:'SAFETY_OFFICER',CSM:'SECURITY_OFFICER',OPS_LEAD:'OPS_LEAD',
 PRODUCT_OWNER:'PRODUCT_APPROVER',QA:'GATE_JUDGE',REGULATORY:'REGULATORY_OWNER',
};
export const KILL_APPROVER_ROLES:Role[]=[...new Set(Object.values(REPORT_APPROVER_ROLES))];
