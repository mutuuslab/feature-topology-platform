// 스키마 마이그레이션 — 이름 순 적용, 적용된 것은 다시 실행하지 않는다. 기존 항목은 수정하지 말고 새 항목을 추가한다.
// 도메인 레코드는 "키 열 + doc(JSON)" 형태로 저장한다: 키·조회 조건은 열로, 본문은 contracts zod 스키마로 파싱.
export const MIGRATIONS: { name: string; sql: string }[] = [
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
];
