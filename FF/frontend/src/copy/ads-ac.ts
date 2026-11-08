import { localizedCopy } from '../locale/runtime';
// AC 화면 문구 — 승인 조합 제안→승인(/config/compat), 보안 최소 버전 표(같은 화면 탭), 권한 범위(/admin/iam).

export const setApproval = /* @__PURE__ */ localizedCopy('ads-ac.setApproval', {
  status: '상태',
  statusLabel: { PROPOSED: '승인 대기', APPROVED: '승인' },
  selfApproval: '조합을 제안한 사람은 그 조합을 승인할 수 없습니다 — 다른 담당자가 승인합니다.',
  proposer: '제안',
  approver: '승인',
  pendingMeta: (n: number) => `승인 대기 조합 ${n}개 — 승인 전에는 차량 대조·발행에 쓰지 않습니다`,
  pendingNote: '승인 대기 — 차량 수는 승인 뒤 대조할 차량 미리보기입니다',
  action: '조합 승인',
  title: (id: string) => `조합 승인 — ${id}`,
  reason: '승인 사유',
  submit: '승인',
  noPermission: '조합 승인은 기능안전 담당자(FSM) 역할이 할 수 있습니다.',
  readOnly: '읽기 전용 화면 — 승인은 실제 서버에서 합니다',
  done: '승인됨 — 이제 차량 대조·발행 근거로 씁니다',
  registered: (id: string) => `제안됨 — ${id}(다른 담당자가 승인하면 대조·발행에 씁니다)`,
});

export const securityMin = /* @__PURE__ */ localizedCopy('ads-ac.securityMin', {
  tab: '보안 최소 버전 표',
  statusLabel: { PROPOSED: '승인 대기', APPROVED: '승인' },
  selfApproval: '보안 최소 버전을 제안한 사람은 그 값을 승인할 수 없습니다 — 다른 사이버보안 담당자가 승인합니다.',
  blocker: { SECURITY_MIN_LOWERING: '현재 승인된 하한보다 같거나 낮은 버전은 사용할 수 없습니다.', SECURITY_MIN_UNCOMPARABLE: '제안한 버전과 현재 승인된 하한을 비교할 수 없습니다.' } as Record<string, string>,
  lead: '사이버보안 담당자가 승인한 SW별 최소 버전 — 조합 등록·승인은 이 표를 하한으로 검사합니다. 하한은 올리기만 합니다.',
  current: 'SW별 지금 하한',
  history: '제안·승인 이력',
  col: { sw: 'SW', version: '최소 버전', status: '상태', rationale: '근거', proposer: '제안', approver: '승인', at: '시각' },
  pending: (n: number) => `승인 대기 ${n}건`,
  unregisteredBlocker: (ids: string[]) => `보안 최소 버전 표에 승인된 값이 없는 SW가 있어 이 조합을 처리할 수 없습니다(${ids.join(', ')}) — 사이버보안 담당자가 먼저 표에 승인합니다.`,
  unregistered: (ids: string[]) => `표에 없는 SW ${ids.length}개 — 이 SW가 든 조합은 등록·승인할 수 없습니다: ${ids.join(', ')}`,
  propose: { action: '최소 버전 제안', title: '보안 최소 버전 제안', sw: 'SW', version: '최소 버전(x.y.z)', rationale: '근거(취약점 대응 등)', submit: '제안', noPermission: '제안은 사이버보안 담당자 또는 차량 사양·Variant 담당자 역할이 할 수 있습니다.' },
  approve: { action: '승인', reason: '승인 사유', noPermission: '승인은 사이버보안 담당자(CSM) 역할이 할 수 있습니다.' },
  readOnly: '읽기 전용 화면 — 제안·승인은 실제 서버에서 합니다',
  error: '보안 최소 버전 표를 불러오지 못했습니다 — 다시 시도',
});

export const roleScope = /* @__PURE__ */ localizedCopy('ads-ac.roleScope', {
  title: '권한 범위',
  all: '전체', none: '없음',
  lead: '역할 권한 위에 계정별 시장·Feature·환경 범위를 겹칩니다 — 긴급 차단·해제·정책 배포는 대상이 범위 안이어야 합니다.',
  env: (e: string) => `이 설치의 환경: ${e}`,
  commands: '범위를 보는 명령',
  col: { account: '계정', markets: '시장', features: 'Feature', envs: '환경', reason: '사유', by: '지정', at: '지정 시각' },
  analysisOnly: '분석 전용(감사 조회자)은 범위와 관계없이 긴급 차단·해제·정책 배포를 할 수 없습니다.',
  command: { issueKill: '긴급 차단 요청', approveKill: '긴급 차단 승인', rejectKill: '긴급 차단 거절', requestRestore: '복원 요청', approveRestore: '복원 승인', rejectRestore: '복원 거절', releaseKill: '차단 해제', rescindKill: '사건 범위 해제', deployPolicy: '정책 배포' } as Record<string, string>,
  error: '권한 범위를 불러오지 못했습니다 — 다시 시도',
});
