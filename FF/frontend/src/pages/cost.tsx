import { useNavigate } from 'react-router-dom';
import { costSummary, fmtWon, changeCost, impact } from '../data/engine';
import { DeployBadge } from '../components/ui';
import { Bars, Donut, CountUp } from '../components/charts';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageTitle } from '../components/PageTitle';

const PIE = ['#0B5FFF', '#16A34A', '#D9822B', '#9333EA', '#D64545', '#0891B2'];

export default function Cost() {
  const nav = useNavigate();
  const c = costSummary();
  // 도입 ROI — 변경 1건 평균 절감(Binary→Policy-only) × 연간 변경 건수(가설)
  const sample = changeCost(impact('API-BDC-POLICY-CONTROL'), 'Policy-only');
  const annualChanges = 120;
  const roiSaving = sample.savingsWon * annualChanges;

  return (
    <div>
      <Breadcrumb />
      <PageTitle fallback="SW 개발비 / Development Cost" />
      <p className="page-sub">공수(M/M)→금액(₩) 환산 · 모든 값은 <b>추정/가설</b> (요율 ₩12M/MM)</p>

      <div className="kpis reveal">
        <div className="kpi"><div className="v">{fmtWon(c.totalEst)}</div><div className="l">총 예상 개발비</div></div>
        <div className="kpi"><div className="v">{fmtWon(c.totalActual)}</div><div className="l">총 실적 개발비</div></div>
        <div className="kpi"><div className="v" style={{ color: c.totalActual > c.totalEst ? 'var(--fail)' : 'var(--pass)' }}>{fmtWon(c.totalActual - c.totalEst)}</div><div className="l">예실 차이</div></div>
        <div className="kpi"><div className="v" style={{ color: 'var(--pass)' }}>{fmtWon(roiSaving)}</div><div className="l">연간 절감(ROI, 가설)</div></div>
        <div className="kpi"><div className="v"><CountUp value={c.rows.length} /></div><div className="l">집계 Feature 수</div></div>
      </div>

      <div className="row">
        <div className="col card" style={{ flex: 2 }}><b>도메인별 예상 개발비</b><div className="mt"><Bars data={c.byDomain} fmt={fmtWon} /></div></div>
        <div className="col card"><b>배포방식별 비중</b>
          <Donut size={130} center={fmtWon(c.totalEst)} segments={Object.entries(c.byDeploy).sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ label: k, value: v, color: PIE[i % PIE.length] }))} />
        </div>
      </div>

      <div className="card">
        <b>Feature별 개발비 (예상 vs 실적)</b>
        <table className="mt"><thead><tr><th>Feature</th><th>Domain</th><th>Deploy</th><th>예상 M/M</th><th>실적 M/M</th><th>예상 ₩</th><th>실적 ₩</th><th>차이</th></tr></thead>
          <tbody>{c.rows.map(r => (
            <tr key={r.id} onClick={() => nav(`/feature/${r.id}`)}>
              <td className="mono">{r.id}</td><td>{r.domain}</td><td><DeployBadge value={r.deploy} /></td>
              <td>{r.estMM}</td><td>{r.actualMM || '-'}</td><td className="mono">{fmtWon(r.estWon)}</td>
              <td className="mono">{r.actualWon ? fmtWon(r.actualWon) : '-'}</td>
              <td className="mono" style={{ color: r.varianceWon > 0 ? 'var(--fail)' : 'var(--pass)' }}>{r.actualWon ? fmtWon(r.varianceWon) : '-'}</td>
            </tr>
          ))}</tbody></table>
      </div>

      <div className="card">
        <b>도입 ROI · 배포방식 절감 (가설)</b>
        <p className="small mt">변경 1건(BDC API 예시) 기준 — Binary OTA <span className="mono">{fmtWon(sample.binaryWon)}</span> → Policy-only <span className="mono">{fmtWon(sample.changeWon)}</span>, 절감 <b style={{ color: 'var(--pass)' }}>{fmtWon(sample.savingsWon)}</b></p>
        <table className="mt"><thead><tr><th>항목</th><th>Before</th><th>After</th><th>효과</th></tr></thead>
          <tbody>
            <tr><td>불필요 Binary OTA 비용</td><td className="muted">{fmtWon(sample.binaryWon)}/건</td><td>{fmtWon(sample.changeWon)}/건</td><td><span className="badge status-PASS">~70%↓</span></td></tr>
            <tr><td>연간 변경 {annualChanges}건 누적 절감</td><td className="muted">-</td><td className="mono">{fmtWon(roiSaving)}</td><td><span className="badge status-PASS">ROI</span></td></tr>
            <tr><td>과잉검증·재작업 절감</td><td className="muted">검증누락 15~20%</td><td>&lt;2%</td><td><span className="badge status-PASS">품질비용↓</span></td></tr>
          </tbody></table>
        <p className="small muted">※ 정량치는 Mutuus Lab 가설 — PoC/Baseline 실측 검증 필요(S34 연계).</p>
      </div>
    </div>
  );
}
