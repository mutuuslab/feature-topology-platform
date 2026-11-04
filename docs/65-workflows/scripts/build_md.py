"""모델 → out/processes/FPW.<n>.md, out/roles/<R-ID>.md, out/departments/<DEP-ID>.md·README.md·raci.csv
(docs 프런트매터 + Mermaid). 손으로 고치지 않는다.

사용: python -I scripts/build_md.py [--partial]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import List

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_model as wm  # noqa: E402
from build_html import role_activities, rules_of_role  # noqa: E402

OUT = wm.ROOT / "out"
GEN = "<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->"


def doc_id(pid: str) -> str:
    return "WF-FPW-" + pid.split(".")[1]


def role_doc_id(rid: str) -> str:
    return "WF-ROLE-" + rid.split("-", 1)[1]


def front_matter(m, did: str, title: str, related: List[str]) -> str:
    meta = m["common"]["meta"]
    rel = "".join(f"\n    - {r}" for r in related) or " []"
    return f"""---
id: {did}
type: workflow
title: "{title}"
status: draft
version: {meta['version']}
owner: {meta['owner']}
cycle: 0
traces:
  depends_on:{rel}
last_updated: {meta['last_updated']}
---
{GEN}
"""


def cell(text: str) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def natural_key(text: str):
    """WF-FPW-2가 WF-FPW-13보다 앞에 오도록 숫자는 숫자로 비교한다."""
    return [(0, int(t), "") if t.isdigit() else (1, 0, t) for t in re.split(r"(\d+)", text)]


def act_name(a) -> str:
    """활동 이름 + 판정 표기. 이름에 이미 Gx가 있으면 덧붙이지 않는다('G7 출시·활성화 판정 (G7 판정)' 중복 방지)."""
    gd = a.get("gate_decision")
    return a["name"] + (f" ({gd} 판정)" if gd and gd not in a["name"] else "")


def mermaid(m, p) -> str:
    lanes: List[str] = []
    for a in p["activities"]:
        if a["raci"]["R"][0] not in lanes:
            lanes.append(a["raci"]["R"][0])
    out = ["```mermaid", "flowchart LR"]
    for rid in lanes:
        out.append(f'  subgraph {rid.replace("-", "_")}["{m["roles_by_id"][rid]["name"]}"]')
        for a in p["activities"]:
            if a["raci"]["R"][0] == rid:
                nid = a["id"].replace(".", "_").replace("-", "_")
                gd = a.get("gate_decision")
                label = f'{a["id"].split("-")[1]} {a["name"]}' + (f' · {gd} 판정' if gd and gd not in a["name"] else "")
                shape = f'{{{{"{label}"}}}}' if a.get("gate_decision") else f'["{label}"]'
                out.append(f"    {nid}{shape}")
        out.append("  end")
    for a in p["activities"]:
        src = a["id"].replace(".", "_").replace("-", "_")
        if a.get("trigger"):
            out.append(f'  T_{src}(("{a["trigger"]}")) -.-> {src}')
        for n in a.get("next", []):
            out.append(f'  {src} --> {n.replace(".", "_").replace("-", "_")}')
    out.append("```")
    return "\n".join(out)


def raci_txt(m, a) -> str:
    r = a["raci"]
    n = lambda xs: ", ".join(m["roles_by_id"][x]["name"] for x in xs)  # noqa: E731
    s = f"R {n(r['R'])} · A {m['roles_by_id'][r['A']]['name']}"
    if r.get("C"):
        s += f" · C {n(r['C'])}"
    if r.get("I"):
        s += f" · I {n(r['I'])}"
    return s


def process_md(m, p) -> str:
    cw = {c["report"]: c["platform"] for c in m["common"]["gate_crosswalk"]}
    related = [f"GATE-{g}" for rg in p.get("gates", []) for g in cw[rg]] + p.get("related", [])
    lines = [front_matter(m, doc_id(p["id"]), f"{p['name_ko']} / {p['name']}", related),
             f"# {doc_id(p['id'])} · {p['id']} {p['name_ko']} / {p['name']}", "",
             f"> {p['purpose_ko']}", "",
             f"보고서 Gate: {', '.join(p.get('gates', [])) or '–'} · 근거: {p.get('ref', '–')}", "",
             "## 1. 업무 흐름", "", mermaid(m, p), "",
             "## 2. 활동", "",
             "| ID | 활동 | RACI | 입력 | 출력 | 플랫폼 권한·화면 | 이행 규칙 |",
             "|---|---|---|---|---|---|---|"]
    for a in p["activities"]:
        plat = a.get("platform") or {}
        pl = ", ".join(f"`{x}`" for x in plat.get("actions", []) + plat.get("screens", [])) or "플랫폼 밖"
        lines.append(f"| {a['id']} | {cell(act_name(a))} | {cell(raci_txt(m, a))} | {', '.join(a.get('inputs', []))} | "
                     f"{', '.join(a.get('outputs', []))} | {pl} | {', '.join(a.get('rules', [])) or '–'} |")
    lines += ["", "### 수행 절차와 완료 기준", ""]
    for a in p["activities"]:
        lines.append(f"#### {a['id']} {a['name']}")
        if a.get("trigger"):
            lines.append(f"- 트리거: {a['trigger']}")
        lines += [f"{i}. {s}" for i, s in enumerate(a["steps"], 1)]
        lines += ["", "완료 기준:"] + [f"- [ ] {c}" for c in a["checks"]] + [""]
    lines += ["## 3. 산출물", "", "| 키 | 이름 | 종류 | 주요 내용 |", "|---|---|---|---|"]
    for wp in p["work_products"]:
        kind = "산출" if wp["kind"] == "output" else f"입력 ({wp.get('from', '')})"
        lines.append(f"| {wp['key']} | {cell(wp['name'])} | {cell(kind)} | {cell('; '.join(wp['content']))} |")
    lines += ["", "## 4. 진입·완료 기준", "", "**진입**"] + [f"- {x}" for x in p["entry_criteria"]]
    lines += ["", "**완료**"] + [f"- {x}" for x in p["exit_criteria"]] + [""]
    lines += ["## 5. 결과(Outcome)", ""] + [f"- {o['id']} {o['text_ko']}" for o in p["outcomes"]] + [""]
    return "\n".join(lines)


def role_md(m, r) -> str:
    acts = role_activities(m, r["id"])
    plat = ", ".join(f"{x}({m['iam_role_label'][x]})" for x in r["platform_roles"]) or "없음(플랫폼 밖 업무)"
    related = sorted({doc_id(p["id"]) for p, _, _, _ in acts}, key=natural_key)
    lines = [front_matter(m, role_doc_id(r["id"]), f"{r['name']} 업무 절차서 / {r['en']} Procedure", related),
             f"# {role_doc_id(r['id'])} · {r['name']} 업무 절차서", "",
             f"> {r['desc']}", "",
             f"- IAM 역할: {plat}",
             f"- IAM 데모 계정: {', '.join(wm.accounts_of(m, r['id'])) or '–'}",
             f"- 매핑 근거: {r['basis']}", "",
             "## 1. 내가 하는 일 (수행 R · 책임 A)", ""]
    do = [x for x in acts if x[2] in ("R", "A")]
    if not do:
        lines.append("작성된 프로세스에 수행 활동이 아직 없다.")
    for p, a, kind, is_a in do:
        role = "수행·책임" if kind == "R" and is_a else "수행" if kind == "R" else "책임(승인)"
        plat_a = a.get("platform") or {}
        lines += [f"### {a['id']} {a['name']} — {role}" + (f" · {a['gate_decision']} 판정" if a.get("gate_decision") and a["gate_decision"] not in a["name"] else ""),
                  f"- 프로세스: {p['id']} {p['name_ko']}",
                  f"- 시작: {a.get('trigger') or '앞 활동 완료'}",
                  f"- 입력: {', '.join(a.get('inputs', [])) or '–'} → 출력: {', '.join(a.get('outputs', [])) or '–'}",
                  f"- 플랫폼: {', '.join('`' + x + '`' for x in plat_a.get('actions', []) + plat_a.get('screens', [])) or '플랫폼 밖'}"]
        lines += [f"{i}. {s}" for i, s in enumerate(a["steps"], 1)]
        lines += [f"- [ ] {c}" for c in a["checks"]] + [""]
    ci = [x for x in acts if x[2] in ("C", "I")]
    lines += ["## 2. 협의·통보 받는 활동", ""]
    lines += [f"- {a['id']} {a['name']} ({'협의' if k == 'C' else '통보'})" for _, a, k, _ in ci] or ["- 없음"]
    covered = {x for _, a in m["acts_by_id"].values() for x in a.get("rules", []) if r["id"] in wm.ra_roles(a)}
    lines += ["", "## 3. 보고서가 이 역할에 지정한 규칙", ""]
    lines += [f"- {x['id']} {x['title']} — {'이행 활동 있음' if x['id'] in covered else '작성 예정'}" for x in rules_of_role(m, r["id"])] or ["- 없음"]
    return "\n".join(lines) + "\n"


WORKSPACE_KO = {"studio": "기획 스튜디오", "review": "심사 결재함", "console": "엔지니어링 콘솔",
                "control": "관제실", "portal": "검토 포털"}


def dept_doc_id(did: str) -> str:
    return "WF-" + did


def dept_name(m, did: str) -> str:
    return m["dept_by_id"][did]["name"]


def raci_cells(m, did: str) -> dict:
    """프로세스별 부서 몫 개수 — {FPW.n: {"R": k, ...}}"""
    out: dict = {}
    for p, a, _ in wm.dept_activities(m, did):
        c = out.setdefault(p["id"], {k: 0 for k in wm.RACI_ORDER})
        for part in wm.dept_parts(m, did, a):
            c[part] += 1
    return out


def cell_txt(c: dict) -> str:
    return " ".join(f"{k}{c[k]}" for k in wm.RACI_ORDER if c.get(k)) or "–"


PART_KO = {"R": "수행", "A": "책임", "C": "협의", "I": "통보"}


def part_holders(m, did: str, a) -> str:
    """부서가 맡는 몫과 그 몫을 쥔 부서 역할 — 'R·A (상품 기획) · C (Feature Owner)'."""
    roles = m["dept_by_id"][did]["roles"]
    r = a["raci"]
    held = {"R": [x for x in r["R"] if x in roles], "A": [r["A"]] if r["A"] in roles else [],
            "C": [x for x in r.get("C", []) if x in roles], "I": [x for x in r.get("I", []) if x in roles]}
    groups: List[tuple] = []                     # [(역할 묶음, [몫…])] — 같은 역할 묶음이 쥔 몫은 합친다
    for k in wm.RACI_ORDER:
        if not held[k]:
            continue
        for g in groups:
            if g[0] == tuple(held[k]):
                g[1].append(k)
                break
        else:
            groups.append((tuple(held[k]), [k]))
    return " · ".join(f"{'·'.join(ks)} ({', '.join(m['roles_by_id'][x]['name'] for x in rs)})" for rs, ks in groups)


def wp_names(m, keys: List[str]) -> str:
    """산출물 이름 + `WP-ID`."""
    return ", ".join(f"{m['wp_by_key'][k]['name']} `{k}`" for k in keys) or "–"


def screens_txt(plat: dict, limit: int = 3) -> str:
    scr = plat.get("screens", [])
    if not scr:
        return "플랫폼 밖"
    return ", ".join(f"`{s}`" for s in scr[:limit]) + (f" 외 {len(scr) - limit}" if len(scr) > limit else "")


def first_ra(m, did: str) -> int:
    """1차 범위(핵심 생애주기)에서 부서가 수행·책임을 맡는 활동 수."""
    first = set(m["common"].get("department_scope", {}).get("first", []))
    return sum(1 for p, a, _ in wm.dept_activities(m, did)
               if p["id"] in first and {"R", "A"} & set(wm.dept_parts(m, did, a)))


def dept_md(m, d) -> str:
    did = d["id"]
    first = set(m["common"].get("department_scope", {}).get("first", []))
    scope = lambda pid: "1차" if pid in first else "2차 초안"  # noqa: E731
    acts = wm.dept_activities(m, did)
    roles = ", ".join(m["roles_by_id"][r]["name"] for r in d["roles"])
    related = sorted({doc_id(p["id"]) for p, _, _ in acts}, key=natural_key) + [role_doc_id(r) for r in d["roles"]]
    lines = [front_matter(m, dept_doc_id(did), f"{d['name']} R&R / {d['en']} Roles & Responsibilities", related),
             f"# {dept_doc_id(did)} · {d['name']} R&R", ""]
    if not first_ra(m, did):
        lines += ["> 1차 범위(핵심 생애주기)에서 수행·책임 업무가 없다 — 2차 초안 업무만 있다.", ""]
    lines += [f"> {' '.join(d['desc'].split())}", "",
              f"- 맡는 조직 역할: {roles}",
              f"- 화면 유형: {WORKSPACE_KO[d['workspace']]}",
              f"- 데모 계정: {', '.join(d['personas'])} (첫 번째가 기본)",
              "- 부서는 OEM 조직 가정안이다. 고객사 조직이 정해지면 model/common.yaml departments만 바꾼다.", ""]
    count = {k: 0 for k in wm.RACI_ORDER}
    for _, a, _ in acts:
        for part in wm.dept_parts(m, did, a):
            count[part] += 1
    lines += ["## 1. 업무 (활동당 한 줄)", "",
              " · ".join(f"{PART_KO[k]} {count[k]}" for k in wm.RACI_ORDER) + f" (활동 {len(acts)}개)", ""]
    if acts:
        lines += ["| 활동 | 프로세스 | 몫 | 입력 → 출력 | 플랫폼 화면 | 범위 |", "|---|---|---|---|---|---|"]
        for p, a, _ in acts:
            io = f"{wp_names(m, a.get('inputs', []))} → {wp_names(m, a.get('outputs', []))}"
            lines.append(f"| {a['id']} {cell(act_name(a))} | {p['id']} {cell(p['name_ko'])} | {cell(part_holders(m, did, a))} | "
                         f"{cell(io)} | {screens_txt(a.get('platform') or {})} | {scope(p['id'])} |")
    else:
        lines.append("- 없음")
    lines.append("")
    hand = wm.dept_handoffs(m, did)
    lines += ["## 2. 부서 간 인계", "", "| 방향 | 보내는 활동 | 받는 활동 | 상대 부서 | 넘기는 산출물 | 범위 |",
              "|---|---|---|---|---|---|"]
    for k, lab in (("in", "받음"), ("out", "보냄")):
        for s, t, o in hand[k]:
            (ps, sa), (_, ta) = m["acts_by_id"][s], m["acts_by_id"][t]
            passed = [x for x in sa.get("outputs", []) if x in ta.get("inputs", [])]
            lines.append(f"| {lab} | {s} {cell(sa['name'])} | {t} {cell(ta['name'])} | {dept_name(m, o)} | "
                         f"{cell(wp_names(m, passed))} | {scope(ps['id'])} |")
    if not hand["in"] and not hand["out"]:
        empty = "인계 없음(부서 안에서 끝남)" if count["R"] or count["A"] else "인계 없음(협의·통보만)"
        lines.append(f"| – | – | – | {empty} | – | – |")
    scr = wm.dept_screens(m, did)
    lines += ["", "## 3. 쓰는 화면", "",
              f"- 주 업무 화면: {', '.join(f'`{s}`' for s in scr['primary']) or '없음'}",
              f"- 참조 화면(협의·통보): {', '.join(f'`{s}`' for s in scr['reference']) or '없음'}", ""]
    sod = [x for x in wm.dept_sod_overlaps(m) if x["department"] == did]
    if sod:
        lines += ["## 4. 부서 겸직 직무 분리", "",
                  "같은 부서 안에서도 아래 두 활동은 다른 사람이 해야 한다(플랫폼이 사람 단위로 막는다).", ""]
        lines += [f"- {x['sod']}: {x['first']} ↔ {x['second']} — {x['note']}" for x in sod] + [""]
    return "\n".join(lines)


def dept_index_md(m) -> str:
    scope = m["common"].get("department_scope", {})
    plans = [pl for pl in m["plan"] if pl["id"] in m["proc_by_id"]]
    lines = [front_matter(m, "WF-DEP-INDEX", "부서별 R&R — 부서×프로세스 RACI / Department RACI",
                          [dept_doc_id(d["id"]) for d in m["departments"]]),
             "# WF-DEP-INDEX · 부서별 R&R", "",
             f"> {scope.get('note', '')}", ""]
    lines += [f"- 참고: {x}" for x in scope.get("demo_notes", [])] + [""]
    lines += ["## 1. 부서", "",
              "1차 수행·책임 = 1차 범위(핵심 생애주기)에서 수행(R)·책임(A)을 맡는 활동 수. 0이면 2차 초안 업무만 있다.", "",
              "| 부서 | 맡는 역할 | 화면 유형 | 데모 계정 | 1차 수행·책임 |", "|---|---|---|---|---|"]
    for d in m["departments"]:
        n = first_ra(m, d["id"])
        lines.append(f"| [{d['name']}]({d['id']}.md) | {', '.join(m['roles_by_id'][r]['name'] for r in d['roles'])} | "
                     f"{WORKSPACE_KO[d['workspace']]} | {', '.join(d['personas'])} | {n or '0 (2차 초안만)'} |")
    head = " | ".join(pl["id"] + ("" if pl["id"] in scope.get("first", []) else "*") for pl in plans)
    lines += ["", "## 2. 부서×프로세스 RACI", "",
              "칸 = 그 부서가 맡는 활동 수(R 수행·A 책임·C 협의·I 통보). * = 2차 초안.",
              "부서가 한 활동에서 몫을 여럿 맡으면(예: 수행과 책임) 그 활동은 몫마다 한 번씩 센다 — 칸의 합이 활동 수보다 클 수 있다.", "",
              f"| 부서 | {head} |", "|---|" + "---|" * len(plans)]
    for d in m["departments"]:
        cells = raci_cells(m, d["id"])
        lines.append(f"| {d['name']} | " + " | ".join(cell_txt(cells.get(pl["id"], {})) for pl in plans) + " |")
    lines += ["", "## 3. 부서 겸직 직무 분리", ""]
    lines += [f"- {dept_name(m, x['department'])} · {x['sod']}: {x['first']} ↔ {x['second']} — {x['note']}"
              for x in wm.dept_sod_overlaps(m)] or ["- 없음"]
    return "\n".join(lines) + "\n"


def dept_csv(m) -> str:
    """부서×활동 RACI 표(Excel에서 연다). BOM 포함 UTF-8."""
    deps = m["departments"]
    rows = ["프로세스,활동 ID,활동," + ",".join(d["name"] for d in deps)]
    for pl in m["plan"]:
        p = m["proc_by_id"].get(pl["id"])
        for a in (p or {}).get("activities", []):
            vals = ["/".join(wm.dept_parts(m, d["id"], a)) for d in deps]
            name = '"' + a["name"].replace('"', '""') + '"'
            rows.append(",".join([p["id"], a["id"], name, *vals]))
    return "﻿" + "\n".join(rows) + "\n"


def build(partial: bool = False) -> List[Path]:
    m = wm.load_model()
    rep = wm.validate(m, partial=partial)
    if rep.errors:
        raise SystemExit("모델 오류 — 먼저 scripts/wf_model.py로 확인:\n" + "\n".join(rep.errors))
    written = []
    for sub in ("processes", "roles", "departments"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
        for old in (OUT / sub).glob("*.md"):
            old.unlink()
    for p in m["processes"]:
        path = OUT / "processes" / f"{p['id']}.md"
        path.write_text(process_md(m, p), encoding="utf-8")
        written.append(path)
    for r in m["roles"]:
        path = OUT / "roles" / f"{r['id']}.md"
        path.write_text(role_md(m, r), encoding="utf-8")
        written.append(path)
    for d in m["departments"]:
        path = OUT / "departments" / f"{d['id']}.md"
        path.write_text(dept_md(m, d), encoding="utf-8")
        written.append(path)
    if m["departments"]:
        for name, text in (("README.md", dept_index_md(m)), ("raci.csv", dept_csv(m))):
            path = OUT / "departments" / name
            path.write_text(text, encoding="utf-8", newline="\n")
            written.append(path)
    return written


if __name__ == "__main__":
    files = build(partial="--partial" in sys.argv)
    print(f"→ {len(files)}개 Markdown ({OUT})")
