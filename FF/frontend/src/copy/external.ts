import { localizedCopy } from '../locale/runtime';
// 외부 창 진입 문구. 가상 도구의 계정·작업 문구는 지연 로드되는 앱에만 둔다.
export const externalLaunch = /* @__PURE__ */ localizedCopy('external.externalLaunch', {
  title: '외부 도구에서 이어서 작업',
  demo: '가상 연계 시연',
  real: '실제 저장소',
  connected: '설정된 외부 도구',
  newWindow: '새 창 열기',
  codebeamer: { name: 'CodeBeamer', task: '요구사항 · 검토 의견', detail: '요구를 열고 상태와 의견을 바꾸면 플랫폼 추적에 반영됩니다.' },
  jira: { name: 'JIRA', task: 'Epic · 변경요청 보드', detail: '외부에서 요청한 전이는 플랫폼의 권한·게이트 판정을 거칩니다.' },
  github: { name: 'GitHub', task: '실제 코드 · PR #9', detail: '통합 변경과 Flag 호출이 들어 있는 실제 소스를 확인합니다.' },
  grafana: { name: 'Grafana', task: '운영 지표 · 개선 신호', detail: '사용률·수동 끄기·폴백·오류를 Version·차종별로 보고 개선 후보를 찾습니다.', scoped: '이 Feature 지표', overview: '전체 Feature 지표', badge: '운영 대시보드' },
  source: 'Flag 소스',
  commit: '스캔한 커밋',
  unavailable: '가상 연계 화면은 데모 설치에서만 사용할 수 있습니다.',
});
