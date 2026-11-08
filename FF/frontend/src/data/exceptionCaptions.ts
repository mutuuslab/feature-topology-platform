import type { ExceptionCheckId, ExceptionKind, GateId } from '@ff/contracts';
import { exceptions as X } from '../copy/exceptions';
import { localeSnapshot } from '../locale/runtime';

export interface ExceptionScopeSource { kind?:ExceptionKind; gates?:GateId[]; checks?:ExceptionCheckId[]; ruleIds?:string[]; scope:string }
/** Use canonical typed fields; never translate arbitrary API messages or change exception coverage. */
export const exceptionScopeCaption = (row:ExceptionScopeSource) => {
 if(localeSnapshot().language !== 'en') return row.scope;
 if(row.kind === 'GATE_PENDING' && Array.isArray(row.gates)) return `PENDING Gate ${row.gates.join('·')}`;
 if(row.kind === 'BYPASS' && Array.isArray(row.checks)) return row.checks.map(check=>check==='COMPLIANCE_RULE' ? `${X.checkLabels[check]}(${(row.ruleIds ?? []).join(', ')})` : X.checkLabels[check] ?? check).join(' · ');
 return row.scope;
};
