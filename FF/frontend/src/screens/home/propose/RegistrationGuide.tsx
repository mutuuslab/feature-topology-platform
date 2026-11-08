import { Link } from 'react-router-dom';
import { proposeGuide as G } from '../../../copy/propose-guide';

export function RegistrationGuide() {
  return <div className="propose-guide">
    <p>{G.quick}</p>
    <details>
      <summary>{G.title}</summary>
      <ol className="propose-guide__steps">{G.steps.map((step) => <li key={step.title}><strong>{step.title}</strong><p>{step.body}</p></li>)}</ol>
      <dl className="propose-guide__notes"><div><dt>{G.automatic}</dt><dd>{G.automaticBody}</dd></div><div><dt>{G.confirm}</dt><dd>{G.confirmBody}</dd></div></dl>
      <p>{G.alm}</p>
      <p><Link to="/integration/connectors?tab=sync">{G.almRecovery}</Link></p>
    </details>
  </div>;
}
