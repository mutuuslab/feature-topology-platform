"""모델 → out/processes/FPW.<n>.md, out/roles/<R-ID>.md (docs 프런트매터 + Mermaid). 손으로 고치지 않는다.

사용: python -I scripts/build_md.py [--partial]
"""
from __future__ import annotations

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
        name = a["name"] + (f" ({a['gate_decision']} 판정)" if a.get("gate_decision") else "")
        lines.append(f"| {a['id']} | {cell(name)} | {cell(raci_txt(m, a))} | {', '.join(a.get('inputs', []))} | "
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
    related = sorted({doc_id(p["id"]) for p, _, _, _ in acts})
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
        lines += [f"### {a['id']} {a['name']} — {role}" + (f" · {a['gate_decision']} 판정" if a.get("gate_decision") else ""),
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


def build(partial: bool = False) -> List[Path]:
    m = wm.load_model()
    rep = wm.validate(m, partial=partial)
    if rep.errors:
        raise SystemExit("모델 오류 — 먼저 scripts/wf_model.py로 확인:\n" + "\n".join(rep.errors))
    written = []
    for sub in ("processes", "roles"):
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
    return written


if __name__ == "__main__":
    files = build(partial="--partial" in sys.argv)
    print(f"→ {len(files)}개 Markdown ({OUT})")
