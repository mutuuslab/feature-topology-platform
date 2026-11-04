// /procurement/sw-cost — 메뉴만 연 준비 중 화면(2026-11-04). 열릴 기능과 설계 문서 경로만 보인다(Feature DB는 screens/refdb로 열렸다).
// '준비 중'은 낱말 상태라 핵심 메시지의 상태 pill로 — 큰 숫자 칸에 넣으면 3초 규칙(three-second ④)에 걸린다.
import { swCost } from '../../copy/refdbCost';
import { PageHeader, Panel } from '../../design';

type PlannedCopy = typeof swCost;

function PlannedScreen({ copy }: { copy: PlannedCopy }) {
  return (
    <div className="ds-screen">
      <PageHeader title={copy.title} lead={copy.lead} message={{ tone: 'neutral', text: copy.statusText, status: { label: copy.status, tone: 'neutral' } }} />
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

export function SwCostScreen() {
  return <PlannedScreen copy={swCost} />;
}
