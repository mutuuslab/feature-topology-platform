// 안전 관련 Flag의 ASIL 상속 (보고서 v1.1 5장 · FFG-CLS-002) — 안전 관련 거동을 바꾸는 Flag 값과 그 생성·전달 경로는 그 Flag를 쓰는 SW의
// 최고 ASIL을 상속한다. 예외는 다섯 조건을 모두 만족하고 각 조건의 Evidence가 연결될 때만이며, 연속 파라미터(보정 데이터)를 원격으로
// 바꾸는 Flag는 예외를 쓸 수 없다. 플랫폼이 판정할 수 있는 조건(구성 선택·Guard 검증·도구 신뢰도·보정 데이터 여부)은 여기서 보고,
// 소비 기능의 범위·변화율 자체 제한(FFG-CODE-021)은 차량 SW Evidence(evidenceManifestId)로만 인정한다.
import type { FeatureVersionRow } from '../schemas/dataset';
import type { SafetyProfile } from '../schemas/safety-profile';

export type AsilExceptionCondition = 'CONFIG_SET_ONLY' | 'GUARD_VERIFIES' | 'CONSUMER_LIMITS' | 'TOOL_CONFIDENCE' | 'NOT_CALIBRATION';
export const ASIL_EXCEPTION_LABEL: Record<AsilExceptionCondition, string> = {
  CONFIG_SET_ONLY: '원격 경로는 검증된 구성 집합의 선택(활성화·비활성화·복원)만 전달',
  GUARD_VERIFIES: 'Safety Guard가 진위·대상·Version·등급·순번·시간을 독립 검증',
  CONSUMER_LIMITS: '소비 기능이 값의 범위·변화율을 스스로 제한(FFG-CODE-021)',
  TOOL_CONFIDENCE: '생성 경로 컴포넌트의 도구 신뢰도 확보(8.1절)',
  NOT_CALIBRATION: '연속 파라미터(보정 데이터)를 원격으로 바꾸지 않음',
};

export interface AsilInheritance {
  /** 안전 관련 Flag(F2 이상, 분류 없음 포함) */
  safetyRelated: boolean;
  /** 상속하는 ASIL — 예외가 성립하지 않으면 이것이 경로의 ASIL */
  inherits: string | null;
  conditions: { id: AsilExceptionCondition; met: boolean; evidence: string | null }[];
  /** 다섯 조건이 모두 Evidence와 함께 성립 */
  exception: boolean;
  /** G7 판정 전제 위반(있으면 PASS 불가) */
  blocker: string | null;
}

/**
 * ASIL 상속·예외 판정.
 * @rule FFG-CLS-002 — 플랫폼 판정 조건 4개 + 차량 SW Evidence 1개, 보정 데이터 Flag 예외 0건. 아키텍처 검토·FFI 분석 자체는 조직 몫
 */
export function asilInheritance(
  f: Pick<FeatureVersionRow, 'asil' | 'controlPoints'>,
  p: Pick<SafetyProfile, 'fClass' | 'asilRef' | 'deactClass' | 'evidenceManifestId'> | null,
  ctx: { toolConfidence: boolean },
): AsilInheritance {
  const safetyRelated = !p || p.fClass >= 'F2';
  const inherits = p?.asilRef ?? f.asil ?? null;
  const calibration = f.controlPoints.includes('Parameter');
  const conditions: AsilInheritance['conditions'] = [
    { id: 'CONFIG_SET_ONLY', met: f.controlPoints.length > 0 && f.controlPoints.every((c) => c === 'Flag' || c === 'Signal'), evidence: f.controlPoints.join(',') || null },
    { id: 'GUARD_VERIFIES', met: !!p && p.deactClass !== 'DC0', evidence: p ? `kill_command v2 Guard 검증(${p.deactClass})` : null },
    { id: 'CONSUMER_LIMITS', met: !!p?.evidenceManifestId, evidence: p?.evidenceManifestId ?? null },
    { id: 'TOOL_CONFIDENCE', met: ctx.toolConfidence, evidence: ctx.toolConfidence ? 'FFG-PLT-013 도구 분류 위반 0건' : null },
    { id: 'NOT_CALIBRATION', met: !calibration, evidence: calibration ? null : f.controlPoints.join(',') || null },
  ];
  const exception = safetyRelated && conditions.every((c) => c.met && !!c.evidence);
  const blocker = safetyRelated && !exception && !inherits ? '안전 관련 Flag인데 상속할 ASIL(asilRef)이 정해지지 않았고 예외 조건도 성립하지 않습니다 — 경로의 ASIL을 정해야 G7을 판정할 수 있습니다' : null;
  return { safetyRelated, inherits: safetyRelated ? inherits : null, conditions, exception, blocker };
}
