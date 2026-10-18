"""단일 게이트: 모델 검증 → (선택) /admin/iam 실시간 대조 → HTML·MD 생성 → pytest.

사용:
  python -I scripts/check.py            최종 게이트(모든 프로세스·규칙 커버리지 필수)
  python -I scripts/check.py --partial  작성 중(미작성 프로세스 몫은 경고)
  python -I scripts/check.py --live     실행 중인 플랫폼 IAM과 스냅샷을 대조(다르면 실패 → extract_platform.mjs 재실행)
성공하면 마지막 줄에 ALL GATES PASS 를 출력한다.
"""
from __future__ import annotations

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_model as wm  # noqa: E402
import build_html  # noqa: E402
import build_md  # noqa: E402


def iam_shape(roles_doc: dict) -> dict:
    return {
        "permissions": {p["name"]: sorted(p["roles"]) for p in roles_doc["permissions"]},
        "human": sorted(r["role"] for r in roles_doc["roles"] if r["human"]),
        "sod": sorted(s["id"] for s in roles_doc["sod"]),
    }


def live_diff(m: dict) -> list:
    url = m["iam"]["source"]["iam_url"].replace("/admin/iam", "/api/iam/roles")
    with urllib.request.urlopen(url, timeout=5) as res:
        live = iam_shape(json.load(res))
    snap = iam_shape(m["iam"])
    out = []
    for name in sorted(set(live["permissions"]) | set(snap["permissions"])):
        a, b = snap["permissions"].get(name), live["permissions"].get(name)
        if a != b:
            out.append(f"권한 {name}: 스냅샷 {a} ↔ 실행 중 {b}")
    if live["human"] != snap["human"]:
        out.append(f"사람 역할: 스냅샷 {snap['human']} ↔ 실행 중 {live['human']}")
    if live["sod"] != snap["sod"]:
        out.append(f"직무 분리: 스냅샷 {snap['sod']} ↔ 실행 중 {live['sod']}")
    return out


def main(argv) -> int:
    partial = "--partial" in argv
    failed = []
    m = wm.load_model()
    rep = wm.validate(m, partial=partial)
    print(f"[1] 모델 검증: 오류 {len(rep.errors)}, 경고 {len(rep.warnings)}")
    for e in rep.errors:
        print("    ERROR", e)
    if rep.errors:
        failed.append("model")
    if "--live" in argv:
        try:
            diff = live_diff(m)
            print(f"[2] /admin/iam 실시간 대조: 차이 {len(diff)}")
            for d in diff:
                print("    DIFF", d)
            if diff:
                failed.append("iam-live")
        except OSError as ex:
            print(f"[2] /admin/iam 실시간 대조 실패(서버 미실행?): {ex}")
            failed.append("iam-live")
    else:
        print("[2] /admin/iam 실시간 대조: 생략(--live)")
    if not failed:
        html = build_html.build(partial=partial)
        mds = build_md.build(partial=partial)
        print(f"[3] 생성: {html.name}, Markdown {len(mds)}개")
    r = subprocess.run([sys.executable, "-I", "-m", "pytest", "-q", str(wm.ROOT / "tests"), "-p", "no:cacheprovider"],
                       cwd=wm.ROOT, capture_output=True, text=True)
    print(f"[4] pytest: {r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr.strip()[-300:]}")
    if r.returncode:
        print(r.stdout[-3000:])
        failed.append("pytest")
    if failed:
        print("GATE FAIL:", ", ".join(failed))
        return 1
    print("ALL GATES PASS" + (" (partial)" if partial else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
