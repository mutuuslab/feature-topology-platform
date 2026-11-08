export default {
  'lists.pager': 'List pagination',
  'lists.prev': 'Previous',
  'lists.next': 'Next',
  'lists.range': (from: number, to: number, total: number) => `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`,
  'lists.pageOf': (page: number, pages: number) => `Page ${page} of ${pages}`,
  'lists.loadMore': 'Load more',
  'lists.loadingMore': 'Loading…',
  'lists.loaded': (n: number) => `${n.toLocaleString('en-US')} records shown`,
  'lists.end': 'All records are shown.',
};
