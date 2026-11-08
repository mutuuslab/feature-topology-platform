import { localizedCopy } from '../locale/runtime';
// 기획 홈에서만 쓰는 문구 — 공통 셸의 첫 화면 묶음에 싣지 않는다.
export const workspaceStudio = /* @__PURE__ */ localizedCopy('workspace-studio.workspaceStudio', {
  eyebrow: '상품기획 · Feature 소유',
  title: '기획팀',
  lead: 'Feature를 제안하고, 단계별로 어디에 있는지 보고, 출시 책임을 확인합니다.',
  key: (n: number) => ({ value: n, text: '출시 전 Feature' }),
  propose: '새 Feature 등록',
  products: '상품 구성',
  board: 'Feature 보드',
  boardLead: 'Lifecycle 단계별 최신 Version',
  column: { PROPOSED: '제안', APPROVED: '정의 승인', VERIFIED: '검증 완료', RELEASED: '출시', DEPRECATED: '사용 중단' } as Record<string, string>,
  more: (n: number) => `외 ${n}건`,
  productCount: (n: number) => `상품 ${n}개`,
});
