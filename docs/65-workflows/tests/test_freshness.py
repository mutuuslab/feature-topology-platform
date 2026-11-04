"""IAM 스냅샷 오프라인 신선도(check.py [2a])와 Feature DB 운영 모델(FPW.14·SOD-13~15) 시험.

스냅샷이 routes.tsx·contracts보다 낡으면 절차 패널이 작업 화면에 안 뜨고(정확 일치) 권한 대조가 틀린 표로 돈다.
신선도 검사는 서버 없이 돈다 — 여기서는 합성 자료로 결함을 넣어 실제로 잡는지 본다.
"""
import copy

import pytest

import check
import wf_model as wm


def snap_facts(model):
    """스냅샷 자체에서 만든 '지금 소스' — 차이 0이어야 한다."""
    iam = model["iam"]
    screens = [s["path"] for s in iam["screens"]]
    facts = {"permissions": [{"name": p["name"], "roles": sorted(p["roles"])} for p in iam["permissions"]],
             "sod": [s["id"] for s in iam["sod"]]}
    return screens, facts


def test_routes_screen_regex_matches_extract_rules():
    src = "\n".join([
        "  { path: '/master/feature-db/:refId', element: named(x, 'A'), title: 'Feature DB 기준 행', group: 'master', parent: '/master/feature-db' },",
        "  { path: '/old', element: legacyTo('/new'), title: '옛 주소', group: 'master' },",
        "  { path: '/twin/demo', element: named(x, 'B'), title: '데모', group: 'demo' },",
        "  { path: '/_probe', element: named(x, 'C'), title: '점검', group: 'dev' },",
    ])
    assert check.routes_screens(src) == ["/master/feature-db/:refId"]


def test_fresh_snapshot_has_no_diff(model):
    screens, facts = snap_facts(model)
    assert check.freshness_diff(model["iam"], screens, facts) == []


def test_detects_new_route_screen(model):
    screens, facts = snap_facts(model)
    diff = check.freshness_diff(model["iam"], screens + ["/master/new-screen"], facts)
    assert diff == ["화면 /master/new-screen: routes.tsx에 있는데 스냅샷에 없다"]


def test_detects_removed_route_screen(model):
    screens, facts = snap_facts(model)
    gone = screens[0]
    assert any(gone in d and "스냅샷에만" in d for d in check.freshness_diff(model["iam"], screens[1:], facts))


def test_detects_new_permission_and_role_change(model):
    screens, facts = snap_facts(model)
    facts = copy.deepcopy(facts)
    facts["permissions"].append({"name": "recordSourceReviewX", "roles": ["REFDB_ADMIN"]})
    facts["permissions"][0]["roles"] = sorted({*facts["permissions"][0]["roles"], "NO_SUCH_ROLE"})
    diff = check.freshness_diff(model["iam"], screens, facts)
    assert any("recordSourceReviewX" in d and "스냅샷에 없다" in d for d in diff)
    assert any(facts["permissions"][0]["name"] in d and "↔ contracts" in d for d in diff)


def test_detects_new_sod_rule(model):
    screens, facts = snap_facts(model)
    facts = {**facts, "sod": [*facts["sod"], "SOD-99"]}
    assert any("직무 분리" in d for d in check.freshness_diff(model["iam"], screens, facts))


def test_real_routes_tsx_parses_feature_db_screens():
    routes = check.FF_DIR / "frontend" / "src" / "routes.tsx"
    if not routes.exists():
        pytest.skip("FF 폴더 없음")
    screens = check.routes_screens(routes.read_text(encoding="utf-8"))
    assert {"/feature/propose", "/master/feature-db", "/master/feature-db/:refId",
            "/master/feature-db/changes", "/master/feature-db/changes/:id"} <= set(screens)


# ── Feature DB 운영 모델 (④ C1·C3·C5) ─────────────────────────
def screens_of(model, aid):
    return (model["acts_by_id"][aid][1].get("platform") or {}).get("screens", [])


def test_fpw14_activities_point_at_their_work_screens(model):
    routes = check.FF_DIR / "frontend" / "src" / "routes.tsx"
    if not routes.exists():
        pytest.skip("FF 폴더 없음")
    real = set(check.routes_screens(routes.read_text(encoding="utf-8")))
    assert screens_of(model, "FPW.14-A01") == ["/master/feature-db/:refId"]       # 기준 행 상세의 변경 요청
    for aid in ("FPW.14-A02", "FPW.14-A03"):                                      # 요청 상세의 검토·판정
        assert "/master/feature-db/changes/:id" in screens_of(model, aid)
    assert "/master/feature-db/changes" in screens_of(model, "FPW.14-A04")         # 변경 요청함의 발행
    assert screens_of(model, "FPW.1-A06") == ["/feature/propose"]                  # 등록 화면의 추가 요청
    for p in model["processes"]:
        for a in p["activities"]:
            for s in screens_of(model, a["id"]):
                assert s in real, (a["id"], s)


def test_refdb_sod_is_person_level_and_covers_add_request(model):
    sod = {s["id"]: s for s in model["common"]["sod"]}
    for sid, second in (("SOD-13", "FPW.14-A03"), ("SOD-14", "FPW.14-A02")):
        assert sod[sid]["level"] == "person"
        assert wm.sod_firsts(sod[sid]) == ["FPW.14-A01", "FPW.1-A06"] and sod[sid]["second"] == second
    assert (sod["SOD-15"]["level"], sod["SOD-15"]["first"], sod["SOD-15"]["second"]) == ("person", "FPW.14-A02", "FPW.14-A03")


def test_rejection_is_finalised_at_publish_not_decision(model):
    a03 = " ".join(model["acts_by_id"]["FPW.14-A03"][1]["steps"])
    a04 = " ".join(model["acts_by_id"]["FPW.14-A04"][1]["steps"])
    assert "다음 발행 때" in a03 and "폐기와 사유를 남긴다" not in a03
    assert "폐기" in a04 and "알림" in a04


def test_list_first_role_clash_is_checked_for_every_first(model):
    s = next(x for x in model["common"]["sod"] if x["id"] == "SOD-01")
    s["first"] = ["FPW.1-A05", "FPW.1-A01"]                 # 두 번째 앞 활동만 겹치지 않는다 — 첫째가 겹친다
    errs = wm.validate(model, partial=True).errors
    assert any("SOD-01" in e and "FPW.1-A05의 R" in e for e in errs)


def test_list_first_missing_activity_is_reported(model):
    s = next(x for x in model["common"]["sod"] if x["id"] == "SOD-13")
    s["first"] = ["FPW.14-A01", "FPW.1-A99"]
    rep = wm.validate(model, partial=True)
    assert any("SOD-13" in w and "FPW.1-A99" in w for w in rep.warnings + rep.errors)


def test_department_sod_expands_list_first(model):
    rows = [x for x in wm.dept_sod_overlaps(model) if x["sod"] in ("SOD-13", "SOD-14")]
    assert all(isinstance(x["first"], str) for x in rows)
