export default {
  'fleetSearch.label': 'Search vehicles',
  'fleetSearch.placeholder': 'VIN, vehicle name or scope',
  'fleetSearch.empty': 'No vehicles match this search.',
  'fleetSearch.matches': (n: number, total: number) => `${n.toLocaleString('en-US')} matches out of ${total.toLocaleString('en-US')} vehicles`,
};
