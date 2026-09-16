import { useNavigate } from 'react-router-dom';
import { consistency } from '../data/engine';
import { Donut, Bars, RadialProgress, tally, dist } from '../components/charts';
import { SeverityBadge, SeverityLegend, severityMeta } from '../components/ui';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageTitle } from '../components/PageTitle';

const SEV_COLOR = { Blocking: '#D64545', Warning: '#D9822B', Info: '#3B82F6' };

export default function ConsistencyConsole() {
  const nav = useNavigate();
  const v = consistency();
  const blocking = v.filter(x => x.severity === 'B').length;
  const RULES_TOTAL = 12;
  return (
    <div>
      <Breadcrumb />
      <PageTitle fallback="Consistency Rule Console" />
      <p className="page-sub">12 Rules 자동 평가 · Violation Inbox {v.length}건</p>

      <div className="card"><b>Severity 범례 — 무슨 의미이고 왜 이 등급인가</b><div className="mt"><SeverityLegend /></div></div>

      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>Severity 분포</b>
          <Donut size={120} center={`${v.length}`} segments={dist(tally(v, x => severityMeta(x.severity).label), SEV_COLOR)} />
        </div>
        <div className="col card" style={{ flex: 2 }}><b>Rule별 위반 건수</b><div className="mt"><Bars data={tally(v, x => x.rule)} /></div></div>
        <div className="col card" style={{ maxWidth: 200, alignItems: 'center' }}><b>정합성 점수</b>
          <RadialProgress size={110} color={blocking ? '#D64545' : '#1F9D55'} value={Math.round((RULES_TOTAL - new Set(v.map(x => x.rule)).size) / RULES_TOTAL * 100)} label={`${RULES_TOTAL - new Set(v.map(x => x.rule)).size}/${RULES_TOTAL} Rule 통과`} />
        </div>
      </div>

      <div className="card">
        <table><thead><tr><th>Rule</th><th>Feature</th><th>Severity</th><th>Message</th></tr></thead>
          <tbody>{v.map((x,i)=>(
            <tr key={i} onClick={()=>x.featureId.startsWith('FEAT')&&nav(`/feature/${x.featureId}`)}>
              <td className="mono">{x.rule}</td><td className="mono">{x.featureId}</td>
              <td><SeverityBadge code={x.severity} /></td>
              <td>{x.message}</td>
            </tr>
          ))}</tbody></table>
        {v.length===0 && <p className="muted">위반 없음 ✓</p>}
      </div>
    </div>
  );
}
