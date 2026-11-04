"""단일 게이트: 모델 검증 → IAM 스냅샷 신선도(오프라인) → (선택) /admin/iam 실시간 대조 → HTML·MD·JSON 생성 → pytest.

사용:
  python -I scripts/check.py            최종 게이트(모든 프로세스·규칙 커버리지 필수)
  python -I scripts/check.py --partial  작성 중(미작성 프로세스 몫은 경고)
  python -I scripts/check.py --live     실행 중인 플랫폼 IAM과 스냅샷을 대조(다르면 실패 → extract_platform.mjs 재실행)
  python -I scripts/check.py --ff <FF 폴더>  신선도 검사에 쓸 FF 폴더(기본: 이 저장소의 FF)
성공하면 마지막 줄에 ALL GATES PASS 를 출력한다.

신선도 검사는 서버 없이 돈다 — 스냅샷(_source/platform_iam.json)의 화면이 지금 routes.tsx와, 권한·직무 분리가
contracts/dist와 같은지 본다. 다르면 실패하고 extract_platform.mjs 재실행 명령을 알려 준다.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_model as wm  # noqa: E402
import build_html  # noqa: E402
import build_md  # noqa: E402
import build_json  # noqa: E402


def iam_shape(roles_doc: dict) -> dict:
    return {
        "permissions": {p["name"]: sorted(p["roles"]) for p in roles_doc["permissions"]},
        "human": sorted(r["role"] for r in roles_doc["roles"] if r["human"]),
        "sod": sorted(s["id"] for s in roles_doc["sod"]),
    }


# ── 오프라인 신선도 ─────────────────────────────────────────
FF_DIR = wm.ROOT.parents[1] / "FF"
# extract_platform.mjs와 같은 식 — 이전 주소(legacyTo)와 /twin·/_ 화면은 뺀다
SCREEN_RE = re.compile(r"\{ path: '([^']+)', element: (?!legacyTo)[^\n]*?title: '([^']+)', group: '([^']+)'")
DIST_DUMP = ("const c=require(process.argv[1]);process.stdout.write(JSON.stringify({"
             "permissions:c.permissions().map(p=>({name:p.name,roles:[...p.roles].sort()})),"
             "sod:(c.SOD_RULES||[]).map(s=>s.id)}))")


def routes_screens(routes_tsx: str) -> list:
    """routes.tsx의 화면 경로(스냅샷 screens와 같은 규칙)."""
    return [p for p, _t, _g in SCREEN_RE.findall(routes_tsx) if not p.startswith("/twin") and not p.startswith("/_")]


def contracts_facts(ff: Path) -> dict | None:
    """contracts/dist의 권한표·직무 분리 규칙. dist가 없으면 None(검사 생략)."""
    dist = ff / "contracts" / "dist" / "index.js"
    if not dist.exists():
        return None
    r = subprocess.run(["node", "-e", DIST_DUMP, str(dist)], capture_output=True, text=True, encoding="utf-8", timeout=120)
    if r.returncode:
        raise OSError(f"contracts/dist 읽기 실패: {r.stderr.strip()[-300:]}")
    return json.loads(r.stdout)


def freshness_diff(snap: dict, screens: list, facts: dict) -> list:
    """스냅샷 ↔ 지금 소스. 빈 목록이면 신선하다."""
    out = []
    have = {s["path"] for s in snap["screens"]}
    out += [f"화면 {p}: routes.tsx에 있는데 스냅샷에 없다" for p in screens if p not in have]
    out += [f"화면 {p}: 스냅샷에만 있다(routes.tsx에 없다)" for p in sorted(have - set(screens))]
    snap_perm = {p["name"]: sorted(p["roles"]) for p in snap["permissions"]}
    dist_perm = {p["name"]: sorted(p["roles"]) for p in facts["permissions"]}
    for name in sorted(set(snap_perm) | set(dist_perm)):
        a, b = snap_perm.get(name), dist_perm.get(name)
        if a is None:
            out.append(f"권한 {name}: contracts에 있는데 스냅샷에 없다")
        elif b is None:
            out.append(f"권한 {name}: 스냅샷에만 있다(contracts에 없다)")
        elif a != b:
            out.append(f"권한 {name}: 스냅샷 {a} ↔ contracts {b}")
    snap_sod, dist_sod = sorted(s["id"] for s in snap["sod"]), sorted(facts["sod"])
    if snap_sod != dist_sod:
        out.append(f"직무 분리: 스냅샷 {snap_sod} ↔ contracts {dist_sod}")
    return out


def extract_command(m: dict, ff: Path) -> str:
    url = m["iam"]["source"]["iam_url"].replace("/admin/iam", "")
    return f"node scripts/extract_platform.mjs --url {url} --ff {ff.as_posix()}   (FF 백엔드 실행 중, contracts dist 새로 빌드한 뒤)"


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
    ff = Path(argv[argv.index("--ff") + 1]).resolve() if "--ff" in argv else FF_DIR
    routes = ff / "frontend" / "src" / "routes.tsx"
    try:
        facts = contracts_facts(ff) if routes.exists() else None
    except OSError as ex:
        facts = None
        print(f"[2a] IAM 스냅샷 신선도: {ex}")
        failed.append("iam-stale")
    if facts is None:
        if "iam-stale" not in failed:
            print(f"[2a] IAM 스냅샷 신선도: 생략({ff}에 routes.tsx 또는 contracts/dist 없음)")
    else:
        stale = freshness_diff(m["iam"], routes_screens(routes.read_text(encoding="utf-8")), facts)
        print(f"[2a] IAM 스냅샷 신선도(오프라인): 차이 {len(stale)}")
        for d in stale:
            print("    STALE", d)
        if stale:
            print("    → 스냅샷을 다시 뽑는다:", extract_command(m, ff))
            failed.append("iam-stale")
    if "--live" in argv:
        try:
            diff = live_diff(m)
            print(f"[2b] /admin/iam 실시간 대조: 차이 {len(diff)}")
            for d in diff:
                print("    DIFF", d)
            if diff:
                failed.append("iam-live")
        except OSError as ex:
            print(f"[2b] /admin/iam 실시간 대조 실패(서버 미실행?): {ex}")
            failed.append("iam-live")
    else:
        print("[2b] /admin/iam 실시간 대조: 생략(--live)")
    if not failed:
        html = build_html.build(partial=partial)
        mds = build_md.build(partial=partial)
        js = build_json.build()
        print(f"[3] 생성: {html.name}, Markdown {len(mds)}개, {js.name}")
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
