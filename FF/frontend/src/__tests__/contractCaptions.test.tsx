import { afterEach, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { COMPLIANCE_CHECK_LABEL, COMPLIANCE_RULE_TYPE_LABEL, COMPLIANCE_RULE_STATUS_LABEL, GATE_META, ROLE_LABEL, type GateCheck } from '@ff/contracts';
import { changeUiLanguage, __resetLocaleForTest } from '../locale/runtime';
import { complianceCriterionCaption, procedureGateCaption, roleCaptionFromSourceLabel } from '../data/contractCaptions';
import { NextTurn } from '../screens/features/NextTurn';
import { GateChecks } from '../screens/features/GateOutcomePanel';
import { GateRail } from '../design/lifecycle';
import { personLabel as operationPersonLabel } from '../screens/ops/shared';
import type { TransitionOption } from '../screens/types';

afterEach(()=>{ cleanup(); __resetLocaleForTest(); });

it('localizes known compliance and gate captions without changing source labels or identifiers', async()=>{
 const source=JSON.stringify({COMPLIANCE_CHECK_LABEL,COMPLIANCE_RULE_TYPE_LABEL,COMPLIANCE_RULE_STATUS_LABEL,GATE_META,ROLE_LABEL});
 expect(complianceCriterionCaption({check:'GATE_PASS',gate:'G3'})).toBe('G3 Gate 통과');
 await changeUiLanguage('en');
 expect(complianceCriterionCaption({check:'GATE_PASS',gate:'G3'})).toBe('G3 Gate passes');
 expect(procedureGateCaption('G2')).toContain('G2 Requirement Gate + G7 Safety/Security Gate');
 expect(procedureGateCaption('G8')).toContain('No platform Gate');
 expect(roleCaptionFromSourceLabel(ROLE_LABEL.FEATURE_APPROVER)).toBe('Feature approver');
 expect(roleCaptionFromSourceLabel('사용자 원문 역할')).toBe('사용자 원문 역할');
 expect(operationPersonLabel('usr-quality')).toBe('박유진(Quality review)');
 expect(JSON.stringify({COMPLIANCE_CHECK_LABEL,COMPLIANCE_RULE_TYPE_LABEL,COMPLIANCE_RULE_STATUS_LABEL,GATE_META,ROLE_LABEL})).toBe(source);
 await changeUiLanguage('ko');
 expect(complianceCriterionCaption({check:'GATE_PASS',gate:'G3'})).toBe('G3 Gate 통과');
});

it('updates next-owner and transition explanations while retaining original responses, blockers and transition state',async()=>{
 const transitions:TransitionOption[]=[{to:'APPROVED',ko:'정의 승인',auto:false,roles:[ROLE_LABEL.FEATURE_APPROVER],blockers:[{code:'GATE_UNJUDGED',ref:'G1',message:'G1 Feature Gate 미판정 — 원문은 그대로 유지'}]}];
 const source=JSON.stringify(transitions);
 const {container}=render(<NextTurn transitions={transitions}/>);
 expect(screen.getByText('G1 Feature Gate 미판정 — 원문은 그대로 유지')).toBeTruthy();
 const state=container.querySelector('[data-next-turn]');
 await act(async()=>{await changeUiLanguage('en');});
 expect(screen.getByText('A required Gate has no decision.',{exact:false})).toBeTruthy();
 expect(screen.getByText('Original server response')).toBeTruthy();
 expect(container.querySelector('details')).not.toHaveAttribute('open');
 expect(screen.getByText('G1 Feature Gate 미판정 — 원문은 그대로 유지')).toBeTruthy();
 expect(state).toHaveAttribute('data-next-turn','APPROVED'); expect(state).toHaveAttribute('data-next-mine','wait');
 expect(JSON.stringify(transitions)).toBe(source);
 await act(async()=>{await changeUiLanguage('ko');});
 expect(screen.queryByText('Original server response')).toBeNull();
 expect(screen.getByText('G1 Feature Gate 미판정 — 원문은 그대로 유지')).toBeTruthy();
});

it('keeps automatic-check facts and failed severity while translating headings and preserving source detail',async()=>{
 const checks:GateCheck[]=[{gate:'G1',key:'OWNER',label:'Feature Owner 지정',pass:false,detail:'담당 원문 김태호 — 수정하지 않음'}];
 const source=JSON.stringify(checks);
 const {container}=render(<GateChecks checks={checks}/>);
 await act(async()=>{await changeUiLanguage('en');});
 expect(screen.getByText('Feature Owner assigned')).toBeTruthy();
 expect(container.querySelector('[data-check="OWNER"]')).toHaveAttribute('data-state','FAIL');
 expect(screen.getByText('담당 원문 김태호 — 수정하지 않음')).toBeTruthy();
 expect(container.querySelector('details')).not.toHaveAttribute('open');
 expect(JSON.stringify(checks)).toBe(source);
});

it('updates gate judge tooltips in place while retaining canonical gate identity and statuses',async()=>{
 const {container}=render(<GateRail statuses={{G1:'FAIL'}}/>);
 const gate=container.querySelector('[data-gate="G1"]');
 expect(gate?.getAttribute('title')).toContain('Feature 정의 승인자');
 await act(async()=>{await changeUiLanguage('en');});
 expect(gate?.getAttribute('title')).toContain('Feature definition approver');
 expect(gate).toHaveAttribute('data-status','FAIL');
 expect(container.querySelector('[data-gate="G1"]')).toBe(gate);
});
