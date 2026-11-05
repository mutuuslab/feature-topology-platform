// 부서 작업공간 첫 화면 — 화면 유형별 홈(기획 스튜디오·심사 결재함·엔지니어링 콘솔·관제실·검토 포털). 홈(/)이 부서 보기일 때만 불러온다.
// 홈 아래에 덧붙이는 것(W5): 이 부서가 보낸 협의 요청과 받은 의견(포털 홈은 자기 화면에 이미 있다), Feature DB를 맡는 부서의 품질 지표 한 줄.
import type { DepartmentSummary } from '@ff/contracts';
import ConsoleHome from './Console';
import ControlRoomHome from './ControlRoom';
import PortalHome from './Portal';
import ReviewHome from './Review';
import StudioHome from './Studio';
import { SentConsults } from './Consults';
import { RefQualityPanel } from '../refdb/common';
import './workspaces.css';

const HOMES = { studio: StudioHome, review: ReviewHome, console: ConsoleHome, control: ControlRoomHome, portal: PortalHome } as const;

/** Feature DB 관리자 역할(업무 절차 R-RDA)을 가진 부서 — 콘솔 홈에 품질 지표 한 줄(P5-7) */
const REFDB_OWNER_ROLE = 'R-RDA';

export default function WorkspaceHome({ dept }: { dept: DepartmentSummary }) {
  const Home = HOMES[dept.workspace];
  if (dept.workspace === 'portal') return <Home dept={dept} />;
  return (
    <div className="ws-extras">
      <Home dept={dept} />
      {dept.roles.includes(REFDB_OWNER_ROLE) && <RefQualityPanel />}
      <SentConsults deptId={dept.id} />
    </div>
  );
}
