// 큰 목록 문구(출시 준비 RD-UX-03) — design/table.tsx Pager·DataTable, 감사 이력 더 불러오기.
export const lists = {
  pager: '목록 페이지',
  prev: '이전',
  next: '다음',
  range: (from: number, to: number, total: number) => `${from.toLocaleString('ko-KR')}–${to.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')}건`,
  pageOf: (page: number, pages: number) => `${page} / ${pages}쪽`,
  loadMore: '더 불러오기',
  loadingMore: '불러오는 중…',
  loaded: (n: number) => `${n.toLocaleString('ko-KR')}건 표시`,
  end: '마지막 기록까지 모두 표시했습니다.',
  staticMore: '데모에서는 첫 페이지만 볼 수 있습니다.',
};
