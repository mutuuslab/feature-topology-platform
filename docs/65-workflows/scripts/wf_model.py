"""업무 절차 모델 로더·검증기·스윔레인 레이아웃.

단일 소스: model/common.yaml, model/processes/FPW.<n>.yaml
사실 소스: _source/guide_rules.json(표준 보고서), _source/platform_iam.json(/admin/iam)

사용: python -I scripts/wf_model.py [--partial]   → 문제가 없으면 OK
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import yaml

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "model"
SOURCE_DIR = ROOT / "_source"
TERMS = ROOT.parents[1] / "FF" / "harness" / "guide" / "harness" / "terms.json"
ID_REGISTRY = ROOT.parent / "_meta" / "id-registry.yaml"
REGISTRY_ID = re.compile(r"^[A-Z]+-[A-Z0-9-]+$")

BANNED = [re.compile(p, re.I) for p in (r"digital\s*twin", r"디지털\s*트윈", r"트윈", r"\btwin\b",
                                        r"은퇴")]   # 은퇴 → Retirement (플랫폼 용어, 사용자 결정 2026-10-18)
ACT_ID = re.compile(r"^FPW\.\d+-A\d{2}$")
WP_KEY = re.compile(r"^WP-[A-Z0-9-]+$")
COPY_RUN = 15          # 보고서 규칙 문장과 연속 일치를 허용하지 않는 어절 수
NAME_MAX = 24
TEXT_LISTS = ("steps", "checks", "content", "entry_criteria", "exit_criteria")


def _proc_key(path: Path) -> int:
    return int(path.stem.split(".")[1])


# ── 로드 ──────────────────────────────────────────────────────
def load_model(model_dir: Path = MODEL_DIR, source_dir: Path = SOURCE_DIR) -> dict:
    common = yaml.safe_load((model_dir / "common.yaml").read_text(encoding="utf-8"))
    guide = json.loads((source_dir / "guide_rules.json").read_text(encoding="utf-8"))
    iam = json.loads((source_dir / "platform_iam.json").read_text(encoding="utf-8"))
    procs = []
    for p in sorted((model_dir / "processes").glob("FPW.*.yaml"), key=_proc_key):
        try:
            procs.append(yaml.safe_load(p.read_text(encoding="utf-8"))["process"])
        except yaml.YAMLError as ex:
            raise SystemExit(f"{p.name}: YAML 문법 오류 — 따옴표로 시작하는 항목은 전체를 따옴표로 감싼다\n{ex}")
    m = {"common": common, "guide": guide, "iam": iam, "processes": procs}
    m["roles"] = common["roles"]
    m["roles_by_id"] = {r["id"]: r for r in common["roles"]}
    m["role_by_name"] = {r["name"]: r["id"] for r in common["roles"]}
    m["rule_by_id"] = {r["id"]: r for r in guide["rules"]}
    m["gate_by_id"] = {g["id"]: g for g in guide["gates"]}
    m["perm_by_name"] = {p["name"]: p for p in iam["permissions"]}
    m["iam_role_label"] = {r["role"]: r["label"] for r in iam["roles"]}
    m["screen_by_path"] = {s["path"]: s for s in iam["screens"]}
    m["plan"] = common["process_plan"]
    m["registry_ids"] = registry_ids(yaml.safe_load(ID_REGISTRY.read_text(encoding="utf-8"))) if ID_REGISTRY.exists() else set()
    m["proc_by_id"] = {p["id"]: p for p in procs}
    m["acts_by_id"] = {a["id"]: (p, a) for p in procs for a in p.get("activities", [])}
    wps: Dict[str, dict] = {}
    for p in procs:
        for wp in p.get("work_products", []):
            wps.setdefault(wp["key"], {**wp, "owner": p["id"]})
    m["wp_by_key"] = wps
    return m


def registry_ids(node) -> set:
    """id-registry.yaml 안의 모든 ID(딕셔너리 키·리스트 항목)."""
    found = set()
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(k, str) and REGISTRY_ID.match(k):
                found.add(k)
            found |= registry_ids(v)
    elif isinstance(node, list):
        for v in node:
            if isinstance(v, str) and REGISTRY_ID.match(v):
                found.add(v)
            else:
                found |= registry_ids(v)
    return found


def report_role_ids(m: dict, names: List[str]) -> List[str]:
    """보고서의 역할 이름(통제 어휘·Gate 승인 칸) → 카탈로그 역할 ID."""
    alias = m["common"].get("gate_approver_alias", {})
    return [alias.get(n) or m["role_by_name"].get(n) for n in names if alias.get(n) or m["role_by_name"].get(n)]


def platform_roles(m: dict, rid: str) -> List[str]:
    return m["roles_by_id"][rid]["platform_roles"]


def accounts_of(m: dict, rid: str) -> List[str]:
    """IAM 데모 계정 중 이 조직 역할의 플랫폼 역할을 하나라도 가진 계정."""
    mine = set(platform_roles(m, rid))
    return [acc for acc, roles in m["iam"]["accounts"].items() if mine & set(roles)]


def ra_roles(act: dict) -> set:
    """수행(R)·책임(A) 역할. A가 잘못 리스트로 적혀도 검증이 멈추지 않게 한다."""
    r = act["raci"]
    a = r.get("A")
    return {*r.get("R", []), *([a] if isinstance(a, str) else (a or []))}


def raci_roles(act: dict) -> List[str]:
    r = act["raci"]
    return [*r.get("R", []), r["A"], *r.get("C", []), *r.get("I", [])]


# ── 정합성: 보고서 ↔ IAM 자동 검출 ─────────────────────────────
def alignment_findings(m: dict) -> Dict[str, str]:
    """자동 검출한 보고서↔플랫폼 불일치. key → 설명. 각 key는 common.alignment 결정이 있어야 한다."""
    found: Dict[str, str] = {}
    perms = m["iam"]["permissions"]
    # (1) 보고서 Gate 승인자가 대응 플랫폼 Gate를 판정·승인할 IAM 권한이 없음
    judge = set(m["perm_by_name"]["judgeGate"]["roles"])
    for cw in m["common"]["gate_crosswalk"]:
        if not cw["platform"]:
            continue
        allowed = set(judge)
        for t in m["iam"]["transitions"]:
            if set(t["gates"]) & set(cw["platform"]) and not t["auto"]:
                allowed |= set(t["roles"])
        for name in cw.get("approval_actions", []):          # Gate 승인 수단으로 정한 route(예: G7 signRelease)
            if name in m["perm_by_name"]:
                allowed |= set(m["perm_by_name"][name]["roles"])
        for rid in report_role_ids(m, m["gate_by_id"][cw["report"]]["approvers"]):
            if not set(platform_roles(m, rid)) & allowed:
                found[f"gate-approval:{cw['report']}:{rid}"] = (
                    f"보고서 {cw['report']} 승인자 {m['roles_by_id'][rid]['name']}에게 플랫폼 {'/'.join(cw['platform'])} "
                    f"판정·승인 권한({', '.join(sorted(allowed))})이 없다")
    # (2) 라우트 요약이 조직 역할을 주체로 적었는데 그 역할의 IAM 권한이 아님
    names = {r["name"]: r["id"] for r in m["roles"] if r["source"] != "iam"}
    for p in perms:
        for name, rid in names.items():
            if name in p["summary"] and not set(platform_roles(m, rid)) & set(p["roles"]):
                found[f"perm:{p['name']}:{name}"] = (
                    f"라우트 {p['name']} 요약에 '{name}'이 나오나 허용 역할은 {', '.join(p['roles'])}")
    return found


# ── 검증 ──────────────────────────────────────────────────────
@dataclass
class Report:
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


def _texts(obj, path=""):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _texts(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _texts(v, f"{path}[{i}]")


def _copy_hit(text: str, rule_tokens: List[List[str]]) -> bool:
    toks = text.split()
    if len(toks) < COPY_RUN:
        return False
    grams = {tuple(toks[i:i + COPY_RUN]) for i in range(len(toks) - COPY_RUN + 1)}
    for rt in rule_tokens:
        if any(tuple(rt[i:i + COPY_RUN]) in grams for i in range(len(rt) - COPY_RUN + 1)):
            return True
    return False


ALIGNMENT_STATUSES = {"resolved-in-model", "resolved-in-platform", "open-platform", "open-report", "not-applicable"}


def validate(m: dict, partial: bool = False) -> Report:
    rep = Report()
    err, warn = rep.errors.append, rep.warnings.append
    soft = warn if partial else err      # 아직 작성하지 않은 프로세스 몫의 미커버
    roles = m["roles_by_id"]
    written = {p["id"] for p in m["processes"]}

    # 역할 카탈로그 ↔ IAM
    iam_roles = {r["role"] for r in m["iam"]["roles"]}
    human = {r["role"] for r in m["iam"]["roles"] if r["human"]}
    mapped = {pr for r in m["roles"] for pr in r["platform_roles"]}
    for r in m["roles"]:
        for pr in r["platform_roles"]:
            if pr not in iam_roles:
                err(f"{r['id']}: platform_roles {pr}이(가) IAM 역할에 없다")
    for pr in sorted(human - mapped):
        err(f"IAM 역할 {pr}({m['iam_role_label'][pr]})에 대응하는 조직 역할이 없다")
    for name in m["guide"]["role_vocab"]:
        if name not in m["role_by_name"]:
            err(f"보고서 역할 어휘 '{name}'이(가) 카탈로그에 없다")

    # docs ID 레지스트리: 생성 문서 ID(WF-*)가 등록되어 있어야 한다
    if not m["registry_ids"]:
        warn(f"ID 레지스트리를 읽지 못했다: {ID_REGISTRY}")
    else:
        for pl in m["plan"]:
            if "WF-FPW-" + pl["id"].split(".")[1] not in m["registry_ids"]:
                err(f"{pl['id']}: 문서 ID WF-FPW-{pl['id'].split('.')[1]}이(가) id-registry에 없다")
        for r in m["roles"]:
            if "WF-ROLE-" + r["id"].split("-", 1)[1] not in m["registry_ids"]:
                err(f"{r['id']}: 문서 ID WF-ROLE-{r['id'].split('-', 1)[1]}이(가) id-registry에 없다")

    # Gate 대응표
    cw_report = {c["report"] for c in m["common"]["gate_crosswalk"]}
    cw_platform = {g for c in m["common"]["gate_crosswalk"] for g in c["platform"]}
    for g in m["gate_by_id"]:
        if g not in cw_report:
            err(f"gate_crosswalk에 보고서 {g}가 없다")
    for g in m["iam"]["gates"]:
        if g["id"] not in cw_platform:
            err(f"gate_crosswalk에 플랫폼 {g['id']}({g['name']})가 없다")

    # 프로세스 계획
    plan_ids = [p["id"] for p in m["plan"]]
    for pid in written - set(plan_ids):
        err(f"{pid}: process_plan에 없다")
    for pid in plan_ids:
        if pid not in written:
            soft(f"{pid}: 프로세스 파일이 아직 없다")

    terms = json.loads(TERMS.read_text(encoding="utf-8"))["banned"] if TERMS.exists() else []
    if not TERMS.exists():
        warn(f"용어 규칙 파일이 없다: {TERMS}")
    rule_tokens = [r["rule"].split() for r in m["guide"]["rules"]]

    produced: Dict[str, List[str]] = {}
    consumed: Dict[str, List[str]] = {}
    for p in m["processes"]:
        pid = p["id"]
        for key in ("id", "name", "name_ko", "purpose_ko", "outcomes", "entry_criteria", "exit_criteria",
                    "work_products", "activities"):
            if key not in p:
                err(f"{pid}: 필수 키 {key} 없음")
        plan = next((x for x in m["plan"] if x["id"] == pid), None)
        if plan and plan["name_ko"] != p.get("name_ko"):
            err(f"{pid}: name_ko가 process_plan과 다르다 ({p.get('name_ko')} ≠ {plan['name_ko']})")
        outcome_ids = {o["id"] for o in p.get("outcomes", [])}
        for rid in p.get("related", []):
            if rid not in m["registry_ids"]:
                err(f"{pid}: related {rid}이(가) docs/_meta/id-registry.yaml에 없다")
        for wp in p.get("work_products", []):
            if not WP_KEY.match(wp["key"]):
                err(f"{pid}: WP 키 형식 {wp['key']}")
            if m["wp_by_key"][wp["key"]]["owner"] != pid:
                err(f"{pid}: {wp['key']}는 {m['wp_by_key'][wp['key']]['owner']}가 이미 정의했다")
            if wp.get("kind") not in ("output", "input"):
                err(f"{pid}: {wp['key']} kind는 output|input")
            if wp.get("kind") == "input" and not wp.get("from"):
                err(f"{pid}: 입력 WP {wp['key']}에 from이 없다")
        acts = p.get("activities", [])
        act_ids = {a["id"] for a in acts}
        covered_outcomes = set()
        for a in acts:
            aid = a["id"]
            if not ACT_ID.match(aid) or not aid.startswith(pid + "-"):
                err(f"{aid}: 활동 ID 형식은 {pid}-Ann")
            short = re.split(r"[(（]", a["name"])[0].strip()
            if len(short) > NAME_MAX:
                err(f"{aid}: 활동 이름 {len(short)}자 > {NAME_MAX}")
            raci = a.get("raci", {})
            if not isinstance(raci.get("A"), str):
                err(f"{aid}: RACI A는 정확히 1명")
            if not raci.get("R"):
                err(f"{aid}: RACI R이 없다")
            all_r = raci_roles(a) if isinstance(raci.get("A"), str) else []
            for rid in all_r:
                if rid not in roles:
                    err(f"{aid}: 알 수 없는 역할 {rid}")
            rci = [*raci.get("R", []), *raci.get("C", []), *raci.get("I", [])]
            if len(rci) != len(set(rci)) or raci.get("A") in [*raci.get("C", []), *raci.get("I", [])]:
                err(f"{aid}: 한 역할이 RACI에 중복(R=A만 허용)")
            for o in a.get("outcomes", []):
                if o not in outcome_ids:
                    err(f"{aid}: 알 수 없는 outcome {o}")
                covered_outcomes.add(o)
            for rid in a.get("rules", []):
                if rid not in m["rule_by_id"]:
                    err(f"{aid}: 보고서에 없는 규칙 {rid}")
            for n in a.get("next", []):
                if n not in act_ids:
                    err(f"{aid}: next {n}이(가) 같은 프로세스에 없다")
            for k in a.get("inputs", []):
                if k not in m["wp_by_key"]:
                    err(f"{aid}: 정의되지 않은 입력 {k}")
                consumed.setdefault(k, []).append(aid)
            for k in a.get("outputs", []):
                if k not in m["wp_by_key"]:
                    err(f"{aid}: 정의되지 않은 출력 {k}")
                elif m["wp_by_key"][k]["owner"] != pid or m["wp_by_key"][k]["kind"] != "output":
                    err(f"{aid}: {k}는 이 프로세스의 output WP가 아니다")
                produced.setdefault(k, []).append(aid)
            if not 3 <= len(a.get("steps", [])) <= 6:
                err(f"{aid}: steps는 3~6개")
            for s in a.get("steps", []):
                if isinstance(s, str) and not s.rstrip().endswith("다"):
                    err(f"{aid}: 절차 문장은 '~한다'로 끝난다: {s[:30]}")
            if not 1 <= len(a.get("checks", [])) <= 3:
                err(f"{aid}: checks는 1~3개")
            gd = a.get("gate_decision")
            if gd:
                if gd not in m["gate_by_id"]:
                    err(f"{aid}: gate_decision {gd}는 보고서 Gate가 아니다")
                elif gd not in p.get("gates", []):
                    err(f"{aid}: gate_decision {gd}가 프로세스 gates에 없다")
                else:
                    approvers = report_role_ids(m, m["gate_by_id"][gd]["approvers"])
                    if raci.get("A") not in approvers:
                        err(f"{aid}: {gd} 판정의 A({raci.get('A')})는 6.1절 승인자 {approvers} 중 하나여야 한다")
            plat = a.get("platform") or {}
            for act_name in plat.get("actions", []):
                perm = m["perm_by_name"].get(act_name)
                if not perm:
                    err(f"{aid}: IAM 권한표에 없는 action {act_name}")
                    continue
                r0 = raci["R"][0] if raci.get("R") else None
                if r0 in roles and not set(platform_roles(m, r0)) & set(perm["roles"]):
                    err(f"{aid}: R {r0}({roles[r0]['name']}, {platform_roles(m, r0)})은(는) {act_name} 권한이 없다 "
                        f"(허용: {', '.join(perm['roles'])})")
            for path in plat.get("screens", []):
                if path not in m["screen_by_path"]:
                    err(f"{aid}: 화면 {path}이(가) frontend routes에 없다")
            for g in plat.get("gates", []):
                if g not in {x["id"] for x in m["iam"]["gates"]}:
                    err(f"{aid}: 플랫폼 Gate {g} 없음")
            for other in a.get("independent_of", []):
                if other not in m["acts_by_id"]:
                    soft(f"{aid}: independent_of {other} 활동이 아직 없다")
                elif set(raci.get("R", [])) & set(m["acts_by_id"][other][1]["raci"]["R"]):
                    err(f"{aid}: 독립 활동의 R이 {other}의 R과 겹친다")
        reached = {n for a in acts for n in a.get("next", [])}
        for a in acts[1:]:
            if a["id"] not in reached and not a.get("trigger"):
                err(f"{a['id']}: 시작 경로가 없다 — 앞 활동의 next에 넣거나 trigger를 적는다")
        for o in outcome_ids - covered_outcomes:
            err(f"{pid}: outcome {o}을(를) 다루는 활동이 없다")
        for g in p.get("gates", []):
            if not any(a.get("gate_decision") == g for a in acts):
                err(f"{pid}: {g} 판정 활동(gate_decision)이 없다")
        for r in p.get("rules", []):
            if r not in m["rule_by_id"]:
                err(f"{pid}: 보고서에 없는 규칙 {r}")
            elif not any(r in a.get("rules", []) for a in acts):
                err(f"{pid}: 프로세스 규칙 {r}을(를) 이행하는 활동이 없다")
        # 텍스트 규칙
        for path, text in _texts(p, pid):
            for b in BANNED:
                if b.search(text):
                    err(f"{path}: 금지어 {b.pattern}")
            for t in terms:
                if t["term"] in text and not re.search(t["allow_context"], text):
                    err(f"{path}: 용어 규칙 '{t['term']}' — {t['why']}")
            if path.rsplit(".", 1)[-1].split("[")[0] in TEXT_LISTS and _copy_hit(text, rule_tokens):
                err(f"{path}: 보고서 규칙 문장을 {COPY_RUN}어절 이상 그대로 옮겼다")
        for key in TEXT_LISTS:
            for i, v in enumerate(p.get(key, [])):
                if not isinstance(v, str):
                    err(f"{pid}.{key}[{i}]: 문자열이 아니다(': '가 든 항목은 따옴표)")
        for a in acts:
            for key in ("steps", "checks"):
                for i, v in enumerate(a.get(key, [])):
                    if not isinstance(v, str):
                        err(f"{a['id']}.{key}[{i}]: 문자열이 아니다(': '가 든 항목은 따옴표)")

    for k, wp in m["wp_by_key"].items():
        if wp["kind"] == "output" and k not in produced:
            err(f"{k}: 생성 활동이 없다")
        if wp["kind"] == "output" and k not in consumed and not wp.get("retained"):
            soft(f"{k}: 사용 활동이 없다(보존 기록이면 retained: true)")
        if wp.get("retained") and k in consumed:
            warn(f"{k}: retained인데 사용 활동이 있다 — retained 표시를 뺀다")
        if wp["kind"] == "input" and k not in consumed:
            err(f"{k}: 입력 WP인데 사용 활동이 없다")

    # 커버리지: 역할이 지정된 보고서 규칙 → 그 역할이 R/A인 활동이 인용
    for rule in m["guide"]["rules"]:
        if not rule["roles"]:
            continue
        want = set(report_role_ids(m, rule["roles"]))
        ok = any(rule["id"] in a.get("rules", []) and want & ra_roles(a)
                 for _, a in m["acts_by_id"].values())
        if not ok:
            soft(f"{rule['id']}: 적용 역할({', '.join(rule['roles'])})이 R/A인 활동이 이 규칙을 이행하지 않는다")
    # 보고서 Gate 판정
    for g in m["gate_by_id"]:
        if not any(a.get("gate_decision") == g for _, a in m["acts_by_id"].values()):
            soft(f"보고서 {g}: 판정 활동이 없다")

    # 직무 분리
    for s in m["common"].get("sod", []):
        if s["id"] not in {x["id"] for x in m["iam"]["sod"]}:
            err(f"sod {s['id']}: IAM 직무 분리 규칙에 없다")
        a1, a2 = m["acts_by_id"].get(s["first"]), m["acts_by_id"].get(s["second"])
        if not a1 or not a2:
            soft(f"sod {s['id']}: 활동 {s['first']} 또는 {s['second']}이(가) 아직 없다")
            continue
        if s.get("level") == "person":
            if not (a2[1].get("platform") or {}).get("actions"):
                err(f"sod {s['id']}: 사람 수준 분리는 플랫폼이 강제해야 한다 — {s['second']}에 platform.actions가 없다")
        elif s.get("level") == "role":
            clash = set(a1[1]["raci"]["R"]) & ra_roles(a2[1])
            if clash:
                err(f"sod {s['id']}: {s['first']}의 R과 {s['second']}의 R/A가 겹친다 {sorted(clash)}")
        else:
            err(f"sod {s['id']}: level은 role|person")

    # 정합성 결정
    statuses = ALIGNMENT_STATUSES
    for cw in m["common"]["gate_crosswalk"]:
        for name in cw.get("approval_actions", []):
            if name not in m["perm_by_name"]:
                err(f"gate_crosswalk {cw['report']}: approval_actions {name}이(가) IAM 권한표에 없다")
    decided = {}
    for a in m["common"].get("alignment", []):
        if a.get("status") not in statuses:
            err(f"{a['id']}: status {a.get('status')}")
        decided[a["key"]] = a
    found = alignment_findings(m)
    for key, desc in found.items():
        if key not in decided:
            err(f"정합성 미결정 {key}: {desc}")
    for key, a in decided.items():
        detectable = key.split(":")[0] in ("gate-approval", "perm")
        if a.get("status") == "resolved-in-platform":
            if detectable and key in found:
                err(f"{a['id']}: 플랫폼에서 해소했다고 적었지만 아직 검출된다({key})")
        elif detectable and key not in found:
            warn(f"{a['id']}: 더 이상 검출되지 않는 불일치({key}) — 플랫폼에서 해소되었으면 status: resolved-in-platform")
    return rep


# ── 스윔레인 레이아웃 ─────────────────────────────────────────
LANE_LABEL_W = 132
COL_W = 280
ACT_W, ACT_H = 188, 66
ROW_H = 90
LANE_PAD = 16
NODE = 18
ORIGIN_X, ORIGIN_Y = 0, 0


@dataclass
class Box:
    id: str
    kind: str          # lane | action | start | end
    label: str
    x: float
    y: float
    w: float
    h: float
    extra: dict = field(default_factory=dict)


@dataclass
class Layout:
    pid: str
    lanes: List[Box]
    nodes: Dict[str, Box]
    edges: List[Tuple[str, str, str]]
    width: float
    height: float


def _is_trigger(acts: List[dict], aid: str) -> bool:
    act = next(a for a in acts if a["id"] == aid)
    return bool(act.get("trigger")) and aid != acts[0]["id"] and not any(
        aid in b.get("next", []) for b in acts if not b.get("trigger"))


def _levels(acts: List[dict]) -> Dict[str, int]:
    """열 = 진입점에서의 최장 경로. 트리거 전용 활동은 가장 이른 후속 활동 한 칸 앞."""
    preds: Dict[str, List[str]] = {a["id"]: [] for a in acts}
    for a in acts:
        for n in a.get("next", []):
            preds[n].append(a["id"])
    level: Dict[str, int] = {}

    def depth(aid: str, seen: frozenset) -> int:
        if aid in level:
            return level[aid]
        ps = [p for p in preds[aid] if p not in seen]     # 트리거 활동도 선행으로 센다(같은 열에 겹치지 않게)
        value = 0 if not ps else 1 + max(depth(p, seen | {aid}) for p in ps)
        level[aid] = value
        return value

    for a in acts:
        depth(a["id"], frozenset())
    for a in acts:                                       # 트리거 활동은 가장 이른 후속 활동 바로 앞 열로 당긴다
        if _is_trigger(acts, a["id"]):
            succ = [level[n] for n in a.get("next", [])]
            if succ:
                level[a["id"]] = max(level[a["id"]], min(succ) - 1)
    return level


def layout(m: dict, proc: dict) -> Layout:
    acts = proc["activities"]
    level = _levels(acts)
    first_x = ORIGIN_X + LANE_LABEL_W + NODE + 48
    ncols = 1 + max(level.values())
    lane_order: List[str] = []
    for a in acts:
        if a["raci"]["R"][0] not in lane_order:
            lane_order.append(a["raci"]["R"][0])
    width = first_x + ncols * COL_W + NODE + 30
    lanes: List[Box] = []
    nodes: Dict[str, Box] = {}
    y = ORIGIN_Y
    for rid in lane_order:
        cells: Dict[Tuple[int, int], bool] = {}
        rows = 0
        mine = [a for a in acts if a["raci"]["R"][0] == rid]
        for a in mine:
            row = 0
            while (level[a["id"]], row) in cells:
                row += 1
            cells[(level[a["id"]], row)] = True
            rows = max(rows, row + 1)
            nodes[a["id"]] = Box(a["id"], "action", a["name"], first_x + level[a["id"]] * COL_W,
                                 y + LANE_PAD + row * ROW_H, ACT_W, ACT_H,
                                 {"gate": a.get("gate_decision"), "trigger": a.get("trigger")})
        h = LANE_PAD * 2 + (rows - 1) * ROW_H + ACT_H
        lanes.append(Box(rid, "lane", m["roles_by_id"][rid]["name"], ORIGIN_X, y, width, h))
        y += h
    edges: List[Tuple[str, str, str]] = []
    entry = [acts[0]["id"]] + [a["id"] for a in acts if _is_trigger(acts, a["id"])]
    for i, aid in enumerate(entry):
        t = nodes[aid]
        sid = f"{proc['id']}-S{i + 1}"
        label = "시작" if i == 0 else (next(a for a in acts if a["id"] == aid).get("trigger") or "트리거")
        nodes[sid] = Box(sid, "start", label, t.x - NODE - 34, t.y + (t.h - NODE) / 2, NODE, NODE)
        edges.append((sid, aid, "start" if i == 0 else "trigger"))
    for a in acts:
        for n in a.get("next", []):
            edges.append((a["id"], n, "flow"))
    for i, a in enumerate([a for a in acts if not a.get("next")]):
        s = nodes[a["id"]]
        eid = f"{proc['id']}-E{i + 1}"
        nodes[eid] = Box(eid, "end", "종료", s.x + s.w + 14, s.y + (s.h - NODE) / 2, NODE, NODE)
        edges.append((a["id"], eid, "end"))
    return Layout(proc["id"], lanes, nodes, edges, width, y - ORIGIN_Y)


def route(lay: Layout, src: str, dst: str, slot: int = 0) -> List[Tuple[float, float]]:
    """직교 경로. 앞으로 가는 흐름은 대상 상자 왼쪽 틈의 한 줄기(같은 대상이면 합류)에서 꺾고,
    되돌아가는 흐름은 도식 아래로 돈다. 종료 원은 틈의 왼쪽(상자 바로 옆)에 있어 줄기와 겹치지 않는다."""
    a, b = lay.nodes[src], lay.nodes[dst]
    sx, sy = a.x + a.w, a.y + a.h / 2
    tx, ty = b.x, b.y + b.h / 2
    if abs(sy - ty) < 0.5 and tx >= sx:
        return [(sx, sy), (tx, ty)]
    if tx > sx + 8:
        gx = tx - 12
        return [(sx, sy), (gx, sy), (gx, ty), (tx, ty)]
    below = lay.height - 6 - slot * 6
    return [(sx, sy), (sx + 12, sy), (sx + 12, below), (tx - 14, below), (tx - 14, ty), (tx, ty)]


def main(argv: List[str]) -> int:
    partial = "--partial" in argv
    m = load_model()
    rep = validate(m, partial=partial)
    for w in rep.warnings:
        print("WARN ", w)
    for e in rep.errors:
        print("ERROR", e)
    if rep.errors:
        print(f"FAIL — 오류 {len(rep.errors)}, 경고 {len(rep.warnings)}")
        return 1
    print(f"OK — 프로세스 {len(m['processes'])}, 활동 {len(m['acts_by_id'])}, 경고 {len(rep.warnings)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
