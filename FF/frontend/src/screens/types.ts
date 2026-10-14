// 백엔드 응답 모양 (contracts 스키마 기반 행 + 서버가 붙인 파생 필드)
import type { DependencyRow, FeatureFunctionRow, FeatureVersionRow, GateRecordRow, Lifecycle, ProductRow } from '@ff/contracts';

export interface FeatureSummary {
  featureId: string;
  version: string;
  isLatest: boolean;
  name: string;
  country: string;
  vehicleModel: string;
  trim: string;
  lifecycle: Lifecycle;
  baselineId: string | null;
  ownerId: string;
  asil: string;
  tags: string[];
  controlPoints: string[];
  gates: Record<string, string>;
}

export interface FeatureList {
  total: number;
  items: FeatureSummary[];
  facets: { lifecycle: Record<string, number>; country: Record<string, number>; vehicleModel: Record<string, number> };
}

export interface Blocker {
  code: string;
  message: string;
  ref?: string;
}

export interface TransitionOption {
  to: Lifecycle;
  ko: string;
  auto: boolean;
  roles: string[];
  blockers: Blocker[];
}

export interface BaselineRecord {
  baselineId: string;
  featureId: string;
  version: string;
  contentHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  requestId: string | null;
  snapshot: FeatureVersionRow;
}

export interface FeatureDetail {
  feature: FeatureVersionRow;
  meta: { createdBy: string | null; createdAt: string | null };
  gates: Record<string, GateRecordRow>;
  dependencies: { outgoing: DependencyRow[]; incoming: DependencyRow[] };
  functions: FeatureFunctionRow[];
  trace: { function: { functionId: string; label: string } | null; swId: string; swVersion: string | null; ecuPno: string | null; sw: any; ecu: any }[];
  baseline: BaselineRecord | null;
  products: ProductRow[];
  pendingBaselineRequest: { requestId: string } | null;
  transitions: TransitionOption[];
  versions: { version: string; lifecycle: Lifecycle; baselineId: string | null }[];
}

export interface GateView {
  gates: {
    gate: string;
    name: string;
    judgeRole: string;
    stage: string;
    status: string;
    latest: GateRecordRow | null;
    evidence: any;
    /** FFG-LCY-001 Decision Record 서명 상태 */
    decision?: { state: 'SIGNED' | 'IMPORTED' | 'MISSING' | 'INVALID'; reason: string | null; kid: string | null; approver: { id: string | null; role: string } | null } | null;
    history: (GateRecordRow & { decision?: 'SIGNED' | 'IMPORTED' | 'MISSING' | 'INVALID' })[];
  }[];
  /** FFG-LCY-003 재-HARA 요청 */
  rehara?: { requestId: string; condition: string; detail: string; status: 'OPEN' | 'RESOLVED'; createdAt: string; resolvedBy: string | null }[];
}

export interface ChecklistItem {
  id: string;
  label: string;
  state: 'PASS' | 'FAIL' | 'INFO';
  detail: string;
  data?: any;
}

export interface BaselineRequest {
  requestId: string;
  featureId: string;
  version: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  requestedAt: string;
  reason: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  baselineId: string | null;
}

export interface AuditEntry {
  id: number;
  at: string;
  actorId: string;
  actorRole: string;
  action: string;
  target: string;
  result: 'ALLOWED' | 'DENIED' | 'FAILED';
  reason: string | null;
}
