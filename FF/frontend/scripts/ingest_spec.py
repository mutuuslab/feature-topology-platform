#!/usr/bin/env python3
"""기능명세서 xlsx → src/data/spec.json 사전 변환.
사용: python scripts/ingest_spec.py "<xlsx 경로>"
기본 경로: C:\\Users\\TaehoKim\\Downloads\\Feature Flag 플랫폼_기능명세서_2026-06-01_2차revision.xlsx
"""
import json, os, re, sys
import openpyxl

DEFAULT = r"C:\Users\TaehoKim\Downloads\Feature Flag 플랫폼_기능명세서_2026-06-01_2차revision.xlsx"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "spec.json")

def cell(v):
    return "" if v is None else str(v).strip().replace("\n", " / ")

def family_of(fid: str) -> str:
    m = re.match(r"(FR-[A-Z]+)", fid or "")
    return m.group(1) if m else ""

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    wb = openpyxl.load_workbook(path, data_only=True)
    data = {"changeLog": [], "components": [], "glossary": [], "requirements": []}

    for ws in wb.worksheets:
        title = ws.title
        rows = [[cell(c) for c in r] for r in ws.iter_rows(values_only=True)]

        if title.startswith("Change Log"):
            for r in rows:
                vals = [x for x in r if x]
                if len(vals) >= 4 and re.match(r"\d", vals[0]) and vals[0] != "Version":
                    data["changeLog"].append({"version": vals[0], "date": (vals[1] or "")[:10],
                                              "desc": vals[2], "author": vals[3] if len(vals) > 3 else ""})
        elif title.startswith("00"):
            cat = ""
            for r in rows:
                # 열: No | 구분 | 개발항목 | 컴포넌트 | 내용 | (owner)
                nz = [x for x in r]
                # find No. column (first numeric)
                if not r or not re.match(r"^\d+$", (r[0] if r else "") or "") and (len(r) > 1 and not re.match(r"^\d+$", r[1] or "")):
                    pass
                # robust: search row for a number + a component
                joined = [x for x in r if x]
                if not joined:
                    continue
                if joined[0] in ("No.",) or "개발 항목" in r:
                    continue
                # columns by position (B..) — after trimming leading empties handled by iter
                # Use known layout: [No, 구분, 개발항목, 컴포넌트, 내용, owner]
                vals = r
                no = next((v for v in vals if re.match(r"^\d+$", v or "")), "")
                if not no:
                    continue
                idx = vals.index(no)
                seg = vals[idx:idx+6] + [""] * 6
                _no, gubun, devItem, comp, content, owner = seg[0], seg[1], seg[2], seg[3], seg[4], seg[5]
                if gubun:
                    cat = gubun
                if comp:
                    data["components"].append({"no": _no, "category": cat or gubun, "devItem": devItem,
                                               "component": comp, "desc": content, "owner": owner})
        elif title.startswith("용어") or "용어" in title:
            for r in rows:
                vals = [x for x in r if x]
                if len(vals) >= 2 and vals[0] not in ("용어", "Term"):
                    data["glossary"].append({"term": vals[0], "def": vals[1]})
        else:
            # 기능 시트 01~06: 헤더에서 컬럼 인덱스 탐지(선두 빈 컬럼 변동 대응)
            col = {}
            for r in rows:
                if "요구사항 ID" in r:
                    for i, v in enumerate(r):
                        if v == "개발 항목": col["devItem"] = i
                        elif v == "컴포넌트": col["comp"] = i
                        elif v == "서브 컴포넌트": col["sub"] = i
                        elif v == "요구사항 ID": col["id"] = i
                        elif v == "요구사항 명": col["name"] = i
                        elif v == "상세 설명": col["desc"] = i
                        elif v == "구현 방식": col["impl"] = i
                        elif v == "적용 영역": col["area"] = i
                        elif v == "비고": col["note"] = i
                    break
            if "id" not in col:
                continue
            def g(r, key):
                i = col.get(key, -1)
                return r[i] if 0 <= i < len(r) else ""
            devItem = comp = sub = ""
            for r in rows:
                if "요구사항 ID" in r:
                    continue
                a, b, c = g(r, "devItem"), g(r, "comp"), g(r, "sub")
                if a: devItem = a
                if b: comp = b
                if c: sub = c
                fid = g(r, "id")
                if not fid or not fid.startswith("FR-"):
                    continue
                data["requirements"].append({
                    "id": fid, "family": family_of(fid), "sheet": title,
                    "category": devItem, "component": comp, "sub": sub,
                    "name": g(r, "name"), "desc": g(r, "desc"), "impl": g(r, "impl"),
                    "area": g(r, "area"), "note": g(r, "note"),
                })

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    fams = sorted({r["family"] for r in data["requirements"]})
    print(f"OK → {os.path.normpath(OUT)}")
    print(f"  changeLog={len(data['changeLog'])} components={len(data['components'])} glossary={len(data['glossary'])} requirements={len(data['requirements'])}")
    print(f"  families({len(fams)}): {', '.join(fams)}")

if __name__ == "__main__":
    main()
