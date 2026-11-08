import { formatCount, formatExact } from '../../design/format';
export default {
  "ops5y.fleetMap.sourceAll": 'Demo and target fleet (weighted sample)',
  "ops5y.fleetMap.represented": (n: number) => `Represents ${formatCount(n)} vehicles`,
  "ops5y.fleetMap.legendCluster": 'Target fleet cluster — count represents vehicles',
  "ops5y.fleetMap.clusterNote": (represented: number, sample: number) => `${formatExact(sample)} sampled vehicles in this area represent ${formatCount(represented)} target vehicles. Select a cluster or zoom in to see sample vehicles.`,
  "ops5y.fleetMap.pointsNote": (n: number) => `Received ${formatExact(n)} sampled vehicles in this area — each represents multiple vehicles (tables and totals use weighted counts).`,
  "ops5y.fleetMap.activationNote": 'Target-fleet samples contain subscription status only and appear gray in the activation view. Activation is reported only for demo vehicles and samples with received data.',
  "ops5y.home.target": 'Target vehicles (in operation)',
  "ops5y.trial.period": 'Period',
  "ops5y.trial.monthly": '4-week total',
  "ops5y.trial.periods.26": '26 weeks',
  "ops5y.trial.periods.52": '1 year',
  "ops5y.trial.periods.260": '5 years',
};
