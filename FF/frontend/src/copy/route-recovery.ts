import { localizedCopy } from '../locale/runtime';
export const routeRecovery = /* @__PURE__ */ localizedCopy('route-recovery.routeRecovery', {
  updated: '화면 파일을 불러오지 못했습니다. 다시 시도하면 현재 주소의 화면을 새로 불러옵니다.',
  failed: (message: string) => `화면을 표시할 수 없습니다: ${message}`,
});
