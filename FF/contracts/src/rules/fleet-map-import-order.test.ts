// 회귀: access를 먼저 import해도 routes → fleet-map 평가가 깨지지 않는다(2cb567a — "HUMAN_ROLES is not iterable" 순환 import).
import { HUMAN_ROLES } from './access';
import { describe, expect, it } from 'vitest';
import { LOCATION_VIEW_ROLES } from './fleet-map';

describe('fleet-map import 순서', () => {
  it('access를 먼저 불러와도 위치 열람 역할은 사람 역할 전부 + SYSTEM', () => {
    expect([...LOCATION_VIEW_ROLES].sort()).toEqual([...HUMAN_ROLES, 'SYSTEM'].sort());
  });
});
