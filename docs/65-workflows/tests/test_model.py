"""모델·사실 소스·검증기 테스트. 결함 주입으로 검증기가 실제로 잡는지 확인한다."""
import pytest

import wf_model as wm


def errors(m, partial=True):
    return wm.validate(m, partial=partial).errors


def test_model_is_valid_in_strict_mode(model):
    rep = wm.validate(model, partial=False)
    assert rep.errors == [] and rep.warnings == []


def test_all_planned_processes_exist(model):
    assert [p["id"] for p in model["processes"]] == [pl["id"] for pl in model["plan"]]


def test_guide_snapshot_counts(model):
    rules = model["guide"]["rules"]
    assert len(rules) == 181                      # 00_front.md 형식 예시(코드 블록)는 제외
    assert sum(1 for r in rules if r["roles"]) == 62
    assert [g["id"] for g in model["guide"]["gates"]] == [f"G{i}" for i in range(1, 9)]
    assert len(model["guide"]["role_vocab"]) == 14


def test_iam_snapshot_shape(model):
    iam = model["iam"]
    assert iam["source"]["iam_url"].endswith("/admin/iam")
    assert {r["role"] for r in iam["roles"] if r["human"]}
    assert all(p["roles"] for p in iam["permissions"])
    assert not any(s["path"].startswith("/twin") for s in iam["screens"])


def test_every_iam_human_role_is_mapped(model):
    mapped = {pr for r in model["roles"] for pr in r["platform_roles"]}
    human = {r["role"] for r in model["iam"]["roles"] if r["human"]}
    assert human <= mapped


def test_every_platform_action_is_permitted_for_its_executor(model):
    for _, a in model["acts_by_id"].values():
        for name in (a.get("platform") or {}).get("actions", []):
            allowed = set(model["perm_by_name"][name]["roles"])
            assert set(wm.platform_roles(model, a["raci"]["R"][0])) & allowed, (a["id"], name)


# ── 결함 주입 ────────────────────────────────────────────────
def test_detects_two_accountable(model):
    _, a = model["acts_by_id"]["FPW.1-A01"]
    a["raci"]["A"] = ["R-FO", "R-SM"]
    assert any("A는 정확히 1명" in e for e in errors(model))


def test_detects_action_without_permission(model):
    _, a = model["acts_by_id"]["FPW.8-A04"]          # 긴급 차단 요청 issueKill
    a["raci"]["R"] = ["R-REG"]                         # 법규 담당(REGULATORY_OWNER)은 issueKill 권한 없음
    assert any("issueKill 권한이 없다" in e for e in errors(model))


def test_detects_unknown_action_and_screen(model):
    _, a = model["acts_by_id"]["FPW.5-A05"]
    a["platform"] = {"actions": ["noSuchAction"], "screens": ["/no/such"]}
    errs = errors(model)
    assert any("noSuchAction" in e for e in errs) and any("/no/such" in e for e in errs)


def test_detects_role_level_sod_clash(model):
    _, a = model["acts_by_id"]["FPW.8-A05"]          # 차단 승인
    a["raci"]["R"] = ["R-OPS", "R-SM"]                 # 요청자(운영 조직)가 승인자에 들어감
    a["raci"]["C"] = []
    a["raci"]["I"] = ["R-QA"]
    assert any("SOD-08" in e for e in errors(model))


def test_person_level_sod_requires_platform_enforcement(model):
    _, a = model["acts_by_id"]["FPW.8-A09"]          # 복원 승인
    a["platform"] = {}
    assert any("SOD-09" in e for e in errors(model))


def test_detects_independence_violation(model):
    _, a = model["acts_by_id"]["FPW.5-A06"]          # G5 판정 — 시험 수행(R-TST)과 독립
    a["raci"]["R"] = ["R-TST"]
    assert any("독립 활동" in e for e in errors(model))


def test_detects_gate_decision_by_non_approver(model):
    _, a = model["acts_by_id"]["FPW.1-A05"]
    a["raci"]["A"] = "R-QA"                            # 6.1절 G1 승인자는 Feature Owner·Safety Manager
    a["raci"]["I"] = ["R-REQ", "R-PLM"]
    assert any("G1 판정의 A" in e for e in errors(model))


def test_uncovered_rule_is_error_in_strict_mode(model):
    # FFG-SEC-002(PKI 운영)를 이행하는 활동에서 규칙을 빼면 strict 게이트가 실패해야 한다
    for _, a in model["acts_by_id"].values():
        a["rules"] = [r for r in a.get("rules", []) if r != "FFG-SEC-002"]
    for p in model["processes"]:
        p["rules"] = [r for r in p.get("rules", []) if r != "FFG-SEC-002"]
    errs = errors(model, partial=False)
    assert any(e.startswith("FFG-SEC-002:") for e in errs)
    assert not any(e.startswith("FFG-SEC-002:") for e in errors(model, partial=True))   # 작성 중에는 경고


def test_unconsumed_output_is_error_unless_retained(model):
    wp = model["wp_by_key"]["WP-EOL-RECORD"]
    wp["retained"] = False
    assert any("WP-EOL-RECORD: 사용 활동이 없다" in e for e in errors(model, partial=False))


def test_undecided_alignment_is_error(model):
    model["common"]["alignment"] = [a for a in model["common"]["alignment"] if a["id"] != "ALN-05"]
    assert any("정합성 미결정 gate-approval:G4:R-ARC" in e for e in errors(model))


def test_unmapped_iam_role_is_error(model):
    model["roles_by_id"]["R-PO"]["platform_roles"] = []
    assert any("PRODUCT_APPROVER" in e for e in errors(model))


def test_banned_term_is_error(model):
    _, a = model["acts_by_id"]["FPW.8-A01"]
    a["steps"][0] = "디지털 트윈 화면에서 이상 징후를 확인한다"
    assert any("금지어" in e for e in errors(model))


def test_copied_rule_text_is_error(model):
    rule = model["rule_by_id"]["FFG-PLT-005"]["rule"]
    _, a = model["acts_by_id"]["FPW.8-A05"]
    a["checks"][0] = rule
    assert any("그대로 옮겼다" in e for e in errors(model))


@pytest.mark.parametrize("by", ["role", "department"])
def test_layout_has_no_overlap_or_crossing(model, by):
    for p in model["processes"]:
        lay = wm.layout(model, p, by)
        acts = [n for n in lay.nodes.values() if n.kind == "action"]
        blockers = list(lay.nodes.values())          # 활동 상자와 시작·종료 원 모두 — 선이 지나가면 안 된다
        for i, a in enumerate(acts):
            for b in acts[i + 1:]:
                assert not (a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h), (a.id, b.id)
        for s, d, _ in lay.edges:
            pts = wm.route(lay, s, d)
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                for b in blockers:
                    if b.id in (s, d):
                        continue
                    # 시작·종료 원 곁을 바짝 지나가면 그 원으로 이어진 선처럼 읽힌다 → 원 주변 여유를 둔다
                    pad = CIRCLE_CLEARANCE if b.kind in ("start", "end") else 0
                    assert not (min(x1, x2) < b.x + b.w + pad and max(x1, x2) > b.x - pad
                                and min(y1, y2) < b.y + b.h + pad and max(y1, y2) > b.y - pad), (p["id"], s, d, b.id)


CIRCLE_CLEARANCE = 14


def test_end_stub_is_longer_than_arrowhead(model):
    for p in model["processes"]:
        lay = wm.layout(model, p)
        for s, d, kind in lay.edges:
            if kind == "end":
                (x1, _), (x2, _) = wm.route(lay, s, d)[:2]
                assert x2 - x1 >= 12, (p["id"], s)


def test_every_activity_is_reachable(model):
    a = model["acts_by_id"]["FPW.12-A02"][1]
    a.pop("trigger", None)
    assert any("FPW.12-A02: 시작" in e for e in errors(model))


def test_retirement_korean_term_is_banned(model):
    _, a = model["acts_by_id"]["FPW.9-A02"]
    a["steps"][0] = "만료 알림을 받은 Flag의 은퇴를 정한다"
    assert any("은퇴" in e and "금지어" in e for e in errors(model))


def test_resolved_in_platform_must_not_be_detected_anymore(model):
    aln = next(a for a in model["common"]["alignment"] if a["id"] == "ALN-05")   # G4 아키텍트 — 여전히 검출됨
    aln["status"] = "resolved-in-platform"
    assert any("ALN-05: 플랫폼에서 해소했다고 적었지만" in e for e in errors(model))


# ── 부서 ──────────────────────────────────────────────────────
def test_every_role_belongs_to_exactly_one_department(model):
    owners = [r for d in model["departments"] for r in d["roles"]]
    assert sorted(owners) == sorted(r["id"] for r in model["roles"])
    assert {d["workspace"] for d in model["departments"]} == set(wm.WORKSPACES)


def test_detects_role_without_department(model):
    model["common"]["departments"][0]["roles"].remove("R-FO")
    m = {**model, "departments": model["common"]["departments"]}
    assert any("R-FO" in e and "정확히 한 부서" in e for e in errors(m))


def test_detects_role_in_two_departments(model):
    model["departments"][1]["roles"].append("R-FO")
    assert any("R-FO" in e and "정확히 한 부서" in e for e in errors(model))


def test_detects_persona_outside_department(model):
    model["dept_by_id"]["DEP-OPS"]["personas"] = ["author"]      # Feature 작성 계정은 운영 역할을 맡지 않는다
    assert any("DEP-OPS" in e and "author" in e for e in errors(model))


def test_detects_unknown_workspace(model):
    model["dept_by_id"]["DEP-LEG"]["workspace"] = "lounge"
    assert any("DEP-LEG" in e and "workspace" in e for e in errors(model))


def test_kill_request_and_approval_are_in_different_departments(model):
    # 2026-11-04 결정: 차단 요청 = OTA·서비스운영, 2인 승인 = 기능안전 + 차량사이버보안
    _, req = model["acts_by_id"]["FPW.8-A04"]
    _, appr = model["acts_by_id"]["FPW.8-A05"]
    assert wm.lane_dept(model, req) == "DEP-OPS"
    assert {model["dept_of_role"][r] for r in appr["raci"]["R"]} == {"DEP-FS", "DEP-CS"}


def test_department_screens_split_primary_and_reference(model):
    s = wm.dept_screens(model, "DEP-OPS")
    assert s["primary"] and not set(s["primary"]) & set(s["reference"])
    assert all(wm.dept_screens(model, d["id"])["primary"] or wm.dept_screens(model, d["id"])["reference"]
               for d in model["departments"])


def test_handoffs_consider_every_performing_department(model):
    # FPW.8-A04(운영) → A05(기능안전 + 차량사이버보안 공동 수행): 두 부서 모두 받는 인계가 있어야 한다
    out = wm.dept_handoffs(model, "DEP-OPS")["out"]
    assert ("FPW.8-A04", "FPW.8-A05", "DEP-FS") in out and ("FPW.8-A04", "FPW.8-A05", "DEP-CS") in out
    assert ("FPW.8-A04", "FPW.8-A05", "DEP-OPS") in wm.dept_handoffs(model, "DEP-CS")["in"]
    for d in model["departments"]:                              # 자기 부서로의 인계는 없다
        h = wm.dept_handoffs(model, d["id"])
        assert all(o != d["id"] for k in ("in", "out") for _, _, o in h[k])


def test_request_owner_cannot_own_approval(model):
    # 2026-11-04 결정: Retirement 요청 책임(Feature Owner)이 승인 책임이던 결함을 되살리면 잡는다
    _, appr = model["acts_by_id"]["FPW.9-A03"]
    appr["raci"]["A"] = "R-FO"
    assert any("FPW.9-A02→FPW.9-A03" in e for e in errors(model))


def test_tara_is_owned_by_cybersecurity(model):
    _, tara = model["acts_by_id"]["FPW.2-A06"]
    assert tara["raci"]["R"] == ["R-CSM"] and tara["raci"]["A"] == "R-CSM"
    _, hara = model["acts_by_id"]["FPW.2-A02"]
    assert hara["raci"]["A"] == "R-SM" and "R-CSM" in hara["raci"]["C"]


# ── Feature DB (30-95, 2026-11-04) ─────────────────────────────
def test_feature_db_roles_belong_to_expected_departments(model):
    assert model["roles_by_id"]["R-RDA"]["platform_roles"] == ["REFDB_ADMIN"]
    assert model["roles_by_id"]["R-DRV"]["platform_roles"] == ["DOMAIN_REVIEWER"]
    assert model["dept_of_role"]["R-RDA"] == "DEP-PLM"
    assert model["dept_of_role"]["R-DRV"] == "DEP-SE"


def test_feature_db_operation_process_exists(model):
    plan = next(pl for pl in model["plan"] if pl["id"] == "FPW.14")
    assert plan["group"] == "지원" and plan["name_ko"] == "Feature DB 운영"
    p = next(p for p in model["processes"] if p["id"] == "FPW.14")
    actions = {n: a["raci"]["R"][0] for a in p["activities"] for n in (a.get("platform") or {}).get("actions", [])}
    assert actions == {"createRefChange": "R-FO", "reviewRefChange": "R-DRV",
                       "decideRefChange": "R-RDA", "publishRefRelease": "R-RDA",
                       "recordSourceReview": "R-RDA"}                   # 출처 정기 점검 기록(다음 점검일 갱신)
    assert model["acts_by_id"]["FPW.14-A05"][1].get("trigger")          # 정기 출처 점검은 사건(점검일)으로 시작


def test_feature_registration_links_reference_and_blocks_pending(model):
    _, reg = model["acts_by_id"]["FPW.1-A01"]
    assert "WP-REF-LINK" in reg["outputs"] and "WP-REFDB-RELEASE" in reg["inputs"]
    _, add = model["acts_by_id"]["FPW.1-A06"]
    assert add.get("trigger") and add["platform"]["actions"] == ["requestRefAdd"] and not add.get("next")
    _, approve = model["acts_by_id"]["FPW.3-A04"]                           # 정의 승인 — 요청 중 행 확인
    assert "WP-REF-LINK" in approve["inputs"] and any("PENDING" in c for c in approve["checks"])


def test_feature_db_change_request_is_separated_from_approval(model):
    pairs = {(x["request"], x["approval"]) for x in model["common"]["request_approval"]}
    assert {("FPW.14-A01", "FPW.14-A03"), ("FPW.1-A06", "FPW.14-A03")} <= pairs
    _, appr = model["acts_by_id"]["FPW.14-A03"]
    appr["raci"]["A"] = "R-FO"                                               # 요청자(Feature Owner)가 승인 책임이 되면 잡는다
    appr["raci"]["I"] = []
    errs = errors(model)
    assert any("FPW.14-A01→FPW.14-A03" in e for e in errs)
    assert any("FPW.1-A06→FPW.14-A03" in e for e in errs)
