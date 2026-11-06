// 대시보드 계약 — Jira 대시보드처럼 사용자가 만든 판(열 레이아웃 + 가젯 인스턴스)을 서버에 저장한다.
// 같은 종류의 가젯을 설정만 달리해 여러 개 둘 수 있다(인스턴스 id ≠ 종류 type). 판 모양(v2)은 프론트 배치 모델과 같다.
// 소유자만 바꾸고 지운다. 공유는 플랫폼 역할 단위(보기만). 변경은 버전(If-Match)으로 겹친 저장을 막는다(412).
import { z } from 'zod';
import { Role } from '../enums';

/** 열 레이아웃 — 1열 · 2열 같은 폭 · 2열 왼쪽 넓게 · 2열 오른쪽 넓게 · 3열 */
export const DASHBOARD_LAYOUTS = ['1', '2', '2L', '2R', '3'] as const;
export const DashboardLayout = z.enum(DASHBOARD_LAYOUTS);
export type DashboardLayout = z.infer<typeof DashboardLayout>;
export const DASHBOARD_COLUMNS: Record<DashboardLayout, number> = { '1': 1, '2': 2, '2L': 2, '2R': 2, '3': 3 };

/** 가젯 자동 새로 고침(분) — 0은 끔 */
export const GADGET_REFRESH = [0, 1, 5, 15] as const;
export type GadgetRefresh = (typeof GADGET_REFRESH)[number];

/** 판 하나의 가젯 상한 — 화면이 한 번에 여는 조회 수를 묶는다 */
export const DASHBOARD_MAX_GADGETS = 40;
/** 판 JSON 크기 상한(바이트 근사, 문자 수) */
export const DASHBOARD_MAX_BOARD_CHARS = 64_000;

const Ident = z.string().regex(/^[A-Za-z0-9_-]{1,48}$/);
/** 가젯 설정 값 — 문자열·수·참거짓·문자열 목록만(화면 설정이지 임의 문서가 아니다) */
const ConfigValue = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null(), z.array(z.string().max(80)).max(20)]);

export const GadgetInstance = z
  .object({
    id: Ident,
    type: Ident,
    config: z.record(z.string().max(40), ConfigValue).default({}),
    /** 처음 놓은 뒤 설정을 저장했는가 — 아니면 가젯 안에 설정 양식을 보인다 */
    configured: z.boolean().default(true),
    refresh: z.union([z.literal(0), z.literal(1), z.literal(5), z.literal(15)]).default(0),
    minimized: z.boolean().default(false),
  })
  .strict();
export type GadgetInstance = z.infer<typeof GadgetInstance>;

export const DashboardBoard = z
  .object({
    v: z.literal(2),
    layout: DashboardLayout,
    /** 열마다 위에서 아래로 가젯 인스턴스 id */
    columns: z.array(z.array(Ident).max(DASHBOARD_MAX_GADGETS)).min(1).max(3),
    gadgets: z.record(Ident, GadgetInstance),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.columns.length !== DASHBOARD_COLUMNS[b.layout]) ctx.addIssue({ code: 'custom', path: ['columns'], message: `레이아웃 ${b.layout}은 ${DASHBOARD_COLUMNS[b.layout]}열입니다` });
    const placed = b.columns.flat();
    if (new Set(placed).size !== placed.length) ctx.addIssue({ code: 'custom', path: ['columns'], message: '같은 가젯이 두 번 놓였습니다' });
    if (placed.length > DASHBOARD_MAX_GADGETS) ctx.addIssue({ code: 'custom', path: ['columns'], message: `가젯은 ${DASHBOARD_MAX_GADGETS}개까지입니다` });
    for (const id of placed) if (!b.gadgets[id]) ctx.addIssue({ code: 'custom', path: ['gadgets', id], message: `놓인 가젯 ${id}의 설정이 없습니다` });
    for (const [id, g] of Object.entries(b.gadgets)) {
      if (g.id !== id) ctx.addIssue({ code: 'custom', path: ['gadgets', id, 'id'], message: '가젯 id가 키와 다릅니다' });
      if (!placed.includes(id)) ctx.addIssue({ code: 'custom', path: ['gadgets', id], message: '놓이지 않은 가젯 설정입니다' });
    }
    if (JSON.stringify(b).length > DASHBOARD_MAX_BOARD_CHARS) ctx.addIssue({ code: 'custom', path: [], message: '대시보드가 너무 큽니다' });
  });
export type DashboardBoard = z.infer<typeof DashboardBoard>;

const Name = z.string().trim().min(1).max(80);
const SharedRoles = z.array(Role).max(20);

export const DashboardCreateBody = z.object({ name: Name, board: DashboardBoard, sharedRoles: SharedRoles.default([]) }).strict();
export type DashboardCreateBody = z.infer<typeof DashboardCreateBody>;

/** 바꿀 것만 — 버전은 If-Match 머리글(권장) 또는 version */
export const DashboardUpdateBody = z
  .object({ name: Name.optional(), board: DashboardBoard.optional(), sharedRoles: SharedRoles.optional(), version: z.number().int().positive().optional() })
  .strict();
export type DashboardUpdateBody = z.infer<typeof DashboardUpdateBody>;

export const DashboardDeleteBody = z.object({ version: z.number().int().positive().optional() }).strict();
export const DashboardFavouriteBody = z.object({ favourite: z.boolean() }).strict();

/** 조회 결과 — favourite·mine은 보는 사람 기준 */
export interface DashboardView {
  id: string;
  name: string;
  ownerId: string;
  sharedRoles: Role[];
  version: number;
  createdAt: string;
  updatedAt: string;
  favourite: boolean;
  mine: boolean;
  board: DashboardBoard;
}

/** 볼 수 있는가 — 소유자이거나 내 역할 중 하나에 공유됐다(서버·정적 데모가 같은 규칙) */
export const canViewDashboard = (d: { ownerId: string; sharedRoles: readonly string[] }, actor: { id: string; roles: readonly string[] }) =>
  d.ownerId === actor.id || d.sharedRoles.some((r) => actor.roles.includes(r));
