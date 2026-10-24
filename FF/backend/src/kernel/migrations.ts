// 스키마 마이그레이션 — 이름 순 적용, 적용된 것은 다시 실행하지 않는다. 기존 항목은 수정하지 말고 새 항목을 추가한다.
// 도메인 레코드는 "키 열 + doc(JSON)" 형태로 저장한다: 키·조회 조건은 열로, 본문은 contracts zod 스키마로 파싱.
// pg — PostgreSQL 방언 번역(pg-dialect.ts)이 감당하지 못하는 항목만 PG용 SQL을 따로 둔다(20-92 §4.3). 잠금(migrations.lock.json)은 sql만 해시한다.
export const MIGRATIONS: { name: string; sql: string; pg?: string }[] = [
  {
    name: '001_kernel',
    sql: `
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('ALLOWED','DENIED','FAILED')),
  reason TEXT,
  before_doc TEXT,
  after_doc TEXT,
  correlation_id TEXT,
  component_id TEXT
);
CREATE INDEX audit_target ON audit(target);
CREATE INDEX audit_actor ON audit(actor_id);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  aggregate TEXT NOT NULL,
  component_id TEXT,
  correlation_id TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX events_type ON events(type);
CREATE INDEX events_aggregate ON events(aggregate);

CREATE TABLE idempotency (
  key TEXT NOT NULL,
  route TEXT NOT NULL,
  req_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (key, route)
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
  },
  {
    name: '002_dataset_v081',
    sql: `
CREATE TABLE feature_version (
  feature_id TEXT NOT NULL, version TEXT NOT NULL,
  lifecycle TEXT NOT NULL, baseline_id TEXT,
  doc TEXT NOT NULL,
  PRIMARY KEY (feature_id, version)
);
CREATE INDEX feature_version_lc ON feature_version(lifecycle);

CREATE TABLE baseline (
  baseline_id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL, version TEXT NOT NULL,
  content_hash TEXT,
  doc TEXT NOT NULL,
  UNIQUE (feature_id, version)
);

CREATE TABLE product (
  catalog_id TEXT NOT NULL, version TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  doc TEXT NOT NULL,
  PRIMARY KEY (catalog_id, version)
);

CREATE TABLE dependency (
  dependency_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source_feature_id TEXT NOT NULL, source_version TEXT NOT NULL,
  target_feature_id TEXT NOT NULL, target_version TEXT,
  doc TEXT NOT NULL
);
CREATE INDEX dependency_src ON dependency(source_feature_id, source_version);
CREATE INDEX dependency_tgt ON dependency(target_feature_id);

CREATE TABLE gate_record (
  gate_record_id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL, feature_version TEXT NOT NULL,
  gate TEXT NOT NULL, status TEXT NOT NULL,
  judged_at TEXT NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX gate_record_fv ON gate_record(feature_id, feature_version, gate);

CREATE TABLE evidence (
  evidence_ref TEXT NOT NULL, gate_record_id TEXT NOT NULL,
  doc TEXT NOT NULL,
  PRIMARY KEY (gate_record_id)
);

CREATE TABLE feature_function (
  feature_id TEXT NOT NULL, feature_version TEXT NOT NULL, function_id TEXT NOT NULL,
  doc TEXT NOT NULL,
  PRIMARY KEY (feature_id, feature_version, function_id)
);

CREATE TABLE sw_master (sw_id TEXT NOT NULL, version TEXT NOT NULL, ecu_pno TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (sw_id, version, ecu_pno));
CREATE TABLE ecu_master (ecu_pno TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE version_rationale (feature_id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE precheck_rule (rule_id TEXT PRIMARY KEY, doc TEXT NOT NULL);
`,
  },
  {
    name: '003_registry_bom',
    sql: `
ALTER TABLE feature_version ADD COLUMN created_by TEXT;
ALTER TABLE feature_version ADD COLUMN created_at TEXT;
ALTER TABLE baseline ADD COLUMN approved_by TEXT;
ALTER TABLE baseline ADD COLUMN approved_at TEXT;
ALTER TABLE baseline ADD COLUMN request_id TEXT;

CREATE TABLE baseline_request (
  request_id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL, version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  requested_by TEXT NOT NULL, requested_at TEXT NOT NULL, reason TEXT NOT NULL,
  decided_by TEXT, decided_at TEXT, decision_reason TEXT,
  baseline_id TEXT
);
CREATE INDEX baseline_request_status ON baseline_request(status);
`,
  },
  {
    name: '004_catalog',
    sql: `
ALTER TABLE product ADD COLUMN created_by TEXT;
ALTER TABLE product ADD COLUMN created_at TEXT;
ALTER TABLE product ADD COLUMN config_approved_by TEXT;
ALTER TABLE product ADD COLUMN release_approved_by TEXT;
`,
  },
  {
    name: '005_policy_runtime',
    sql: `
CREATE TABLE policy (
  policy_id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL, feature_version TEXT NOT NULL, control_point TEXT NOT NULL,
  flag_key TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX policy_feature ON policy(feature_id, feature_version);
CREATE INDEX policy_flag ON policy(flag_key);

CREATE TABLE validation_run (
  run_id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL, policy_revision INTEGER NOT NULL, content_hash TEXT NOT NULL,
  decision TEXT NOT NULL, at TEXT NOT NULL, by_actor TEXT NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX validation_run_policy ON validation_run(policy_id);

CREATE TABLE vehicle (vin TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE entitlement (grant_id TEXT PRIMARY KEY, vin TEXT NOT NULL, catalog_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX entitlement_vin ON entitlement(vin);
`,
  },
  {
    name: '006_delivery',
    sql: `
CREATE TABLE pki_key (key_id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, not_after TEXT NOT NULL, public_pem TEXT NOT NULL, private_pem TEXT NOT NULL, retired_at TEXT);
CREATE TABLE publication (
  publication_id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
  scope_key TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL, doc TEXT NOT NULL,
  UNIQUE (scope_key, sequence)
);
CREATE INDEX publication_status ON publication(status);
CREATE TABLE readback (id INTEGER PRIMARY KEY AUTOINCREMENT, publication_id TEXT NOT NULL, vin TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX readback_pub ON readback(publication_id);
CREATE TABLE if_call (id INTEGER PRIMARY KEY AUTOINCREMENT, if_id TEXT NOT NULL, idem_key TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL, UNIQUE (if_id, idem_key));
CREATE TABLE kill_request (kill_id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE TABLE vehicle_runtime (vin TEXT PRIMARY KEY, doc TEXT NOT NULL);
`,
  },
  {
    name: '007_virtual_validation',
    sql: `
CREATE TABLE virtual_run (
  run_id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, feature_id TEXT NOT NULL, feature_version TEXT NOT NULL,
  scenario_id TEXT NOT NULL, content_hash TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE INDEX virtual_run_policy ON virtual_run(policy_id, scenario_id);
CREATE INDEX virtual_run_feature ON virtual_run(feature_id, feature_version);
`,
  },
  {
    name: '008_vehicle_request',
    sql: `
CREATE TABLE vehicle_request (
  request_id TEXT PRIMARY KEY, vin TEXT NOT NULL, at TEXT NOT NULL, boot_id TEXT, sequence INTEGER, doc TEXT NOT NULL
);
CREATE INDEX vehicle_request_vin ON vehicle_request(vin, at);
CREATE UNIQUE INDEX vehicle_request_idem ON vehicle_request(vin, boot_id, sequence) WHERE boot_id IS NOT NULL;
CREATE TABLE vehicle_channel (vin TEXT PRIMARY KEY, boot_id TEXT NOT NULL, sequence INTEGER NOT NULL);
`,
  },
  {
    name: '009_anomaly_feedback',
    sql: `
CREATE TABLE anomaly (anomaly_id TEXT PRIMARY KEY, kind TEXT NOT NULL, feature_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX anomaly_open ON anomaly(kind, feature_id, status);
CREATE TABLE quality_feedback (feedback_id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX quality_feedback_feature ON quality_feedback(feature_id, status);
`,
  },
  {
    name: '010_poc_run',
    sql: `
CREATE TABLE poc_run (run_id TEXT PRIMARY KEY, status TEXT NOT NULL, started_at TEXT NOT NULL, doc TEXT NOT NULL);
`,
  },
  {
    // 기간형 체험권 — 차량 가명 성향(국가·지역·차종·트림·연령대·주행 성향·ADAS 사용)과 데모/합성 구분
    name: '011_trial_analytics',
    sql: `
CREATE TABLE vehicle_profile (vin TEXT PRIMARY KEY, source TEXT NOT NULL, doc TEXT NOT NULL);
ALTER TABLE entitlement ADD COLUMN source TEXT NOT NULL DEFAULT 'DEMO';
CREATE INDEX entitlement_catalog ON entitlement(catalog_id, source);
`,
  },
  {
    // 보고서 v1.1 WP0 커널 신뢰 기반 — 감사 해시 체인(FFG-PLT-015)·서명 키 용도/epoch(FFG-SEC-002)·승인자 개인 키(FFG-PLT-005)·소프트웨어 HSM 비밀
    // 감사 행은 추가만: 삭제는 언제나, 수정은 해시가 채워진 뒤 막는다(해시 없는 옛 행의 채우기만 허용 — AuditService.onModuleInit).
    name: '012_trust',
    sql: `
ALTER TABLE audit ADD COLUMN prev_hash TEXT;
ALTER TABLE audit ADD COLUMN hash TEXT;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only (FFG-PLT-015)'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit WHEN OLD.hash IS NOT NULL BEGIN SELECT RAISE(ABORT, 'audit is append-only (FFG-PLT-015)'); END;
ALTER TABLE pki_key ADD COLUMN purpose TEXT NOT NULL DEFAULT 'policy';
ALTER TABLE pki_key ADD COLUMN epoch INTEGER NOT NULL DEFAULT 1;
CREATE INDEX pki_key_purpose ON pki_key(purpose, status);
CREATE TABLE approver_key (user_id TEXT PRIMARY KEY, kid TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL, public_pem TEXT NOT NULL, private_pem TEXT NOT NULL);
CREATE TABLE hsm_secret (name TEXT NOT NULL, epoch INTEGER NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (name, epoch));
`,
  },
  {
    // 보고서 v1.1 WP1 안전 분류 Registry — Feature Version별 안전 속성(5.7, FFG-CLS-*)과 Flag ID 결합 기록(재사용 금지, FFG-CODE-020)
    name: '013_safety_profile',
    sql: `
CREATE TABLE safety_profile (feature_id TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('DRAFT','CONFIRMED')), doc TEXT NOT NULL, PRIMARY KEY (feature_id, version));
CREATE TABLE flag_registry (flag_key TEXT PRIMARY KEY, feature_id TEXT NOT NULL, bound_at TEXT NOT NULL, retired_at TEXT);
`,
  },
  {
    // 명령 원장(보고서 v1.1 8장, FFG-PLT-017·FFG-SEC-003·FFG-PLT-005) — Feature별 명령 순번·직전 Kill 승인자, 이동 시간 창 누적은 추가만
    name: '014_command_ledger',
    sql: `
CREATE TABLE command_ledger (feature_id TEXT PRIMARY KEY, last_seq INTEGER NOT NULL, last_kill_approvers TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
CREATE TABLE command_window (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE, request TEXT NOT NULL, vehicles INTEGER NOT NULL, at TEXT NOT NULL);
CREATE INDEX command_window_feature ON command_window (feature_id, at);
CREATE TRIGGER command_window_no_update BEFORE UPDATE ON command_window BEGIN SELECT RAISE(ABORT, 'command_window는 추가만 가능'); END;
CREATE TRIGGER command_window_no_delete BEFORE DELETE ON command_window BEGIN SELECT RAISE(ABORT, 'command_window는 추가만 가능'); END;
`,
  },
  {
    // Kill·복원 v2(보고서 v1.1 7~9장) — 서명된 kill_command v2와 차량별 봉투(vehicle_auth·cmd_auth). 둘 다 추가만.
    // 차량·Feature·epoch마다 vehicle_seq는 하나씩만(재전송·중복 발급 방지, FFG-VEH-013)
    name: '015_kill_v2',
    sql: `
CREATE TABLE kill_command (command_id TEXT PRIMARY KEY, kill_id TEXT NOT NULL, request TEXT NOT NULL, doc TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX kill_command_kill ON kill_command (kill_id);
CREATE TABLE vehicle_envelope (command_id TEXT NOT NULL, kill_id TEXT NOT NULL, vin TEXT NOT NULL, feature_id TEXT NOT NULL, request TEXT NOT NULL, key_epoch INTEGER NOT NULL, vehicle_seq INTEGER NOT NULL, cmd_auth TEXT NOT NULL, doc TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (command_id, vin));
CREATE UNIQUE INDEX vehicle_envelope_seq ON vehicle_envelope (vin, feature_id, key_epoch, vehicle_seq);
CREATE TRIGGER kill_command_no_update BEFORE UPDATE ON kill_command BEGIN SELECT RAISE(ABORT, 'kill_command는 추가만 가능'); END;
CREATE TRIGGER kill_command_no_delete BEFORE DELETE ON kill_command BEGIN SELECT RAISE(ABORT, 'kill_command는 추가만 가능'); END;
CREATE TRIGGER vehicle_envelope_no_update BEFORE UPDATE ON vehicle_envelope BEGIN SELECT RAISE(ABORT, 'vehicle_envelope는 추가만 가능'); END;
CREATE TRIGGER vehicle_envelope_no_delete BEFORE DELETE ON vehicle_envelope BEGIN SELECT RAISE(ABORT, 'vehicle_envelope는 추가만 가능'); END;
`,
  },
  {
    // 차량 상태 보고 v2(보고서 v1.1 13.3.1) — 받은 보고는 위반까지 모두 남기고(추가만), 받아들인 최신 상태는 차량·Feature별로
    name: '016_status_v2',
    sql: `
CREATE TABLE status_report (id INTEGER PRIMARY KEY AUTOINCREMENT, vin TEXT NOT NULL, feature_id TEXT NOT NULL, report_seq INTEGER NOT NULL, state TEXT NOT NULL, accepted INTEGER NOT NULL, violation TEXT, via TEXT NOT NULL, doc TEXT NOT NULL, received_at TEXT NOT NULL);
CREATE INDEX status_report_vin ON status_report (vin, id);
CREATE TRIGGER status_report_no_update BEFORE UPDATE ON status_report BEGIN SELECT RAISE(ABORT, 'status_report는 추가만 가능'); END;
CREATE TRIGGER status_report_no_delete BEFORE DELETE ON status_report BEGIN SELECT RAISE(ABORT, 'status_report는 추가만 가능'); END;
CREATE TABLE vehicle_feature_status (vin TEXT NOT NULL, feature_id TEXT NOT NULL, state TEXT NOT NULL, report_seq INTEGER NOT NULL, doc TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (vin, feature_id));
`,
  },
  {
    // 보고서 v1.1 WP2 — Gate Decision Record(FFG-LCY-001): Gate 기록마다 서명된 결정 본문. 추가만(재판정은 새 Gate 기록 + 새 결정)
    name: '017_gate_decision',
    sql: `
CREATE TABLE gate_decision (gate_record_id TEXT PRIMARY KEY, provenance TEXT NOT NULL, kid TEXT NOT NULL, signed_at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE TRIGGER gate_decision_no_update BEFORE UPDATE ON gate_decision BEGIN SELECT RAISE(ABORT, 'gate_decision은 추가만 가능'); END;
CREATE TRIGGER gate_decision_no_delete BEFORE DELETE ON gate_decision BEGIN SELECT RAISE(ABORT, 'gate_decision은 추가만 가능'); END;
`,
  },
  {
    // 보고서 v1.1 WP2 — 재-HARA 요청(FFG-LCY-003): 6.4 조건 자동 검출. 같은 원인(ref)으로 두 번 만들지 않는다
    name: '018_rehara',
    sql: `
CREATE TABLE rehara_request (request_id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, feature_version TEXT NOT NULL, condition TEXT NOT NULL, ref TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE UNIQUE INDEX rehara_once ON rehara_request(feature_id, feature_version, ref);
CREATE INDEX rehara_fv ON rehara_request(feature_id, feature_version, status);
`,
  },
  {
    // 보고서 v1.1 WP6 — SUMS 기록(FFG-LCY-008): 명령(RXSWIN·형식승인 영향 평가·사용자 고지)과 결과. 추가만
    name: '019_sums',
    sql: `
CREATE TABLE sums_record (id INTEGER PRIMARY KEY AUTOINCREMENT, command_id TEXT NOT NULL, kind TEXT NOT NULL, feature_id TEXT NOT NULL, publication_id TEXT, at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX sums_command ON sums_record (command_id, kind);
CREATE INDEX sums_publication ON sums_record (publication_id);
CREATE TRIGGER sums_no_update BEFORE UPDATE ON sums_record BEGIN SELECT RAISE(ABORT, 'sums_record는 추가만 가능'); END;
CREATE TRIGGER sums_no_delete BEFORE DELETE ON sums_record BEGIN SELECT RAISE(ABORT, 'sums_record는 추가만 가능'); END;
`,
  },
  {
    // P10 — 실험(D01-07)·장애·VOC(D04-05)·동기화 실행(D05-02)·해외공장 주문(D05-03)·OTel 수집기 모의(IF-11)
    name: '020_p10_ext',
    sql: `
CREATE TABLE experiment (experiment_id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX experiment_policy ON experiment(policy_id);
CREATE TABLE incident (incident_id TEXT PRIMARY KEY, feature_id TEXT, status TEXT NOT NULL, source TEXT NOT NULL, external_ref TEXT, doc TEXT NOT NULL);
CREATE UNIQUE INDEX incident_external ON incident(source, external_ref) WHERE external_ref IS NOT NULL;
CREATE TABLE sync_run (run_id TEXT PRIMARY KEY, target_id TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX sync_run_target ON sync_run(target_id, at);
CREATE TABLE plant_order (order_id TEXT PRIMARY KEY, plant TEXT NOT NULL, vin TEXT NOT NULL, doc TEXT NOT NULL);
CREATE TABLE otel_span (id INTEGER PRIMARY KEY AUTOINCREMENT, trace_id TEXT NOT NULL, name TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX otel_span_name ON otel_span(name, id);
`,
  },
  {
    // 체험권 만료 사전 고지 (FFG-LCY-010) — 체험권·만료일마다 한 번. 고지 ID(NTC-NNNNN)는 차단 명령의 user_notice.text_ref가 된다
    name: '021_trial_notice',
    sql: `
CREATE TABLE trial_notice (notice_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, valid_to TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE UNIQUE INDEX trial_notice_once ON trial_notice(grant_id, valid_to);
`,
  },
  {
    // 보고서 v1.1 WP8 — SBOM(CycloneDX 1.6, 게시본마다)·VEX 판정(FFG-SBOM-002·003·007, SEC-006). 추가만 — 원산지 근거 10년 보존(BIS 15 CFR 791)
    name: '030_sbom',
    sql: `
CREATE TABLE sbom (serial TEXT PRIMARY KEY, publication_id TEXT, feature_id TEXT NOT NULL, feature_version TEXT NOT NULL, package_hash TEXT NOT NULL, created_at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX sbom_feature ON sbom (feature_id, feature_version, created_at);
CREATE TRIGGER sbom_no_update BEFORE UPDATE ON sbom BEGIN SELECT RAISE(ABORT, 'sbom은 추가만 가능'); END;
CREATE TRIGGER sbom_no_delete BEFORE DELETE ON sbom BEGIN SELECT RAISE(ABORT, 'sbom은 추가만 가능'); END;
CREATE TABLE vex (id INTEGER PRIMARY KEY AUTOINCREMENT, vuln_id TEXT NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE TRIGGER vex_no_update BEFORE UPDATE ON vex BEGIN SELECT RAISE(ABORT, 'vex는 추가만 가능'); END;
CREATE TRIGGER vex_no_delete BEFORE DELETE ON vex BEGIN SELECT RAISE(ABORT, 'vex는 추가만 가능'); END;
`,
  },
  {
    // 보고서 v1.1 WP10 — 보안 이벤트(FFG-SEC-007, 14.4): 포렌식 기록(추가만, 개인정보 없음 — 차량은 가명)과 진위 실패 채널 제한
    name: '031_security_event',
    sql: `
CREATE TABLE security_event (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, event_id TEXT NOT NULL, code TEXT NOT NULL, vehicle TEXT, doc TEXT NOT NULL);
CREATE INDEX security_event_window ON security_event (event_id, at);
CREATE TRIGGER security_event_no_update BEFORE UPDATE ON security_event BEGIN SELECT RAISE(ABORT, 'security_event는 추가만 가능'); END;
CREATE TRIGGER security_event_no_delete BEFORE DELETE ON security_event BEGIN SELECT RAISE(ABORT, 'security_event는 추가만 가능'); END;
CREATE TABLE vehicle_channel_limit (id INTEGER PRIMARY KEY AUTOINCREMENT, vin TEXT NOT NULL, until TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX vehicle_channel_limit_vin ON vehicle_channel_limit (vin, until);
`,
  },
  {
    // 보고서 v1.1 WP10 — 보존과 삭제(FFG-TEL-008, 13.7): 삭제 기록(추가만). 추가만 저장소도 보존 기간이 지나면 지워야 하므로
    // 삭제 금지 트리거를 보존 sweep 중(retention_gate.active = 1, 같은 트랜잭션 안)에만 풀리게 바꾼다
    name: '032_retention',
    sql: `
CREATE TABLE retention_gate (id INTEGER PRIMARY KEY CHECK (id = 1), active INTEGER NOT NULL);
INSERT INTO retention_gate (id, active) VALUES (1, 0);
CREATE TABLE retention_deletion (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, store TEXT NOT NULL, cutoff TEXT NOT NULL, deleted INTEGER NOT NULL, held INTEGER NOT NULL, doc TEXT NOT NULL);
CREATE TRIGGER retention_deletion_no_update BEFORE UPDATE ON retention_deletion BEGIN SELECT RAISE(ABORT, 'retention_deletion은 추가만 가능'); END;
CREATE TRIGGER retention_deletion_no_delete BEFORE DELETE ON retention_deletion BEGIN SELECT RAISE(ABORT, 'retention_deletion은 추가만 가능'); END;
DROP TRIGGER status_report_no_delete;
CREATE TRIGGER status_report_no_delete BEFORE DELETE ON status_report WHEN (SELECT active FROM retention_gate WHERE id = 1) = 0 BEGIN SELECT RAISE(ABORT, 'status_report는 추가만 가능(보존 기간 삭제만 허용)'); END;
DROP TRIGGER security_event_no_delete;
CREATE TRIGGER security_event_no_delete BEFORE DELETE ON security_event WHEN (SELECT active FROM retention_gate WHERE id = 1) = 0 BEGIN SELECT RAISE(ABORT, 'security_event는 추가만 가능(보존 기간 삭제만 허용)'); END;
`,
  },
  {
    // 보고서 v1.1 WP10 — 운행 중 감시 지표(FFG-TEL-009, 13.5): Feature Version별 Safety Case 경보 기준 기록(추가만 — 최신 기록이 유효)
    name: '033_safety_metric_plan',
    sql: `
CREATE TABLE safety_metric_plan (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id TEXT NOT NULL, version TEXT NOT NULL, doc TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL);
CREATE INDEX safety_metric_plan_fv ON safety_metric_plan (feature_id, version, id);
CREATE TRIGGER safety_metric_plan_no_update BEFORE UPDATE ON safety_metric_plan BEGIN SELECT RAISE(ABORT, 'safety_metric_plan은 추가만 가능'); END;
CREATE TRIGGER safety_metric_plan_no_delete BEFORE DELETE ON safety_metric_plan BEGIN SELECT RAISE(ABORT, 'safety_metric_plan은 추가만 가능'); END;
`,
  },
  {
    // 보고서 v1.1 WP10 — EU Data Act 접근권(FFG-TEL-006): 요청 처리 기록(제공·거부, 내보낸 내용은 해시만)과 OEM 비개인 데이터 이용 계약 근거(문서 ID). 둘 다 추가만
    name: '034_data_act',
    sql: `
CREATE TABLE data_access_request (request_id TEXT PRIMARY KEY, vin TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE TRIGGER data_access_request_no_update BEFORE UPDATE ON data_access_request BEGIN SELECT RAISE(ABORT, 'data_access_request는 추가만 가능'); END;
CREATE TRIGGER data_access_request_no_delete BEFORE DELETE ON data_access_request BEGIN SELECT RAISE(ABORT, 'data_access_request는 추가만 가능'); END;
CREATE TABLE data_act_contract_basis (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL, note TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL);
CREATE TRIGGER data_act_contract_basis_no_update BEFORE UPDATE ON data_act_contract_basis BEGIN SELECT RAISE(ABORT, 'data_act_contract_basis는 추가만 가능'); END;
CREATE TRIGGER data_act_contract_basis_no_delete BEFORE DELETE ON data_act_contract_basis BEGIN SELECT RAISE(ABORT, 'data_act_contract_basis는 추가만 가능'); END;
`,
  },
  {
    // 보고서 v1.1 — IAM 직무 분리(FFG-PLT-016): 긴급 권한(Kill 발행) 사후 독립 검토 기록. 한 명령에 한 번, 추가만
    name: '035_kill_post_review',
    sql: `
CREATE TABLE kill_post_review (kill_id TEXT PRIMARY KEY, reviewer TEXT NOT NULL, role TEXT NOT NULL, at TEXT NOT NULL, summary TEXT NOT NULL);
CREATE TRIGGER kill_post_review_no_update BEFORE UPDATE ON kill_post_review BEGIN SELECT RAISE(ABORT, 'kill_post_review는 추가만 가능'); END;
CREATE TRIGGER kill_post_review_no_delete BEFORE DELETE ON kill_post_review BEGIN SELECT RAISE(ABORT, 'kill_post_review는 추가만 가능'); END;
`,
  },
  {
    // 보고서 v1.1 — 변경 기록(FFG-CODE-030): CI/CD(IF-13)가 SW Version마다 등록. AI 생성 표시·도구·범위와 검토·분석·시험·커버리지 근거.
    // 추가만 — 근거 보완은 같은 변경 ID의 새 개정(rev)이고 최신 개정으로 판정한다
    name: '036_change_record',
    sql: `
CREATE TABLE change_record (change_id TEXT NOT NULL, rev INTEGER NOT NULL, sw_id TEXT NOT NULL, sw_version TEXT NOT NULL, ai INTEGER NOT NULL, at TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (change_id, rev));
CREATE INDEX change_record_sw ON change_record (sw_id, sw_version);
CREATE TRIGGER change_record_no_update BEFORE UPDATE ON change_record BEGIN SELECT RAISE(ABORT, 'change_record는 추가만 가능'); END;
CREATE TRIGGER change_record_no_delete BEFORE DELETE ON change_record BEGIN SELECT RAISE(ABORT, 'change_record는 추가만 가능'); END;
`,
  },
  {
    // 보고서 v1.1 6.5 — Flag 은퇴 6단계(FFG-LCY-011 플랫폼 몫): 은퇴 건 진행 기록(단계마다 감사). 삭제 금지 — 기록 보존이 6단계
    name: '037_flag_retirement',
    sql: `
CREATE TABLE flag_retirement (retirement_id TEXT PRIMARY KEY, flag_key TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX flag_retirement_flag ON flag_retirement (flag_key, status);
CREATE TRIGGER flag_retirement_no_delete BEFORE DELETE ON flag_retirement BEGIN SELECT RAISE(ABORT, 'flag_retirement는 삭제할 수 없음(기록 보존)'); END;
`,
  },
  {
    // 기능명세서 공통 — 수신자 지정 알림(D04-04): 이벤트 하나에 알림 하나(같은 트랜잭션), 수신자 키(개인·역할·팀), 계정별 읽음,
    // 이메일 설정과 모의 발송 기록. 알림·발송 기록은 추가만 — 읽음만 계정별로 쌓인다
    name: '038_notification',
    sql: `
CREATE TABLE notification (notification_id TEXT PRIMARY KEY, event_seq INTEGER NOT NULL UNIQUE, category TEXT NOT NULL, severity TEXT NOT NULL, created_at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE TABLE notification_recipient (notification_id TEXT NOT NULL, rkey TEXT NOT NULL, PRIMARY KEY (notification_id, rkey));
CREATE INDEX notification_recipient_key ON notification_recipient (rkey, notification_id);
CREATE TABLE notification_exclude (notification_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (notification_id, user_id));
CREATE TABLE notification_read (notification_id TEXT NOT NULL, user_id TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (notification_id, user_id));
CREATE TABLE notification_pref (user_id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE notification_email (id INTEGER PRIMARY KEY AUTOINCREMENT, notification_id TEXT NOT NULL, user_id TEXT NOT NULL, address TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX notification_email_user ON notification_email (user_id, id);
CREATE TRIGGER notification_no_update BEFORE UPDATE ON notification BEGIN SELECT RAISE(ABORT, 'notification은 추가만 가능'); END;
CREATE TRIGGER notification_no_delete BEFORE DELETE ON notification BEGIN SELECT RAISE(ABORT, 'notification은 추가만 가능'); END;
CREATE TRIGGER notification_email_no_delete BEFORE DELETE ON notification_email BEGIN SELECT RAISE(ABORT, 'notification_email은 추가만 가능'); END;
`,
  },
  {
    // 정책 버전 이력 — 개정본마다 내용 전체(doc)를 남긴다. 이력 저장 이전에 있던 정책은 지금 개정본을 IMPORTED로 시작점 삼는다
    name: '039_policy_revision',
    sql: `
CREATE TABLE policy_revision (policy_id TEXT NOT NULL, revision INTEGER NOT NULL, content_hash TEXT NOT NULL, kind TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL, restored_from INTEGER, reason TEXT, doc TEXT NOT NULL, PRIMARY KEY (policy_id, revision));
INSERT INTO policy_revision (policy_id, revision, content_hash, kind, changed_by, changed_at, restored_from, reason, doc)
  SELECT policy_id, revision, json_extract(doc, '$.contentHash'), 'IMPORTED', json_extract(doc, '$.createdBy'), json_extract(doc, '$.createdAt'), NULL, NULL, doc FROM policy;
CREATE TRIGGER policy_revision_no_update BEFORE UPDATE ON policy_revision BEGIN SELECT RAISE(ABORT, 'policy_revision은 추가만 가능'); END;
CREATE TRIGGER policy_revision_no_delete BEFORE DELETE ON policy_revision BEGIN SELECT RAISE(ABORT, 'policy_revision은 추가만 가능'); END;
`,
  },
  {
    // 롤백(D03-04) — Rollback Plan·수동 롤백 요청·롤백 실행. 상태가 바뀌는 기록이라 갱신은 되지만 지울 수 없다(변경은 감사에 남는다)
    name: '040_rollback',
    sql: `
CREATE TABLE rollback_plan (plan_id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, feature_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX rollback_plan_deployment ON rollback_plan (deployment_id, status);
CREATE TABLE rollback_request (request_id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, feature_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE TABLE rollback_execution (execution_id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, feature_id TEXT NOT NULL, plan_id TEXT, request_id TEXT, status TEXT NOT NULL, result TEXT, artifact_id TEXT, started_at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX rollback_execution_artifact ON rollback_execution (artifact_id);
CREATE TRIGGER rollback_plan_no_delete BEFORE DELETE ON rollback_plan BEGIN SELECT RAISE(ABORT, 'rollback_plan은 지울 수 없다'); END;
CREATE TRIGGER rollback_request_no_delete BEFORE DELETE ON rollback_request BEGIN SELECT RAISE(ABORT, 'rollback_request는 지울 수 없다'); END;
CREATE TRIGGER rollback_execution_no_delete BEFORE DELETE ON rollback_execution BEGIN SELECT RAISE(ABORT, 'rollback_execution은 지울 수 없다'); END;
`,
  },
  {
    // 5년 운영 — 권한 수십만 건: 만료 sweep(ACTIVE만)을 색인으로(상품별 조회 색인은 이미 있다)
    name: '041_ops5y_indexes',
    sql: `
CREATE INDEX entitlement_status ON entitlement(status);
`,
  },
  {
    // Release Sign-off(출시 책임 확인) — 보고서 6.1 G7 승인자 Feature Owner의 개인 서명(사용자 결정 2026-10-18).
    // 추가만: 다시 판정되면 새 서명을 더한다(이전 서명은 판정 기록이 달라 효력 없음).
    name: '042_release_signoff',
    sql: `
CREATE TABLE release_signoff (signoff_id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id TEXT NOT NULL, feature_version TEXT NOT NULL, g8_record TEXT NOT NULL, g9_record TEXT NOT NULL, signed_by TEXT NOT NULL, signed_at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX release_signoff_version ON release_signoff (feature_id, feature_version);
CREATE TRIGGER release_signoff_no_update BEFORE UPDATE ON release_signoff BEGIN SELECT RAISE(ABORT, 'release_signoff은 추가만 가능'); END;
CREATE TRIGGER release_signoff_no_delete BEFORE DELETE ON release_signoff BEGIN SELECT RAISE(ABORT, 'release_signoff은 추가만 가능'); END;
`,
  },
  {
    // GitLab · JIRA · codeBeamer 양방향 연계(사용자 결정 2026-10-18) — 외부 항목 마지막 관측 값·연결·보낼 함·받은 함·충돌,
    // 그리고 실서버가 없을 때의 모의 외부 시스템(mock_ext_*). 보낼 함은 변경과 같은 트랜잭션에서 쌓인다.
    name: '043_ext_sync',
    sql: `
CREATE TABLE ext_item (system TEXT NOT NULL, ext_key TEXT NOT NULL, kind TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (system, ext_key));
CREATE TABLE ext_link (link_id INTEGER PRIMARY KEY AUTOINCREMENT, system TEXT NOT NULL, ext_key TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, UNIQUE (system, ext_key, entity, entity_id));
CREATE INDEX ext_link_entity ON ext_link (entity, entity_id);
CREATE TABLE sync_outbox (job_id INTEGER PRIMARY KEY AUTOINCREMENT, system TEXT NOT NULL, idem_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, attempts INTEGER NOT NULL, next_at TEXT NOT NULL, created_at TEXT NOT NULL, done_at TEXT, doc TEXT NOT NULL);
CREATE INDEX sync_outbox_due ON sync_outbox (status, next_at);
CREATE TABLE sync_inbox (system TEXT NOT NULL, delivery_id TEXT NOT NULL, received_at TEXT NOT NULL, ext_key TEXT NOT NULL, outcome TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (system, delivery_id));
CREATE TABLE sync_conflict (conflict_id INTEGER PRIMARY KEY AUTOINCREMENT, system TEXT NOT NULL, ext_key TEXT NOT NULL, field TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE TABLE mock_ext_item (system TEXT NOT NULL, ext_key TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (system, ext_key));
CREATE TABLE mock_ext_seq (scope TEXT PRIMARY KEY, n INTEGER NOT NULL);
`,
  },
  {
    // 업무 절차 실행(docs/65-workflows C3) — 활동 완료를 서버에 저장한다. 취소는 undone_at으로 남기고 행은 지우지 않는다(감사 추적).
    // procedure_overdue는 SLA 초과 알림을 활동당 한 번만 보내기 위한 표시다(완료·취소 시 지운다).
    name: '044_procedure',
    sql: `
CREATE TABLE procedure_completion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id TEXT NOT NULL,
  process_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  completed_by TEXT NOT NULL,
  completed_role TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  note TEXT,
  evidence_doc TEXT NOT NULL,
  signature_doc TEXT,
  undone_at TEXT,
  undone_by TEXT
);
CREATE INDEX procedure_completion_current ON procedure_completion (activity_id, undone_at);
CREATE TABLE procedure_overdue (activity_id TEXT PRIMARY KEY, notified_at TEXT NOT NULL, due_at TEXT NOT NULL);
`,
  },
  {
    // OIDC 로그인 세션(출시 준비 RD-SEC-01·04) — 쿠키에는 무작위 32바이트 ID, 표에는 그 SHA-256만 둔다(DB를 읽어도 세션을 훔칠 수 없다).
    // 절대 수명(expires_at)과 유휴 만료(last_seen_at 기준)를 둘 다 본다. 데모 모드에서는 쓰지 않는다.
    name: '045_auth_session',
    sql: `
CREATE TABLE auth_session (
  id_hash TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  name TEXT,
  email TEXT,
  roles TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX auth_session_sub ON auth_session (sub);
CREATE INDEX auth_session_expires ON auth_session (expires_at);
`,
  },
  {
    // 차량 채널(출시 준비 RD-SEC-08·RD-OPS-04) — 서명된 차량 요청의 nonce(재전송 방지, 허용 시각 창이 지나면 지운다)와
    // 차량 당겨받기 채널의 전달함(차량이 HTTPS로 받아 가고 서명된 확인을 보낸다). 전달함 행은 확인 뒤에도 남긴다(추적).
    name: '046_vehicle_channel',
    sql: `
CREATE TABLE vehicle_request_nonce (vin TEXT NOT NULL, nonce TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (vin, nonce));
CREATE INDEX vehicle_request_nonce_at ON vehicle_request_nonce (at);
CREATE TABLE vehicle_delivery (
  delivery_id TEXT PRIMARY KEY,
  vin TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  fetched_at TEXT,
  fetch_count INTEGER NOT NULL DEFAULT 0,
  acked_at TEXT,
  ack_doc TEXT,
  UNIQUE (vin, publication_id)
);
CREATE INDEX vehicle_delivery_pending ON vehicle_delivery (vin, acked_at, queued_at);
`,
  },
  {
    // 대시보드(Jira식 가젯 판) — 사용자가 만든 판을 서버에 둔다. layout은 판 JSON(v2: 열 레이아웃 + 가젯 인스턴스·설정),
    // shared_roles는 보기를 허용한 플랫폼 역할 JSON 배열, version은 겹친 저장을 막는 낙관적 잠금(If-Match, 412).
    // favourite는 소유자의 별, 남의 대시보드 별은 dashboard_star(보는 사람별)에 둔다.
    name: '047_dashboard',
    sql: `
CREATE TABLE dashboard (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  layout TEXT NOT NULL,
  shared_roles TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  favourite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX dashboard_owner ON dashboard (owner_id);
CREATE TABLE dashboard_star (actor_id TEXT NOT NULL, dashboard_id TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (actor_id, dashboard_id));
`,
  },
  {
    // 알림 메일 채널 제거(사용자 결정 D-RD-7, 2026-10-24: 화면 알림만) — 038의 메일 설정(notification_pref)·모의 발송 기록
    // (notification_email)을 지운다. 실제 메일은 한 번도 나간 적이 없다(모의 기록뿐). 038은 고치지 않는다(잠금).
    // SQLite는 DROP TABLE 전에 그 표의 트리거(추가만 가능)를 먼저 지우므로 삭제 금지 트리거가 막지 않는다.
    // 알림·수신자·제외·읽음 표는 그대로 — 화면 알림과 읽음 상태가 쓴다.
    name: '048_drop_notification_email',
    sql: `
DROP TABLE IF EXISTS notification_email;
DROP TABLE IF EXISTS notification_pref;
`,
  },
  {
    // OTA 서버 연동(IF-05, FF_VEHICLE_CHANNEL=ota) — 게시본마다 OTA 작업 1건(job_id = 멱등 키). 게시본을 만든 트랜잭션에서 QUEUED로 넣고(outbox),
    // 커밋 뒤 제출한다. 실패하면 게시본은 그대로 두고 전달만 RETRY_WAIT(전달 실패·재시도 가능)·FAILED로 남긴다.
    // ota_job_vehicle은 OTA 서버가 webhook으로 알린 차량별 결과, ota_event는 받은 webhook 이벤트 ID(재전송 방지·같은 이벤트는 한 번만).
    name: '049_ota_job',
    sql: `
CREATE TABLE ota_job (
  job_id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  targets TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  ota_job_id TEXT,
  server_state TEXT,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX ota_job_due ON ota_job (state, next_attempt_at);
CREATE TABLE ota_job_vehicle (
  job_id TEXT NOT NULL,
  vin TEXT NOT NULL,
  outcome TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL,
  event_id TEXT,
  PRIMARY KEY (job_id, vin)
);
CREATE TABLE ota_event (event_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, body_sha256 TEXT NOT NULL, received_at TEXT NOT NULL, outcome TEXT NOT NULL);
CREATE INDEX ota_event_received ON ota_event (received_at);
`,
  },
  {
    // 고객 기준 값(출시 준비 RD-OPS-03) — 판매국·지역·차종·트림을 설치마다 등록한다. 데모 데이터셋 값은 데모 시드만 넣는다(origin SEED).
    // 부모가 없는 종류(판매국·차종)는 parent = ''(빈 문자열)로 두어 기본 키가 NULL로 갈라지지 않게 한다. 쓰인 값은 지우지 않고 사용 중지(RETIRED)만.
    name: '065_reference_value',
    sql: `
CREATE TABLE reference_value (
  kind TEXT NOT NULL CHECK (kind IN ('COUNTRY','REGION','VEHICLE_MODEL','TRIM')),
  code TEXT NOT NULL,
  parent TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('SEED','CUSTOMER')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  retired_at TEXT,
  retired_reason TEXT,
  PRIMARY KEY (kind, parent, code)
);
CREATE INDEX entitlement_source ON entitlement (source);
`,
  },
  {
    // 개인정보 삭제·가명 처리(출시 준비 RD-P2-05) — 감사 체인 v2: 행마다 무작위 소금(audit_salt)으로 식별 칸(행위자·대상·사유·전후 문서)의
    // 해시를 따로 두고(*_d), 행 해시는 그 칸 해시로 잇는다. 가명 처리는 식별 칸 값만 바꾸고 소금을 지운다 — 칸 해시·행 해시가 그대로라 체인 검증이 통과하고,
    // 소금이 없으면 지운 값을 다시 맞혀 볼 수 없다. 바꾼 행은 audit_redaction(묶음 = 그 처리를 기록한 감사 행 id)에 바뀐 뒤 내용의 해시로 남기고,
    // 묶음 전체의 해시는 체인 안의 처리 기록이 갖는다 — 처리 기록 없이 바꾼 행·지운 소금은 검증이 잡는다.
    // 감사 수정·소금 삭제·추가만 알림의 수정·삭제는 처리 트랜잭션(privacy_gate.active = 1) 안에서만 풀린다. 감사 행 삭제는 언제나 막는다.
    // privacy_subject는 사람·차량 ↔ 가명 대응표(가명처리 추가 정보, 따로 둔다) — 삭제 처리 때 subject_id를 지워 되돌릴 수 없게 한다.
    name: '066_privacy',
    sql: `
CREATE TABLE privacy_gate (id INTEGER PRIMARY KEY CHECK (id = 1), active INTEGER NOT NULL);
INSERT INTO privacy_gate (id, active) VALUES (1, 0);
ALTER TABLE audit ADD COLUMN chain_v INTEGER NOT NULL DEFAULT 1;
ALTER TABLE audit ADD COLUMN actor_d TEXT;
ALTER TABLE audit ADD COLUMN target_d TEXT;
ALTER TABLE audit ADD COLUMN reason_d TEXT;
ALTER TABLE audit ADD COLUMN before_d TEXT;
ALTER TABLE audit ADD COLUMN after_d TEXT;
CREATE TABLE audit_salt (audit_id INTEGER PRIMARY KEY, salt TEXT NOT NULL);
CREATE TRIGGER audit_salt_no_update BEFORE UPDATE ON audit_salt BEGIN SELECT RAISE(ABORT, 'audit_salt는 추가만 가능'); END;
CREATE TRIGGER audit_salt_no_delete BEFORE DELETE ON audit_salt WHEN (SELECT active FROM privacy_gate WHERE id = 1) = 0 BEGIN SELECT RAISE(ABORT, 'audit_salt는 개인정보 처리 중에만 지울 수 있다'); END;
CREATE TABLE audit_redaction (audit_id INTEGER NOT NULL, batch_id INTEGER NOT NULL, redacted_digest TEXT NOT NULL, PRIMARY KEY (audit_id, batch_id));
CREATE INDEX audit_redaction_batch ON audit_redaction (batch_id);
CREATE TRIGGER audit_redaction_no_update BEFORE UPDATE ON audit_redaction BEGIN SELECT RAISE(ABORT, 'audit_redaction은 추가만 가능'); END;
CREATE TRIGGER audit_redaction_no_delete BEFORE DELETE ON audit_redaction BEGIN SELECT RAISE(ABORT, 'audit_redaction은 추가만 가능'); END;
DROP TRIGGER audit_no_update;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit WHEN OLD.hash IS NOT NULL AND NOT (
  (SELECT active FROM privacy_gate WHERE id = 1) = 1 AND OLD.chain_v = 2 AND NEW.chain_v = 2 AND NEW.id = OLD.id
  AND NEW.at IS OLD.at AND NEW.actor_role IS OLD.actor_role AND NEW.action IS OLD.action AND NEW.result IS OLD.result
  AND NEW.correlation_id IS OLD.correlation_id AND NEW.component_id IS OLD.component_id AND NEW.prev_hash IS OLD.prev_hash AND NEW.hash IS OLD.hash
  AND NEW.actor_d IS OLD.actor_d AND NEW.target_d IS OLD.target_d AND NEW.reason_d IS OLD.reason_d AND NEW.before_d IS OLD.before_d AND NEW.after_d IS OLD.after_d
) BEGIN SELECT RAISE(ABORT, 'audit is append-only (FFG-PLT-015)'); END;
DROP TRIGGER notification_no_update;
CREATE TRIGGER notification_no_update BEFORE UPDATE ON notification WHEN (SELECT active FROM privacy_gate WHERE id = 1) = 0 BEGIN SELECT RAISE(ABORT, 'notification은 추가만 가능(개인정보 처리만 허용)'); END;
DROP TRIGGER notification_no_delete;
CREATE TRIGGER notification_no_delete BEFORE DELETE ON notification WHEN (SELECT active FROM privacy_gate WHERE id = 1) = 0 BEGIN SELECT RAISE(ABORT, 'notification은 추가만 가능(보존 기한·개인정보 처리만 허용)'); END;
CREATE TABLE privacy_subject (pseudonym TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('USER','VEHICLE')), subject_id TEXT, created_at TEXT NOT NULL, erased_at TEXT, UNIQUE (kind, subject_id));
CREATE TABLE privacy_request (request_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('REQUESTED','DONE','REJECTED')), requested_by TEXT NOT NULL, requested_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT, doc TEXT NOT NULL);
`,
  },
  {
    // 공유 상태(출시 준비 RD-OPS-14 · 20-92 §3) — 프로세스 메모리에 있던 것을 DB로 옮겨 같은 DB를 쓰는 인스턴스가 함께 본다.
    // shared_reservation: 처리 중 예약(멱등 키 — 같은 키가 다른 인스턴스에 와도 409), 만료 시각(벽시계 ms)이 지나면 다른 쪽이 잡는다.
    // shared_counter: 고정 창 카운터(차량별 요청 빈도). instance_lease: 단일 실행 인스턴스 임대(두 번째 인스턴스 부팅 거부).
    name: '075_shared_state',
    sql: `
CREATE TABLE shared_reservation (slot TEXT PRIMARY KEY, value TEXT NOT NULL, holder TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE shared_counter (key TEXT PRIMARY KEY, start_ms INTEGER NOT NULL, n INTEGER NOT NULL);
CREATE TABLE instance_lease (name TEXT PRIMARY KEY, holder TEXT NOT NULL, acquired_at TEXT NOT NULL, renewed_at TEXT NOT NULL, expires_at INTEGER NOT NULL);
`,
  },
];
