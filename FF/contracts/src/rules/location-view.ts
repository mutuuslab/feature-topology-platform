// 위치 열람 역할 — 전세계 차량 지도(fleet-map.ts) 규칙에서 뺀 가벼운 정의. API 경로 표(routes.ts, 화면 첫 묶음)가 쓴다
import { ROLES, type Role } from '../enums';

/**
 * 위치 열람 역할 — 사람 역할 전부(사용자 결정 2026-10-17 "누구나 다 볼 수 있도록"). 차량(VEHICLE)은 열람하지 않는다.
 * 열람은 계속 감사하고(지도는 계정당 10분에 한 번, 상세는 매번), 지도 목록의 정밀도(약 1 km)도 그대로다.
 */
// access.ts의 HUMAN_ROLES를 쓰지 않는다 — access → routes → location-view 순환 import에서 아직 초기화 전이다. 같은 정의를 enums에서 직접 계산한다.
export const LOCATION_VIEW_ROLES: Role[] = [...ROLES.filter((r) => r !== 'VEHICLE' && r !== 'SYSTEM'), 'SYSTEM'];
