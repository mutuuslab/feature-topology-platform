"""업무 절차 모델 → out/workflows.json (Feature Platform이 읽는 데이터).

FF `tools/workflow-sync.ts`가 이 파일로 `contracts/src/generated/workflows.ts`를 만들고, FF 정합성 시험이
활동의 action·screen·역할을 실제 ROUTES와 대조한다. 스윔레인 좌표는 여기서 계산해 넣으므로 FF에는
레이아웃 코드가 없다. 같은 모델이면 같은 바이트가 나와야 한다(시각·경로 같은 실행마다 바뀌는 값 금지).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import List

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_model as wm  # noqa: E402
import build_html  # noqa: E402

OUT = wm.ROOT / "out" / "workflows.json"
SCHEMA = 1


def _r(v: float) -> float:
    return round(float(v), 1)


def _box(b: wm.Box) -> dict:
    return {"id": b.id, "kind": b.kind, "label": b.label, "x": _r(b.x), "y": _r(b.y), "w": _r(b.w), "h": _r(b.h)}


def layout_json(m: dict, proc: dict) -> dict:
    lay = wm.layout(m, proc)
    return {
        "width": _r(lay.width),
        "height": _r(lay.height),
        "lanes": [{"role": ln.id, "label": ln.label, "x": _r(ln.x), "y": _r(ln.y), "w": _r(ln.w), "h": _r(ln.h)} for ln in lay.lanes],
        "nodes": [_box(n) for n in lay.nodes.values()],
        "edges": [{"from": s, "to": d, "kind": k, "points": [[_r(x), _r(y)] for x, y in wm.route(lay, s, d)]} for s, d, k in lay.edges],
        "joins": [[_r(x), _r(y)] for x, y in build_html.junctions(lay)],
    }


def activity_json(a: dict) -> dict:
    r = a["raci"]
    plat = a.get("platform") or {}
    return {
        "id": a["id"],
        "name": a["name"],
        "trigger": a.get("trigger"),
        "gateDecision": a.get("gate_decision"),
        "independentOf": a.get("independent_of", []),
        "outcomes": a.get("outcomes", []),
        "rules": a.get("rules", []),
        "raci": {"R": r.get("R", []), "A": r["A"], "C": r.get("C", []), "I": r.get("I", [])},
        "inputs": a.get("inputs", []),
        "outputs": a.get("outputs", []),
        "steps": a.get("steps", []),
        "checks": a.get("checks", []),
        "platform": {
            "actions": plat.get("actions", []),
            "screens": plat.get("screens", []),
            "gates": plat.get("gates", []),
            "anchor": plat.get("anchor") or None,
            "ui": {"fields": (plat.get("ui") or {}).get("fields", []), "buttons": (plat.get("ui") or {}).get("buttons", [])},
        },
        "slaHours": a.get("sla_hours"),
        "next": a.get("next", []),
    }


def process_json(m: dict, p: dict, plan: dict) -> dict:
    return {
        "id": p["id"],
        "name": p["name_ko"],
        "en": p["name"],
        "group": plan["group"],
        "gates": p.get("gates", []),
        "ref": p.get("ref", ""),
        "purpose": " ".join(p.get("purpose_ko", "").split()),
        "outcomes": [{"id": o["id"], "text": o["text_ko"]} for o in p.get("outcomes", [])],
        "rules": p.get("rules", []),
        "entry": p.get("entry_criteria", []),
        "exit": p.get("exit_criteria", []),
        "workProducts": [{"key": w["key"], "name": w["name"], "en": w.get("en", ""), "kind": w["kind"],
                          "retained": bool(w.get("retained")), "content": w.get("content", [])} for w in p.get("work_products", [])],
        "activities": [activity_json(a) for a in p["activities"]],
        "layout": layout_json(m, p),
    }


def personas(m: dict) -> dict:
    """IAM 데모 계정(페르소나) → 조직 역할. 계정의 플랫폼 역할과 조직 역할의 platform_roles가 겹치면 그 역할을 맡는다."""
    out = {}
    for acc, roles in sorted(m["iam"]["accounts"].items()):
        out[acc] = [r["id"] for r in m["roles"] if set(r["platform_roles"]) & set(roles)]
    return out


def document(m: dict) -> dict:
    plan = {pl["id"]: pl for pl in m["plan"]}
    return {
        "schema": SCHEMA,
        "note": "docs/65-workflows/scripts/build_json.py가 모델(model/*.yaml)에서 만든다. 손으로 고치지 않는다.",
        "roles": [{"id": r["id"], "name": r["name"], "en": r.get("en", ""), "desc": r.get("desc", ""),
                   "platformRoles": r["platform_roles"]} for r in m["roles"]],
        "personas": personas(m),
        "gateCrosswalk": [{"report": g["report"], "platform": g.get("platform", []), "approvalActions": g.get("approval_actions", [])}
                          for g in m["common"]["gate_crosswalk"]],
        "processes": [process_json(m, p, plan[p["id"]]) for p in m["processes"]],
    }


def render(m: dict) -> str:
    return json.dumps(document(m), ensure_ascii=False, indent=1) + "\n"


def build() -> Path:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(render(wm.load_model()).encode("utf-8"))
    return OUT


def main(argv: List[str]) -> int:
    print(build())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
