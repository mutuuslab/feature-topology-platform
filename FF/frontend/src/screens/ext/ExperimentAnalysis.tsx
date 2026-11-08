import { experimentAnalysis as A } from '../../copy/experiment-analysis';
import { p10 } from '../../copy/p10';
import { Panel } from '../../design';
import './experiments.css';

const X = p10.experiment;
export interface ExperimentResults {
  days: number; control: number; treatment: number; diff: number; ci95: [number, number];
  enough: boolean; significant: boolean; verdict: string; agreement?: number;
  sampleCounts?: { control: number; treatment: number };
  source?: 'SIMULATED';
  fleet: { deployedPolicyId: string | null; vehicles: number; comparableVehicles?: number; comparisonStatus?: string; agreement: number; diverged: { vin: string; shadow: boolean | null; current: boolean | null }[] } | null;
}

export function missingFleetEvidence(f: ExperimentResults['fleet']): string | null {
  if (!f || f.comparisonStatus === 'SOURCE_UNAVAILABLE' || f.comparisonStatus === 'PARTIAL') return A.incompleteComparison;
  if (f.comparisonStatus === 'NO_BASELINE') return A.noBaseline;
  if (!f.vehicles) return A.noFleet;
  if (!f.deployedPolicyId) return A.noBaseline;
  return f.comparableVehicles === f.vehicles ? null : A.incompleteComparison;
}

export function ExperimentMethods() {
  return <Panel title={A.methods}>
    <ol className="experiment-path">{A.steps.map(s => <li key={s}>{s}</li>)}</ol>
    <div className="experiment-methods"><section><h3>{A.ab}</h3><p>{A.abBody}</p></section><section><h3>{A.shadow}</h3><p>{A.shadowBody}</p></section></div>
    <p className="ds-field__hint">{A.guard}</p>
  </Panel>;
}

/** Rates share a zero-to-one scale; CI always includes zero and the complete interval. */
export function ExperimentResultCharts({ result: r, type, minSamples }: { result: ExperimentResults; type: string; minSamples: number }) {
  const missingFleet = missingFleetEvidence(r.fleet);
  const valid = [r.control, r.treatment, r.diff, ...r.ci95].every(Number.isFinite) && r.ci95[0] <= r.ci95[1];
  const extent = Math.max(.01, Math.abs(r.diff), Math.abs(r.ci95[0]), Math.abs(r.ci95[1])) * 1.15;
  const x = (v: number) => 24 + ((v + extent) / (extent * 2)) * 352;
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  return <section className="experiment-analysis" aria-label={A.comparison}>
    <p className="ds-tag">{A.simulated}</p><p className="ds-field__hint">{A.simulationNote}</p>
    {valid ? <>
      <div className="experiment-rates">{([[X.control, r.control], [X.treatmentArm, r.treatment]] as const).map(([label, rate]) => <div key={label} className="experiment-rate"><span>{label}</span><progress aria-label={label} max={1} value={Math.max(0, Math.min(1, rate))} /><strong className="ds-mono">{pct(rate)}</strong></div>)}</div>
      <figure className="experiment-interval"><figcaption>{A.interval}</figcaption>
        <svg viewBox="0 0 400 78" role="img" aria-label={`${A.interval}: ${A.intervalText(...r.ci95)}`}>
          <line className="experiment-axis" x1="24" x2="376" y1="32" y2="32" />
          <line className="experiment-zero" x1={x(0)} x2={x(0)} y1="12" y2="46" />
          <line className="experiment-ci" x1={x(r.ci95[0])} x2={x(r.ci95[1])} y1="32" y2="32" />
          {[r.ci95[0], r.ci95[1]].map((v,i) => <line key={i} className="experiment-ci-cap" x1={x(v)} x2={x(v)} y1="25" y2="39" />)}
          <circle className="experiment-point" cx={x(r.diff)} cy="32" r="5" />
          <text x="24" y="66">{A.percentagePoints(-extent)}</text><text x="200" y="66" textAnchor="middle">{A.zero}</text><text x="376" y="66" textAnchor="end">{A.percentagePoints(extent)}</text>
        </svg>
        <p className="ds-mono">{A.percentagePoints(r.diff)} · {A.intervalText(...r.ci95)}</p>
      </figure>
    </> : <p>{A.unmeasured}</p>}
    <p>{r.enough ? A.enough : A.insufficient} <span className="ds-field__hint">{A.sampleMinimum(minSamples)}</span></p>
    {r.sampleCounts && <p className="ds-mono">{A.evidence}: {X.control} {r.sampleCounts.control.toLocaleString()} · {X.treatmentArm} {r.sampleCounts.treatment.toLocaleString()}</p>}
    {type === 'SHADOW' && <section className="experiment-shadow"><h3>{A.fleet}</h3>{r.fleet && !missingFleet ? <>
      <div className="experiment-rate"><span>{A.agreement}</span><progress aria-label={A.agreement} max={1} value={r.fleet.agreement} /><strong className="ds-mono">{pct(r.fleet.agreement)}</strong></div>
      <p className="ds-mono">{A.divergence}: {r.fleet.diverged.length} / {r.fleet.vehicles}</p>
    </> : <p>{missingFleet}</p>}</section>}
  </section>;
}
