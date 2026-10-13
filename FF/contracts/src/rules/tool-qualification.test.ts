// 컴포넌트 도구 신뢰성 분류 — FFG-PLT-013: 컴포넌트 100%에 오류 유형별 TD 근거, TCL2 이상 100%에 신뢰도 확보 방법, 서명 서비스 TD1 금지
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPONENTS } from '../components.manifest';
import { checkToolClassification, componentTcl, tclOf, TOOL_CLASSIFICATION, type ToolClassification } from './tool-qualification';

const FF = resolve(__dirname, '../../..');
const ids = COMPONENTS.map((c) => c.id);

describe('도구 신뢰성 분류 (ISO 26262-8 cl.11)', () => {
  it('TCL 표: TI1 → TCL1, TI2는 TD1·TD2·TD3 → TCL1·TCL2·TCL3', () => {
    expect([tclOf('TI1', null), tclOf('TI2', 'TD1'), tclOf('TI2', 'TD2'), tclOf('TI2', 'TD3')]).toEqual(['TCL1', 'TCL1', 'TCL2', 'TCL3']);
    expect(componentTcl({ outputs: [{ error: 'a', ti: 'TI2', td: 'TD1', detection: 'x' }, { error: 'b', ti: 'TI2', td: 'TD2', detection: 'y' }] })).toBe('TCL2'); // 출력 유형 중 가장 높은 것
  });

  it('42 컴포넌트 모두 표에 있고, 보고서 8.1 컴포넌트는 규칙 위반 0건 — 8.1 밖은 열린 항목(UNCLASSIFIED)으로만', () => {
    expect(ids).toHaveLength(42);
    const problems = checkToolClassification(ids);
    expect(problems.filter((p) => p.severity === 'FAIL')).toEqual([]);
    const open = problems.filter((p) => p.severity === 'OPEN').map((p) => p.componentId);
    expect(open).toEqual(TOOL_CLASSIFICATION.filter((c) => c.kind === 'UNCLASSIFIED').map((c) => c.componentId));
    expect(TOOL_CLASSIFICATION.filter((c) => c.source === 'REPORT_8_1')).toHaveLength(32);
  });

  it('서명·키 서비스(보안 배포·PKI)는 TD3 → TCL3, CAL 별도 — 다른 TCL2 이상도 신뢰도 확보 근거 시험 파일이 실재한다', () => {
    for (const id of ['D06-08', 'D06-10']) expect(componentTcl(TOOL_CLASSIFICATION.find((c) => c.componentId === id)!)).toBe('TCL3');
    const evidence = TOOL_CLASSIFICATION.flatMap((c) => c.qualification?.evidence ?? []);
    expect(evidence.filter((p) => !existsSync(join(FF, p)))).toEqual([]);
  });

  it('검사는 위반을 잡는다: 서명 서비스 TD1, 검출 수단 없는 TD1·TD2, 방법 없는 TCL2, 분류 누락', () => {
    const bad: ToolClassification[] = [
      { componentId: 'X1', reportName: null, kind: 'TOOL', signing: true, outputs: [{ error: 'e', ti: 'TI2', td: 'TD1', detection: 'x' }], qualification: null, rules: [], source: 'FF_DRAFT' },
      { componentId: 'X2', reportName: null, kind: 'TOOL', outputs: [{ error: 'e', ti: 'TI2', td: 'TD1', detection: null }], qualification: null, rules: [], source: 'FF_DRAFT' },
      { componentId: 'X3', reportName: null, kind: 'TOOL', outputs: [{ error: 'e', ti: 'TI2', td: 'TD2', detection: null }], qualification: null, rules: [], source: 'FF_DRAFT' },
    ];
    expect(checkToolClassification(['X1', 'X2', 'X3', 'X4'], bad).map((p) => [p.componentId, p.code])).toEqual([
      ['X1', 'SIGNING_TD1'],
      ['X2', 'TD1_WITHOUT_DETECTION'],
      ['X3', 'TD2_WITHOUT_DETECTION'],
      ['X3', 'TCL2_WITHOUT_METHOD'],
      ['X4', 'MISSING'],
    ]);
  });
});
