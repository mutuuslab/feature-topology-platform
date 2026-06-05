import { useNavigate } from 'react-router-dom';
import { consistency } from '../data/engine';
import { Donut, Bars, RadialProgress, tally, dist } from '../components/charts';

export default function ConsistencyConsole() {
  const nav = useNavigate();
  const v = consistency();
  const blocking = v.filter(x => x.severity === 'blocking').length;
  const RULES_TOTAL = 12;
  return (
    <div>
      <div className="breadcrumb">관계 / Topology ▸ Consistency Rule Console</div>
      <h1 className="page-title">Consistency Rule Console</h1>
      <p className="page-sub">12 Rules 자동 평가 · Violation Inbox {v.length}건</p>

      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>Severity 분포</b>
          <Donut size={120} center={`${v.length}`} segments={dist(tally(v, x => x.severity), { blocking: '#D64545', warning: '#D9822B', info: '#3B82F6' })} />
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
              <td><span className="badge" style={{background:x.severity==='blocking'?'var(--fail)':'var(--pending)'}}>{x.severity}</span></td>
              <td>{x.message}</td>
            </tr>
          ))}</tbody></table>
        {v.length===0 && <p className="muted">위반 없음 ✓</p>}
      </div>
    </div>
  );
}
