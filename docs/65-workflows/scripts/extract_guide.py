"""표준 보고서(FF_Safety_Guide_v2/guide_src) → _source/guide_rules.json 사실 스냅샷.

규칙 블록(### FFG-XXX-NNN, 6필드), 역할 통제 어휘(1.5절 표), Gate G1~G8 표(6.1절)를 추출한다.
업무 절차 모델은 이 스냅샷만 참조한다. 보고서가 바뀌면 다시 실행해 차이를 확인한다.

사용: python -I scripts/extract_guide.py [--guide <guide_src 경로>]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GUIDE = Path("C:/project/2026-09-23_FF_IMP/FF_Safety_Guide_v2/guide_src")
OUT = ROOT / "_source" / "guide_rules.json"

# 6.1절 Gate 표의 승인 칸에는 통제 어휘 밖의 이름도 나온다. 그대로 보존한다.
EXTRA_APPROVERS = ["Release Manager", "독립 검토자", "독립 V&V"]
RULE_HEAD = re.compile(r"^### (FFG-[A-Z]+-\d{3}) (.+)$")
FIELD = re.compile(r"^- (수준|적용|규칙|근거|검증|예제): (.*)$")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git_head(path: Path) -> str | None:
    try:
        out = subprocess.run(["git", "-C", str(path), "rev-parse", "HEAD"], capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def role_vocab(guide: Path) -> list[str]:
    for line in (guide / "01_overview.md").read_text(encoding="utf-8").splitlines():
        if line.startswith("| 역할·조직 |"):
            return [r.strip() for r in line.split("|")[2].split(",")]
    raise SystemExit("01_overview.md에서 역할·조직 어휘 행을 찾지 못했다")


def gates(guide: Path, vocab: list[str]) -> list[dict]:
    lines = (guide / "06_lifecycle.md").read_text(encoding="utf-8").splitlines()
    out = []
    for no, line in enumerate(lines, 1):
        m = re.match(r"^\| (G[1-8]) ([^|]+?) \|", line)
        if not m or out and out[-1]["id"] == m.group(1):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 7:      # 6.1절 본표만(7열). 6.4절 시나리오 표는 열 수가 다르다.
            continue
        names = [n.strip() for n in cells[6].split(",")]
        out.append({
            "id": m.group(1), "name": m.group(2).strip(), "purpose": cells[1], "platform": cells[2],
            "iso26262": cells[3], "sw_update": cells[4], "aspice": cells[5],
            "approvers": names, "approver_roles": [n for n in names if n in vocab or n in EXTRA_APPROVERS],
            "line": no,
        })
    if [g["id"] for g in out] != [f"G{i}" for i in range(1, 9)]:
        raise SystemExit(f"Gate 표 추출 실패: {[g['id'] for g in out]}")
    return out


def rules(guide: Path, vocab: list[str]) -> list[dict]:
    out = []
    for f in sorted(guide.glob("*.md")):
        lines = f.read_text(encoding="utf-8").splitlines()
        fenced = False                       # 코드 블록 안의 형식 예시(00_front.md)는 규칙이 아니다
        for i, line in enumerate(lines):
            if line.startswith("```"):
                fenced = not fenced
            m = None if fenced else RULE_HEAD.match(line)
            if not m:
                continue
            fields = {}
            for nxt in lines[i + 1:i + 8]:
                fm = FIELD.match(nxt)
                if fm:
                    fields[fm.group(1)] = fm.group(2).strip()
                elif nxt.strip():
                    break
            applies = fields.get("적용", "")
            out.append({
                "id": m.group(1), "title": m.group(2).strip(), "file": f.name, "line": i + 1,
                "level": fields.get("수준", ""), "applies": applies,
                "roles": [r for r in vocab if r in applies],
                "rule": fields.get("규칙", ""), "basis": fields.get("근거", ""), "verify": fields.get("검증", ""),
            })
    ids = [r["id"] for r in out]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        raise SystemExit(f"규칙 ID 중복: {dup}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--guide", type=Path, default=DEFAULT_GUIDE)
    args = ap.parse_args()
    guide = args.guide.resolve()
    vocab = role_vocab(guide)
    data = {
        "source": {"guide_src": str(guide), "git_head": git_head(guide),
                   "files": {f.name: sha256(f) for f in sorted(guide.glob("*.md"))}},
        "role_vocab": vocab,
        "gates": gates(guide, vocab),
        "rules": rules(guide, vocab),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    with_role = [r for r in data["rules"] if r["roles"]]
    print(f"rules={len(data['rules'])} with_role={len(with_role)} roles={len(vocab)} gates={len(data['gates'])} → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
