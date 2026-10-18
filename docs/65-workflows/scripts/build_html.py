"""모델 → out/index.html (단일 파일). 손으로 고치지 않는다.

구성: 읽는 법·프로세스 고르기 → 담당자 → Gate 대응 → 정합성 점검 → 직무 분리 → 프로세스(스윔레인·활동·산출물)
      → 담당자별 업무 절차서 → 규칙 커버리지
사용: python -I scripts/build_html.py [--partial]
"""
from __future__ import annotations

import sys
from html import escape
from pathlib import Path
from typing import List

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_model as wm  # noqa: E402

OUT = wm.ROOT / "out" / "index.html"
E = escape


def _w(ch: str, size: float) -> float:
    return size * (1.0 if ord(ch) > 0x2E80 else 0.58)


def wrap(text: str, width: float, size: float = 12, max_lines: int = 3) -> List[str]:
    lines, cur, cw = [], "", 0.0
    for word in text.split(" "):
        ww = sum(_w(c, size) for c in word) + (_w(" ", size) if cur else 0)
        if cur and cw + ww > width:
            lines.append(cur)
            cur, cw = word, sum(_w(c, size) for c in word)
        else:
            cur, cw = (cur + " " + word if cur else word), cw + ww
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1][:-1] + "…"
    return lines


def rname(m, rid):
    return m["roles_by_id"][rid]["name"]


def chips(items, cls="chip"):
    return "".join(f'<span class="{cls}">{E(str(i))}</span>' for i in items)


def wp_link(m, key):
    wp = m["wp_by_key"].get(key)
    label = wp["name"] if wp else key
    return f'<a class="wp" href="#{E(key)}" title="{E(key)}">{E(label)}</a>'


def act_link(m, aid):
    p, a = m["acts_by_id"][aid]
    return f'<a href="#{E(aid)}">{E(aid)} {E(a["name"])}</a>'


# ── 스윔레인 SVG ──────────────────────────────────────────────
def junctions(lay) -> list:
    """같은 대상으로 모이는 흐름이 한 줄기에 합류하는 실제 지점.

    대상마다 줄기(세로선)는 들어오는 흐름들의 y와 대상 y 사이를 잇는다. 줄기 끝(꺾임)이 아닌,
    줄기 중간에서 다른 흐름이 붙는 y에만 점을 찍는다."""
    by_dst: dict = {}
    straight: set = set()
    for src, dst, _ in lay.edges:
        pts = wm.route(lay, src, dst)
        if len(pts) == 4:                       # 앞으로 가는 직교 흐름: 출발 → (gx,sy) → (gx,ty) → 대상
            by_dst.setdefault(dst, []).append(pts)
        elif len(pts) == 2 and lay.nodes[dst].kind == "action":
            straight.add(dst)                   # 대상과 같은 높이로 곧게 들어오는 흐름
    out = []
    for dst, paths in by_dst.items():
        if len(paths) + (dst in straight) < 2:
            continue
        gx, ty = paths[0][2]
        ys = [p[1][1] for p in paths]
        lo, hi = min(ys + [ty]), max(ys + [ty])
        for y in sorted(set(ys + [ty])):
            if lo < y < hi or (y == ty and dst in straight):
                out.append((gx, y))
    return out


def svg_workflow(m, proc) -> str:
    lay = wm.layout(m, proc)
    h = lay.height + 24
    mid = f"arr-{proc['id'].replace('.', '-')}"
    out = [f'<svg class="flow" viewBox="-2 -2 {lay.width + 4} {h + 4}" width="{lay.width}" height="{h}" '
           f'role="img" aria-label="{E(proc["id"])} 업무 흐름">',
           f'<defs><marker id="{mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
           'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#475569"/></marker></defs>']
    for i, ln in enumerate(lay.lanes):
        out.append(f'<rect class="lane{i % 2}" x="{ln.x}" y="{ln.y}" width="{ln.w}" height="{ln.h}"/>')
        ty = ln.y + ln.h / 2 - 7 * (len(wrap(ln.label, 110)) - 1)
        for j, line in enumerate(wrap(ln.label, 110)):
            out.append(f'<text class="lanelabel" x="{ln.x + 10}" y="{ty + j * 15 + 4}">{E(line)}</text>')
        out.append(f'<line class="lanesep" x1="{ln.x + wm.LANE_LABEL_W}" y1="{ln.y}" '
                   f'x2="{ln.x + wm.LANE_LABEL_W}" y2="{ln.y + ln.h}"/>')
    for src, dst, kind in lay.edges:
        pts = wm.route(lay, src, dst)
        d = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        out.append(f'<polyline class="edge {kind}" points="{d}" marker-end="url(#{mid})"/>')
    for x, y in junctions(lay):
        out.append(f'<circle class="join" cx="{x:.1f}" cy="{y:.1f}" r="3"/>')
    for n in lay.nodes.values():
        if n.kind == "action":
            _, a = m["acts_by_id"][n.id]
            gate, trig = n.extra.get("gate"), n.extra.get("trigger")
            cls = "act gate" if gate else "act"
            out.append(f'<a href="#{E(n.id)}"><g class="node" data-roles="{E(" ".join(wm.raci_roles(a)))}">'
                       f'<rect class="{cls}" x="{n.x}" y="{n.y}" width="{n.w}" height="{n.h}" rx="8"/>'
                       f'<text class="aid" x="{n.x + 8}" y="{n.y + 14}">{E(n.id.split("-")[1])}'
                       f'{" · " + E(gate) + " 판정" if gate else ""}</text>')
            name = wrap(n.label, n.w - 14, 12.5, 2)
            body_h = n.h - 18 - (12 if trig else 0)
            y0 = n.y + 18 + (body_h - 15 * len(name)) / 2 + 11
            for j, line in enumerate(name):
                out.append(f'<text class="aname" x="{n.x + 8}" y="{y0 + j * 15:.1f}">{E(line)}</text>')
            if trig:
                out.append(f'<text class="trig" x="{n.x + 8}" y="{n.y + n.h - 6}">'
                           f'⚡ {E(wrap(trig, n.w - 24, 10.5, 1)[0])}</text>')
            out.append("</g></a>")
        elif n.kind == "start":
            out.append(f'<circle class="start" cx="{n.x + n.w / 2}" cy="{n.y + n.h / 2}" r="{n.w / 2}"/>')
        elif n.kind == "end":
            out.append(f'<circle class="end" cx="{n.x + n.w / 2}" cy="{n.y + n.h / 2}" r="{n.w / 2}"/>'
                       f'<circle class="endin" cx="{n.x + n.w / 2}" cy="{n.y + n.h / 2}" r="{n.w / 2 - 4}"/>')
    out.append("</svg>")
    hint = '<p class="meta">← 흐름도가 넓다. 가로로 스크롤한다 →</p>' if lay.width > 1200 else ""
    return hint + "\n".join(out)


# ── 섹션 ──────────────────────────────────────────────────────
def section_overview(m) -> str:
    rows = []
    for pl in m["plan"]:
        p = m["proc_by_id"].get(pl["id"])
        if p:
            lanes = []
            for a in p["activities"]:
                if a["raci"]["R"][0] not in lanes:
                    lanes.append(a["raci"]["R"][0])
            rows.append(f'<tr><td><a href="#{E(p["id"])}">{E(p["id"])}</a></td><td><a href="#{E(p["id"])}">{E(p["name_ko"])}</a></td>'
                        f'<td>{chips(pl["gates"])}</td><td>{len(p["activities"])}</td>'
                        f'<td>{", ".join(E(rname(m, r)) for r in lanes)}</td><td>작성</td></tr>')
        else:
            rows.append(f'<tr class="todo"><td>{E(pl["id"])}</td><td>{E(pl["name_ko"])}</td><td>{chips(pl["gates"])}</td>'
                        f'<td>–</td><td>–</td><td>작성 예정</td></tr>')
    return f"""<section id="overview"><h2>1. 읽는 법 · 프로세스 고르기</h2>
<p class="lead">Feature 생애주기(표준 보고서 Gate G1~G8)와 지원 업무를 {len(m['plan'])}개 프로세스로 나누고,
각 활동에 <b>누가(R) 하고 누가 책임(A)지는지</b>, 무엇을 받아 무엇을 내놓는지, 플랫폼의 어느 권한·화면으로 하는지를 정했다.
위쪽 <b>내 역할 보기</b>에서 역할을 고르면 그 역할이 관여하는 활동만 강조된다.</p>
<table><thead><tr><th>ID</th><th>프로세스</th><th>보고서 Gate</th><th>활동</th><th>수행 역할(스윔레인)</th><th>상태</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
<details class="more"><summary>표기 규칙</summary><ul>
<li><b>R</b> 수행 · <b>A</b> 최종 책임(1명) · <b>C</b> 협의 · <b>I</b> 통보. 스윔레인은 첫 번째 R 역할 기준이다.</li>
<li>활동의 <b>플랫폼 권한</b>은 /admin/iam 권한표의 action 이름이다. R 역할에 매핑된 IAM 역할이 그 action을 허용해야 검증을 통과한다.</li>
<li>굵은 테두리 상자는 Gate 판정 활동, 원 안의 원은 종료, 빈 원은 시작·트리거다.</li></ul></details></section>"""


def role_stats(m, rid):
    s = {"R": 0, "A": 0, "C": 0, "I": 0}
    for _, a in m["acts_by_id"].values():
        r = a["raci"]
        s["R"] += rid in r["R"]
        s["A"] += rid == r["A"]
        s["C"] += rid in r.get("C", [])
        s["I"] += rid in r.get("I", [])
    return s


SOURCE_KO = {"report": "보고서 1.5절", "report-gate": "보고서 6.1절 Gate 승인", "iam": "IAM(보고서 어휘 밖)"}


def section_roles(m) -> str:
    rows = []
    for r in m["roles"]:
        s = role_stats(m, r["id"])
        plat = ", ".join(f'{E(pr)}<br><small>{E(m["iam_role_label"][pr])}</small>' for pr in r["platform_roles"]) or "<i>플랫폼 밖</i>"
        accts = ", ".join(wm.accounts_of(m, r["id"])) or "–"
        rows.append(f'<tr data-roles="{E(r["id"])}"><td><a href="#role-{E(r["id"])}">{E(r["id"])}</a></td><td><b>{E(r["name"])}</b><br>'
                    f'<small>{E(r["en"])}</small></td><td>{E(SOURCE_KO[r["source"]])}</td><td>{E(r["desc"])}</td>'
                    f'<td>{plat}</td><td>{E(accts)}</td><td class="num">{s["R"]}/{s["A"]}/{s["C"]}/{s["I"]}</td></tr>')
    return f"""<section id="roles"><h2>2. 담당자 (조직 역할)</h2>
<p class="lead">표준 보고서의 조직 역할 {sum(r['source'] == 'report' for r in m['roles'])}개에 Gate 승인 칸의 Release Manager와,
보고서 어휘에는 없지만 /admin/iam에 있는 역할 {sum(r['source'] == 'iam' for r in m['roles'])}개를 더했다. 플랫폼 역할 매핑이 IAM과 어긋나면 검증이 실패한다.</p>
<table><thead><tr><th>ID</th><th>역할</th><th>출처</th><th>책임</th><th>IAM 역할</th><th>IAM 데모 계정</th><th>R/A/C/I</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
<details class="more"><summary>매핑 근거</summary><table><tbody>
{''.join(f'<tr><td>{E(r["name"])}</td><td>{E(r["basis"])}</td></tr>' for r in m['roles'])}</tbody></table></details></section>"""


def section_gates(m) -> str:
    pg = {g["id"]: g for g in m["iam"]["gates"]}
    rows = []
    for cw in m["common"]["gate_crosswalk"]:
        g = m["gate_by_id"][cw["report"]]
        acts = [aid for aid, (_, a) in m["acts_by_id"].items() if a.get("gate_decision") == cw["report"]]
        plat = "<br>".join(f'{E(x)} {E(pg[x]["name"])} <small>({E(pg[x]["judgeRole"])})</small>' for x in cw["platform"]) or "–"
        rows.append(f'<tr><td><b>{E(g["id"])}</b> {E(g["name"])}</td><td>{E(g["purpose"])}</td><td>{E(", ".join(g["approvers"]))}</td>'
                    f'<td>{plat}</td><td>{E(cw["note"])}</td><td>{"<br>".join(act_link(m, a) for a in acts) or "<i>작성 예정</i>"}</td></tr>')
    return f"""<section id="gates"><h2>3. Gate 대응 (보고서 G1~G8 ↔ 플랫폼 G1~G9)</h2>
<p class="lead">보고서와 플랫폼은 Gate 번호와 범위가 다르다. 업무 절차는 보고서 Gate로 나누고, 판정 활동이 플랫폼의 어느 Gate를 등록하는지 이 표로 맞춘다.</p>
<table><thead><tr><th>보고서 Gate</th><th>목적</th><th>보고서 승인</th><th>플랫폼 Gate (판정자)</th><th>대응 설명</th><th>판정 활동</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table></section>"""


STATUS_KO = {"resolved-in-model": "절차로 해소", "resolved-in-platform": "플랫폼 수정으로 해소", "open-platform": "플랫폼 수정 필요", "open-report": "보고서 수정 필요",
             "not-applicable": "오탐"}


def section_alignment(m, rep) -> str:
    src = m["iam"]["source"]
    rows = "".join(
        f'<tr class="st-{E(a["status"])}"><td>{E(a["id"])}</td><td>{E(a["topic"])}<br><small><code>{E(a["key"])}</code></small></td>'
        f'<td>{E(a["report"])}</td><td>{E(a["platform"])}</td><td>{E(a["decision"])}</td><td class="st">{E(STATUS_KO[a["status"]])}</td></tr>'
        for a in m["common"]["alignment"])
    diff = "".join(f"<li>{E(d['kind'])}: <code>{E(d['name'])}</code></li>" for d in m["iam"]["dist_diff"]) or "<li>없음</li>"
    human = [r for r in m["iam"]["roles"] if r["human"]]
    return f"""<section id="alignment"><h2>4. 정합성 점검 (보고서 ↔ /admin/iam)</h2>
<p class="lead">기준: <a href="{E(src['iam_url'])}">{E(src['iam_url'])}</a> (조회 {E(src['fetched_at'][:19])} UTC, 권한 {len(m['iam']['permissions'])}개 ·
사람 역할 {len(human)}개 · 직무 분리 {len(m['iam']['sod'])}개). 자동 검출된 불일치는 모두 아래 결정이 있어야 게이트를 통과한다.</p>
<ul class="checks">
<li>IAM 사람 역할 {len(human)}개 모두 조직 역할에 매핑됨</li>
<li>활동의 플랫폼 action {sum(len((a.get('platform') or {}).get('actions', [])) for _, a in m['acts_by_id'].values())}건 모두 R 역할의 IAM 권한으로 허용됨</li>
<li>화면 경로는 frontend 라우트 표({len(m['iam']['screens'])}개)에 존재</li></ul>
<table><thead><tr><th>ID</th><th>주제</th><th>보고서</th><th>플랫폼(IAM)</th><th>결정</th><th>상태</th></tr></thead><tbody>{rows}</tbody></table>
<details class="more"><summary>스냅샷 출처와 contracts/dist 차이</summary><ul>
<li>FF git: <code>{E(str((src.get('ff_git') or {}).get('head')))}</code> (작업 중 파일 {E(str((src.get('ff_git') or {}).get('dirty_files')))}개), 서버 seed {E(str(src.get('server_seed')))}</li>
<li>보고서: <code>{E(m['guide']['source']['guide_src'])}</code> @ <code>{E(str(m['guide']['source']['git_head']))}</code></li>
<li>dist ↔ 실행 서버 권한 차이:<ul>{diff}</ul></li></ul></details></section>"""


def section_sod(m) -> str:
    iam_sod = {s["id"]: s for s in m["iam"]["sod"]}
    rows = []
    for s in m["common"]["sod"]:
        ok = s["first"] in m["acts_by_id"] and s["second"] in m["acts_by_id"]
        rows.append(f'<tr><td>{E(s["id"])}</td><td>{E(iam_sod[s["id"]]["rule"])}</td><td>{"조직 역할 분리" if s["level"] == "role" else "사람 분리(플랫폼 강제)"}</td>'
                    f'<td>{act_link(m, s["first"]) if ok else E(s["first"])}</td><td>{act_link(m, s["second"]) if ok else E(s["second"])}</td>'
                    f'<td>{E(s["note"])}</td></tr>')
    return f"""<section id="sod"><h2>5. 직무 분리</h2>
<p class="lead">IAM 직무 분리 규칙을 활동 쌍으로 묶었다. 조직 역할 분리는 두 활동의 담당 역할이 달라야 하고,
사람 분리는 같은 역할이 양쪽에 나와도 플랫폼 감사 원장이 같은 사람을 거부한다.</p>
<table><thead><tr><th>규칙</th><th>IAM 내용</th><th>수준</th><th>앞 활동</th><th>뒤 활동</th><th>설명</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table></section>"""


def raci_line(m, a) -> str:
    r = a["raci"]
    parts = [f'<b>R</b> {", ".join(E(rname(m, x)) for x in r["R"])}', f'<b>A</b> {E(rname(m, r["A"]))}']
    if r.get("C"):
        parts.append(f'<b>C</b> {", ".join(E(rname(m, x)) for x in r["C"])}')
    if r.get("I"):
        parts.append(f'<b>I</b> {", ".join(E(rname(m, x)) for x in r["I"])}')
    return " · ".join(parts)


def platform_block(m, a) -> str:
    plat = a.get("platform") or {}
    if not plat:
        return '<div class="plat off">플랫폼 밖에서 수행</div>'
    bits = []
    for name in plat.get("actions", []):
        p = m["perm_by_name"][name]
        bits.append(f'<span class="act-perm" title="{E(", ".join(p["roles"]))}"><code>{E(name)}</code> {E(p["summary"])}</span>')
    for path in plat.get("screens", []):
        s = m["screen_by_path"][path]
        bits.append(f'<span class="screen"><code>{E(path)}</code> {E(s["title"])}</span>')
    if plat.get("gates"):
        bits.append(f'<span class="pg">플랫폼 Gate {E(", ".join(plat["gates"]))}</span>')
    return f'<div class="plat">{"".join(bits)}</div>'


def activity_card(m, a) -> str:
    roles = " ".join(wm.raci_roles(a))
    rules = " ".join(f'<span class="chip rule" title="{E(m["rule_by_id"][r]["title"])}">{E(r)}</span>' for r in a.get("rules", []))
    gate = f'<span class="chip gate">{E(a["gate_decision"])} 판정</span>' if a.get("gate_decision") else ""
    trig = f'<p class="trigger">트리거: {E(a["trigger"])}</p>' if a.get("trigger") else ""
    nxt = ", ".join(act_link(m, n) for n in a.get("next", [])) or "–"
    return f"""<article class="card act-card" id="{E(a['id'])}" data-roles="{E(roles)}">
<h4>{E(a['id'])} {E(a['name'])} {gate}</h4>{trig}
<p class="raci">{raci_line(m, a)}</p>
<div class="io"><div><b>입력</b> {', '.join(wp_link(m, k) for k in a.get('inputs', [])) or '–'}</div>
<div><b>출력</b> {', '.join(wp_link(m, k) for k in a.get('outputs', [])) or '–'}</div></div>
<b>수행 절차</b><ol>{''.join(f'<li>{E(s)}</li>' for s in a['steps'])}</ol>
<b>완료 기준</b><ul class="checks">{''.join(f'<li>{E(c)}</li>' for c in a['checks'])}</ul>
{platform_block(m, a)}
<p class="meta">이행 규칙 {rules or '–'} · 다음 {nxt}</p></article>"""


def wp_card(m, p, wp) -> str:
    makers = [aid for aid, (_, a) in m["acts_by_id"].items() if wp["key"] in a.get("outputs", [])]
    users = [aid for aid, (_, a) in m["acts_by_id"].items() if wp["key"] in a.get("inputs", [])]
    kind = "산출" if wp["kind"] == "output" else f'입력 · {E(wp.get("from", ""))}'
    return f"""<article class="card wp-card" id="{E(wp['key'])}"><h4>{E(wp['name'])} <small>{E(wp['en'])}</small></h4>
<p class="meta"><code>{E(wp['key'])}</code> · {kind}</p><ul>{''.join(f'<li>{E(c)}</li>' for c in wp['content'])}</ul>
<p class="meta">생성 {', '.join(act_link(m, x) for x in makers) or '–'} · 사용 {', '.join(act_link(m, x) for x in users) or '–'}</p></article>"""


def raci_matrix(m, p) -> str:
    used = []
    for a in p["activities"]:
        for r in wm.raci_roles(a):
            if r not in used:
                used.append(r)
    head = "".join(f"<th>{E(rname(m, r))}</th>" for r in used)
    rows = []
    for a in p["activities"]:
        cells = []
        for r in used:
            x = a["raci"]
            v = "/".join(k for k in ("R", "A", "C", "I") if (r in x.get(k, []) if k != "A" else r == x["A"]))
            cells.append(f'<td class="rc rc-{v[:1]}">{v}</td>')
        rows.append(f'<tr><td>{act_link(m, a["id"])}</td>{"".join(cells)}</tr>')
    return f'<table class="raci-m"><thead><tr><th>활동</th>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table>'


def section_process(m, p, num) -> str:
    ins = []
    for a in p["activities"]:
        for k in a.get("inputs", []):
            if (m["wp_by_key"][k]["owner"] != p["id"] or m["wp_by_key"][k]["kind"] == "input") and k not in ins:
                ins.append(k)
    gate_act = [a for a in p["activities"] if a.get("gate_decision")]
    lead = (f'{", ".join(wp_link(m, k) for k in ins)} → 활동 {len(p["activities"])}개 → '
            f'{"<b>" + E(gate_act[0]["gate_decision"]) + " 판정</b>" if gate_act else "완료"}')
    rules = "".join(f'<tr><td>{E(r)}</td><td>{E(m["rule_by_id"][r]["title"])}</td><td>{E(m["rule_by_id"][r]["applies"])}</td>'
                    f'<td>{", ".join(act_link(m, a["id"]) for a in p["activities"] if r in a.get("rules", []))}</td></tr>'
                    for r in p.get("rules", []))
    return f"""<section class="proc" id="{E(p['id'])}"><h2>{num}. {E(p['id'])} {E(p['name_ko'])} <small>{E(p['name'])}</small></h2>
<p class="lead">{lead}</p><p>{E(p['purpose_ko'])}</p>
<div class="flowwrap">{svg_workflow(m, p)}</div>
<h3>활동</h3>{''.join(activity_card(m, a) for a in p['activities'])}
<h3>산출물</h3><div class="grid">{''.join(wp_card(m, p, wp) for wp in p['work_products'])}</div>
<details class="more"><summary>진입·완료 기준 · 결과(Outcome)</summary>
<b>진입</b><ul>{''.join(f'<li>{E(x)}</li>' for x in p['entry_criteria'])}</ul>
<b>완료</b><ul>{''.join(f'<li>{E(x)}</li>' for x in p['exit_criteria'])}</ul>
<b>결과</b><ul>{''.join(f'<li>{E(o["id"])} {E(o["text_ko"])}</li>' for o in p['outcomes'])}</ul></details>
<details class="more"><summary>RACI 매트릭스</summary>{raci_matrix(m, p)}</details>
<details class="more"><summary>보고서 규칙 근거 ({len(p.get('rules', []))})</summary>
<table><thead><tr><th>규칙</th><th>제목</th><th>적용</th><th>이행 활동</th></tr></thead><tbody>{rules}</tbody></table></details>
</section>"""


def role_activities(m, rid):
    """역할이 관여하는 활동을 프로세스 계획(생애주기) 순서로."""
    out = []
    for pl in m["plan"]:
        p = m["proc_by_id"].get(pl["id"])
        for a in (p or {}).get("activities", []):
            r = a["raci"]
            kind = "R" if rid in r["R"] else "A" if rid == r["A"] else "C" if rid in r.get("C", []) else "I" if rid in r.get("I", []) else None
            if kind:
                out.append((p, a, kind, rid == r["A"]))
    return out


def rules_of_role(m, rid):
    name = m["roles_by_id"][rid]["name"]
    return [r for r in m["guide"]["rules"] if name in r["roles"]]


def section_role_procedures(m, num) -> str:
    parts = []
    for r in m["roles"]:
        acts = role_activities(m, r["id"])
        do = [x for x in acts if x[2] in ("R", "A")]
        ci = [x for x in acts if x[2] in ("C", "I")]
        items = []
        for p, a, kind, is_a in do:
            mark = "수행·책임" if kind == "R" and is_a else "수행" if kind == "R" else "책임(승인)"
            plat = a.get("platform") or {}
            perm = ", ".join(f"<code>{E(x)}</code>" for x in plat.get("actions", [])) or "플랫폼 밖"
            items.append(f'<li><b>{act_link(m, a["id"])}</b> <span class="chip">{mark}</span>'
                         f'{" <span class=\"chip gate\">" + E(a["gate_decision"]) + " 판정</span>" if a.get("gate_decision") else ""}'
                         f'<br><small>{E(p["name_ko"])} · 트리거/선행: {E(a.get("trigger") or "앞 활동 완료")} · 권한: {perm}</small>'
                         f'<ol>{"".join(f"<li>{E(s)}</li>" for s in a["steps"])}</ol></li>')
        rules = rules_of_role(m, r["id"])
        covered = {x for _, a in m["acts_by_id"].values() for x in a.get("rules", [])
                   if r["id"] in wm.ra_roles(a)}
        rl = "".join(f'<li>{E(x["id"])} {E(x["title"])} {"✓" if x["id"] in covered else "<i>— 작성 예정</i>"}</li>' for x in rules)
        ci_l = "".join(f'<li>{act_link(m, a["id"])} <span class="chip">{"협의" if k == "C" else "통보"}</span></li>' for _, a, k, _ in ci)
        plat = ", ".join(f'{E(x)}({E(m["iam_role_label"][x])})' for x in r["platform_roles"]) or "플랫폼 권한 없음"
        parts.append(f"""<article class="card role-card" id="role-{E(r['id'])}" data-roles="{E(r['id'])}">
<h3>{E(r['name'])} <small>{E(r['id'])} · {E(r['en'])}</small></h3><p>{E(r['desc'])}</p>
<p class="meta">IAM 역할: {plat} · 데모 계정: {E(', '.join(wm.accounts_of(m, r['id'])) or '–')}</p>
<h4>내가 하는 일 ({len(do)})</h4>{'<ol class="role-acts">' + ''.join(items) + '</ol>' if items else '<p class="meta">작성된 프로세스에 수행 활동이 아직 없다(2단계 작성 예정).</p>'}
<details class="more"><summary>협의·통보 받는 활동 ({len(ci)})</summary><ul>{ci_l or '<li>–</li>'}</ul></details>
<details class="more"><summary>보고서가 이 역할에 지정한 규칙 ({len(rules)})</summary><ul>{rl or '<li>–</li>'}</ul></details></article>""")
    return f"""<section id="by-role"><h2>{num}. 담당자별 업무 절차서</h2>
<p class="lead">RACI에서 자동으로 모은 역할별 절차서다. 수행(R)·책임(A) 활동을 생애주기 순서로 나열한다.</p>{''.join(parts)}</section>"""


def section_coverage(m, rep, num) -> str:
    rows = []
    for rule in m["guide"]["rules"]:
        if not rule["roles"]:
            continue
        want = set(wm.report_role_ids(m, rule["roles"]))
        acts = [aid for aid, (_, a) in m["acts_by_id"].items()
                if rule["id"] in a.get("rules", []) and want & wm.ra_roles(a)]
        rows.append(f'<tr class="{"ok" if acts else "miss"}"><td>{E(rule["id"])}</td><td>{E(rule["title"])}</td>'
                    f'<td>{E(", ".join(rule["roles"]))}</td><td>{"<br>".join(act_link(m, a) for a in acts) or "미커버"}</td></tr>')
    done = sum('class="ok"' in r for r in rows)
    probs = "".join(f"<li>{E(w)}</li>" for w in rep.warnings) or "<li>없음</li>"
    unused = unused_permissions(m)
    unused_rows = "".join(
        f'<tr><td><code>{E(p["name"])}</code></td><td>{E(p["summary"])}</td><td>{E(p["component"])}</td>'
        f'<td>{E(", ".join(p["roles"]))}</td><td>{E(", ".join(orgs))}</td></tr>' for p, orgs in unused)
    return f"""<section id="coverage"><h2>{num}. 규칙 커버리지</h2>
<p class="lead">보고서 규칙 {len(m['guide']['rules'])}개 중 역할이 지정된 {len(rows)}개를 그 역할이 수행·책임지는 활동이 이행해야 한다.
현재 <b>{done}/{len(rows)}</b>.</p>
<table><thead><tr><th>규칙</th><th>제목</th><th>지정 역할</th><th>이행 활동</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
<details class="more"><summary>절차가 정의되지 않은 IAM 변경 권한 ({len(unused)})</summary>
<p class="meta">사람 역할이 실행할 수 있지만 어느 활동에도 쓰이지 않은 권한이다. 게이트 조건은 아니며, 업무 절차가 필요한 업무인지 검토할 목록이다(알림 설정·PoC 진행 제외).</p>
<table><thead><tr><th>action</th><th>요약</th><th>컴포넌트</th><th>IAM 역할</th><th>조직 역할</th></tr></thead><tbody>{unused_rows}</tbody></table></details>
<details class="more"><summary>검증 경고 ({len(rep.warnings)})</summary><ul>{probs}</ul></details></section>"""


NOT_PROCEDURAL = {"readNotification", "readAllNotifications", "saveNotificationPrefs", "startPoc", "advancePoc"}


def unused_permissions(m):
    """절차 어디에도 쓰이지 않은 사람 역할 변경 권한과, 그 권한을 가진 조직 역할."""
    used = {x for _, a in m["acts_by_id"].values() for x in (a.get("platform") or {}).get("actions", [])}
    human = {r["role"] for r in m["iam"]["roles"] if r["human"]}
    out = []
    for p in m["iam"]["permissions"]:
        if p["name"] in used or p["name"] in NOT_PROCEDURAL or not set(p["roles"]) & human:
            continue
        orgs = [r["name"] for r in m["roles"] if set(r["platform_roles"]) & set(p["roles"])]
        out.append((p, orgs))
    return out


def toolbar(m) -> str:
    opts = "".join(f'<option value="{E(r["id"])}">{E(r["name"])}</option>' for r in m["roles"])
    return f'''<div class="toolbar"><b>{E(m["common"]["meta"]["title"])}</b> v{E(m["common"]["meta"]["version"])}
<label>내 역할 보기 <select id="rolepick"><option value="">전체</option>{opts}</select></label>
<a href="#overview">고르기</a><a href="#roles">담당자</a><a href="#gates">Gate</a><a href="#alignment">정합성</a><a href="#by-role">담당자별 절차서</a><a href="#coverage">커버리지</a></div>'''


CSS = """
:root{--ink:#0f172a;--mute:#64748b;--line:#cbd5e1;--acc:#1d4ed8;--gate:#b45309;--bg:#f8fafc}
*{box-sizing:border-box}body{margin:0;font:14px/1.55 "Pretendard","Malgun Gothic",system-ui,sans-serif;color:var(--ink);background:#fff}
main{max-width:1280px;margin:0 auto;padding:12px 24px 80px}h2{margin-top:44px;border-bottom:2px solid var(--ink);padding-bottom:4px}
h2 small,h3 small,h4 small{color:var(--mute);font-weight:400}.lead{font-size:15px;background:var(--bg);border-left:4px solid var(--acc);padding:8px 12px}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid var(--line);padding:5px 7px;vertical-align:top;text-align:left;word-break:keep-all;overflow-wrap:anywhere}
td:first-child,td.st{white-space:nowrap}[id]{scroll-margin-top:56px}
code,.chip.rule{font-family:"Cascadia Mono",Consolas,"D2Coding",monospace;font-variant-ligatures:none}
th{background:#eef2f7}tr.todo td{color:var(--mute)}tr.miss td:last-child{color:#b91c1c;font-weight:600}td.num{white-space:nowrap}
.toolbar{position:sticky;top:0;z-index:5;background:#0f172a;color:#fff;padding:8px 24px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.toolbar a{color:#bfdbfe;text-decoration:none}.toolbar select{font-size:14px}
.card{border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:10px 0;background:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
.chip{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:0 7px;margin:0 3px 0 0;font-size:12px;background:var(--bg)}
.chip.gate{border-color:var(--gate);color:var(--gate);font-weight:600}.chip.rule{font-family:Consolas,monospace}
.meta{color:var(--mute);font-size:12.5px}.raci{margin:4px 0}.io{display:flex;gap:24px;flex-wrap:wrap;margin:4px 0}
.trigger{color:var(--gate);margin:2px 0}.plat{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.plat span{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:1px 6px;font-size:12.5px}.plat.off{color:var(--mute);font-size:12.5px}
.plat .screen{background:#f0fdf4;border-color:#bbf7d0}.plat .pg{background:#fff7ed;border-color:#fed7aa}
ul.checks li::marker{content:"✓ "}a.wp{color:#0f766e}.flowwrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;padding:6px;background:#fff}
svg.flow .lane0{fill:#f8fafc;stroke:#cbd5e1}svg.flow .lane1{fill:#fff;stroke:#cbd5e1}svg.flow .lanesep{stroke:#cbd5e1}
svg.flow .lanelabel{font-size:12.5px;font-weight:600;fill:#334155}svg.flow .act{fill:#fff;stroke:#1d4ed8;stroke-width:1.4}
svg.flow .act.gate{stroke:#b45309;stroke-width:2.6}svg.flow .aid{font-size:10.5px;fill:#64748b}svg.flow .aname{font-size:12.5px;fill:#0f172a}
svg.flow .edge{fill:none;stroke:#475569;stroke-width:1.3}svg.flow .join{fill:#475569}svg.flow .start{fill:#fff;stroke:#0f172a;stroke-width:1.5}
svg.flow .end{fill:#fff;stroke:#0f172a;stroke-width:1.5}svg.flow .endin{fill:#0f172a}svg.flow .trig{font-size:10.5px;fill:#b45309}
.dim{opacity:.22}svg .node.dim{opacity:.2}.hit{outline:3px solid #f59e0b;outline-offset:2px}
.rc-R{background:#dbeafe;font-weight:700}.rc-A{background:#fde68a;font-weight:700}.rc-C{background:#f1f5f9}.rc-I{color:var(--mute)}
details.more{margin:8px 0}details.more>summary{cursor:pointer;color:var(--acc)}tr.st-open-platform td:last-child{color:#b45309;font-weight:600}
@media print{.toolbar{display:none}details{display:block}}
"""

JS = """
const pick=document.getElementById('rolepick');
function apply(){const r=pick.value;document.querySelectorAll('[data-roles]').forEach(el=>{
 const has=!r||el.dataset.roles.split(' ').includes(r);el.classList.toggle('dim',!has);
 el.classList.toggle('hit',!!r&&has&&el.classList.contains('role-card'));});
 if(r){location.hash='role-'+r;} try{localStorage.setItem('ff-wf-role',r);}catch(e){} }
pick.addEventListener('change',apply);
try{const s=localStorage.getItem('ff-wf-role');if(s){pick.value=s;apply();}}catch(e){}
"""


def build(partial: bool = False, out: Path = OUT) -> Path:
    m = wm.load_model()
    rep = wm.validate(m, partial=partial)
    if rep.errors:
        raise SystemExit("모델 오류 — 먼저 scripts/wf_model.py로 확인:\n" + "\n".join(rep.errors))
    procs = [m["proc_by_id"][pl["id"]] for pl in m["plan"] if pl["id"] in m["proc_by_id"]]
    num = 6
    body = [section_overview(m), section_roles(m), section_gates(m), section_alignment(m, rep), section_sod(m)]
    for p in procs:
        body.append(section_process(m, p, num))
        num += 1
    body.append(section_role_procedures(m, num))
    body.append(section_coverage(m, rep, num + 1))
    meta = m["common"]["meta"]
    html = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(meta['title'])}</title><meta name="generator" content="docs/65-workflows/scripts/build_html.py"><style>{CSS}</style></head>
<body>{toolbar(m)}<main><h1>{E(meta['title'])} <small>{E(meta['title_en'])}</small></h1>
<p class="meta">생성물 — 손으로 고치지 않는다. 원본: model/*.yaml · 사실 소스: _source/*.json · 갱신 {E(str(meta['last_updated']))}</p>
{''.join(body)}</main><script>{JS}</script></body></html>"""
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return out


if __name__ == "__main__":
    path = build(partial="--partial" in sys.argv)
    print(f"→ {path} ({path.stat().st_size // 1024} KB)")
