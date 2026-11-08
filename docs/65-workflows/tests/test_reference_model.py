"""Bad references must not become false outcome/evidence coverage."""
from copy import deepcopy
import pytest
from reference_model import evidence_rows, practice_problems, practices_json


@pytest.fixture
def process():
    return {
        'id': 'FPW.99',
        'outcomes': [{'id': 'O1'}, {'id': 'O2'}],
        'activities': [
            {'id': 'FPW.99-A01', 'outcomes': ['O1'], 'outputs': ['WP-PLAN']},
            {'id': 'FPW.99-A02', 'outcomes': ['O2'], 'outputs': ['WP-RESULT']},
        ],
        'base_practices': [
            {'id': 'FPW.99.BP1', 'name': '범위를 정한다', 'definition_ko': '요청 범위와 책임을 정하고 확인 가능한 계획을 남긴다.', 'notes': [], 'activity_ids': ['FPW.99-A01'], 'outcomes': ['O1'], 'evidence': [{'work_product': 'WP-PLAN', 'outcomes': ['O1']}]},
            {'id': 'FPW.99.BP2', 'name': '결과를 확인한다', 'definition_ko': '계획의 기준으로 실제 결과를 확인하고 미해결 사항과 책임을 기록한다.', 'notes': ['외부 입력은 결과 확인의 대체 근거로 세지 않는다.'], 'activity_ids': ['FPW.99-A02'], 'outcomes': ['O2'], 'evidence': [{'work_product': 'WP-RESULT', 'outcomes': ['O2']}]},
        ],
    }


def problems(p):
    return practice_problems(p, {'WP-PLAN', 'WP-RESULT', 'WP-EXTERNAL'})


def test_valid_definitions_and_explicit_evidence(process):
    assert problems(process) == []
    rows = evidence_rows(process)
    assert rows == [{'key': 'WP-PLAN', 'outcomes': ['O1'], 'practices': ['FPW.99.BP1']}, {'key': 'WP-RESULT', 'outcomes': ['O2'], 'practices': ['FPW.99.BP2']}]
    result = practices_json(process)
    assert result[1]['activityIds'] == ['FPW.99-A02']
    assert result[1]['notes'] == process['base_practices'][1]['notes']


@pytest.mark.parametrize('change,expected', [
    (lambda p: p['base_practices'][1].update(id='FPW.99.BP1'), 'BP ID 중복'),
    (lambda p: p['base_practices'][0].update(activity_ids=['FPW.1-A01']), '이 프로세스에 없는 활동'),
    (lambda p: p['base_practices'][0].update(outcomes=['O9']), '알려진 성과'),
    (lambda p: p['base_practices'][0]['evidence'][0].update(work_product='WP-MISSING'), '없는 산출물'),
    (lambda p: p['base_practices'][0]['evidence'][0].update(work_product='WP-EXTERNAL'), '산출하지 않는 근거'),
    (lambda p: p['base_practices'][0]['evidence'][0].update(outcomes=['O2']), 'BP 성과와 맞지 않는다'),
    (lambda p: p['base_practices'].pop(), 'BP에 연결되지 않은 기존 활동'),
    (lambda p: p['base_practices'][0].update(evidence=[]), '출력 근거가 없는 성과 O1'),
    (lambda p: p['base_practices'][0].update(definition_ko=p['base_practices'][0]['name']), '별개의 업무 정의'),
])
def test_rejects_false_coverage(process, change, expected):
    candidate = deepcopy(process)
    change(candidate)
    assert any(expected in e for e in problems(candidate))


def test_unrelated_outcome_is_not_added_to_evidence_matrix(process):
    process['base_practices'][0]['outcomes'].append('O2')
    rows = evidence_rows(process)
    assert rows[0]['outcomes'] == ['O1']
