"""Reference definitions and explicit evidence traces; never infer approvals or completion."""
from __future__ import annotations

import re


def practice_problems(process: dict, work_product_keys: set[str]) -> list[str]:
    pid = process['id']
    outcomes = {o['id'] for o in process.get('outcomes', [])}
    activities = {a['id']: a for a in process.get('activities', [])}
    practices = process.get('base_practices', [])
    errors = []
    ids = set()
    used_activities = set()
    covered_outcomes = set()
    evidenced_outcomes = set()
    if not practices:
        return [f'{pid}: BP 정의가 없다']
    for bp in practices:
        bid = bp.get('id', '?')
        if not isinstance(bid, str) or not re.fullmatch(re.escape(pid) + r'\.BP[1-9][0-9]*', bid):
            errors.append(f'{pid}: BP ID 형식 오류 {bid}')
        if bid in ids:
            errors.append(f'{pid}: BP ID 중복 {bid}')
        ids.add(bid)
        definition = bp.get('definition_ko', '')
        if not bp.get('name') or not isinstance(definition, str) or not definition.strip() or definition.strip() == bp.get('name'):
            errors.append(f'{bid}: 이름과 별개의 업무 정의가 필요하다')
        notes = bp.get('notes', [])
        if not isinstance(notes, list) or any(not isinstance(n, str) or not n.strip() for n in notes):
            errors.append(f'{bid}: 참고는 빈 값 없는 문장 목록이어야 한다')
        bound = bp.get('activity_ids', [])
        if not isinstance(bound, list) or not bound:
            errors.append(f'{bid}: 연결 활동이 없다')
            bound = []
        unknown = set(bound) - activities.keys()
        if unknown:
            errors.append(f'{bid}: 이 프로세스에 없는 활동 {sorted(unknown)}')
        used_activities.update(bound)
        reached = bp.get('outcomes', [])
        if not isinstance(reached, list) or not reached or not set(reached) <= outcomes:
            errors.append(f'{bid}: 알려진 성과를 하나 이상 연결해야 한다')
            reached = []
        covered_outcomes.update(reached)
        for aid in set(bound) & activities.keys():
            if not set(activities[aid].get('outcomes', [])) <= set(reached):
                errors.append(f'{bid}: 활동 {aid}의 성과 연결이 BP에서 빠졌다')
        produced = {key for aid in set(bound) & activities.keys() for key in activities[aid].get('outputs', [])}
        evidence = bp.get('evidence', [])
        if not isinstance(evidence, list):
            errors.append(f'{bid}: 출력 근거는 목록이어야 한다')
            evidence = []
        seen_evidence = set()
        for item in evidence:
            key = item.get('work_product')
            links = item.get('outcomes', [])
            if key not in work_product_keys:
                errors.append(f'{bid}: 없는 산출물 {key}')
            elif key not in produced:
                errors.append(f'{bid}: 연결 활동이 산출하지 않는 근거 {key}')
            if not isinstance(links, list) or not links or not set(links) <= set(reached):
                errors.append(f'{bid}: 출력 근거 {key}의 성과가 BP 성과와 맞지 않는다')
            elif key in work_product_keys and key in produced:
                evidenced_outcomes.update(links)
            signature = (key, tuple(links))
            if signature in seen_evidence:
                errors.append(f'{bid}: 출력 근거 중복 {key}')
            seen_evidence.add(signature)
    for aid in sorted(activities.keys() - used_activities):
        errors.append(f'{pid}: BP에 연결되지 않은 기존 활동 {aid}')
    for oid in sorted(outcomes - covered_outcomes):
        errors.append(f'{pid}: BP가 다루지 않는 성과 {oid}')
    for oid in sorted(outcomes - evidenced_outcomes):
        errors.append(f'{pid}: 출력 근거가 없는 성과 {oid}')
    return errors


def reference_problems(model: dict) -> list[str]:
    """Legacy source remains readable; declaring the reference model enables full definition gates."""
    required = bool(model.get('common', {}).get('reference_model'))
    keys = {w['key'] for p in model['processes'] for w in p.get('work_products', [])}
    errors = [e for p in model['processes'] if required or 'base_practices' in p for e in practice_problems(p, keys)]
    contexts = model.get('common', {}).get('screen_context')
    if contexts is not None:
        screens = set(model.get('screen_by_path', {}))
        linked = {s for p in model['processes'] for a in p['activities'] for s in a.get('platform', {}).get('screens', [])}
        seen = set()
        for item in contexts:
            path = item.get('path')
            if path not in screens or path in seen or path in linked:
                errors.append(f'화면 범위: 없거나 중복·이미 활동에 연결된 공통 화면 {path}')
            if item.get('kind') not in ('navigation', 'cross_cutting') or not item.get('reason', '').strip():
                errors.append(f'화면 범위: {path}의 구분·근거가 없다')
            seen.add(path)
        for path in sorted(screens - linked - seen):
            errors.append(f'화면 범위: 업무 연결 또는 공통 UI 근거가 없는 화면 {path}')
    return errors


def practices_json(process: dict) -> list[dict]:
    return [{
        'id': bp['id'], 'name': bp['name'], 'definition': ' '.join(bp['definition_ko'].split()),
        'notes': list(bp.get('notes', [])), 'activityIds': list(bp.get('activity_ids', [])),
        'outcomes': list(bp.get('outcomes', [])),
        'evidence': [{'workProduct': e['work_product'], 'outcomes': list(e['outcomes'])} for e in bp.get('evidence', [])],
    } for bp in process.get('base_practices', [])]


def evidence_rows(process: dict) -> list[dict]:
    """Aggregate only explicit source links; do not multiply activity outputs by all outcomes."""
    rows = {}
    for bp in process.get('base_practices', []):
        for item in bp.get('evidence', []):
            row = rows.setdefault(item['work_product'], {'key': item['work_product'], 'outcomes': set(), 'practices': set()})
            row['outcomes'].update(item['outcomes'])
            row['practices'].add(bp['id'])
    return [{'key': r['key'], 'outcomes': sorted(r['outcomes']), 'practices': sorted(r['practices'])} for r in rows.values()]
