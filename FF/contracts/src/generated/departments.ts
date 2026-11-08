// 생성 파일 — tools/workflow-sync.ts가 docs/65-workflows/out/workflows.json에서 만든다. 손으로 고치지 않는다(workflow:check가 잡는다).
import type { DepartmentsDoc } from '../rules/workflows';

export const DEPARTMENTS: DepartmentsDoc = {
 "departments": [
  {
   "id": "DEP-PDP",
   "name": "상품기획팀",
   "en": "Product Planning",
   "desc": "Feature를 소유하고 대상·분류·출시를 판단한다. 상품 구성과 체험 제안을 만들고 고객 출시를 승인한다.",
   "workspace": "studio",
   "roles": [
    "R-FO",
    "R-PDA",
    "R-PO"
   ],
   "personas": [
    "author",
    "commerce",
    "approver",
    "productowner"
   ],
   "screens": {
    "primary": [
     "/master/define",
     "/feature/propose",
     "/features",
     "/master/feature-db",
     "/master/taxonomy/levels",
     "/variant-conditions",
     "/arch/topology",
     "/features/catalogue",
     "/features/:id/:ver",
     "/master/artifacts",
     "/integration/connectors",
     "/policies/:id",
     "/baselines",
     "/experiments",
     "/products/new",
     "/entitlements",
     "/products/bill-of-features",
     "/products/configurator",
     "/products/:id/:ver",
     "/activation/decide",
     "/admin/approval",
     "/flag-retirements",
     "/flag-code/lifecycle",
     "/master/feature-db/:refId",
     "/data/workbench",
     "/biz/trials",
     "/products"
    ],
    "reference": [
     "/analysis/impact",
     "/trace/design",
     "/change/cr",
     "/policies/new",
     "/policies",
     "/config/odd",
     "/policies/global-scope",
     "/flag-code",
     "/flag-code/flags/:flagKey",
     "/validations/virtual",
     "/flag-code/reconcile",
     "/integration/code-scans",
     "/verify/evidence",
     "/config/compat",
     "/deployments",
     "/deployments/software",
     "/ops/ota-installs",
     "/deployments/campaigns/:id",
     "/verify/exceptions",
     "/verify/compliance",
     "/verify/safety-case",
     "/fleet/live",
     "/notifications",
     "/ops/flag-evaluations",
     "/ops/anomalies",
     "/ops/safety-kpi",
     "/ops/incidents",
     "/ops/incident-reports/:id",
     "/ops/feature-health",
     "/ops/feature-health/:findingId",
     "/ops/collection",
     "/integration/datalake",
     "/ops/kill",
     "/audit",
     "/quality/feedback",
     "/trace/ads",
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes",
     "/procurement/sw-cost",
     "/procurement/sw-cost/:estId",
     "/master/reference-values",
     "/master/taxonomy",
     "/master/upg",
     "/master/structure",
     "/features/shared-assets",
     "/change/eo",
     "/ops/telemetry",
     "/fleet/map",
     "/fleet/vehicles",
     "/fleet/vehicles/:vin"
    ]
   },
   "counts": {
    "R": 16,
    "A": 18,
    "C": 27,
    "I": 39
   }
  },
  {
   "id": "DEP-SE",
   "name": "시스템엔지니어링팀",
   "en": "Systems Engineering",
   "desc": "안전요구를 확정하고 Feature 정의를 승인한다. Control Point·안전 설계의 적합성을 책임지고, 담당 도메인의 Feature DB 변경 요청을 검토한다.",
   "workspace": "console",
   "roles": [
    "R-REQ",
    "R-ARC",
    "R-DRV"
   ],
   "personas": [
    "approver",
    "integrator"
   ],
   "screens": {
    "primary": [
     "/trace/design",
     "/change/cr",
     "/features/:id/:ver",
     "/admin/approval",
     "/master/control-points",
     "/policies/new",
     "/policies",
     "/config/odd",
     "/policies/global-scope",
     "/policies/:id",
     "/flag-code",
     "/flag-code/flags/:flagKey",
     "/flag-code/reconcile",
     "/flag-retirements",
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes",
     "/master/taxonomy",
     "/master/upg",
     "/master/structure",
     "/features/shared-assets",
     "/change/eo"
    ],
    "reference": [
     "/master/define",
     "/feature/propose",
     "/features",
     "/master/feature-db",
     "/master/taxonomy/levels",
     "/variant-conditions",
     "/arch/topology",
     "/features/catalogue",
     "/analysis/impact",
     "/master/artifacts",
     "/integration/connectors",
     "/arch/components",
     "/validations",
     "/verify/evidence",
     "/baselines",
     "/integration/code-repositories",
     "/integration/code-repositories/:repoId",
     "/integration/code-scans",
     "/integration/openfeature",
     "/master/feature-db/:refId",
     "/procurement/sw-cost/:estId",
     "/precheck",
     "/trace/coverage"
    ]
   },
   "counts": {
    "R": 11,
    "A": 13,
    "C": 25,
    "I": 19
   }
  },
  {
   "id": "DEP-INT",
   "name": "SW통합·릴리스팀",
   "en": "SW Integration & Release",
   "desc": "통합 빌드와 Baseline·출시 묶음을 관리하고 출시 전이를 실행한다.",
   "workspace": "console",
   "roles": [
    "R-INT",
    "R-REL"
   ],
   "personas": [
    "coordinator",
    "integrator"
   ],
   "screens": {
    "primary": [
     "/features/:id/:ver",
     "/master/artifacts",
     "/integration/connectors",
     "/flag-code",
     "/flag-code/flags/:flagKey",
     "/flag-code/reconcile",
     "/integration/code-scans",
     "/deployments",
     "/deployments/software",
     "/ops/ota-installs",
     "/deployments/campaigns/:id",
     "/integration/code-repositories",
     "/integration/code-repositories/:repoId",
     "/verify/exceptions",
     "/policies/:id",
     "/flag-code/lifecycle",
     "/flag-retirements",
     "/precheck",
     "/trace/coverage"
    ],
    "reference": [
     "/master/control-points",
     "/trace/design",
     "/arch/topology",
     "/validations",
     "/validations/virtual",
     "/verify/evidence",
     "/verify/safety-case",
     "/admin/approval",
     "/baselines",
     "/config/compat",
     "/activation/decide",
     "/experiments",
     "/fleet/live",
     "/notifications",
     "/ops/flag-evaluations",
     "/ops/rollback",
     "/deployments/:id",
     "/fleet/vehicles/:vin",
     "/supplier/portal",
     "/supplier/deliveries",
     "/admin/security",
     "/integration/openfeature",
     "/procurement/sw-cost/:estId",
     "/master/reference-values",
     "/master/taxonomy",
     "/master/upg",
     "/master/structure",
     "/features/shared-assets",
     "/change/eo",
     "/integration/sync",
     "/integration/legacy",
     "/field",
     "/baselines/eol"
    ]
   },
   "counts": {
    "R": 15,
    "A": 14,
    "C": 24,
    "I": 25
   }
  },
  {
   "id": "DEP-PLM",
   "name": "PLM·기준정보팀",
   "en": "PLM & Master Data",
   "desc": "차량 사양·Variant·BOM 기준선을 관리하고 확정을 승인한다. Feature DB 기준 행 변경을 승인하고 버전을 발행한다.",
   "workspace": "console",
   "roles": [
    "R-PLM",
    "R-RDA"
   ],
   "personas": [
    "steward"
   ],
   "screens": {
    "primary": [
     "/variant-conditions",
     "/arch/topology",
     "/features/catalogue",
     "/baselines",
     "/config/compat",
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes",
     "/master/feature-db",
     "/master/taxonomy/levels",
     "/master/reference-values"
    ],
    "reference": [
     "/master/define",
     "/feature/propose",
     "/features",
     "/features/:id/:ver",
     "/admin/approval",
     "/master/artifacts",
     "/integration/connectors",
     "/policies/new",
     "/policies",
     "/config/odd",
     "/policies/global-scope",
     "/master/feature-db/:refId",
     "/master/taxonomy",
     "/master/upg",
     "/master/structure",
     "/features/shared-assets",
     "/change/eo",
     "/precheck",
     "/trace/coverage",
     "/integration/sync",
     "/integration/legacy",
     "/field",
     "/baselines/eol"
    ]
   },
   "counts": {
    "R": 7,
    "A": 6,
    "C": 7,
    "I": 8
   }
  },
  {
   "id": "DEP-FS",
   "name": "기능안전팀",
   "en": "Functional Safety",
   "desc": "안전 분류·HARA·Safety Case를 책임지고 Gate 판정과 긴급 차단·복원 승인을 한다.",
   "workspace": "review",
   "roles": [
    "R-SM"
   ],
   "personas": [
    "quality",
    "safety2",
    "integrator"
   ],
   "screens": {
    "primary": [
     "/features/:id/:ver",
     "/admin/approval",
     "/analysis/impact",
     "/arch/topology",
     "/arch/components",
     "/verify/exceptions",
     "/verify/evidence",
     "/verify/compliance",
     "/verify/safety-case",
     "/activation/decide",
     "/ops/kill",
     "/fleet/live",
     "/deployments",
     "/ops/rollback",
     "/flag-retirements",
     "/ops/safety-kpi",
     "/trace/ads"
    ],
    "reference": [
     "/master/define",
     "/feature/propose",
     "/features",
     "/master/feature-db",
     "/master/taxonomy/levels",
     "/variant-conditions",
     "/features/catalogue",
     "/trace/design",
     "/change/cr",
     "/integration/connectors",
     "/master/control-points",
     "/policies/:id",
     "/validations",
     "/master/artifacts",
     "/validations/virtual",
     "/deployments/software",
     "/ops/ota-installs",
     "/deployments/campaigns/:id",
     "/flag-code/reconcile",
     "/experiments",
     "/notifications",
     "/ops/anomalies",
     "/ops/incidents",
     "/ops/incident-reports/:id",
     "/ops/feature-health",
     "/ops/feature-health/:findingId",
     "/ops/collection",
     "/integration/datalake",
     "/ops/incident-reports",
     "/audit/oversight",
     "/audit",
     "/deployments/:id",
     "/fleet/vehicles/:vin",
     "/quality/feedback",
     "/supplier/portal",
     "/supplier/deliveries",
     "/admin/security",
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes",
     "/data/workbench",
     "/products"
    ]
   },
   "counts": {
    "R": 19,
    "A": 19,
    "C": 38,
    "I": 11
   }
  },
  {
   "id": "DEP-CS",
   "name": "차량사이버보안팀",
   "en": "Vehicle Cybersecurity",
   "desc": "TARA·보안 검토를 하고 긴급 차단 2인 승인과 키 교체 기록을 맡는다.",
   "workspace": "review",
   "roles": [
    "R-CSM"
   ],
   "personas": [
    "integrator"
   ],
   "screens": {
    "primary": [
     "/ops/kill",
     "/admin/security",
     "/admin/data",
     "/verify/compliance",
     "/trace/ads"
    ],
    "reference": [
     "/features/:id/:ver",
     "/admin/approval",
     "/arch/components",
     "/deployments",
     "/master/artifacts",
     "/deployments/software",
     "/audit/oversight",
     "/fleet/live",
     "/admin/iam",
     "/admin/settings",
     "/events",
     "/notifications/rules",
     "/data/workbench",
     "/products"
    ]
   },
   "counts": {
    "R": 9,
    "A": 8,
    "C": 22,
    "I": 1
   }
  },
  {
   "id": "DEP-HOM",
   "name": "법규인증팀",
   "en": "Homologation & Regulatory",
   "desc": "시장별 법규·형식승인·사용자 고지를 확인하고 Compliance Profile과 긴급 권한 사후 검토를 맡는다.",
   "workspace": "review",
   "roles": [
    "R-REG"
   ],
   "personas": [
    "steward"
   ],
   "screens": {
    "primary": [
     "/ops/incident-reports",
     "/admin/data",
     "/verify/compliance",
     "/trace/ads"
    ],
    "reference": [
     "/features/:id/:ver",
     "/admin/approval",
     "/baselines",
     "/config/compat",
     "/activation/decide",
     "/ops/kill",
     "/audit/oversight",
     "/audit",
     "/admin/security",
     "/master/feature-db",
     "/admin/iam",
     "/master/reference-values"
    ]
   },
   "counts": {
    "R": 11,
    "A": 10,
    "C": 14,
    "I": 7
   }
  },
  {
   "id": "DEP-VAL",
   "name": "시험·검증팀",
   "en": "Test & Validation",
   "desc": "독립 V&V를 계획·실행하고 검증 Gate를 판정한다.",
   "workspace": "review",
   "roles": [
    "R-TST"
   ],
   "personas": [
    "quality"
   ],
   "screens": {
    "primary": [
     "/arch/topology",
     "/validations",
     "/validations/virtual",
     "/verify/evidence",
     "/verify/safety-case",
     "/admin/approval",
     "/supplier/portal",
     "/supplier/deliveries"
    ],
    "reference": [
     "/analysis/impact",
     "/trace/design",
     "/change/cr",
     "/features/:id/:ver",
     "/master/artifacts",
     "/integration/connectors",
     "/master/control-points",
     "/flag-code",
     "/flag-code/flags/:flagKey",
     "/flag-code/reconcile",
     "/integration/code-scans",
     "/activation/decide",
     "/policies/:id",
     "/verify/compliance",
     "/ops/kill",
     "/quality/feedback",
     "/flag-retirements",
     "/flag-code/lifecycle",
     "/data/workbench",
     "/ops/telemetry",
     "/fleet/map",
     "/fleet/vehicles",
     "/fleet/vehicles/:vin"
    ]
   },
   "counts": {
    "R": 4,
    "A": 4,
    "C": 14,
    "I": 7
   }
  },
  {
   "id": "DEP-QA",
   "name": "품질팀",
   "en": "Quality",
   "desc": "독립 검토자로서 설계·Safety Case를 검토하고 Evidence와 감사 이력을 확인한다.",
   "workspace": "review",
   "roles": [
    "R-QA"
   ],
   "personas": [
    "quality",
    "viewer"
   ],
   "screens": {
    "primary": [
     "/features/:id/:ver",
     "/admin/approval",
     "/verify/evidence",
     "/audit/oversight",
     "/ops/kill",
     "/quality/feedback",
     "/supplier/portal",
     "/supplier/deliveries"
    ],
    "reference": [
     "/arch/components",
     "/master/artifacts",
     "/validations/virtual",
     "/verify/safety-case",
     "/deployments",
     "/deployments/software",
     "/integration/connectors",
     "/ops/ota-installs",
     "/deployments/campaigns/:id",
     "/verify/exceptions",
     "/verify/compliance",
     "/activation/decide",
     "/fleet/live",
     "/notifications",
     "/ops/anomalies",
     "/ops/safety-kpi",
     "/ops/incidents",
     "/ops/incident-reports/:id",
     "/ops/feature-health",
     "/ops/feature-health/:findingId",
     "/ops/collection",
     "/integration/datalake",
     "/audit",
     "/ops/rollback",
     "/policies/:id",
     "/deployments/:id",
     "/fleet/vehicles/:vin",
     "/admin/data",
     "/trace/ads",
     "/admin/iam",
     "/admin/settings",
     "/events",
     "/notifications/rules",
     "/precheck",
     "/trace/coverage",
     "/integration/sync",
     "/integration/legacy",
     "/field",
     "/baselines/eol",
     "/data/workbench",
     "/biz/trials",
     "/ops/telemetry",
     "/fleet/map",
     "/fleet/vehicles",
     "/products"
    ]
   },
   "counts": {
    "R": 11,
    "A": 4,
    "C": 6,
    "I": 37
   }
  },
  {
   "id": "DEP-OPS",
   "name": "OTA·서비스운영팀",
   "en": "OTA & Service Operations",
   "desc": "차량 운행을 관제하고 이상 징후에 대응하며 긴급 차단·복원을 요청하고 단계적 확대를 실행한다.",
   "workspace": "control",
   "roles": [
    "R-OPS"
   ],
   "personas": [
    "operator",
    "opslead"
   ],
   "screens": {
    "primary": [
     "/activation/decide",
     "/policies/:id",
     "/verify/exceptions",
     "/fleet/live",
     "/features/:id/:ver",
     "/notifications",
     "/ops/flag-evaluations",
     "/ops/anomalies",
     "/ops/safety-kpi",
     "/ops/incidents",
     "/ops/incident-reports/:id",
     "/ops/feature-health",
     "/ops/feature-health/:findingId",
     "/ops/collection",
     "/integration/datalake",
     "/ops/kill",
     "/deployments",
     "/audit",
     "/ops/rollback",
     "/deployments/:id",
     "/fleet/vehicles/:vin",
     "/admin/settings",
     "/events",
     "/notifications/rules",
     "/integration/sync",
     "/integration/legacy",
     "/field",
     "/baselines/eol",
     "/data/workbench",
     "/ops/telemetry",
     "/fleet/map",
     "/fleet/vehicles"
    ],
    "reference": [
     "/deployments/software",
     "/integration/connectors",
     "/ops/ota-installs",
     "/deployments/campaigns/:id",
     "/experiments",
     "/admin/approval",
     "/products/:id/:ver",
     "/ops/incident-reports",
     "/audit/oversight",
     "/quality/feedback",
     "/flag-retirements",
     "/admin/security",
     "/admin/data",
     "/verify/compliance",
     "/trace/ads",
     "/admin/iam",
     "/biz/trials"
    ]
   },
   "counts": {
    "R": 18,
    "A": 15,
    "C": 9,
    "I": 22
   }
  },
  {
   "id": "DEP-ITSEC",
   "name": "Feature 관제실",
   "en": "Feature Control Center",
   "desc": "HSM·KMS에서 서명 키를 생성·순환·폐기한다(플랫폼 밖 업무 — 플랫폼에서는 조회). 플랫폼 계정 상태와 소유자가 없는 기록의 소유자 이관을 맡는다.",
   "workspace": "control",
   "roles": [
    "R-PKI",
    "R-SYS"
   ],
   "personas": [
    "sysadmin"
   ],
   "screens": {
    "primary": [
     "/admin/security",
     "/admin/iam",
     "/verify/compliance"
    ],
    "reference": [
     "/deployments",
     "/master/artifacts",
     "/deployments/software",
     "/admin/settings",
     "/events",
     "/notifications/rules"
    ]
   },
   "counts": {
    "R": 3,
    "A": 2,
    "C": 5,
    "I": 0
   }
  },
  {
   "id": "DEP-PUR",
   "name": "구매팀",
   "en": "Procurement",
   "desc": "협력사 계약·납품 조건을 관리하고 Feature별 SW 개발비를 산정·승인하며 단가·계수 표를 관리한다.",
   "workspace": "portal",
   "roles": [
    "R-PUR",
    "R-CE",
    "R-CA",
    "R-CV",
    "R-CBA"
   ],
   "personas": [
    "viewer",
    "approver"
   ],
   "screens": {
    "primary": [
     "/procurement/sw-cost",
     "/procurement/sw-cost/:estId",
     "/procurement/sw-cost/basis"
    ],
    "reference": [
     "/analysis/impact",
     "/arch/topology",
     "/supplier/portal",
     "/supplier/deliveries"
    ]
   },
   "counts": {
    "R": 9,
    "A": 10,
    "C": 8,
    "I": 9
   }
  },
  {
   "id": "DEP-LEG",
   "name": "법무팀",
   "en": "Legal",
   "desc": "데이터 이용·고객 고지·계약 근거를 검토하고 의견을 준다.",
   "workspace": "portal",
   "roles": [
    "R-LEG"
   ],
   "personas": [
    "viewer"
   ],
   "screens": {
    "primary": [],
    "reference": [
     "/ops/incident-reports",
     "/admin/data",
     "/integration/openfeature",
     "/verify/compliance",
     "/trace/ads",
     "/data/workbench",
     "/biz/trials"
    ]
   },
   "counts": {
    "R": 2,
    "A": 2,
    "C": 10,
    "I": 0
   }
  },
  {
   "id": "DEP-DPO",
   "name": "개인정보보호팀",
   "en": "Data Protection",
   "desc": "운영 데이터의 개인정보 처리 근거·보존·삭제를 검토한다.",
   "workspace": "portal",
   "roles": [
    "R-DPO"
   ],
   "personas": [
    "viewer"
   ],
   "screens": {
    "primary": [
     "/integration/openfeature",
     "/admin/data"
    ],
    "reference": [
     "/ops/safety-kpi",
     "/admin/settings",
     "/data/workbench",
     "/biz/trials",
     "/products",
     "/entitlements"
    ]
   },
   "counts": {
    "R": 2,
    "A": 2,
    "C": 9,
    "I": 0
   }
  }
 ],
 "firstScope": [
  "FPW.1",
  "FPW.2",
  "FPW.3",
  "FPW.4",
  "FPW.5",
  "FPW.6",
  "FPW.7",
  "FPW.8",
  "FPW.9"
 ]
};
