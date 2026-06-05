import { useNavigate } from 'react-router-dom';
import { consistency } from '../data/engine';

export default function ConsistencyConsole() {
  const nav = useNavigate();
  const v = consistency();
  return (
    <div>
      <div className="breadcrumb">관계 / Topology ▸ Consistency Rule Console</div>
      <h1 className="page-title">Consistency Rule Console</h1>
      <p className="page-sub">12 Rules 자동 평가 · Violation Inbox {v.length}건</p>
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
