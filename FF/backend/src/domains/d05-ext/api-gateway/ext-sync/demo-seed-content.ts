// 모의 도구의 읽기 자료. 현재 플랫폼 명세만 풀어 쓰며 고객 요구·측정 수치·시험 성공을 만들어 넣지 않는다.
import type { FeatureVersionRow, Policy } from '@ff/contracts';

const list = (values: readonly string[] | undefined) => values?.length ? values.join(', ') : '미정';
const identity = (f: FeatureVersionRow) => `${f.featureId}@${f.version}`;
const scope = (f: FeatureVersionRow) => `${f.country} / ${f.vehicleModel} / ${f.trim}`;
const implementation = (f: FeatureVersionRow) => f.swIds.length ? f.swIds.map((sw, i) => `${sw}@${f.swVersions[i] ?? '미정'} → ECU ${f.ecuPnos[i] ?? '미정'}`).join('; ') : '미정 — 구현 연결 전';
const provenance = '가상 시연 데이터: 플랫폼 Feature 명세를 설명한 요구 정의입니다. 고객 승인 요구나 실제 검증·승인 Evidence가 아닙니다.';

export function demoRequirementContent(f: FeatureVersionRow, reqId: string) {
  return {
    body: [
      provenance,
      `기능 정의\n${reqId} — ${f.name}\n${f.description || '세부 설명 미정'}\n명세 기준: ${identity(f)}; 상태 ${f.lifecycle}; 담당 조직/소유자 ${f.ownerId}`,
      `동작 요구\n적용 범위는 ${scope(f)}이며 UPG-VC는 ${list(f.upgVc)}입니다. 이 범위에서 연결된 요구 ${list(f.requirementIds)}와 기능 ${list(f.functions.map((fn) => `${fn.functionId} ${fn.label}`))}의 동작을 검토합니다. 동작 임계값·시간·성능 수치는 명세에 없는 경우 미정이며 별도 검토로 확정합니다.`,
      `입력·출력\n입력 적용 조건: 국가 ${f.country}, 차종 ${f.vehicleModel}, 트림 ${f.trim}. 출력/제어점: ${list(f.controlPoints)}. 구현 연결: ${implementation(f)}. 신호 자료형·단위·유효 범위·오류 입력 처리는 미정이며 구현 명세에서 확정합니다.`,
      `수용 기준\n요구 ${reqId}에서 ${identity(f)}의 적용 범위·제어점·구현 연결을 추적할 수 있어야 합니다. 변경된 명세와 시험 계획의 일치 여부를 검토해야 하며, 구체 시험 절차·정량 합격값·검증 방법은 미정입니다. 이 본문의 존재나 요구 상태만으로 Gate를 통과시키지 않습니다.`,
      `FeatureFlag 시연용 요구 정의\n차량 관문은 인증된 차량의 Flag 평가에 FF 서명을 붙여 전달합니다. 차량은 신뢰한 키로 서명을 확인하고 마지막 서명본을 TTL 내에서만 사용하며 TTL 만료 시 safe-off로 전환해야 합니다. 차단과 로컬 안전 가드는 평가보다 우선합니다. 이 문단은 시연 설계 요구이며 실제 서명 검증·TTL 시험의 성공 기록이 아닙니다.`,
      `변경 시 재검토\n요구 본문·적용 범위·Version·제어점·SW/ECU 연결·안전 분류 변경 시 영향과 추적을 다시 검토합니다. ASIL 참조값은 ${f.asil}이며 위험도 판정을 대체하지 않습니다. 실제 검토·승인은 플랫폼 담당자의 서비스 경로와 근거로 별도 기록합니다.`,
    ].join('\n\n'),
    fields: { reqId, tracker: 'Feature Platform 시스템 요구사항 (시연)', release: `${identity(f)} (시연)`, submittedBy: 'jung.req', assignedTo: 'jung.req', risk: '미정 — 별도 위험 평가 필요', asil: f.asil, verificationMethod: '미정 — 검증 계획 수립 필요', requirementStatus: 'Approved', source: 'DEMO' },
  };
}

export function demoEpicContent(f: FeatureVersionRow) {
  const assignee = ['VERIFIED', 'RELEASED', 'DEPRECATED', 'RETIRED'].includes(f.lifecycle) ? 'park.release' : 'kim.author';
  return {
    body: [provenance, `목표\n${f.name}\n${f.description || '세부 설명 미정'}`, `적용 범위·명세\nFeature Platform: ${identity(f)}\n${scope(f)}\n현재 Lifecycle: ${f.lifecycle}; ASIL ${f.asil}; 소유자 ${f.ownerId}\n요구: ${list(f.requirementIds)}\n제어점: ${list(f.controlPoints)}\nUPG-VC: ${list(f.upgVc)}\n구현: ${implementation(f)}`, `담당·변경 근거\n보고자 kim.author; 현재 단계의 시연 담당 ${assignee}. 플랫폼 명세 ${identity(f)}의 현황을 모의 Epic에 투영했습니다. 원본 변경 사유가 없는 경우 상세 사유는 미정입니다. 상태 전이 요청은 플랫폼 Gate·역할·직무 분리 검사를 거치며 이 Epic 자체는 승인 근거가 아닙니다.`].join('\n\n'),
    fields: { featureId: f.featureId, version: f.version, scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim, asil: f.asil, ownerId: f.ownerId }, assignee, reporter: 'kim.author', source: 'DEMO' },
  };
}

export function demoChangeRequestContent(p: Policy, f: FeatureVersionRow | undefined, parentKey: string | null) {
  return {
    body: [provenance, `변경 대상\n정책 ${p.policyId} r${p.revision}; Flag ${p.flagKey}; Feature ${p.featureId}@${p.featureVersion}\n상위 Epic: ${parentKey ?? '미연결'}\n적용 범위: ${f ? scope(f) : '미정 — Feature 연결 확인 필요'}\n제어점: ${p.controlPoint}`, `변경 내용·근거\n${p.description}\n현재 정책 상태 ${p.status}; enabled=${p.enabled}; safeDefault=${p.safeDefault}\n롤아웃 ${p.rollout.mode}, ${p.rollout.basisPoints}/10000; 전략 ${p.strategies.length}개\n이 항목은 현재 정책 명세의 모의 투영입니다. 변경 전 값·외부 승인 사유가 없는 경우 미정이며 추정하지 않습니다.`, `검토·인계\nJIRA 시연 검토 담당 lee.approver, 보고자 kim.author, GitLab 구현 담당 han.dev. 상위 Epic의 Feature Version과 제어점·Flag 연결을 확인하고, 실제 검증 결과·해시·작성자와 다른 승인자를 플랫폼에서 확인합니다. 이 CR의 상태나 본문만으로 정책 승인·배포·차량 활성화를 수행하지 않습니다.`].join('\n\n'),
    fields: { parentKey, policyId: p.policyId, featureId: p.featureId, version: p.featureVersion, assignee: 'lee.approver', reporter: 'kim.author', source: 'DEMO' },
  };
}
