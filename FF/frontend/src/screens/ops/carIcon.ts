// 지도 차량 아이콘 — 위에서 본 승용차(앞=북쪽, 지도에서 진행 방향으로 돌린다). 앞은 뾰족한 보닛·전조등, 뒤는 평평한 범퍼라 방향이 보인다.
// 차체는 상태 색, 테두리는 면 색(어떤 바탕 지도에서도 윤곽이 보이게), 유리·바퀴는 어두운 토큰 색. 색은 모두 호출하는 쪽이 토큰에서 읽어 넘긴다.
// hollow — 속이 빈 차(면 색 차체 + 상태 색 굵은 테두리). 회색 계열 두 상태(종료·권한 없음)를 색이 아니라 모양으로도 가른다.

/** 장치 픽셀 크기 — pixelRatio 2로 등록하면 18×30 CSS px */
export const CAR_W = 36;
export const CAR_H = 60;
export const CAR_PIXEL_RATIO = 2;

export interface CarColors {
  body: string;
  outline: string;
  glass: string;
  hollow?: boolean;
}

/** 차체 윤곽 — 앞(위)은 보닛이 뾰족하게 모이고 뒤(아래)는 각진 범퍼 */
function bodyPath(ctx: CanvasRenderingContext2D) {
  const w = CAR_W;
  const h = CAR_H;
  ctx.beginPath();
  ctx.moveTo(6, 18);
  ctx.lineTo(6, h - 8);
  ctx.quadraticCurveTo(6, h - 3, 11, h - 3);
  ctx.lineTo(w - 11, h - 3);
  ctx.quadraticCurveTo(w - 6, h - 3, w - 6, h - 8);
  ctx.lineTo(w - 6, 18);
  ctx.quadraticCurveTo(w - 6, 6, w / 2, 2);
  ctx.quadraticCurveTo(6, 6, 6, 18);
  ctx.closePath();
}

export function drawCar(ctx: CanvasRenderingContext2D, c: CarColors) {
  const w = CAR_W;
  const h = CAR_H;
  const rr = (x: number, y: number, ww: number, hh: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, ww, hh, r);
  };
  ctx.clearRect(0, 0, w, h);
  // 바퀴 — 차체 옆으로 살짝 나온다
  ctx.fillStyle = c.glass;
  for (const [x, y] of [
    [2, 14],
    [w - 8, 14],
    [2, h - 21],
    [w - 8, h - 21],
  ])
    (rr(x, y, 6, 11, 2), ctx.fill());
  // 차체
  bodyPath(ctx);
  ctx.fillStyle = c.hollow ? c.outline : c.body;
  ctx.fill();
  ctx.lineWidth = c.hollow ? 4 : 3;
  ctx.strokeStyle = c.hollow ? c.body : c.outline;
  ctx.stroke();
  // 앞유리(넓게)·뒷유리(좁게) — 앞뒤가 달라 보이게
  ctx.fillStyle = c.glass;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(10, 22);
  ctx.lineTo(w - 10, 22);
  ctx.lineTo(w - 12, 31);
  ctx.lineTo(12, 31);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(12, h - 16);
  ctx.lineTo(w - 12, h - 16);
  ctx.lineTo(w - 11, h - 11);
  ctx.lineTo(11, h - 11);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  // 전조등 — 앞쪽 표시
  ctx.fillStyle = c.hollow ? c.body : c.outline;
  (rr(10, 9, 5, 3, 1), ctx.fill());
  (rr(w - 15, 9, 5, 3, 1), ctx.fill());
}

export function carImage(c: CarColors): ImageData {
  const cv = document.createElement('canvas');
  cv.width = CAR_W;
  cv.height = CAR_H;
  const ctx = cv.getContext('2d')!;
  drawCar(ctx, c);
  return ctx.getImageData(0, 0, CAR_W, CAR_H);
}

/** 상태 색 토큰 이름 → 지도 이미지 이름 */
export const carIconName = (cssVarName: string) => `car${cssVarName}`;
