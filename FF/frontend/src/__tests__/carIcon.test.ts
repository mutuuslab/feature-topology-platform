// 지도 자동차 아이콘 — 차체는 상태 색, 테두리는 면 색, 유리·바퀴는 어두운 색. 모든 상태 색 토큰마다 아이콘 이름이 하나씩 있다.
import { describe, expect, it } from 'vitest';
import { CAR_H, CAR_W, carIconName, drawCar } from '../screens/ops/carIcon';
import { ACTIVATION_VAR, CAR_STATE_VARS, HOLLOW_VAR, NO_RUNTIME_VAR, SUBSCRIPTION_VAR } from '../screens/ops/FleetMapCanvas';

/** 그리기 호출을 기록하는 가짜 2D 문맥 */
function fakeCtx() {
  const ops: { op: 'fill' | 'stroke'; color: string; alpha: number }[] = [];
  const ctx: any = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    clearRect: () => {},
    beginPath: () => {},
    roundRect: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    closePath: () => {},
    fill: () => ops.push({ op: 'fill', color: ctx.fillStyle, alpha: ctx.globalAlpha }),
    stroke: () => ops.push({ op: 'stroke', color: ctx.strokeStyle, alpha: ctx.globalAlpha }),
  };
  return { ctx, ops };
}

describe('지도 자동차 아이콘', () => {
  it('차체는 상태 색으로 채우고 면 색 테두리를 두른다, 유리·바퀴는 어두운 색', () => {
    const { ctx, ops } = fakeCtx();
    drawCar(ctx, { body: 'BODY', outline: 'OUTLINE', glass: 'GLASS' });
    expect(ops.filter((o) => o.op === 'fill' && o.color === 'BODY')).toHaveLength(1);
    expect(ops.filter((o) => o.op === 'stroke')).toEqual([{ op: 'stroke', color: 'OUTLINE', alpha: 1 }]);
    expect(ops.filter((o) => o.color === 'GLASS').length).toBe(6); // 바퀴 4 + 앞·뒷유리
    expect(ops.filter((o) => o.op === 'fill' && o.color === 'OUTLINE')).toHaveLength(2); // 전조등 — 앞쪽 표시
    expect(ctx.globalAlpha).toBe(1); // 유리 투명도를 되돌린다
  });

  it('속이 빈 차(권한 없음) — 차체는 면 색, 테두리·전조등이 상태 색이라 회색 두 상태를 모양으로 가른다', () => {
    const { ctx, ops } = fakeCtx();
    drawCar(ctx, { body: 'BODY', outline: 'OUTLINE', glass: 'GLASS', hollow: true });
    expect(ops.filter((o) => o.op === 'stroke')).toEqual([{ op: 'stroke', color: 'BODY', alpha: 1 }]);
    expect(ops.filter((o) => o.op === 'fill' && o.color === 'OUTLINE')).toHaveLength(1); // 차체
    expect(ops.filter((o) => o.op === 'fill' && o.color === 'BODY')).toHaveLength(2); // 전조등
  });

  it('세로로 긴 아이콘(앞=위) — 진행 방향 회전의 기준', () => {
    expect(CAR_H).toBeGreaterThan(CAR_W);
  });

  it('구독·활성·런타임 없음 상태 색 토큰마다 아이콘이 하나씩 있다', () => {
    const vars = [...Object.values(SUBSCRIPTION_VAR), ...Object.values(ACTIVATION_VAR), NO_RUNTIME_VAR];
    for (const v of vars) expect(CAR_STATE_VARS).toContain(v);
    expect(new Set(CAR_STATE_VARS.map(carIconName)).size).toBe(CAR_STATE_VARS.length);
    expect(carIconName('--ok')).toBe('car--ok');
    // 속이 빈 차는 종료(회색)와 다른 색 토큰이어야 한다
    expect(HOLLOW_VAR).toBe(SUBSCRIPTION_VAR.NONE);
    expect(HOLLOW_VAR).not.toBe(SUBSCRIPTION_VAR.ENDED);
  });
});
