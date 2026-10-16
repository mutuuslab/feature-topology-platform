"""Evidence 보고서 (report.html) — 숫자·표·SVG 시계열만(스크립트 없음: FF가 CSP default-src 'none'으로 연다)."""
from __future__ import annotations

import html

ST = {'pass': '통과', 'fail': '실패', 'pending': '미확정', 'na': '해당 없음'}
STAGE_C = {'정상': '#2e9e5b', '주의': '#d69a1c', '위험': '#c8452d'}


def esc(x) -> str:
    return html.escape('' if x is None else str(x))


def chart(tel: list[dict], duration: float, target_gap: float) -> str:
    W, H, L, T, B = 920, 260, 44, 12, 40
    ymax = max(target_gap * 1.6, 60, *(r['gap_true'] or 0 for r in tel), *((r['gap_est'] or 0) for r in tel))
    x = lambda t: L + (W - L - 8) * t / max(duration, 1)
    y = lambda v: T + (H - T - B) * (1 - min(v, ymax) / ymax)

    def line(key, color, dash=''):
        pts = ' '.join(f'{x(r["sim_t"]):.1f},{y(r[key]):.1f}' for r in tel if r.get(key) is not None)
        return f'<polyline fill="none" stroke="{color}" stroke-width="1.6" {dash} points="{pts}"/>'

    bands = []
    step = max(1, len(tel) // 400)
    for r in tel[::step]:
        bands.append(f'<rect x="{x(r["sim_t"]):.1f}" y="{H - B + 6}" width="{(W - L) / 400 + 0.6:.1f}" height="8" fill="{STAGE_C.get(r["stage_true"], "#999")}"/>')
        fc = STAGE_C.get(r['stage_feature']) if r['stage_feature'] else '#c9c6bd'
        bands.append(f'<rect x="{x(r["sim_t"]):.1f}" y="{H - B + 18}" width="{(W - L) / 400 + 0.6:.1f}" height="8" fill="{fc}"/>')
    ticks = ''.join(f'<text x="{x(t):.1f}" y="{H - 2}" font-size="10" text-anchor="middle">{t:.0f}s</text>' for t in range(0, int(duration) + 1, 10))
    yt = ''.join(f'<text x="{L - 4}" y="{y(v) + 3:.1f}" font-size="10" text-anchor="end">{v:.0f}</text><line x1="{L}" x2="{W - 8}" y1="{y(v):.1f}" y2="{y(v):.1f}" stroke="#e5e2d8"/>' for v in range(0, int(ymax) + 1, 20))
    return (f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="간격 시계열">{yt}'
            f'<line x1="{L}" x2="{W - 8}" y1="{y(target_gap):.1f}" y2="{y(target_gap):.1f}" stroke="#7d7a70" stroke-dasharray="4 3"/>'
            f'{line("gap_ref", "#9aa6b2", "stroke-dasharray=\"2 2\"")}{line("gap_true", "#15171b")}{line("gap_est", "#2747d4")}'
            f'{"".join(bands)}{ticks}</svg>'
            '<p class="legend"><b style="color:#15171b">━ 실제 간격</b> · <b style="color:#2747d4">━ 기능 추정</b> · '
            '<b style="color:#9aa6b2">┄ 레이더 기준</b> · 아래 띠: 실제 단계 / 기능 판단 (초록 정상 · 노랑 주의 · 빨강 위험 · 회색 비활성)</p>')


def report_html(v: dict, tel: list[dict], events: list[dict]) -> str:
    rows = ''.join(
        f'<tr class="{c["status"]}"><td>{esc(c["label"])}</td><td>{"≤" if c["op"] == "<=" else "≥"} {esc(c["limit"])} {esc(c["unit"])}</td>'
        f'<td>{"—" if c["value"] is None else esc(c["value"]) + " " + esc(c["unit"])}</td><td>{"" if c["at"] is None else esc(c["at"]) + " s"}</td>'
        f'<td>{ST[c["status"]]}</td></tr>' for c in v['criteria'])
    evs = ''.join(f'<tr><td>{esc(e["t"])} s</td><td>{esc(e["type"])}</td><td>{esc(e["detail"])}</td></tr>' for e in events)
    sc, r = v['scenario'], v['repro']
    lim = ''.join(f'<li>{esc(x)}</li>' for x in v.get('limitations', []))
    return f'''<!doctype html><html lang="ko"><meta charset="utf-8"><title>{esc(v["testId"])}</title>
<style>body{{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#15171b;background:#f5f4ef}}table{{border-collapse:collapse;width:100%;margin:8px 0 20px}}
td,th{{border-bottom:1px solid #dfdcd2;padding:4px 8px;text-align:left;vertical-align:top}}tr.fail td{{background:#fbe9e4}}tr.pass td:last-child{{color:#1f7a45}}
.badge{{display:inline-block;padding:2px 10px;border-radius:4px;color:#fff;background:{"#1f7a45" if v["overall"] == "PASS" else "#c8452d"}}}code{{font:12px ui-monospace,monospace}}.legend{{font-size:12px;color:#5f5b50}}</style>
<h1>가상검증 Evidence — {esc(sc.get("name") or sc["scenarioId"])} <span class="badge">{esc(v["overall"])}</span></h1>
<p><code>{esc(v["testId"])}</code> · {esc(v["simulator"])} · 정책 {esc(v["policy"]["policyId"])} r{esc(v["policy"]["revision"])} ({esc(v["policy"]["featureId"])} {esc(v["policy"]["featureVersion"])}) · 판단 {esc(v["evaluation"].get("decision"))} {esc(v["evaluation"].get("reason"))}</p>
<p>시작 상태: 간격 {esc(v["start"]["gap_m"])} m · 자차 {esc(v["start"]["ego_kph"])} km/h · 선행차 {esc(v["start"]["lead_kph"])} km/h · 최소 차간 시간 {esc(v["minTimeGap"])} s ({esc(v["minTimeGapAt"])} s) · 차로 이탈 최대 {esc(v["maxLateralDevM"])} m</p>
{chart(tel, sc["duration_s"], sc["target_gap_m"])}
<h2>판정 기준</h2><table><tr><th>기준</th><th>한계</th><th>값</th><th>시각</th><th>판정</th></tr>{rows}</table>
<h2>재현 정보</h2><table><tr><td>도구</td><td>{esc(r["ffvalVersion"])}</td></tr><tr><td>시나리오 해시</td><td><code>{esc(r["scenarioHash"])}</code></td></tr>
<tr><td>판정 코드 해시</td><td><code>{esc(r["scriptHash"])}</code></td></tr><tr><td>시드 · 주기</td><td>{esc(r["seed"])} · {esc(r["stepS"])} s</td></tr>
<tr><td>CARLA 재생</td><td><code>{esc(r["replay"])}</code></td></tr><tr><td>안전 분류</td><td><code>{esc(r["safety"])}</code></td></tr></table>
<h2>제한 사항</h2><ul>{lim}</ul>
<h2>사건</h2><table><tr><th>시각</th><th>종류</th><th>내용</th></tr>{evs}</table></html>'''
