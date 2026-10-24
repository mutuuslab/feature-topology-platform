// 전체 지도 — 13개 절차를 가치 사슬로. 생애주기 절차는 순서대로 이어지는 화살표 흐름(줄이 넘치면 다음 줄로 접는다),
// 지원 절차는 그 아래 바탕 띠. 각 칸에 내 역할 참여(내 활동 수·내 차례)를 표시한다.
export interface ChainProcess {
  id: string;
  name: string;
  group: string;
  gates: string[];
}

export interface ChainBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  support: boolean;
}

export interface ValueChainLayout {
  width: number;
  height: number;
  boxes: ChainBox[];
  /** 생애주기 흐름 화살표(직교) */
  arrows: { from: string; to: string; points: [number, number][] }[];
  /** 지원 띠의 위치(제목 자리) */
  supportBand: { y: number; h: number } | null;
  lifecycleTitleY: number;
}

export const CHAIN_BOX = { w: 184, maxW: 240, h: 108, gap: 40, rowGap: 48, title: 28 } as const;

/** 생애주기는 group이 첫 그룹(모델 순서)인 절차, 나머지는 지원. 폭에 맞춰 한 줄 칸 수와 칸 폭을 정한다 */
export function layoutValueChain(processes: ChainProcess[], width: number): ValueChainLayout {
  const { h, gap, rowGap, title } = CHAIN_BOX;
  const per = chainPerRow(width);
  const w = Math.max(CHAIN_BOX.w, Math.min(CHAIN_BOX.maxW, Math.floor((width - 16 - (per - 1) * gap) / per)));
  const firstGroup = processes[0]?.group;
  const life = processes.filter((p) => p.group === firstGroup);
  const support = processes.filter((p) => p.group !== firstGroup);
  const boxes: ChainBox[] = [];
  const x0 = 8;
  let y = title;
  life.forEach((p, i) => {
    const r = Math.floor(i / per);
    const c = i % per;
    boxes.push({ id: p.id, x: x0 + c * (w + gap), y: y + r * (h + rowGap), w, h, support: false });
  });
  const lifeRows = Math.ceil(life.length / per);
  y += lifeRows * h + Math.max(0, lifeRows - 1) * rowGap;
  const arrows: ValueChainLayout['arrows'] = [];
  for (let i = 0; i + 1 < life.length; i++) {
    const a = boxes[i];
    const b = boxes[i + 1];
    if (Math.abs(a.y - b.y) < 1) arrows.push({ from: a.id, to: b.id, points: [[a.x + a.w, a.y + a.h / 2], [b.x, b.y + b.h / 2]] });
    else {
      // 줄 끝에서 다음 줄 처음으로 — 두 줄 사이 틈을 따라 돌아간다
      const mid = a.y + a.h + rowGap / 2;
      arrows.push({ from: a.id, to: b.id, points: [[a.x + a.w / 2, a.y + a.h], [a.x + a.w / 2, mid], [b.x + b.w / 2, mid], [b.x + b.w / 2, b.y]] });
    }
  }
  let supportBand: ValueChainLayout['supportBand'] = null;
  if (support.length) {
    y += rowGap;
    const top = y;
    y += title;
    support.forEach((p, i) => {
      const r = Math.floor(i / per);
      const c = i % per;
      boxes.push({ id: p.id, x: x0 + c * (w + gap), y: y + r * (h + gap / 2), w, h, support: true });
    });
    const rows = Math.ceil(support.length / per);
    y += rows * h + Math.max(0, rows - 1) * (gap / 2) + 12;
    supportBand = { y: top - 12, h: y - top + 12 };
  }
  const cols = Math.min(per, Math.max(life.length, support.length));
  return { width: Math.max(width, x0 * 2 + cols * w + Math.max(0, cols - 1) * gap), height: y + 4, boxes, arrows, supportBand, lifecycleTitleY: 0 };
}

/** 주어진 폭에 들어가는 한 줄 칸 수 */
export const chainPerRow = (width: number) => Math.max(2, Math.floor((width - 16 + CHAIN_BOX.gap) / (CHAIN_BOX.w + CHAIN_BOX.gap)));
