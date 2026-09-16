"""정본 화면 · 상세 영역 표(screenAreas.ts) 생성기.

원천
  · C:\\project\\2026-07-12_FF_Requirement분석\\_scratch\\2026-09-13_산출물\\FP_UI_Menu_Map_v1_3.html
    의 window.FP_SCREEN_DESIGN (baseline FP-DETAILED-1.1 · MENU FP-UI-MENU-1.3)

산출
  · FF/frontend/src/data/screenAreas.ts — 30개 화면 × 186개 상세 영역의 ID·이름·성격·배치·canonicalObject

이 파일은 기준 데이터만 담는다. 화면 본문·동작은 제품 페이지가 소유한다.
사용:  python scripts/gen_screen_areas.py
"""
import json
import pathlib
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SPEC = pathlib.Path(r'C:\project\2026-07-12_FF_Requirement분석\_scratch\2026-09-13_산출물\FP_UI_Menu_Map_v1_3.html')
OUT = pathlib.Path(__file__).resolve().parents[1] / 'src' / 'data' / 'screenAreas.ts'


def load():
    html = SPEC.read_text(encoding='utf-8')
    i = html.index('window.FP_SCREEN_DESIGN')
    j = html.index('</script>', i)
    body = html[i:j]
    body = body[body.index('=') + 1:].strip()
    if body.endswith(';'):
        body = body[:-1]
    return json.loads(body)


def group_order(data):
    order = []
    for g in data['groups']:
        for s in g.get('screens', []):
            order.append(s if isinstance(s, str) else s['id'])
    return order


def q(s):
    return json.dumps(s, ensure_ascii=False)


def main():
    data = load()
    screens = data['screens']
    order = [s['id'] for s in screens]
    gorder = group_order(data)
    if gorder and gorder != order:
        print('WARN: group order != screens order')
        print('  groups:', gorder)
        print('  screens:', order)
    counts = data.get('counts', {})
    areas = sum(len(s['submenus']) for s in screens)
    print(f"screen={len(screens)} area={areas} specCounts={counts}")
    if counts.get('screens') and counts['screens'] != len(screens):
        print('WARN: screen count mismatch')
    if counts.get('submenus') and counts['submenus'] != areas:
        print('WARN: submenu count mismatch')

    out = []
    out.append('// 정본 화면 · 상세 영역 표 — AUTO-GENERATED. 직접 고치지 않는다.')
    out.append('//')
    out.append('// 생성기: FF/frontend/scripts/gen_screen_areas.py')
    out.append('// 원천: FP_UI_Menu_Map_v1_3.html 의 window.FP_SCREEN_DESIGN')
    out.append(f"// 기준: {data['baseline']} · {data['date']} · 화면 {len(screens)}개 · 상세 영역 {areas}개")
    out.append('//')
    out.append('// 이 표는 기준 패키지가 정의한 **화면 ID·화면 이름·상세 영역 ID·영역 이름·영역 성격**만 담는다.')
    out.append('// 영역의 작업 문장·인수 조건·요구사양 서술은 제품에 옮기지 않는다(제품 화면은 구현만 보여준다).')
    out.append('')
    out.append('export interface ScreenAreaCanon {')
    out.append('  /** 상세 영역 ID (예: UI02-S01) */')
    out.append('  id: string;')
    out.append('  /** 정본 상세 영역 이름 */')
    out.append('  name: string;')
    out.append('  /** 영역 성격 코드 (예: table · approval · graph) */')
    out.append('  type: string;')
    out.append('  /** 배치 이름 (예: 목록과 상세 패널) */')
    out.append('  layout: string;')
    out.append('  /** 영역이 다루는 정본 객체 */')
    out.append('  object: string;')
    out.append('}')
    out.append('')
    out.append('export interface ScreenCanon {')
    out.append('  /** 기준 화면 ID (UI01~UI30) */')
    out.append('  id: string;')
    out.append('  /** 정본 화면 이름 */')
    out.append('  name: string;')
    out.append('  /** 화면 종류 코드 */')
    out.append('  kind: string;')
    out.append('  /** 담당 역할 키 (SPEC_ROLES) */')
    out.append('  owner: string;')
    out.append('  /** 업무 그룹 ID (SPEC_GROUPS) */')
    out.append('  group: string;')
    out.append('  /** 대표 Plane */')
    out.append('  plane: string;')
    out.append('  /** Plane 소유 Core */')
    out.append('  planeCore: string;')
    out.append('  /** 필수 컬럼 — 목록 영역이 반드시 보여줘야 하는 열 */')
    out.append('  columns: string[];')
    out.append('  /** 업무 Lifecycle 상태 이름 */')
    out.append('  states: string[];')
    out.append('  /** 기본 상세 영역 ID */')
    out.append('  defaultArea: string;')
    out.append('  areas: ScreenAreaCanon[];')
    out.append('}')
    out.append('')
    out.append('export const SCREEN_CANON: ScreenCanon[] = [')
    for s in screens:
        subs = s['submenus']
        out.append('  {')
        out.append(f"    id: {q(s['id'])}, name: {q(s['name'])}, kind: {q(s.get('kind', ''))},")
        out.append(f"    owner: {q(s.get('owner', ''))}, group: {q(s.get('group', ''))},")
        out.append(f"    plane: {q(s.get('plane', ''))}, planeCore: {q(s.get('planeCore', ''))},")
        out.append(f"    columns: {q(s.get('columns', []))},")
        out.append(f"    states: {q(s.get('states', []))},")
        out.append(f"    defaultArea: {q(s.get('defaultSubmenu', subs[0]['id'] if subs else ''))},")
        out.append('    areas: [')
        for a in subs:
            out.append(f"      {{ id: {q(a['id'])}, name: {q(a['name'])}, type: {q(a.get('type', ''))}, "
                       f"layout: {q(a.get('layoutName', ''))}, object: {q(a.get('canonicalObject', ''))} }},")
        out.append('    ],')
        out.append('  },')
    out.append('];')
    out.append('')
    out.append('/** 화면 ID → 정본 화면 */')
    out.append('export const SCREEN_CANON_BY_ID: Record<string, ScreenCanon> =')
    out.append('  Object.fromEntries(SCREEN_CANON.map(s => [s.id, s]));')
    out.append('')
    out.append('/** 상세 영역 ID 전체 (정본 순서) */')
    out.append('export const SCREEN_AREA_IDS: string[] = SCREEN_CANON.flatMap(s => s.areas.map(a => a.id));')
    out.append('')
    out.append('/** 상세 영역 ID → 영역 + 소속 화면 */')
    out.append('export const SCREEN_AREA_BY_ID: Record<string, ScreenAreaCanon & { screenId: string }> =')
    out.append('  Object.fromEntries(')
    out.append('    SCREEN_CANON.flatMap(s => s.areas.map(a => [a.id, { ...a, screenId: s.id } as ScreenAreaCanon & { screenId: string }])),')
    out.append('  );')
    out.append('')
    out.append(f"/** 정본 상세 영역 총수 ({areas}) */")
    out.append(f"export const SCREEN_AREA_TOTAL = {areas};")
    out.append('')
    OUT.write_text('\n'.join(out), encoding='utf-8')
    print('wrote', OUT, OUT.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
