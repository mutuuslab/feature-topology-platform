"""모델·사실 소스·검증기 테스트. 결함 주입으로 검증기가 실제로 잡는지 확인한다."""
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


def test_layout_has_no_overlap_or_crossing(model):
    for p in model["processes"]:
        lay = wm.layout(model, p)
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
