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
    files = build_md.build(partial=True)
    assert len(files) == len(m["processes"]) + len(m["roles"])
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
