"""생성물 테스트: HTML 3초 원칙, 역할 필터, MD 프런트매터가 docs 규약을 만족하는지."""
import re

import yaml

import build_html
import build_md
import wf_model as wm

SCHEMA = wm.ROOT.parent / "_templates" / "frontmatter-schema.yaml"


def test_html_three_second_rule(tmp_path):
    out = build_html.build(partial=True, out=tmp_path / "index.html")
    html = out.read_text(encoding="utf-8")
    m = wm.load_model()
    for p in m["processes"]:
        sec = html[html.index(f'<section class="proc" id="{p["id"]}">'):]
        sec = sec[:sec.index("</section>")]
        # 리드 한 줄 → 흐름도 → 활동 카드 순서, 참고 자료는 접힘
        assert sec.index('class="lead"') < sec.index("<svg") < sec.index('class="card act-card"')
        assert "RACI 매트릭스</summary>" in sec and "보고서 규칙 근거" in sec
        for a in p["activities"]:
            assert f'id="{a["id"]}"' in sec


def test_html_role_filter_lists_every_role(tmp_path):
    html = build_html.build(partial=True, out=tmp_path / "index.html").read_text(encoding="utf-8")
    m = wm.load_model()
    for r in m["roles"]:
        assert f'<option value="{r["id"]}">' in html
        assert f'id="role-{r["id"]}"' in html


def test_markdown_front_matter_follows_docs_schema():
    schema = yaml.safe_load(SCHEMA.read_text(encoding="utf-8"))
    id_re = re.compile(schema["required_fields"]["id"]["pattern"])
    types = schema["required_fields"]["type"]["values"]
    owners = schema["required_fields"]["owner"]["values"]
    m = wm.load_model()
    files = [f for f in build_md.build(partial=True) if f.suffix == ".md"]
    # 프로세스·역할 문서 + 부서 문서와 부서 색인(README)
    assert len(files) == len(m["processes"]) + len(m["roles"]) + len(m["departments"]) + 1
    for f in files:
        text = f.read_text(encoding="utf-8")
        fm = yaml.safe_load(text.split("---")[1])
        assert id_re.match(fm["id"]), fm["id"]
        assert fm["type"] in types and fm["owner"] in owners
        assert fm["id"] in m["registry_ids"], f"{fm['id']} 미등록"
        for dep in fm["traces"]["depends_on"] or []:
            assert dep in m["registry_ids"], (f.name, dep)


def test_every_alignment_status_has_html_label():
    # 상태를 새로 추가하면 HTML 이름표도 있어야 한다(resolved-in-platform 누락으로 생성이 깨졌던 회귀)
    assert set(build_html.STATUS_KO) == wm.ALIGNMENT_STATUSES


def test_workflows_json_is_deterministic_and_complete(model):
    import json
    import build_json
    text = build_json.render(model)
    assert text == build_json.render(wm.load_model())          # 같은 모델 → 같은 바이트(FF 생성 모듈 --check가 기대)
    doc = json.loads(text)
    acts = [a["id"] for p in doc["processes"] for a in p["activities"]]
    assert sorted(acts) == sorted(model["acts_by_id"])
    for p in doc["processes"]:
        nodes = {n["id"] for n in p["layout"]["nodes"]}
        assert {a["id"] for a in p["activities"]} <= nodes
        assert all(e["from"] in nodes and e["to"] in nodes and len(e["points"]) >= 2 for e in p["layout"]["edges"])


def test_department_outputs_cover_every_department(tmp_path, model):
    import csv
    import io
    import json
    import build_json
    html = build_html.build(partial=True, out=tmp_path / "index.html").read_text(encoding="utf-8")
    assert 'id="by-department"' in html and 'class="dept-raci"' in html
    doc = json.loads(build_json.render(model))
    assert [d["id"] for d in doc["departments"]] == [d["id"] for d in model["departments"]]
    for d in model["departments"]:
        assert f'id="dep-{d["id"]}"' in html
    for p in doc["processes"]:
        lay = p["departmentLayout"]
        assert {ln["department"] for ln in lay["lanes"]} <= set(model["dept_by_id"])
        assert {a["id"] for a in p["activities"]} <= {n["id"] for n in lay["nodes"]}
    build_md.build(partial=True)
    rows = list(csv.reader(io.StringIO((build_md.OUT / "departments" / "raci.csv").read_text(encoding="utf-8-sig"))))
    assert rows[0][3:] == [d["name"] for d in model["departments"]]
    assert len(rows) - 1 == len(model["acts_by_id"])
    for row in rows[1:]:                                     # 모든 활동은 R을 맡는 부서가 있다
        assert any("R" in v.split("/") for v in row[3:]), row[:3]


def test_workflows_json_personas_follow_iam_accounts(model):
    import build_json
    per = build_json.personas(model)
    assert set(per) == set(model["iam"]["accounts"])
    assert "R-FO" in per["author"]                              # FEATURE_AUTHOR = Feature Owner
    assert "R-CSM" in per["integrator"]                         # SECURITY_OFFICER = 보안 담당
    assert all(per.values()), [a for a, r in per.items() if not r]


def _dept_docs(model):
    build_md.build(partial=True)
    return {d["id"]: (build_md.OUT / "departments" / f"{d['id']}.md").read_text(encoding="utf-8") for d in model["departments"]}


def test_department_md_lists_each_activity_once(model):
    # 2026-11-04: 몫(R/A/C/I)별 네 표 → 활동당 한 줄 표. 같은 활동이 몫마다 반복되던 것을 막는다.
    for did, text in _dept_docs(model).items():
        sec = text[text.index("## 1. 업무 (활동당 한 줄)"):text.index("## 2. 부서 간 인계")]
        rows = [ln.split(" ")[1] for ln in sec.splitlines() if ln.startswith("| FPW.")]
        want = [a["id"] for _, a, _ in wm.dept_activities(model, did)]
        assert rows == want, did
        if did == "DEP-OPS":
            assert "| R·A (운영 조직) |" in sec               # 몫과 그 몫을 쥔 역할


def test_department_md_has_no_duplicate_gate_label(model):
    # 'G7 출시·활성화 판정 (G7 판정)'처럼 이름에 이미 있는 Gate를 다시 붙이던 회귀
    _dept_docs(model)
    for f in (build_md.OUT / "departments").glob("*.md"):
        text = f.read_text(encoding="utf-8")
        assert not re.search(r"(G\d+)[^|\n]*\(\1 판정\)", text), f.name
    assert "G7 출시·활성화 판정 (G7 판정)" not in build_md.act_name(model["acts_by_id"]["FPW.7-A08"][1])


def test_department_md_handoff_includes_joint_performers(model):
    # 긴급 차단 2인 승인은 기능안전 + 차량사이버보안 공동 수행 — 첫 R 역할만 보면 CS가 받는 인계가 빠졌다
    text = _dept_docs(model)["DEP-CS"]
    sec = text[text.index("## 2. 부서 간 인계"):]
    row = next(ln for ln in sec.splitlines() if "FPW.8-A04" in ln and "FPW.8-A05" in ln)
    assert row.startswith("| 받음") and "OTA·서비스운영팀" in row and "`WP-KILL-REQ`" in row


def test_department_md_depends_on_is_natural_order(model):
    for did, text in _dept_docs(model).items():
        deps = yaml.safe_load(text.split("---")[1])["traces"]["depends_on"] or []
        procs = [int(x.rsplit("-", 1)[1]) for x in deps if x.startswith("WF-FPW-")]
        assert procs == sorted(procs), (did, deps)


def test_department_without_first_scope_work_is_flagged(model):
    docs = _dept_docs(model)
    readme = (build_md.OUT / "departments" / "README.md").read_text(encoding="utf-8")
    banner = "1차 범위(핵심 생애주기)에서 수행·책임 업무가 없다"
    for d in model["departments"]:
        n = build_md.first_ra(model, d["id"])
        assert (banner in docs[d["id"]]) == (n == 0), d["id"]
        row = next(ln for ln in readme.splitlines() if f"]({d['id']}.md)" in ln)
        assert row.rstrip(" |").endswith("0 (2차 초안만)" if n == 0 else str(n)), row
