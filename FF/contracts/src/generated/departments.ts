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
     "/variant-conditions",
     "/arch/topology",
     "/features/:id/:ver",
     "/master/artifacts",
     "/integration/connectors",
     "/baselines",
     "/experiments",
     "/products/new",
     "/entitlements",
     "/products/:id/:ver",
     "/activation/decide",
     "/admin/approval",
     "/flag-retirements",
     "/master/feature-db/:refId"
    ],
    "reference": [
     "/analysis/impact",
     "/trace/design",
     "/change/cr",
     "/policies/new",
     "/policies",
     "/config/odd",
     "/validations/virtual",
     "/verify/evidence",
     "/config/compat",
     "/deployments",
     "/verify/compliance",
     "/verify/safety-case",
     "/fleet/live",
     "/ops/anomalies",
     "/ops/safety-kpi",
     "/ops/incidents",
     "/ops/kill",
     "/audit",
     "/quality/feedback",
     "/trace/ads",
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes"
    ]
   },
   "counts": {
    "R": 12,
    "A": 13,
    "C": 17,
    "I": 33
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
     "/policies/:id",
     "/flag-retirements",
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes"
    ],
    "reference": [
     "/master/define",
     "/feature/propose",
     "/features",
     "/master/feature-db",
     "/variant-conditions",
     "/arch/topology",
     "/analysis/impact",
     "/master/artifacts",
     "/integration/connectors",
     "/arch/components",
     "/validations",
     "/verify/evidence",
     "/baselines",
     "/integration/openfeature",
     "/master/feature-db/:refId"
    ]
   },
   "counts": {
    "R": 9,
    "A": 10,
    "C": 19,
    "I": 16
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
     "/deployments"
    ],
    "reference": [
     "/master/control-points",
     "/trace/design",
     "/policies/:id",
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
     "/flag-retirements",
     "/supplier/portal",
     "/admin/security",
     "/integration/openfeature"
    ]
   },
   "counts": {
    "R": 7,
    "A": 8,
    "C": 14,
    "I": 18
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
     "/baselines",
     "/config/compat",
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes",
     "/master/feature-db"
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
     "/master/feature-db/:refId"
    ]
   },
   "counts": {
    "R": 5,
    "A": 4,
    "C": 3,
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
     "/verify/evidence",
     "/verify/compliance",
     "/verify/safety-case",
     "/activation/decide",
     "/ops/kill",
     "/fleet/live",
     "/deployments",
     "/flag-retirements",
     "/ops/safety-kpi",
     "/trace/ads"
    ],
    "reference": [
     "/master/define",
     "/feature/propose",
     "/features",
     "/master/feature-db",
     "/variant-conditions",
     "/trace/design",
     "/change/cr",
     "/master/control-points",
     "/policies/:id",
     "/validations",
     "/master/artifacts",
     "/validations/virtual",
     "/integration/connectors",
     "/experiments",
     "/ops/anomalies",
     "/ops/incidents",
     "/ops/incident-reports",
     "/audit/oversight",
     "/audit",
     "/quality/feedback",
     "/supplier/portal",
     "/admin/security",
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes"
    ]
   },
   "counts": {
    "R": 17,
    "A": 17,
    "C": 34,
    "I": 8
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
     "/verify/compliance",
     "/trace/ads"
    ],
    "reference": [
     "/features/:id/:ver",
     "/admin/approval",
     "/arch/components",
     "/deployments",
     "/master/artifacts",
     "/audit/oversight",
     "/fleet/live"
    ]
   },
   "counts": {
    "R": 7,
    "A": 6,
    "C": 17,
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
     "/master/feature-db"
    ]
   },
   "counts": {
    "R": 11,
    "A": 10,
    "C": 12,
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
     "/supplier/portal"
    ],
    "reference": [
     "/analysis/impact",
     "/trace/design",
     "/change/cr",
     "/features/:id/:ver",
     "/master/artifacts",
     "/integration/connectors",
     "/master/control-points",
     "/activation/decide",
     "/verify/compliance",
     "/ops/kill",
     "/quality/feedback",
     "/flag-retirements"
    ]
   },
   "counts": {
    "R": 4,
    "A": 4,
    "C": 11,
    "I": 6
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
     "/supplier/portal"
    ],
    "reference": [
     "/arch/components",
     "/master/artifacts",
     "/validations/virtual",
     "/verify/safety-case",
     "/deployments",
     "/integration/connectors",
     "/verify/compliance",
     "/activation/decide",
     "/fleet/live",
     "/ops/anomalies",
     "/ops/safety-kpi",
     "/ops/incidents",
     "/audit",
     "/admin/data",
     "/trace/ads"
    ]
   },
   "counts": {
    "R": 11,
    "A": 4,
    "C": 4,
    "I": 22
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
     "/fleet/live",
     "/ops/anomalies",
     "/ops/safety-kpi",
     "/ops/incidents",
     "/ops/kill",
     "/deployments",
     "/audit"
    ],
    "reference": [
     "/features/:id/:ver",
     "/integration/connectors",
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
     "/trace/ads"
    ]
   },
   "counts": {
    "R": 9,
    "A": 7,
    "C": 7,
    "I": 19
   }
  },
  {
   "id": "DEP-ITSEC",
   "name": "IT인프라·보안운영팀",
   "en": "IT Infrastructure & SecOps",
   "desc": "HSM·KMS에서 서명 키를 생성·순환·폐기한다(플랫폼 밖 업무 — 플랫폼에서는 조회).",
   "workspace": "control",
   "roles": [
    "R-PKI"
   ],
   "personas": [
    "viewer"
   ],
   "screens": {
    "primary": [
     "/admin/security"
    ],
    "reference": [
     "/deployments",
     "/master/artifacts"
    ]
   },
   "counts": {
    "R": 1,
    "A": 0,
    "C": 3,
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
    "primary": [],
    "reference": [
     "/analysis/impact",
     "/arch/topology",
     "/supplier/portal"
    ]
   },
   "counts": {
    "R": 2,
    "A": 3,
    "C": 2,
    "I": 2
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
     "/trace/ads"
    ]
   },
   "counts": {
    "R": 2,
    "A": 2,
    "C": 7,
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
     "/integration/openfeature"
    ],
    "reference": [
     "/ops/safety-kpi",
     "/admin/data"
    ]
   },
   "counts": {
    "R": 1,
    "A": 1,
    "C": 4,
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
