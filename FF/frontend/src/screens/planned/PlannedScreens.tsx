// /master/feature-db · /procurement/sw-cost — 메뉴만 연 준비 중 화면(2026-11-04). 열릴 기능과 설계 문서 경로만 보인다.
import { featureDb, swCost } from '../../copy/refdbCost';
import { PageHeader, Panel } from '../../design';

type PlannedCopy = typeof featureDb;

function PlannedScreen({ copy }: { copy: PlannedCopy }) {
  return (
    <div className="ds-screen">
      <PageHeader title={copy.title} lead={copy.lead} message={{ tone: 'neutral', value: copy.status, text: copy.statusText }} />
      <Panel title={copy.planTitle}>
        <ul>
          {copy.plan.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Panel>
      <Panel title={copy.docTitle}>
        <p>
          <code>{copy.doc}</code>
        </p>
      </Panel>
    </div>
  );
}

export function FeatureDbScreen() {
  return <PlannedScreen copy={featureDb} />;
}

export function SwCostScreen() {
  return <PlannedScreen copy={swCost} />;
}
