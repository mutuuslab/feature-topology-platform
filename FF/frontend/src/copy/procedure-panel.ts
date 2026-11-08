// Global button/loading recovery copy stays small; full activity copy loads with the panel.
export const procedurePanel = {
  button: '이 화면의 업무 절차',
  title: '이 화면의 업무 절차',
  loading: '업무 절차를 불러오는 중입니다.',
  loadFail: '업무 절차를 불러오지 못했습니다. 다시 불러오거나 전체 업무 절차에서 확인하세요.',
  none: '이 화면에 연결된 업무 절차가 없습니다.',
  mineFirst: '내 역할 활동이 먼저 보입니다.',
  openProcess: '절차 전체 보기',
  all: '전체 업무 절차 보기',
  retry: '다시 불러오기',
  context: (screen: string) => `${screen} 화면과 연결된 업무입니다.`,
  count: (n: number) => `이 화면의 관련 활동 ${n}개`,
  noMapping: '업무 연결이 등록되지 않은 화면입니다. 전체 업무 절차에서 관련 업무를 찾아보세요.',
} as const;

export { procedureDisplay as workflowDisplay } from './procedure-display';
