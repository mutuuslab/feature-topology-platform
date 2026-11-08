import { GATE_META, procedureGateOf, procedureGateText, ROLE_LABEL, type Role, type ComplianceCriterion } from '@ff/contracts';
import { permissionRoleLabel } from './refdata';
import { contractCaptions as C } from '../copy/contract-captions';
import { localeSnapshot } from '../locale/runtime';

export const complianceCriterionCaption = (criterion: Pick<ComplianceCriterion, 'check' | 'gate'>) => criterion.check === 'GATE_PASS' ? `${criterion.gate} ${C.complianceCheck.GATE_PASS}` : C.complianceCheck[criterion.check];
export const transitionCaption = (transition: { to: string; auto: boolean; ko: string }) => {
  if (localeSnapshot().language !== 'en') return transition.ko;
  const key = transition.to === 'DEVELOPING' ? transition.auto ? 'START' : 'REWORK' : transition.to;
  return C.transition[key as keyof typeof C.transition] ?? transition.ko;
};

// Parse the unchanged canonical source labels; localize only the resulting display.
const rolesBySourceLabel = new Map((Object.keys(ROLE_LABEL) as Role[]).map(role => [ROLE_LABEL[role],role]));
export const roleCaptionFromSourceLabel = (source:string) => { const role=rolesBySourceLabel.get(source); return role ? permissionRoleLabel(role) : source; };

/** Same canonical mapping; only its explanatory sentence is localized. */
export const procedureGateCaption = (gate:string) => {
 if(localeSnapshot().language !== 'en') return procedureGateText(gate);
 const map=procedureGateOf(gate); if(!map) return C.procedureOnly(gate);
 const name=C.procedure[gate as keyof typeof C.procedure] ?? map.name;
 return map.platformGates.length ? C.procedureLink(gate,name,map.platformGates.map(g=>g+' '+GATE_META[g].name).join(' + ')) : C.procedureOnly(gate)+' '+name+' — '+C.procedureNoGate;
};
