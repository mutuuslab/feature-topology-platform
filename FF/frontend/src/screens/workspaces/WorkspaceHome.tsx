// 부서 작업공간 첫 화면 — 화면 유형별 홈(기획 스튜디오·심사 결재함·엔지니어링 콘솔·관제실·검토 포털). 홈(/)이 부서 보기일 때만 불러온다.
import type { DepartmentSummary } from '@ff/contracts';
import ConsoleHome from './Console';
import ControlRoomHome from './ControlRoom';
import PortalHome from './Portal';
import ReviewHome from './Review';
import StudioHome from './Studio';
import './workspaces.css';

const HOMES = { studio: StudioHome, review: ReviewHome, console: ConsoleHome, control: ControlRoomHome, portal: PortalHome } as const;

export default function WorkspaceHome({ dept }: { dept: DepartmentSummary }) {
  const Home = HOMES[dept.workspace];
  return <Home dept={dept} />;
}
