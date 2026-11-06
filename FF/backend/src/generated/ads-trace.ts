// 생성 파일 — tools/ads-trace.ts가 harness/ads catalog.json·review.json과 결함 기록(it.fails)에서 만든다. 손으로 고치지 않는다(node tools/ads-trace.ts --check가 잡는다).
import type { AdsTraceDoc } from '@ff/contracts';

export const ADS_TRACE: AdsTraceDoc = {
 "source": {
  "file": "ADS_UNECE_Document_Comparison_Korean_Report_v3.0.html",
  "sha256": "712e75bc65426b1c2a763e8b008ff72b6f34f7bc39e52b0a569b11a324764832",
  "revision": "3.0",
  "date": "2026-10-18"
 },
 "reviewed": {
  "sha256": "712e75bc65426b1c2a763e8b008ff72b6f34f7bc39e52b0a569b11a324764832",
  "reviewedAt": "2026-10-18",
  "reviewedCommit": "0681305"
 },
 "requirements": [
  {
   "id": "FFP-F001",
   "title": "Feature 분류",
   "category": "카탈로그·적용성",
   "priority": "P0",
   "owner": "CP",
   "content": "각 Feature에 ADS 여부·DDT 영향·안전 관련성·담당자를 등록해야 한다.",
   "acceptance": "분류 미등록 항목의 차량 릴리스를 거부한다.",
   "basis": "GTR §2.6; §5.3.1.1",
   "tests": [
    "TC01"
   ],
   "claims": [
    "C01"
   ],
   "hazards": [
    "H01"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d01-policy/registry/safety-profile.service.ts:195",
     "contracts/src/rules/classification.ts:49",
     "contracts/src/rules/lifecycle.ts:22"
    ],
    "tests": [
     "backend/test/d01/safety-profile.spec.ts",
     "contracts/src/rules/classification.test.ts"
    ],
    "gap": "ADS 여부·안전 등급·ownerId는 등록되고 Safety Manager 미확정이면 G2 이후 Gate가 막히지만, DDT 영향 축이 없고 분류가 추정 초안(INFERRED)으로 자동 생성되어 '미등록' 상태 자체가 없다.",
    "plan": [
     "ADS-UI12",
     "ADS-BE16"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F002",
   "title": "변경 종류 분류",
   "category": "카탈로그·적용성",
   "priority": "P0",
   "owner": "CP",
   "content": "정책·보정/설정·실행 SW·모델·ODD 변경을 별도 변경 유형으로 관리해야 한다.",
   "acceptance": "각 유형이 서로 다른 영향 분석 경로로 진입한다.",
   "basis": "R156 §2.3; GTR §4.3.3",
   "tests": [
    "TC02"
   ],
   "claims": [
    "C01"
   ],
   "hazards": [
    "H01"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/rehara.ts:14",
     "backend/src/domains/d06-qsec/change-impact-validation/rehara.service.ts:46"
    ],
    "tests": [
     "backend/test/d06/rehara.spec.ts"
    ],
    "gap": "정책·보정/설정·실행 SW·모델·ODD를 나누는 변경 유형 분류가 없다. 재-HARA는 이벤트 종류와 6조건으로만 판정한다.",
    "plan": [
     "ADS-UI09",
     "ADS-BE08"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F003",
   "title": "시장 적용 기준선",
   "category": "카탈로그·적용성",
   "priority": "P0",
   "owner": "CP",
   "content": "국가·승인 유형·적용 규정 series·승인 ODD를 Feature 기준선에 연결해야 한다.",
   "acceptance": "미승인 시장/ODD 대상은 배포 후보에서 제외된다.",
   "basis": "GTR §1; N3·N9 적용 범위",
   "tests": [
    "TC01"
   ],
   "claims": [
    "C01"
   ],
   "hazards": [
    "H01"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/policy-gate.ts:192",
     "contracts/src/rules/compliance-profile.ts:52",
     "backend/src/domains/d06-qsec/secure-deploy/secure-deploy.service.ts:77"
    ],
    "tests": [
     "backend/test/d03/policy-gate.spec.ts",
     "contracts/src/rules/compliance-profile.test.ts"
    ],
    "gap": "승인 시장과 시장 Profile 상태는 Kill 게이트에서만 확인한다. 승인 유형·규정 series·승인 ODD를 기준선에 연결하는 구조가 없고 정책 대상은 국가/차종/트림으로만 고른다.",
    "plan": [
     "ADS-UI12",
     "ADS-BE16"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F004",
   "title": "수명주기 소유권",
   "category": "카탈로그·적용성",
   "priority": "P1",
   "owner": "CP",
   "content": "Feature의 생성·운영·중단·폐기 상태와 각 책임자를 기록해야 한다.",
   "acceptance": "폐기된 Feature의 신규 허용 정책 생성을 거부한다.",
   "basis": "GTR §5.1 SMS에서 도출",
   "tests": [
    "TC23"
   ],
   "claims": [
    "C01"
   ],
   "hazards": [
    "H01"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d01-policy/policy-store/policy.service.ts:124",
     "contracts/src/rules/lifecycle.ts:53",
     "backend/src/domains/d01-policy/registry/lifecycle.service.ts:161"
    ],
    "tests": [
     "backend/test/d01/registry.spec.ts",
     "backend/test/d01/retirement.spec.ts"
    ],
    "gap": "DEPRECATED·RETIRED Feature의 정책 생성 거부 코드는 있지만 직접 시험이 없고, 상태별 책임자는 감사 행위자·소유 조직으로만 남는다.",
    "plan": [
     "ADS-BE16"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F005",
   "title": "호환 형상 집합",
   "category": "형상·영향 분석",
   "priority": "P0",
   "owner": "공동",
   "content": "Feature별 HW·ECU SW·모델·보정·ODD 프로파일의 허용 조합을 등록해야 한다.",
   "acceptance": "개별 부품 버전은 유효해도 조합이 미승인이면 적용을 거부한다.",
   "basis": "GTR §5.3.1.4.1.2; R156 호환성",
   "tests": [
    "TC17"
   ],
   "claims": [
    "C01"
   ],
   "hazards": [
    "H01"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/variant.ts:44",
     "contracts/src/rules/catalog.ts:53"
    ],
    "tests": [
     "backend/test/d06/iam-variant.spec.ts"
    ],
    "gap": "개별 SW 요구 버전 이상 여부만 판정한다. HW·ECU SW·모델·보정·ODD 프로파일의 승인 조합 집합 등록과 조합 기준 거부가 없다.",
    "plan": [
     "ADS-UI05",
     "ADS-BE10"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F006",
   "title": "의존성 그래프",
   "category": "형상·영향 분석",
   "priority": "P0",
   "owner": "CP",
   "content": "활성화·업데이트·복구에 필요한 Feature/ECU 의존성과 금지 조합을 검증해야 한다.",
   "acceptance": "순환 의존성·선행 기능 누락을 빌드 단계에서 탐지한다.",
   "basis": "GTR §5.3.1.15에서 도출",
   "tests": [
    "TC17"
   ],
   "claims": [
    "C01"
   ],
   "hazards": [
    "H01"
   ],
   "review": {
    "verdict": "구현",
    "evidence": [
     "contracts/src/rules/topology.ts:55",
     "contracts/src/rules/catalog.ts:85",
     "contracts/src/rules/lifecycle.ts:136"
    ],
    "tests": [
     "contracts/src/rules/topology.test.ts",
     "backend/test/d01/topology-catalog.spec.ts",
     "contracts/src/rules/catalog.test.ts"
    ],
    "gap": "REQUIRES 순환·선행 누락·EXCLUDES 충돌을 등록·구성 단계에서 탐지한다. ECU·복구 경로 의존성은 다루지 않는다(F005·F039로 이관).",
    "plan": []
   },
   "defects": []
  },
  {
   "id": "FFP-F007",
   "title": "승인 영향 판정",
   "category": "형상·영향 분석",
   "priority": "P0",
   "owner": "CP",
   "content": "새 기능 허용 및 성능·ODD·안전 동작 변경의 승인 영향을 검토해야 한다.",
   "acceptance": "영향 검토 미완료 변경은 서명 단계로 승격되지 않는다.",
   "basis": "R156 00 §7.1.1.8~10 / 01 §7.1.1.9~11",
   "tests": [
    "TC02"
   ],
   "claims": [
    "C01"
   ],
   "hazards": [
    "H01"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/lifecycle.ts:169",
     "backend/src/domains/d01-policy/registry/lifecycle.service.ts:82",
     "backend/src/domains/d01-policy/registry/release-signoff.service.ts:87"
    ],
    "tests": [
     "backend/test/ads/defects.spec.ts",
     "backend/test/d06/rehara.spec.ts"
    ],
    "gap": "열린 재-HARA는 G3~G9 PASS·Release Sign-off·출시 전이를 모두 막고, 세 곳 모두 같은 사유 코드(error.details.blockers[].code = REHARA_OPEN)로 응답한다(ADS-BE06 2026-11-06, G8·G9 PASS·서명 뒤에 열린 요청도). 정책 배포는 막지 않는다 — 결정 D-RD-6(재-HARA 중에도 완화 정책(ODD 축소 등)은 차량에 나가야 한다). 배포 허용·출시 거부를 같은 Version에서 시험한다.",
    "plan": [
     "ADS-UI09",
     "ADS-BE06",
     "ADS-BE08"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F008",
   "title": "릴리스 비교",
   "category": "형상·영향 분석",
   "priority": "P1",
   "owner": "CP",
   "content": "변경 전후 타기팅·의존성·ODD·fallback 계약의 차이를 표시해야 한다.",
   "acceptance": "리뷰어가 확장된 ODD와 변경된 종료 동작을 비교 화면에서 식별한다.",
   "basis": "GTR §4.3.3; Waymo에서 착안",
   "tests": [
    "TC02"
   ],
   "claims": [
    "C01"
   ],
   "hazards": [
    "H01"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/policy-version.ts:59",
     "frontend/src/screens/policy/PolicyVersions.tsx:35",
     "backend/src/domains/d01-policy/policy-store/policy.service.ts:344"
    ],
    "tests": [
     "contracts/src/rules/policy-version.test.ts",
     "frontend/src/__tests__/screensPolicy.test.tsx"
    ],
    "gap": "정책 개정본 사이 필드 차이 표만 있다. 릴리스 전후 의존성·ODD 확장·fallback/종료 동작 계약 비교가 없다.",
    "plan": [
     "ADS-UI09"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F009",
   "title": "직무 분리",
   "category": "승인·변경 통제",
   "priority": "P0",
   "owner": "CP",
   "content": "안전 관련 변경의 작성자와 승인자를 분리해야 한다.",
   "acceptance": "동일 사용자의 자기 승인을 거부하고 시도를 기록한다.",
   "basis": "SMS 기반 프로젝트 통제 제안",
   "tests": [
    "TC20"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H02"
   ],
   "review": {
    "verdict": "구현",
    "evidence": [
     "contracts/src/rules/lifecycle.ts:176",
     "backend/src/domains/d01-policy/registry/lifecycle.service.ts:124",
     "backend/src/domains/d01-policy/policy-store/policy.service.ts:225"
    ],
    "tests": [
     "backend/test/d01/policy.spec.ts",
     "backend/test/d01/registry.spec.ts",
     "backend/test/d03/kill-v2.spec.ts"
    ],
    "gap": "자기 승인은 Feature 전이·정책 승인·Kill 승인에서 거부된다. 거부와 감사 기록을 함께 단언하는 시험은 Kill 승인(kill-v2.spec.ts:40)뿐이고, 정책·Feature 전이 시험은 403만 본다(재검증 2026-10-18).",
    "plan": []
   },
   "defects": []
  },
  {
   "id": "FFP-F010",
   "title": "증거 기반 승격",
   "category": "승인·변경 통제",
   "priority": "P0",
   "owner": "CP",
   "content": "승인 형상·시험·Safety Case 근거를 충족한 릴리스만 운영 환경으로 승격해야 한다.",
   "acceptance": "시험 누락 또는 승인 후 아티팩트 변경 시 승격을 거부한다.",
   "basis": "GTR §5.3.3; Waymo 공개 사례",
   "tests": [
    "TC21"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H02"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d01-policy/topology/gate.service.ts:105",
     "backend/src/domains/d01-policy/policy-store/policy.service.ts:249",
     "contracts/src/rules/lifecycle.ts:160"
    ],
    "tests": [
     "backend/test/d01/gate-decision.spec.ts",
     "backend/test/d01/release-signoff.spec.ts",
     "backend/test/d01/policy.spec.ts"
    ],
    "gap": "근거 없는 PASS·승인 후 해시 변경·Gate 기록 변조는 거부하지만, Safety Case 근거(evidenceManifestId)가 항상 null이라 승격 조건에 연결되지 않는다.",
    "plan": [
     "ADS-UI08",
     "ADS-BE14"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F011",
   "title": "긴급 종료 승인",
   "category": "승인·변경 통제",
   "priority": "P0",
   "owner": "CP",
   "content": "긴급 종료 명령에 사유·대상·권한·승인 경로를 지정해야 한다.",
   "acceptance": "허용된 긴급 경로만 실행되며 사후 검토 대상이 생성된다.",
   "basis": "GTR §4.1.4.4에서 도출",
   "tests": [
    "TC12"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H02"
   ],
   "review": {
    "verdict": "구현",
    "evidence": [
     "backend/src/domains/d03-safety/kill-switch/kill.service.ts:194",
     "contracts/src/rules/policy-gate.ts:119",
     "backend/src/domains/d06-qsec/iam/post-review.service.ts:31"
    ],
    "tests": [
     "backend/test/d03/kill-v2.spec.ts",
     "backend/test/d06/post-review.spec.ts",
     "backend/test/d03/policy-gate.spec.ts"
    ],
    "gap": "사유 분류·대상·2인 승인·FSM·게이트를 거쳐 발행되고 Kill마다 24시간 사후 검토가 생긴다.",
    "plan": []
   },
   "defects": []
  },
  {
   "id": "FFP-F012",
   "title": "승인 취소·동결",
   "category": "승인·변경 통제",
   "priority": "P1",
   "owner": "CP",
   "content": "중대한 사건이 발생한 릴리스의 추가 승격·대상 확대를 동결할 수 있어야 한다.",
   "acceptance": "동결 후 예약된 다음 cohort가 배포되지 않는다.",
   "basis": "GTR §5.4; LD 패턴 참고",
   "tests": [
    "TC19"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H02"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/rollout-stage.ts:57",
     "backend/src/domains/d01-policy/staged-rollout/staged-rollout.service.ts:45"
    ],
    "tests": [
     "backend/test/d01/rollout-stage.spec.ts",
     "contracts/src/rules/rollout-stage.test.ts"
    ],
    "gap": "명시적 동결 명령이 없다. 이상 징후·차단이 있을 때 F2+ 수동 확대만 막고 F0·F1 확대와 새 정책 배포는 막지 않는다.",
    "plan": [
     "ADS-UI11",
     "ADS-BE12"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F013",
   "title": "결정적 정책 빌드",
   "category": "정책 빌드·보안",
   "priority": "P0",
   "owner": "CP",
   "content": "같은 승인 입력으로 같은 정규화 정책과 digest를 생성해야 한다.",
   "acceptance": "재빌드한 payload digest가 같고 빌드 도구 버전을 추적한다.",
   "basis": "형상·증거 재현성의 설계 제안",
   "tests": [
    "TC21"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H02"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d01-policy/policy-repos.ts:21",
     "backend/src/domains/d06-qsec/pki-kms/pki.service.ts:33",
     "backend/src/domains/d06-qsec/secure-deploy/secure-deploy.service.ts:115"
    ],
    "tests": [
     "backend/test/d06/policy-golden.spec.ts"
    ],
    "gap": "정규화 정책 해시는 결정적이지만 서명 payload에 issuedAt·publicationId가 들어가 재빌드 digest가 달라지고, 빌드 도구 버전을 기록하지 않는다.",
    "plan": [
     "ADS-BE11"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F014",
   "title": "정책 서명 검증",
   "category": "정책 빌드·보안",
   "priority": "P0",
   "owner": "차량",
   "content": "차량은 신뢰된 키로 검증된 정책만 수락해야 한다.",
   "acceptance": "비신뢰 키·변조된 본문·잘못된 대상 정책을 거부한다.",
   "basis": "GTR §4.3.2; 보안 설계 제안",
   "tests": [
    "TC14"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H02"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d06-qsec/pki-kms/pki.service.ts:129",
     "backend/src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service.ts:138"
    ],
    "tests": [
     "backend/test/d03/delivery.spec.ts",
     "backend/test/d06/hsm.spec.ts",
     "backend/test/ads/defects.spec.ts"
    ],
    "gap": "비신뢰 키·변조·키 용도 불일치·대상 밖 차량을 거부한다 — 대상 확인은 게시본 종류와 무관하다(POLICY·KILL·RESTORE 모두 payload.targets에 자기 VIN이 없으면 TARGET_MISMATCH로 남기고 적용하지 않는다, ADS-BE05 2026-11-06). 차량 측 스키마 파싱(필드별 검증)은 시뮬레이터 범위.",
    "plan": [
     "ADS-BE05"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F015",
   "title": "단조 증가 epoch",
   "category": "정책 빌드·보안",
   "priority": "P0",
   "owner": "차량",
   "content": "정책 수락 순서를 보호하는 영속 epoch로 오래된 정책의 재생을 거부해야 한다.",
   "acceptance": "새 종료 정책 뒤 도착한 과거 ON 정책이 상태를 되돌리지 못한다.",
   "basis": "GTR §4.1.4.4.2; Uptane 패턴 참고",
   "tests": [
    "TC13"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H02"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service.ts:143",
     "backend/src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service.ts:57",
     "contracts/src/rules/policy-gate.ts:160"
    ],
    "tests": [
     "backend/test/d03/delivery.spec.ts",
     "backend/test/d03/kill-v2.spec.ts"
    ],
    "gap": "Feature별 순번 영속으로 오래된 KILL/RESTORE 재전송은 거부하지만, 정책 순번 공간(flag:키)이 따로라 KILL 뒤 늦게 온 과거 정책 게시본은 순번으로 막히지 않고 kill 상태 유지에만 의존한다.",
    "plan": [
     "ADS-BE07"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F016",
   "title": "승인 범위 제한",
   "category": "정책 빌드·보안",
   "priority": "P0",
   "owner": "CP",
   "content": "정책 컴파일러는 승인 범위보다 넓은 ODD·성능·차량 형상을 발행하지 못해야 한다.",
   "acceptance": "허용 지역·속도 구간의 경계 초과 변경을 빌드에서 거부한다.",
   "basis": "GTR §4.1.5; §4.3.3에서 도출",
   "tests": [
    "TC03"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H02"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d01-policy/staged-rollout/staged-rollout.service.ts:39",
     "backend/src/domains/d06-qsec/secure-deploy/secure-deploy.service.ts:77",
     "contracts/src/rules/odd-restriction.ts:38"
    ],
    "tests": [
     "backend/test/d01/policy.spec.ts"
    ],
    "gap": "코호트 상한과 국가/차종/트림 범위만 제한한다. 승인 ODD·지역·속도 경계 초과 정책을 빌드에서 거부하는 검사가 없다.",
    "plan": [
     "ADS-UI04",
     "ADS-BE09"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F017",
   "title": "CCS 전송 분리",
   "category": "CCS 전달·수렴",
   "priority": "P0",
   "owner": "CCS",
   "content": "Feature 정책 발행과 CCS/OTA의 전달 결과를 별도 식별자로 추적해야 한다.",
   "acceptance": "정책 릴리스 ID와 전송 campaign ID가 양방향으로 조회된다.",
   "basis": "플랫폼 책임 분리 제안",
   "tests": [
    "TC15"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H03"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d04-ops/pipeline-link/pipeline.service.ts:23",
     "backend/src/domains/d06-qsec/secure-deploy/secure-deploy.service.ts:151",
     "contracts/src/routes.ts:230"
    ],
    "tests": [
     "backend/test/d03/delivery.spec.ts"
    ],
    "gap": "게시본에 campaignId(CMP-)가 저장되어 게시본→캠페인은 조회되지만 campaignId→게시본·정책 릴리스 역방향 조회가 없다.",
    "plan": [
     "ADS-BE17"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F018",
   "title": "수신·적용 ACK 분리",
   "category": "CCS 전달·수렴",
   "priority": "P0",
   "owner": "공동",
   "content": "전송 수신·정책 수락·적용 보류·실행 상태 확인을 별도 ACK로 제공해야 한다.",
   "acceptance": "수신 ACK만 온 차량을 적용 완료로 집계하지 않는다.",
   "basis": "안전 운영 상태 모델 제안",
   "tests": [
    "TC15"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H03"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/schemas/wire.ts:144",
     "backend/src/domains/d04-ops/telemetry-ingest/status-ingest.service.ts:186",
     "backend/src/adapters/gleo/gleo.adapter.ts:69"
    ],
    "tests": [
     "backend/test/d04/status-v2.spec.ts",
     "backend/test/d03/gleo-v2.spec.ts"
    ],
    "gap": "kill/restore는 ACCEPTED·DEACT_PENDING_*·끝 상태를 나누지만 '보류(DEFERRED)' 결과가 없고, policy_push에는 ACK 자체가 없으며, 시뮬레이터가 received_at과 applied_at에 같은 시각을 넣는다.",
    "plan": [
     "ADS-UI01",
     "ADS-BE01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F019",
   "title": "명령 멱등성",
   "category": "CCS 전달·수렴",
   "priority": "P0",
   "owner": "공동",
   "content": "같은 commandId의 재전송을 중복 효과 없이 처리해야 한다.",
   "acceptance": "네트워크 재시도에도 종료·해제 전이가 한 번만 수행된다.",
   "basis": "분산 전달 설계 제안",
   "tests": [
    "TC13"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H03"
   ],
   "review": {
    "verdict": "구현",
    "evidence": [
     "backend/src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service.ts:223",
     "contracts/src/rules/status-v2.ts:103",
     "contracts/src/rules/deactivation.ts:133"
    ],
    "tests": [
     "backend/test/ads/defects.spec.ts",
     "backend/test/d04/status-v2.spec.ts",
     "backend/test/d03/policy-gate.spec.ts"
    ],
    "gap": "같은 command_id·같은 내용(서명 포함) 봉투의 재전송은 차량 Guard가 전이 없이 앞 결과(수락·지금 상태)를 다시 알린다 — REPLAY 보안 이벤트가 아니다. 같은 순번의 다른 명령은 여전히 REPLAY로 거부한다.",
    "plan": [
     "ADS-BE04"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F020",
   "title": "cohort 단계 제어",
   "category": "CCS 전달·수렴",
   "priority": "P1",
   "owner": "CP",
   "content": "호환 형상·시장·증거 기준에 맞는 cohort만 단계적으로 확대해야 한다.",
   "acceptance": "관측 기준 미달 시 확대가 정지되고 미확인 차량이 분리된다.",
   "basis": "Waymo·LD 패턴; §5.1.8.4",
   "tests": [
    "TC19"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H03"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/rollout-stage.ts:44",
     "contracts/src/rules/rollout-stage.ts:67"
    ],
    "tests": [
     "backend/test/d01/rollout-stage.spec.ts"
    ],
    "gap": "관측 기간·이상 징후·진행 중 차단이 있으면 확대를 멈추지만, 미확인(무회신·UNKNOWN) 차량을 cohort에서 분리하지 않고 호환 형상·시장 기준 cohort 구성 판정이 없다.",
    "plan": [
     "ADS-UI11",
     "ADS-BE12"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F021",
   "title": "신규 활성화 게이트",
   "category": "차량 로컬 평가",
   "priority": "P0",
   "owner": "차량",
   "content": "차량은 로컬에서 정책·형상·차단·ODD·건전성·필요한 사용자 조건을 재평가해야 한다.",
   "acceptance": "클라우드 허용 상태라도 ODD OUT이면 활성화되지 않는다.",
   "basis": "GTR §4.1.4~5; §4.2.2",
   "tests": [
    "TC04"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H04"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "frontend/src/data/twin/engine.ts:623",
     "backend/src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service.ts:259"
    ],
    "tests": [
     "frontend/src/__tests__/twinEngine.test.ts"
    ],
    "gap": "프론트 twin Local Guard는 차단·서명·신호·전원을 재평가하지만 ODD 조건이 없고, 백엔드 Guard 시뮬레이터의 activate는 조건 없이 ACTIVE로 간다.",
    "plan": [
     "ADS-SIM01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F022",
   "title": "Active 중 정책 회수",
   "category": "차량 로컬 평가",
   "priority": "P0",
   "owner": "차량",
   "content": "Active 중 정책 OFF/권한 만료를 기능별 안전 전환 요청으로 처리해야 한다.",
   "acceptance": "DDT 수행 중 상품 권한 만료가 액추에이터 제어 단절을 만들지 않는다.",
   "basis": "GTR §4.1.4.4.1; 적용 해석",
   "tests": [
    "TC11"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H04"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d03-safety/kill-switch/trial-expiry.listener.ts:64",
     "contracts/src/rules/deactivation.ts:8",
     "backend/src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service.ts:295"
    ],
    "tests": [
     "backend/test/d03/trial-expiry-kill.spec.ts",
     "contracts/src/rules/deactivation.test.ts"
    ],
    "gap": "체험권 만료(F2+)만 COMMERCIAL·DC3(다음 시동)로 처리된다. 일반 구독 만료와 결제는 평가기 ENTITLEMENT 단계를 바로 DENY/ALLOW로 바꿔 OFREP·차량 측 평가가 즉시 OFF가 된다(evaluate.ts:128). DDT 중 연속성을 단언하는 시험이 없다(재검증 2026-10-18).",
    "plan": [
     "ADS-BE20",
     "ADS-BE01",
     "ADS-SIM03",
     "ORC-BE01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F023",
   "title": "판정 사유 계약",
   "category": "차량 로컬 평가",
   "priority": "P0",
   "owner": "차량",
   "content": "허용·거부·판정 불가 결과에 reasonCode와 근거 형상·샘플 식별자를 제공해야 한다.",
   "acceptance": "ODD 불충족과 센서 입력 노후가 다른 사유로 기록된다.",
   "basis": "안전 판정 인터페이스 제안",
   "tests": [
    "TC06"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H04"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/schemas/wire.ts:143",
     "frontend/src/data/twin/engine.ts:145"
    ],
    "tests": [
     "frontend/src/__tests__/twinEngine.test.ts",
     "backend/test/d04/status-v2.spec.ts"
    ],
    "gap": "status_report v2에는 reason.category/source와 reject_code만 있고, 행위별 판정(ALLOW/DENY/UNKNOWN)·reasonCode·근거 형상·샘플 ID 필드가 없다. ODD 불충족 사유도 없다.",
    "plan": [
     "ADS-UI06",
     "ADS-BE01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F024",
   "title": "동작 시점 재검증",
   "category": "차량 로컬 평가",
   "priority": "P0",
   "owner": "차량",
   "content": "활성화·설치 직전의 관련 상태를 같은 로컬 판정 경계에서 재검증해야 한다.",
   "acceptance": "판정 후 차량이 움직이면 오래된 설치 허가를 실행하지 않는다.",
   "basis": "R156 §7.2.2.1.3; TOCTOU 대응",
   "tests": [
    "TC16"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H04"
   ],
   "review": {
    "verdict": "미구현",
    "evidence": [
     "backend/src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service.ts:259",
     "frontend/src/data/twin/engine.ts:623"
    ],
    "tests": [],
    "gap": "판정 시점과 실행·설치 직전 재검증을 같은 경계에서 다루는 계약 필드(판정 ID·유효시간)·시뮬레이터 동작·TOCTOU 시험이 없다.",
    "plan": [
     "ADS-BE01",
     "ADS-SIM01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F025",
   "title": "ODD 프로파일 버전",
   "category": "ODD 관리",
   "priority": "P0",
   "owner": "공동",
   "content": "기능·승인 형상에 결합된 버전형 ODD 프로파일을 관리해야 한다.",
   "acceptance": "같은 Feature라도 서로 다른 승인 ODD의 로그와 정책이 혼용되지 않는다.",
   "basis": "GTR §2.12; §5.3.1.3",
   "tests": [
    "TC03"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H04"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/odd-restriction.ts:8",
     "contracts/src/rules/odd-restriction.ts:37",
     "contracts/src/schemas/policy.ts:48"
    ],
    "tests": [
     "contracts/src/rules/odd-restriction.test.ts"
    ],
    "gap": "ODD 축소를 새 Version으로 강제하지만 버전형 ODD 프로파일 엔티티와 로그·정책의 ODD 프로파일 결합 식별자가 없다.",
    "plan": [
     "ADS-UI04",
     "ADS-BE09"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F026",
   "title": "ODD 의미 검증",
   "category": "ODD 관리",
   "priority": "P0",
   "owner": "CP",
   "content": "ODD 조건의 단위·경계 포함 여부·필수 조건·배제 조건을 검증해야 한다.",
   "acceptance": "km/h와 m/s 혼용 및 경계 연산자 오기를 탐지한다.",
   "basis": "ISO 34503 범위 참고; 프로젝트 규칙",
   "tests": [
    "TC03"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H04"
   ],
   "review": {
    "verdict": "미구현",
    "evidence": [
     "contracts/src/rules/odd-restriction.ts:8"
    ],
    "tests": [],
    "gap": "ODD 조건의 단위·경계 포함·필수/배제를 표현하는 스키마와 단위 혼용·연산자 오기 검사가 없다.",
    "plan": [
     "ADS-UI04",
     "ADS-BE09"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F027",
   "title": "ODD 불확실성 처리",
   "category": "ODD 관리",
   "priority": "P0",
   "owner": "차량",
   "content": "ODD 판정은 IN·OUT·UNKNOWN을 구분하고 입력 품질·유효 시간을 반영해야 한다.",
   "acceptance": "센서/지도 근거가 부족하면 IN으로 추정하지 않는다.",
   "basis": "GTR §4.1.5; SOTIF에서 도출",
   "tests": [
    "TC05"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H04"
   ],
   "review": {
    "verdict": "미구현",
    "evidence": [
     "contracts/src/schemas/safety.ts:39",
     "frontend/src/data/twin/engine.ts:431"
    ],
    "tests": [
     "frontend/src/__tests__/twinEngine.test.ts"
    ],
    "gap": "Guard 상태에 UNKNOWN은 있지만 ODD IN/OUT/UNKNOWN 3값과 입력 품질·유효시간을 반영한 ODD 판정 계약·시뮬레이션이 없다.",
    "plan": [
     "ADS-UI06",
     "ADS-SIM01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F028",
   "title": "ODD 경계 예측",
   "category": "ODD 관리",
   "priority": "P1",
   "owner": "차량",
   "content": "예측 가능한 ODD 이탈에 대해 필요한 전환 준비 시간을 평가해야 한다.",
   "acceptance": "지도상 종료 경계 접근 시 기능별 전환 계획이 이탈 전에 시작된다.",
   "basis": "GTR §4.1.5.5",
   "tests": [
    "TC07"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H04"
   ],
   "review": {
    "verdict": "미구현",
    "evidence": [
     "contracts/src/rules/deactivation.ts:43"
    ],
    "tests": [],
    "gap": "전환 시간값(takeover_ms 등)은 있지만 ODD 경계 접근 예측과 '이탈 전 전환 계획 시작'을 담는 계약·시뮬레이터 동작이 없다.",
    "plan": [
     "ADS-SIM01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F029",
   "title": "행위별 readiness",
   "category": "안전 상태 판정",
   "priority": "P0",
   "owner": "차량",
   "content": "활성화·인계·설치·종료 완료·재활성화 판정을 서로 다른 계약으로 제공해야 한다.",
   "acceptance": "정차 판정만으로 인계/설치/MRC 전체가 허용되지 않는다.",
   "basis": "GTR §4.1.6; §4.2.2; R156",
   "tests": [
    "TC08"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H05"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/schemas/safety.ts:39",
     "contracts/src/schemas/safety-profile.ts:24"
    ],
    "tests": [
     "backend/test/d04/status-v2.spec.ts"
    ],
    "gap": "Guard 상태가 활성화·종료·복원을 나누지만 인계·설치·MRC·재활성화별 readiness 판정 계약이 없다.",
    "plan": [
     "ADS-UI06",
     "ADS-BE01",
     "ADS-SIM01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F030",
   "title": "차량 신호 유효성",
   "category": "안전 상태 판정",
   "priority": "P0",
   "owner": "차량",
   "content": "readiness 입력마다 출처·유효 비트·신뢰 상태·로컬 시간·허용 노후 기준을 검사해야 한다.",
   "acceptance": "노후/비정상 신호가 최종 ALLOW 판정에 재사용되지 않는다.",
   "basis": "ISO 26262·SOTIF 기반 제안",
   "tests": [
    "TC06"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H05"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "frontend/src/data/twin/engine.ts:391",
     "frontend/src/data/twin/engine.ts:671",
     "contracts/src/schemas/wire.ts:159"
    ],
    "tests": [
     "frontend/src/__tests__/twinEngine.test.ts"
    ],
    "gap": "twin Guard는 TTL·품질을 넘긴 신호로 ALLOW를 내지 않지만 와이어 계약에 입력별 출처·유효 비트·신뢰 상태 필드가 없고(time_sync만) 백엔드 시뮬레이터는 신호를 보지 않는다.",
    "plan": [
     "ADS-BE01",
     "ADS-SIM01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F031",
   "title": "MRC 달성 확인",
   "category": "안전 상태 판정",
   "priority": "P0",
   "owner": "차량",
   "content": "정지·안정·위험 저감 근거와 정지 유지 수단을 확인하여 MRC 달성을 기록해야 한다.",
   "acceptance": "교차로 일시 정차만으로 MRC 완료를 선언하지 않는다.",
   "basis": "GTR §2.20; §5.3.1.14",
   "tests": [
    "TC08"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H05"
   ],
   "review": {
    "verdict": "미구현",
    "evidence": [
     "contracts/src/rules/kill-timeline.ts:65",
     "backend/src/domains/d04-ops/telemetry-ingest/safety-kpi.service.ts:154"
    ],
    "tests": [
     "contracts/src/rules/kill-timeline.test.ts"
    ],
    "gap": "타임라인 mrc 칸은 항상 null이고 status_report에 MRC 달성·정지 유지 근거 필드가 없어 '일시 정차 ≠ MRC'를 기록·검사할 수 없다.",
    "plan": [
     "ADS-UI02",
     "ADS-BE01",
     "ADS-SIM03"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F032",
   "title": "반응 시간 예산",
   "category": "안전 상태 판정",
   "priority": "P0",
   "owner": "차량",
   "content": "위험별 탐지·판정·조치 시간 예산을 할당하고 초과를 검출해야 한다.",
   "acceptance": "고장 주입에서 측정한 반응 시간이 승인된 안전 분석 예산 안에 든다.",
   "basis": "ISO 26262 기반 프로젝트 분석",
   "tests": [
    "TC22"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H05"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/deactivation.ts:139",
     "backend/src/domains/d04-ops/telemetry-ingest/status-ingest.service.ts:214"
    ],
    "tests": [
     "backend/test/d04/status-v2.spec.ts",
     "backend/test/d03/kill-timeline.spec.ts"
    ],
    "gap": "등급별 적용 시간 초과는 pending_overdue로 잡지만 위험별 탐지·판정·조치 예산 할당과 고장 주입 반응시간 측정이 없다.",
    "plan": [
     "ADS-SIM03"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F033",
   "title": "종료 차단 영속성",
   "category": "종료·차단 해제",
   "priority": "P0",
   "owner": "차량",
   "content": "유효한 원격 종료는 기능별 차단 상태로 영속 유지해야 한다.",
   "acceptance": "재부팅·전원 손실·캐시 ON 정책으로 재활성화되지 않는다.",
   "basis": "GTR §4.1.4.4.2",
   "tests": [
    "TC12"
   ],
   "claims": [
    "C04"
   ],
   "hazards": [
    "H06"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/status-v2.ts:71",
     "backend/src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service.ts:245",
     "contracts/src/schemas/wire.ts:165"
    ],
    "tests": [
     "backend/test/d04/status-v2.spec.ts"
    ],
    "gap": "재부팅 뒤 복원 없는 ACTIVE는 사후에 Incident로 탐지할 뿐 막지 못한다. 시뮬레이터에 재부팅·전원손실 경로가 없고, 캐시된 ON 정책 평가 시험도 없다(시험은 보고를 직접 주입, 재검증 2026-10-18).",
    "plan": [
     "ADS-SIM02",
     "ADS-BE07"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F034",
   "title": "안전 종료 진행 관리",
   "category": "종료·차단 해제",
   "priority": "P0",
   "owner": "차량",
   "content": "DDT 수행 중 종료 시 해당 fallback/인계 절차와 제어 책임을 추적해야 한다.",
   "acceptance": "요청 수락과 종료 완료가 분리되고 전환 중 책임 공백이 없다.",
   "basis": "GTR §4.1.4.4.1; §4.1.6",
   "tests": [
    "TC09"
   ],
   "claims": [
    "C04"
   ],
   "hazards": [
    "H06"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service.ts:304",
     "contracts/src/rules/kill-timeline.ts:33",
     "contracts/src/schemas/wire.ts:142"
    ],
    "tests": [
     "backend/test/d03/kill-timeline.spec.ts",
     "backend/test/d04/status-v2.spec.ts"
    ],
    "gap": "수락과 완료(DISABLED)는 분리되지만 status_report에 DDT/제어 책임 주체(owner) 필드가 없어 전환 중 책임 공백을 추적하지 못한다.",
    "plan": [
     "ADS-UI02",
     "ADS-BE01",
     "ADS-SIM03"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F035",
   "title": "선택적 차단 해제",
   "category": "종료·차단 해제",
   "priority": "P0",
   "owner": "공동",
   "content": "차단 해제는 원 종료 사건과 대상 Feature·범위를 명시해야 한다.",
   "acceptance": "다른 사건/Feature의 차단을 해제하지 못한다.",
   "basis": "GTR §4.1.4.4.2에서 도출",
   "tests": [
    "TC12"
   ],
   "claims": [
    "C04"
   ],
   "hazards": [
    "H06"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/schemas/wire.ts:68",
     "backend/src/domains/d03-safety/restore/restore.service.ts:74",
     "backend/src/domains/d03-safety/kill-switch/kill.service.ts:200"
    ],
    "tests": [
     "backend/test/d03/kill-v2.spec.ts",
     "backend/test/d03/kill-conflict.spec.ts"
    ],
    "gap": "복원은 killId·Feature 단위이고 Feature당 진행 중 차단은 하나지만, incident_id가 선택 필드이고 cmd_auth에 들어가지 않으며 차량 차단도 Feature 단위라 사건 단위 선택 해제가 보장되지 않는다.",
    "plan": [
     "ADS-UI02",
     "ADS-BE02"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F036",
   "title": "해제와 활성화 분리",
   "category": "종료·차단 해제",
   "priority": "P0",
   "owner": "차량",
   "content": "종료 차단 해제가 곧바로 Active 전이를 발생시키지 않아야 한다.",
   "acceptance": "해제 후에도 ODD·형상·사용자 절차를 새로 통과해야 한다.",
   "basis": "GTR §4.1.5.3; §4.2.2",
   "tests": [
    "TC04"
   ],
   "claims": [
    "C04"
   ],
   "hazards": [
    "H06"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service.ts:276",
     "backend/src/domains/d06-qsec/secure-deploy/secure-deploy.service.ts:107",
     "contracts/src/rules/kill-timeline.ts:62"
    ],
    "tests": [
     "backend/test/ads/defects.spec.ts",
     "backend/test/d03/delivery.spec.ts",
     "backend/test/d03/kill-timeline.spec.ts"
    ],
    "gap": "복원은 다음 시동 자체 시험 뒤 INACTIVE(차단 해제)로 끝나고 ACTIVE는 활성화 요청(ACT_PENDING → 비작동 확인 → ACTIVE)으로만 간다. 플랫폼은 INACTIVE만 복원 확인으로 세고, 복원 명령이 마지막인데 ACTIVE를 보고한 차량은 복원 상세(restore.activeWithoutRedecision)에 '재판정 근거 없음'으로 따로 센다(ADS-BE03 2026-11-06). 활성화 때 ODD·형상·사용자 절차 재확인은 시뮬레이터의 비작동 확인뿐이고, 플랫폼에는 v2 활성화 명령 발행 경로와 2.1 decision 보고 스키마가 없다. FF_IMP 차량 Guard는 아직 복원 → ACTIVE(그 저장소 갱신 필요).",
    "plan": [
     "ADS-UI02",
     "ADS-BE03"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F037",
   "title": "복구 전략 선택",
   "category": "복구·업데이트",
   "priority": "P0",
   "owner": "CCS",
   "content": "업데이트 실패·중단 시 검증된 복구 또는 안전 상태 전략을 적용해야 한다.",
   "acceptance": "복구 불가 시험에서 안전 상태 경로의 달성 증거가 남는다.",
   "basis": "R156 §7.2.2.1.1",
   "tests": [
    "TC18"
   ],
   "claims": [
    "C04"
   ],
   "hazards": [
    "H07"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/rollback.ts:224",
     "contracts/src/rules/rollback.ts:262"
    ],
    "tests": [
     "backend/test/d03/rollback.spec.ts"
    ],
    "gap": "정책 롤백은 검증된 기준으로만 하지만 SW 롤백은 OTA로 넘기고, 복구 불가 시 안전 상태 경로와 그 증거를 남기는 계약·시뮬레이션이 없다.",
    "plan": [
     "ADS-OTA01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F038",
   "title": "설치 사전조건",
   "category": "복구·업데이트",
   "priority": "P0",
   "owner": "차량",
   "content": "설치 시 차량 기술 상태와 설치·복구에 필요한 전원을 로컬에서 검증해야 한다.",
   "acceptance": "배터리 부족 또는 안전한 정지 유지 불충족 시 설치를 보류한다.",
   "basis": "R156 §7.2.2.1.2~3",
   "tests": [
    "TC16"
   ],
   "claims": [
    "C04"
   ],
   "hazards": [
    "H07"
   ],
   "review": {
    "verdict": "미구현",
    "evidence": [
     "frontend/src/data/twin/engine.ts:614"
    ],
    "tests": [],
    "gap": "설치 사전조건(배터리·정지 유지)과 설치 보류를 담는 계약 필드·시뮬레이터 동작이 없다.",
    "plan": [
     "ADS-OTA01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F039",
   "title": "형상 집합 복구",
   "category": "복구·업데이트",
   "priority": "P0",
   "owner": "공동",
   "content": "복구 후 ECU·모델·보정·정책의 전체 호환 형상을 재검증해야 한다.",
   "acceptance": "일부 ECU만 복구된 조합은 복구 완료/사용 재개로 표시되지 않는다.",
   "basis": "R156 호환성; §4.3.3",
   "tests": [
    "TC17"
   ],
   "claims": [
    "C04"
   ],
   "hazards": [
    "H07"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/attestation.ts:44",
     "contracts/src/schemas/wire.ts:85"
    ],
    "tests": [
     "backend/test/d02/attestation.spec.ts"
    ],
    "gap": "Attestation은 flag별 정책 해시·Feature Version·BOM Baseline만 비교하고 명령 target은 ECU 하나 — 다중 ECU·모델·보정 호환 집합 재검증과 부분 복구 표시가 없다.",
    "plan": [
     "ADS-UI05",
     "ADS-BE10",
     "ADS-OTA01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F040",
   "title": "승인된 내용 복원",
   "category": "복구·업데이트",
   "priority": "P0",
   "owner": "공동",
   "content": "과거 내용을 복원할 때도 새 승인 메타데이터와 보안 최소 버전을 준수해야 한다.",
   "acceptance": "rollback 명목의 취약 이미지·오래된 메타데이터 우회를 거부한다.",
   "basis": "Uptane 2.1.0; 보안 설계 제안",
   "tests": [
    "TC14"
   ],
   "claims": [
    "C04"
   ],
   "hazards": [
    "H07"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/rollback.ts:262",
     "backend/src/domains/d06-qsec/secure-deploy/secure-deploy.service.ts:112",
     "contracts/src/rules/status-v2.ts:102"
    ],
    "tests": [
     "backend/test/d03/rollback.spec.ts",
     "backend/test/d04/status-v2.spec.ts"
    ],
    "gap": "정책 복원은 새 개정본·재검증·새 서명·증가 순번으로 재게시되고 이전 key_epoch는 거부되지만 보안 최소 버전·SW anti-rollback 하한 검사가 없다.",
    "plan": [
     "ADS-BE10"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F041",
   "title": "오프라인 기준선",
   "category": "오프라인·재시작",
   "priority": "P0",
   "owner": "차량",
   "content": "초기 부팅·연결 상실·캐시 만료별 승인된 로컬 기준선을 정의해야 한다.",
   "acceptance": "최초 부팅에 정책이 없으면 미승인 기능의 신규 활성화를 허용하지 않는다.",
   "basis": "Unleash 패턴; 안전 통합 제안",
   "tests": [
    "TC10"
   ],
   "claims": [
    "C04"
   ],
   "hazards": [
    "H06"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "frontend/src/data/twin/engine.ts:409",
     "contracts/src/flags/evaluate.ts:89",
     "backend/src/domains/d02-runtime/vehicle-requests/vehicle-request.service.ts:197"
    ],
    "tests": [
     "frontend/src/__tests__/twinEngine.test.ts",
     "backend/test/d02/vehicle-requests.spec.ts"
    ],
    "gap": "오프라인 캐시 TTL·미배포 SAFE_DEFAULT·HELLO 재전달은 있지만 최초 부팅·연결 상실·캐시 만료별 승인 기준선 정의와 '정책 없는 최초 부팅이면 신규 활성화 불가' 시험이 없다.",
    "plan": [
     "ADS-SIM02"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F042",
   "title": "연결 상실 대응",
   "category": "오프라인·재시작",
   "priority": "P0",
   "owner": "차량",
   "content": "클라우드 연결 상실 시 현재 운전 상태의 대응은 차량 안전 개념으로 결정해야 한다.",
   "acceptance": "연결이 끊겨도 네트워크 타임아웃만으로 DDT가 단절되지 않는다.",
   "basis": "GTR §4.1 성능·fallback에서 도출",
   "tests": [
    "TC10"
   ],
   "claims": [
    "C04"
   ],
   "hazards": [
    "H06"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/schemas/wire.ts:160",
     "frontend/src/data/twin/engine.ts:80",
     "backend/src/domains/d04-ops/telemetry-ingest/status-ingest.service.ts:221"
    ],
    "tests": [
     "backend/test/d04/status-v2.spec.ts"
    ],
    "gap": "무회신을 overdue Incident로만 다루고, 연결 상실 중에도 DDT가 유지되는지 확인하는 시뮬레이터 동작·시험이 없다.",
    "plan": [
     "ADS-SIM02"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F043",
   "title": "재시작 상태 복원",
   "category": "오프라인·재시작",
   "priority": "P0",
   "owner": "차량",
   "content": "재시작 시 정책 epoch·종료 차단·진행 중 업데이트 상태를 일관되게 복원해야 한다.",
   "acceptance": "상태 저장 중 전원 손실 후 허용 상태로 임의 초기화되지 않는다.",
   "basis": "종료 지속·복구를 위한 설계 제안",
   "tests": [
    "TC13"
   ],
   "claims": [
    "C04"
   ],
   "hazards": [
    "H06"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/status-v2.ts:14",
     "contracts/src/schemas/wire.ts:48",
     "backend/src/domains/d06-qsec/secure-deploy/publication.repo.ts:72"
    ],
    "tests": [
     "backend/test/d04/status-v2.spec.ts"
    ],
    "gap": "부팅 참조·resync·ACTIVE_WITHOUT_RESTORE 검사는 있지만 시뮬레이터에 저장 중 전원손실·epoch·진행 중 업데이트 복원 동작이 없다.",
    "plan": [
     "ADS-SIM02"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F044",
   "title": "최신성 표시",
   "category": "오프라인·재시작",
   "priority": "P1",
   "owner": "CP",
   "content": "관제 화면의 상태에 마지막 관측 시각·연결 상태·불확실성을 표시해야 한다.",
   "acceptance": "오프라인 차량의 과거 readiness가 현재 안전 허가로 노출되지 않는다.",
   "basis": "상태 오인 방지 설계 제안",
   "tests": [
    "TC15"
   ],
   "claims": [
    "C04"
   ],
   "hazards": [
    "H06"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "frontend/src/screens/ops/FleetLive.tsx:400",
     "frontend/src/components/liveMonitor.ts:80",
     "contracts/src/flags/p0.ts:224"
    ],
    "tests": [
     "frontend/src/__tests__/twinEngine.test.ts"
    ],
    "gap": "링크 상태·신호 나이·STALE_REPORT→UNKNOWN은 보이지만 운영 화면의 차량 Feature 상태 표에 마지막 관측 시각·오프라인 불확실성 표시가 없다.",
    "plan": [
     "ADS-UI01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F045",
   "title": "로컬 최종 권한",
   "category": "런타임 통합",
   "priority": "P0",
   "owner": "차량",
   "content": "로컬 Safety Supervisor가 현재 차량 행위의 최종 안전 허용을 결정해야 한다.",
   "acceptance": "CP 관리자나 일반 SDK가 로컬 DENY를 우회할 수 없다.",
   "basis": "GTR 차량 요구의 책임 할당 제안",
   "tests": [
    "TC04"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H05"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/status-v2.ts:99",
     "backend/src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service.ts:245",
     "frontend/src/data/twin/engine.ts:728"
    ],
    "tests": [
     "backend/test/d04/status-v2.spec.ts",
     "frontend/src/__tests__/twinEngine.test.ts"
    ],
    "gap": "Guard가 서명·차량키·DC4·DISABLED 활성화를 거부하지만 백엔드 Guard 시뮬레이터의 activate는 로컬 DENY 조건 없이 ACTIVE로 간다.",
    "plan": [
     "ADS-SIM01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F046",
   "title": "실행 감시 연계",
   "category": "런타임 통합",
   "priority": "P1",
   "owner": "차량",
   "content": "프로세스 생존·deadline·순서 감시 결과를 기능 건전성 판단에 연결해야 한다.",
   "acceptance": "프로세스가 살아 있어도 deadline 위반을 별도 오류로 탐지한다.",
   "basis": "AUTOSAR R25-11 HM/PHM",
   "tests": [
    "TC22"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H05"
   ],
   "review": {
    "verdict": "범위 밖",
    "evidence": [
     "contracts/src/schemas/wire.ts:154",
     "contracts/src/schemas/safety.ts:109"
    ],
    "tests": [],
    "gap": "PHM deadline 감시는 차량 내부 기능이다. 플랫폼은 dtc[]·FAULT 보고만 받는다.",
    "plan": []
   },
   "defects": []
  },
  {
   "id": "FFP-F047",
   "title": "의미·출력 감시",
   "category": "런타임 통합",
   "priority": "P1",
   "owner": "차량",
   "content": "헬스 감시 외에 센서 일관성·출력 제한·제어 경계 위반을 감시해야 한다.",
   "acceptance": "정상 heartbeat를 내는 비정상 제어 출력이 허용되지 않는다.",
   "basis": "GTR §4.1.4; SOTIF에서 도출",
   "tests": [
    "TC22"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H05"
   ],
   "review": {
    "verdict": "범위 밖",
    "evidence": [
     "contracts/src/schemas/wire.ts:154",
     "frontend/src/data/twin/engine.ts:275"
    ],
    "tests": [],
    "gap": "센서 일관성·출력 제한 감시는 차량 내부 기능이다. 플랫폼은 DTC와 effective drift만 다룬다.",
    "plan": []
   },
   "defects": []
  },
  {
   "id": "FFP-F048",
   "title": "제어 경로 격리",
   "category": "런타임 통합",
   "priority": "P1",
   "owner": "차량",
   "content": "정책 평가 경로와 안전 중요 제어 경로 사이의 간섭을 분석·통제해야 한다.",
   "acceptance": "정책 폭주·CPU/메모리 부하 주입이 할당된 제어 deadline을 침해하지 않는다.",
   "basis": "ISO 26262 기반 설계 제안",
   "tests": [
    "TC22"
   ],
   "claims": [
    "C03"
   ],
   "hazards": [
    "H05"
   ],
   "review": {
    "verdict": "범위 밖",
    "evidence": [],
    "tests": [],
    "gap": "정책 평가 경로와 제어 경로의 실행 격리는 차량 내부 기능이다.",
    "plan": []
   },
   "defects": []
  },
  {
   "id": "FFP-F049",
   "title": "실제 상태 수집",
   "category": "관측·사건 대응",
   "priority": "P0",
   "owner": "공동",
   "content": "정책 의도와 차량의 실제 적용·Active·전환·차단 상태를 별도 수집해야 한다.",
   "acceptance": "허용 대상 수와 실제 Active 노출량이 별도 집계된다.",
   "basis": "GTR §5.1.8.4; §5.4",
   "tests": [
    "TC15"
   ],
   "claims": [
    "C05"
   ],
   "hazards": [
    "H08"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d04-ops/telemetry-ingest/status-ingest.service.ts:155",
     "frontend/src/screens/ops/Deployments.tsx:277",
     "frontend/src/screens/ops/FleetLive.tsx:75"
    ],
    "tests": [
     "backend/test/d04/status-v2.spec.ts",
     "backend/test/d03/delivery.spec.ts",
     "contracts/src/rules/status-v2.test.ts"
    ],
    "gap": "차량 실제 상태와 게시본 회신은 정책 의도와 따로 수집되지만, Feature·cohort별 '허용 대상 수'와 '실제 Active 노출량'을 따로 세는 집계가 없다.",
    "plan": [
     "ADS-UI01",
     "ADS-BE12"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F050",
   "title": "사건 타임라인",
   "category": "관측·사건 대응",
   "priority": "P1",
   "owner": "공동",
   "content": "사건에 연관된 정책·형상·ODD·판정·전환 이력을 공통 식별자로 연결해야 한다.",
   "acceptance": "동일 사건의 차량 로컬 순서와 서버 수신 순서가 구별된다.",
   "basis": "GTR §5.3.3; §5.4에서 도출",
   "tests": [
    "TC19"
   ],
   "claims": [
    "C05"
   ],
   "hazards": [
    "H08"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/kill-timeline.ts:49",
     "backend/src/domains/d04-ops/telemetry-ingest/status-ingest.service.ts:143",
     "backend/src/domains/d04-ops/incident-voc/incident.service.ts:59"
    ],
    "tests": [
     "contracts/src/rules/kill-timeline.test.ts",
     "backend/test/d03/kill-timeline.spec.ts"
    ],
    "gap": "Kill 시간 기록은 명령 ID·차량 observed_at·vehicle_seq로 재구성하지만 서버 수신 순서를 따로 보이지 않고, Incident를 정책·형상·ODD·판정·전환 이력과 묶는 공통 사건 ID가 없다.",
    "plan": [
     "ADS-UI07",
     "ADS-BE13"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F051",
   "title": "안전 지표 승격 기준",
   "category": "관측·사건 대응",
   "priority": "P1",
   "owner": "CP",
   "content": "사전에 승인한 노출량·사건·판정 실패 지표로 cohort 확대 여부를 평가해야 한다.",
   "acceptance": "거래/클릭률 개선만으로 안전 관련 변경이 승격되지 않는다.",
   "basis": "Waymo·LD 패턴의 제한적 적용",
   "tests": [
    "TC19"
   ],
   "claims": [
    "C05"
   ],
   "hazards": [
    "H08"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/rollout-stage.ts:44",
     "backend/src/domains/d01-policy/staged-rollout/staged-rollout.service.ts:47",
     "contracts/src/rules/ext.ts:63"
    ],
    "tests": [
     "backend/test/d01/rollout-stage.spec.ts",
     "contracts/src/rules/ext.test.ts",
     "backend/test/ext/p10.spec.ts"
    ],
    "gap": "Canary 관측·이상 징후·진행 중 차단을 중단 기준으로 쓰지만, 사전 승인한 노출량·사건·판정 실패 지표(감시 지표 경보·노출량 부족·데이터 지연)를 확대 판정 입력으로 쓰지 않는다.",
    "plan": [
     "ADS-UI11",
     "ADS-BE12"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F052",
   "title": "법정 기록 경계",
   "category": "관측·사건 대응",
   "priority": "P0",
   "owner": "공동",
   "content": "운영 로그와 DSSAD·법정 사건 보고의 책임·보존 경계를 구분해야 한다.",
   "acceptance": "FFP 로그 존재만으로 DSSAD 충족으로 표기하지 않는다.",
   "basis": "GTR §4.3.1; §5.4; Annex 6",
   "tests": [
    "TC24"
   ],
   "claims": [
    "C05"
   ],
   "hazards": [
    "H08"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/kill-timeline.ts:47",
     "backend/src/domains/d04-ops/telemetry-ingest/safety-kpi.service.ts:154",
     "contracts/src/rules/compliance-profile.ts:34"
    ],
    "tests": [
     "contracts/src/rules/kill-timeline.test.ts",
     "backend/test/d04/safety-kpi.spec.ts"
    ],
    "gap": "주석에는 'DSSAD는 차량 기록'이라 적었지만 운영 로그와 DSSAD·법정 보고의 경계를 데이터·화면으로 구분하지 않고, 표준 추적표가 FFG-TEL-004를 구현으로 표시한다(합격 조건과 충돌). (결함이 아닌 표시 정정 대상 — ADS-BE13에서 표준 추적표 상태를 고친다)",
    "plan": [
     "ADS-UI07",
     "ADS-BE13"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F053",
   "title": "실행 형상 추적",
   "category": "검증·증거",
   "priority": "P0",
   "owner": "공동",
   "content": "시험 결과를 정책·ODD·HW/SW·도구·시나리오 버전에 결합해야 한다.",
   "acceptance": "다른 형상의 통과 결과를 현재 릴리스 증거로 자동 재사용하지 않는다.",
   "basis": "GTR §5.3.3.9.3",
   "tests": [
    "TC21"
   ],
   "claims": [
    "C06"
   ],
   "hazards": [
    "H08"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d06-qsec/scenario-validation/virtual-run.repo.ts:43",
     "contracts/src/rules/virtual.ts:86",
     "contracts/src/rules/validators.ts:116"
    ],
    "tests": [
     "backend/test/d06/virtual.spec.ts",
     "backend/test/d01/gate-decision.spec.ts",
     "backend/test/d01/release-signoff.spec.ts"
    ],
    "gap": "가상검증 근거는 정책 contentHash·도구 Version·시나리오·시드에 묶이지만 차량 HW/SW·ODD 형상은 결합 키에 없다.",
    "plan": [
     "ADS-UI08",
     "ADS-BE14"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F054",
   "title": "고장 경로 검증",
   "category": "검증·증거",
   "priority": "P0",
   "owner": "공동",
   "content": "종료·입력 노후·통신 단절·부분 복구를 포함한 시험을 수행해야 한다.",
   "acceptance": "요구별 정상/실패 시나리오의 결과와 미해결 결함이 조회된다.",
   "basis": "GTR §5.2~3에서 도출",
   "tests": [
    "TC22"
   ],
   "claims": [
    "C06"
   ],
   "hazards": [
    "H08"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/virtual.ts:38",
     "backend/src/domains/d04-ops/telemetry-ingest/status-ingest.service.ts:221",
     "tools/requirements.ts:13"
    ],
    "tests": [
     "backend/test/d03/delivery.spec.ts",
     "backend/test/d04/status-v2.spec.ts",
     "sim/carla/tests/test_core.py"
    ],
    "gap": "통신 단절·재전송·차량 내 고장 시험은 있지만 입력 노후·부분 복구 시나리오가 없고, FFP 요구별 정상/실패 결과와 미해결 결함 조회가 없다.",
    "plan": [
     "ADS-UI10",
     "ADS-BE18"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F055",
   "title": "시뮬레이션 신뢰성",
   "category": "검증·증거",
   "priority": "P1",
   "owner": "공동",
   "content": "시뮬레이션 증거의 유효 범위와 실차/시험장 상관성을 관리해야 한다.",
   "acceptance": "도구 검증 범위 밖의 결과는 한계 표시 없이 승인 증거로 사용되지 않는다.",
   "basis": "GTR §5.2.1.8.1; §5.2.1.14.2",
   "tests": [
    "TC21"
   ],
   "claims": [
    "C06"
   ],
   "hazards": [
    "H08"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/validators.ts:116",
     "contracts/src/rules/tool-qualification.ts:73",
     "contracts/src/rules/virtual.ts:106"
    ],
    "tests": [
     "backend/test/d06/virtual.spec.ts",
     "sim/carla/tests/test_core.py",
     "contracts/src/rules/tool-qualification.test.ts"
    ],
    "gap": "vECU 기록은 Evidence로 인정하지 않고 CARLA 한계는 문구로만 남는다. 도구 유효 범위(ODD·시나리오)와 실차 상관성을 관리하지 않고 범위 밖 결과에 한계를 자동 표시하지 않는다.",
    "plan": [
     "ADS-UI08",
     "ADS-BE14"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F056",
   "title": "독립 검토 추적",
   "category": "검증·증거",
   "priority": "P1",
   "owner": "CP",
   "content": "안전 근거 검토의 담당·독립성·발견사항·종결을 기록해야 한다.",
   "acceptance": "열린 중대 발견사항이 있는 변경의 승격을 차단한다.",
   "basis": "GTR §5.3.4; SMS 감사와 별도",
   "tests": [
    "TC20"
   ],
   "claims": [
    "C06"
   ],
   "hazards": [
    "H08"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d06-qsec/iam/post-review.service.ts:58",
     "contracts/src/rules/duty-separation.ts:83",
     "backend/src/domains/d01-policy/registry/release-signoff.service.ts:3"
    ],
    "tests": [
     "backend/test/d06/post-review.spec.ts",
     "contracts/src/rules/duty-separation.test.ts"
    ],
    "gap": "Kill 사후 검토의 독립성과 출시 서명은 기록하지만 Safety Case 독립 검토의 발견사항·중대도·종결을 추적하지 않고, 열린 중대 발견사항으로 승격을 막지 않는다.",
    "plan": [
     "ADS-UI08",
     "ADS-BE14"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F057",
   "title": "권한 범위 제어",
   "category": "운영 UI·접근 통제",
   "priority": "P0",
   "owner": "CP",
   "content": "역할별 환경·시장·Feature·명령 권한을 제한해야 한다.",
   "acceptance": "분석 전용 사용자의 종료·해제·정책 발행을 거부한다.",
   "basis": "보안·운영 통제 설계 제안",
   "tests": [
    "TC20"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H02"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/access.ts:20",
     "backend/src/domains/d06-qsec/iam/iam.service.ts:20"
    ],
    "tests": [
     "backend/test/d06/iam-variant.spec.ts"
    ],
    "gap": "역할별 명령 권한은 있지만 환경·시장·Feature 단위 권한 범위 제한이 없고, 분석 전용 역할의 해제·발행 거부 시험이 없다.",
    "plan": [
     "ADS-UI03",
     "ADS-BE15"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F058",
   "title": "의도·실제 비교 UI",
   "category": "운영 UI·접근 통제",
   "priority": "P1",
   "owner": "CP",
   "content": "정책 의도·전달 단계·차량 실제 상태·사유를 동시에 표시해야 한다.",
   "acceptance": "운영자가 미수신과 로컬 거부 차량을 다른 목록으로 조회한다.",
   "basis": "관측 오인 방지 설계 제안",
   "tests": [
    "TC15"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H02"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "frontend/src/screens/ops/Deployments.tsx:281",
     "backend/src/domains/d06-qsec/secure-deploy/secure-deploy.service.ts:198"
    ],
    "tests": [],
    "gap": "게시본 상세에 차량별 상태·사유를 한 표로만 보인다. 미수신과 로컬 거부를 따로 조회하는 목록·필터와 시험이 없다.",
    "plan": [
     "ADS-UI01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F059",
   "title": "일괄 명령 미리보기",
   "category": "운영 UI·접근 통제",
   "priority": "P1",
   "owner": "CP",
   "content": "대량 조작 전에 대상 수·제외 사유·위험·차단 해제 범위를 표시해야 한다.",
   "acceptance": "서버 계산과 서명된 대상 집합이 일치하지 않으면 발행을 막는다.",
   "basis": "운영 오류 방지 설계 제안",
   "tests": [
    "TC20"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H02"
   ],
   "review": {
    "verdict": "구현",
    "evidence": [
     "backend/src/domains/d03-safety/deploy-safety/policy-gate.service.ts:159",
     "backend/src/domains/d03-safety/deploy-safety/policy-gate.service.ts:155",
     "backend/src/domains/d03-safety/kill-switch/kill.service.ts:297",
     "contracts/src/rules/kill-v2.ts:214",
     "backend/src/domains/d06-qsec/pki-kms/hsm.service.ts:146",
     "backend/src/domains/d06-qsec/pki-kms/hsm.service.ts:103"
    ],
    "tests": [
     "backend/test/ads/defects.spec.ts",
     "backend/test/d03/policy-gate.spec.ts",
     "backend/test/d03/kill-v2.spec.ts"
    ],
    "gap": "게이트가 모든 승인 칸을 그 승인자의 등록된 공개키로, 명령에서 다시 만든 대상(기능·요청·사유·차량 집합·승인자·역할·서명 시각)에 대해 검증한다 — 플랫폼 발행 명령과 외부 명령 모두. 키 미등록·검증 실패·대상 불일치·발효 시각과 동떨어진 서명 시각은 FFG-PLT-005 FAIL(D-RD-5, 보고서 예시의 자리표시 서명도 FAIL). 외부 승인자는 공개키만 등록하고 운영 모드는 미등록 승인을 403으로 거부한다. 미리보기는 대상 수·의존 Feature·flag·차단 단계·24시간 누적·사전 판정을 보이고, 제외 사유는 오프라인 차량 표시 수준이다.",
    "plan": [
     "ADS-UI03",
     "ADS-BE05"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F060",
   "title": "운영 감사 추적",
   "category": "운영 UI·접근 통제",
   "priority": "P0",
   "owner": "CP",
   "content": "승인·정책 발행·긴급 명령·해제에 대해 변경 전후와 행위자를 감사 가능하게 남겨야 한다.",
   "acceptance": "변경 이력이 무단 수정/삭제된 경우 탐지하고 원본 근거를 추적한다.",
   "basis": "GTR SMS; 보안 설계 제안",
   "tests": [
    "TC20"
   ],
   "claims": [
    "C02"
   ],
   "hazards": [
    "H02"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/kernel/audit.service.ts:540",
     "backend/src/kernel/audit.service.ts:512",
     "backend/src/kernel/audit.service.ts:322"
    ],
    "tests": [
     "backend/test/kernel/audit-chain.spec.ts"
    ],
    "gap": "중간 행 수정·삭제, 끝 행 삭제(프로세스가 기억한 끝), DB 권한자의 체인 재계산(DB 밖 HMAC 서명 고정점 FF_AUDIT_KEY·FF_AUDIT_ANCHOR_FILE), 운영 모드의 hash 없는 행 편입 금지까지 탐지한다. 고정점은 감사 쓰기마다(FF_AUDIT_ANCHOR_ROWS, 기본 1) 남기고 체인 키 식별자(kid)를 함께 서명하며, 검증 결과에 마지막 일치 고정점과 불일치 구간(broken.range)을 돌려준다(ADS-BE19 2026-11-06 — 재시작 뒤 마지막 행 삭제도 탐지). 남은 것: 고정점 파일의 WORM 보관·외부 시각 인증은 설치 몫(설치 안내서), 체크포인트 사이 행 사본의 외부 append-only 대조, 비운영 모드의 hash 없는 행 보충 1회 제한, 변경 이력의 원본 근거 추적 화면(내보내기·필터)은 REQ B4.",
    "plan": [
     "ADS-BE19"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F061",
   "title": "Shadow 격리",
   "category": "도입·수명주기",
   "priority": "P1",
   "owner": "공동",
   "content": "평가용 Shadow 정책이 실제 제어·활성화·설치 권한을 쓰지 못하게 해야 한다.",
   "acceptance": "실운행 Shadow 결과가 액추에이터/정책 수락 상태를 변경하지 못한다.",
   "basis": "시험 안전을 위한 설계 제안",
   "tests": [
    "TC23"
   ],
   "claims": [
    "C06"
   ],
   "hazards": [
    "H08"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d01-policy/experiment/experiment.service.ts:151",
     "contracts/src/rules/ext.ts:63"
    ],
    "tests": [
     "backend/test/ext/p10.spec.ts",
     "contracts/src/rules/ext.test.ts",
     "e2e/tests/p10.spec.ts"
    ],
    "gap": "Shadow는 서버에서 판단만 계산하고 정책을 쓰지 않지만, 차량 쪽 Shadow 경로의 출력·활성화·설치 권한 격리는 계약·시험이 없다.",
    "plan": [
     "ADS-LC01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F062",
   "title": "상품 권한 어댑터",
   "category": "도입·수명주기",
   "priority": "P1",
   "owner": "CP",
   "content": "상품 권한을 안전 허가와 구분된 입력으로 차량에 전달해야 한다.",
   "acceptance": "결제 성공·구독 만료가 직접 DDT 소유권을 변경하지 않는다.",
   "basis": "Feature 범위·안전 전환 해석",
   "tests": [
    "TC11"
   ],
   "claims": [
    "C06"
   ],
   "hazards": [
    "H08"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "backend/src/domains/d03-safety/kill-switch/trial-expiry.listener.ts:64",
     "contracts/src/flags/evaluate.ts:107",
     "backend/src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service.ts:295"
    ],
    "tests": [
     "backend/test/d03/trial-expiry-kill.spec.ts",
     "backend/test/d05/trial-expiry.spec.ts",
     "contracts/src/rules/deactivation.test.ts"
    ],
    "gap": "상품 권한은 평가의 별도 입력이지만 F2+에서도 권한 변화가 평가 결과(DENY/ALLOW)를 직접 바꾼다. DC3 경로는 체험권 만료뿐이고 결제 성공·일반 구독 만료 시험이 없다(재검증 2026-10-18).",
    "plan": [
     "ADS-BE20",
     "ADS-BE01",
     "ORC-BE01",
     "ORC-UI01"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F063",
   "title": "장기 지원 기준선",
   "category": "도입·수명주기",
   "priority": "P1",
   "owner": "공동",
   "content": "Feature 종료·서버 교체 이후에도 차량의 필요한 기준선·차단·키 갱신을 유지해야 한다.",
   "acceptance": "지원 종료 연습에서 기능이 미승인 ON으로 초기화되지 않는다.",
   "basis": "차량 수명주기 운영 제안",
   "tests": [
    "TC23"
   ],
   "claims": [
    "C06"
   ],
   "hazards": [
    "H08"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/policy-gate.ts:101",
     "contracts/src/rules/retirement.ts:59",
     "contracts/src/flags/openfeature.ts:141"
    ],
    "tests": [
     "backend/test/d01/retirement.spec.ts",
     "contracts/src/rules/policy-gate.test.ts",
     "backend/test/d03/policy-gate.spec.ts"
    ],
    "gap": "폐기 Feature는 비활성화만 허용되고 Retirement 6단계·Safe State 기본값이 있지만, 지원 종료·서버 교체 연습과 기준선·키 갱신 지속 절차·시험이 없다.",
    "plan": [
     "ADS-LC02"
    ]
   },
   "defects": []
  },
  {
   "id": "FFP-F064",
   "title": "규정·표준 변경 관리",
   "category": "도입·수명주기",
   "priority": "P1",
   "owner": "CP",
   "content": "근거 문서의 버전·접근 수준·변경 영향·담당 재검토를 관리해야 한다.",
   "acceptance": "표준 개정 시 영향받는 요구·시험·미확인 항목을 조회한다.",
   "basis": "SMS 및 근거 최신성 관리 제안",
   "tests": [
    "TC24"
   ],
   "claims": [
    "C06"
   ],
   "hazards": [
    "H08"
   ],
   "review": {
    "verdict": "부분",
    "evidence": [
     "contracts/src/rules/compliance-profile.ts:7",
     "tools/guide-sync.ts:244",
     "tools/standards.ts:2"
    ],
    "tests": [
     "tools/guide-sync.test.ts",
     "tools/standards.test.ts",
     "contracts/src/rules/compliance-profile.test.ts"
    ],
    "gap": "Profile Version·원본 해시 변경 경고·규칙별 구현·시험 추적은 있지만, 표준 개정 때 영향받는 FFP 요구·시험·미확인 항목 조회와 접근 수준·담당 재검토 기록이 없다.",
    "plan": [
     "ADS-UI10",
     "ADS-BE18"
    ]
   },
   "defects": []
  }
 ],
 "tests": [
  {
   "id": "TC01",
   "name": "적용 범위",
   "expected": "승인 범위 밖 배포/ADS 의무 자동 전용을 거부",
   "requirements": [
    "FFP-F001",
    "FFP-F003"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "contracts/src/rules/compliance-profile.test.ts",
     "backend/test/d03/policy-gate.spec.ts",
     "contracts/src/rules/classification.test.ts"
    ],
    "plan": [
     "ADS-BE16"
    ]
   }
  },
  {
   "id": "TC02",
   "name": "변경 영향",
   "expected": "승인 영향 분석과 Safety Case 갱신 전 발행 금지",
   "requirements": [
    "FFP-F002",
    "FFP-F007",
    "FFP-F008"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "backend/test/d06/rehara.spec.ts",
     "contracts/src/rules/rehara.test.ts"
    ],
    "plan": [
     "ADS-BE08"
    ]
   }
  },
  {
   "id": "TC03",
   "name": "ODD 의미",
   "expected": "컴파일 오류 또는 로컬 활성화 DENY",
   "requirements": [
    "FFP-F016",
    "FFP-F025",
    "FFP-F026"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "backend/test/d01/odd-restriction.spec.ts",
     "contracts/src/rules/odd-restriction.test.ts"
    ],
    "plan": [
     "ADS-BE09"
    ]
   }
  },
  {
   "id": "TC04",
   "name": "신규 활성화",
   "expected": "Active 전이 없음, 구체적 reasonCode",
   "requirements": [
    "FFP-F021",
    "FFP-F036",
    "FFP-F045"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "backend/test/d04/status-v2.spec.ts",
     "backend/test/d02/support-activation.spec.ts",
     "backend/test/d02/attestation.spec.ts"
    ],
    "plan": [
     "ADS-SIM01"
    ]
   }
  },
  {
   "id": "TC05",
   "name": "불확실한 ODD",
   "expected": "UNKNOWN; 신규 활성화 거부, Active는 안전 개념의 대응",
   "requirements": [
    "FFP-F027"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "contracts/src/flags/p0.test.ts"
    ],
    "plan": [
     "ADS-SIM01"
    ]
   }
  },
  {
   "id": "TC06",
   "name": "입력 품질",
   "expected": "과거 ALLOW 재사용 없음; 불일치 사유 기록",
   "requirements": [
    "FFP-F023",
    "FFP-F030"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "backend/test/d02/vehicle-requests.spec.ts",
     "contracts/src/rules/kill-timeline.test.ts"
    ],
    "plan": [
     "ADS-SIM01"
    ]
   }
  },
  {
   "id": "TC07",
   "name": "경계 접근",
   "expected": "예측 가능한 전환 준비와 승인된 fallback 계획 실행",
   "requirements": [
    "FFP-F028"
   ],
   "review": {
    "status": "없음",
    "evidence": [],
    "plan": [
     "ADS-SIM01"
    ]
   }
  },
  {
   "id": "TC08",
   "name": "정지와 MRC",
   "expected": "정지 사실만으로 MRC/설치 허가 완료 없음",
   "requirements": [
    "FFP-F029",
    "FFP-F031"
   ],
   "review": {
    "status": "없음",
    "evidence": [],
    "plan": [
     "ADS-SIM03"
    ]
   }
  },
  {
   "id": "TC09",
   "name": "인계·종료",
   "expected": "해당 ADSF 절차 유지; 인계 실패 시 해당 fallback/MRC",
   "requirements": [
    "FFP-F034"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "contracts/src/rules/deactivation.test.ts",
     "sim/carla/tests/test_core.py"
    ],
    "plan": [
     "ADS-SIM03"
    ]
   }
  },
  {
   "id": "TC10",
   "name": "연결 상실",
   "expected": "신규 허용과 기존 운전 대응 구별; 제어 공백 없음",
   "requirements": [
    "FFP-F041",
    "FFP-F042"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "backend/test/d02/vehicle-requests.spec.ts",
     "backend/test/d03/delivery.spec.ts"
    ],
    "plan": [
     "ADS-SIM02"
    ]
   }
  },
  {
   "id": "TC11",
   "name": "상품 권한",
   "expected": "즉시 DDT 단절 없음; 승인된 종료 절차/사용자 안내",
   "requirements": [
    "FFP-F022",
    "FFP-F062"
   ],
   "review": {
    "status": "자동 시험 있음",
    "evidence": [
     "backend/test/d03/trial-expiry-kill.spec.ts",
     "contracts/src/rules/deactivation.test.ts",
     "backend/test/d05/trial-expiry.spec.ts"
    ],
    "plan": []
   }
  },
  {
   "id": "TC12",
   "name": "종료·해제",
   "expected": "해당 차단 지속; 정당한 선택적 해제 후에도 자동 Active 없음",
   "requirements": [
    "FFP-F011",
    "FFP-F033",
    "FFP-F035"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "backend/test/d04/status-v2.spec.ts",
     "backend/test/d03/kill-v2.spec.ts",
     "backend/test/d03/delivery.spec.ts"
    ],
    "plan": [
     "ADS-BE02",
     "ADS-BE03"
    ]
   }
  },
  {
   "id": "TC13",
   "name": "지연·중복",
   "expected": "epoch 후퇴 없음; 중복 효과 없음; 안전한 상태 복원",
   "requirements": [
    "FFP-F015",
    "FFP-F019",
    "FFP-F043"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "backend/test/d03/delivery.spec.ts",
     "contracts/src/rules/status-v2.test.ts",
     "backend/test/d03/policy-gate.spec.ts"
    ],
    "plan": [
     "ADS-BE04",
     "ADS-BE07",
     "ADS-SIM02"
    ]
   }
  },
  {
   "id": "TC14",
   "name": "보안 복원",
   "expected": "서명·대상·최소 버전 위반 거부",
   "requirements": [
    "FFP-F014",
    "FFP-F040"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "backend/test/d03/delivery.spec.ts",
     "backend/test/d04/status-v2.spec.ts",
     "backend/test/d03/gleo-v2-vectors.spec.ts"
    ],
    "plan": [
     "ADS-BE05",
     "ADS-BE10"
    ]
   }
  },
  {
   "id": "TC15",
   "name": "운영 상태",
   "expected": "수신/수락/적용/실행을 분리, 최신성 표시",
   "requirements": [
    "FFP-F017",
    "FFP-F018",
    "FFP-F044",
    "FFP-F049",
    "FFP-F058"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "backend/test/d03/delivery.spec.ts",
     "backend/test/d04/status-v2.spec.ts",
     "contracts/src/rules/status-v2.test.ts"
    ],
    "plan": [
     "ADS-BE01",
     "ADS-UI01"
    ]
   }
  },
  {
   "id": "TC16",
   "name": "설치 시점",
   "expected": "직전 재검증에서 설치 보류/중단 경로 실행",
   "requirements": [
    "FFP-F024",
    "FFP-F038"
   ],
   "review": {
    "status": "없음",
    "evidence": [],
    "plan": [
     "ADS-OTA01"
    ]
   }
  },
  {
   "id": "TC17",
   "name": "부분 복구",
   "expected": "호환 집합 확인 전 복구 완료·활성화 금지",
   "requirements": [
    "FFP-F005",
    "FFP-F006",
    "FFP-F039"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "contracts/src/flags/p0.test.ts"
    ],
    "plan": [
     "ADS-BE10"
    ]
   }
  },
  {
   "id": "TC18",
   "name": "복구 실패",
   "expected": "검증된 안전 상태 경로와 재시작 후 상태 일관성",
   "requirements": [
    "FFP-F037"
   ],
   "review": {
    "status": "없음",
    "evidence": [],
    "plan": [
     "ADS-OTA01"
    ]
   }
  },
  {
   "id": "TC19",
   "name": "cohort 관측",
   "expected": "추가 확대 정지; 누락을 성공으로 처리하지 않음",
   "requirements": [
    "FFP-F012",
    "FFP-F020",
    "FFP-F050",
    "FFP-F051"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "backend/test/d01/rollout-stage.spec.ts",
     "backend/test/d04/safety-kpi.spec.ts"
    ],
    "plan": [
     "ADS-BE12"
    ]
   }
  },
  {
   "id": "TC20",
   "name": "운영 오조작",
   "expected": "권한 거부·대상 미리보기·감사 이력 생성",
   "requirements": [
    "FFP-F009",
    "FFP-F056",
    "FFP-F057",
    "FFP-F059",
    "FFP-F060"
   ],
   "review": {
    "status": "자동 시험 있음",
    "evidence": [
     "backend/test/d03/kill-v2.spec.ts",
     "backend/test/d03/policy-gate.spec.ts",
     "backend/test/d03/rollback.spec.ts"
    ],
    "plan": [
     "ADS-BE15"
    ]
   }
  },
  {
   "id": "TC21",
   "name": "증거 재현",
   "expected": "승격 거부; 재현 가능한 정확한 형상 증거 요구",
   "requirements": [
    "FFP-F010",
    "FFP-F013",
    "FFP-F053",
    "FFP-F055"
   ],
   "review": {
    "status": "자동 시험 있음",
    "evidence": [
     "backend/test/d06/virtual.spec.ts",
     "backend/test/d01/gate-decision.spec.ts",
     "backend/test/d01/release-signoff.spec.ts"
    ],
    "plan": [
     "ADS-BE11"
    ]
   }
  },
  {
   "id": "TC22",
   "name": "감시·시간",
   "expected": "의미 감시·격리·시간 예산에 따른 대응",
   "requirements": [
    "FFP-F032",
    "FFP-F046",
    "FFP-F047",
    "FFP-F048",
    "FFP-F054"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "sim/carla/tests/test_core.py",
     "backend/test/d04/status-v2.spec.ts"
    ],
    "plan": [
     "ADS-SIM03"
    ]
   }
  },
  {
   "id": "TC23",
   "name": "Shadow·폐기",
   "expected": "출력 권한 없음; 승인되지 않은 신규 허용 없음",
   "requirements": [
    "FFP-F004",
    "FFP-F061",
    "FFP-F063"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "backend/test/ext/p10.spec.ts",
     "contracts/src/rules/policy-gate.test.ts",
     "backend/test/d01/retirement.spec.ts"
    ],
    "plan": [
     "ADS-LC01",
     "ADS-LC02"
    ]
   }
  },
  {
   "id": "TC24",
   "name": "근거·기록",
   "expected": "영향 요구 조회; 별도 DSSAD/사건 보고 책임 유지",
   "requirements": [
    "FFP-F052",
    "FFP-F064"
   ],
   "review": {
    "status": "일부",
    "evidence": [
     "tools/guide-sync.test.ts",
     "tools/standards.test.ts"
    ],
    "plan": [
     "ADS-BE13",
     "ADS-BE18"
    ]
   }
  }
 ],
 "scenarios": [
  {
   "id": "S01",
   "title": "구매는 완료됐지만 ODD 밖인 경우",
   "situation": "사용자가 고속도로 ADS 상품을 구매했지만 현재 차량은 도심 이면도로에 있다.",
   "handling": "상품 권한은 유효로 표시하고 차량 활성화는 거부한다. 고속도로 진입 후에도 센서·고장·적용 구성과 필요한 사용자 절차를 확인한다.",
   "review": {
    "current": "평가기는 사용 권한(ENTITLEMENT)과 지원 조건·적용 범위를 따로 판정해 NO_ENTITLEMENT·NOT_SUPPORTED로 나눈다(contracts/src/flags/evaluate.ts:128).",
    "gap": "현재 위치·도로 유형에 따른 ODD 판정이 없어 '구매됨 / 현재 운행 조건에서 사용 불가'를 판정하지도 표시하지도 못한다.",
    "plan": [
     "ADS-UI06",
     "ADS-SIM01"
    ]
   }
  },
  {
   "id": "S02",
   "title": "고속 주행 중 결함으로 원격 종료",
   "situation": "ADS가 DDT를 수행하는 동안 해당 구성에서 안전 결함이 확인돼 종료 요청이 도착한다.",
   "handling": "차량은 요청을 검증하고, 종료 후 재활성화 차단을 유지하면서 현재 상태에 맞는 fallback을 수행한다. 사용자 인계가 가능한 기능은 해당 인계 조건을 따르고, 인계 불가·실패 시 적용되는 MRC 경로를 따른다.",
   "review": {
    "current": "Kill v2 DC2 차단은 경고·인계 → 램프 → DISABLED 단계를 밟고 수락·완료 시각을 명령 ID와 기록한다(vehicle-runtime.service.ts:248, kill-timeline.ts:64).",
    "gap": "인계 불가·실패 시의 MRC 경로와 DMS 조건을 모델링하지 않아 MRC 시각이 항상 비어 있고, 제어 책임 주체가 기록되지 않는다.",
    "plan": [
     "ADS-UI02",
     "ADS-SIM03"
    ]
   }
  },
  {
   "id": "S03",
   "title": "국가 타기팅 오류를 정책 롤백",
   "situation": "허용되지 않은 시장의 일부 차량에 ADS 활성화 정책이 전달됐다.",
   "handling": "신규 대상 확대를 중단하고 잘못 포함된 차량을 식별한다. 비활성 차량은 새 활성화를 막고, 이미 active인 차량은 안전 종료 경로를 따른다. 단순히 과거 정책을 복원하는 것 외에 이미 발생한 운행·사건을 평가한다.",
   "review": {
    "current": "미확인 시장에서 F2+ 활성화를 막고(FFG-GEN-003) 정책 롤백은 flag 단위 범위·승인으로 처리한다(compliance-profile.ts:59).",
    "gap": "잘못 포함된 차량을 식별하고 그 차량의 실제 Active·운행 이력과 시정 결과를 평가하는 흐름이 없다.",
    "plan": [
     "ADS-UI01",
     "ADS-BE05",
     "ADS-BE13"
    ]
   }
  },
  {
   "id": "S04",
   "title": "OTA 설치 도중 전원 차단",
   "situation": "업데이트 적용 중 전원이 끊겨 설치가 완료되지 않았다.",
   "handling": "검증된 이전 구성을 복구하거나 해당 고장에 대한 안전 상태를 유지한다. 복구를 위한 에너지를 포함한 전원 조건과 사용자 안내를 설계한다.",
   "review": {
    "current": "SW 버전 롤백은 OTA(IF-05)에 위임하고 실행하지 않는다(rollback.ts:7).",
    "gap": "설치 중 전원 차단·복구 에너지 조건·안전 상태 도달을 플랫폼 계약과 시험 어디에서도 다루지 않는다.",
    "plan": [
     "ADS-OTA01"
    ]
   }
  },
  {
   "id": "S05",
   "title": "모델만 복원했지만 설정이 맞지 않는 경우",
   "situation": "인지 모델을 이전 것으로 되돌렸으나 센서 보정과 전처리는 최신 구성으로 남았다.",
   "handling": "파일 교체 성공과 ADS 복구 성공을 구분한다. 검증된 조합에 없으면 ADS 활성화를 차단하고 호환 구성을 복구하거나 안전한 수정 버전을 적용한다.",
   "review": {
    "current": "구성 증명(정책 해시 대조)과 다중 ECU 회신 DIVERGED/PARTIAL 판정이 있다(attestation.ts).",
    "gap": "모델·런타임·센서 보정·정책의 검증된 호환 집합이 없어 파일 교체 성공과 ADS 복구 성공을 구분하지 못한다.",
    "plan": [
     "ADS-UI05",
     "ADS-BE10"
    ]
   }
  },
  {
   "id": "S06",
   "title": "구버전은 안정적이지만 보안 취약점이 있는 경우",
   "situation": "최신 버전에 성능 문제가 있지만 과거 버전에는 악용 가능한 취약점이 있다.",
   "handling": "구버전이라는 이유만으로 안전하다고 판단하지 않는다. 양쪽 위험을 평가해 안전 상태 유지·검증된 수정 버전·정비 조치를 선택한다.",
   "review": {
    "current": "SBOM 취약점 감시가 있고 복구 후보는 검증·승인·서명이 갖춰져야 고를 수 있다(rollback.ts:252).",
    "gap": "복구 후보 구버전의 보안 취약점을 함께 평가하거나 허용 버전 목록·보안 최소 버전에 반영하는 판단이 없다.",
    "plan": [
     "ADS-BE10"
    ]
   }
  },
  {
   "id": "S07",
   "title": "종료 뒤 오래된 ON 요청이 도착",
   "situation": "결함 대응으로 원격 종료가 완료된 뒤 네트워크에 지연된 과거 허용 정책이 도착한다.",
   "handling": "과거 ON으로 종료 차단을 해제하지 않는다. 정당한 rescind 요청과 최신 상태·형상 검사를 구분한다.",
   "review": {
    "current": "차량 Guard는 Feature별 vehicle_seq로 예전 명령을 거부하고, 서버는 해제 없이 올라온 ACTIVE를 Incident로 처리한다(status-ingest.service.ts:101).",
    "gap": "정책 순번 공간이 Feature 순번과 따로라 KILL 뒤 늦게 온 과거 정책은 순번이 아닌 kill 상태 유지에만 기대고, 재부팅 후 영속 차단은 시뮬레이터에 경로가 없다.",
    "plan": [
     "ADS-BE07",
     "ADS-SIM02"
    ]
   }
  },
  {
   "id": "S08",
   "title": "주행 중 상품 이용 기간 만료",
   "situation": "ADS가 active인 동안 사용 권한의 유효기간이 끝난다.",
   "handling": "상품 운영 정책과 DDT 책임을 구분한다. 종료가 필요하면 해당 안전 절차로 전환하고 다음 활성화를 제한한다. 일률적 만료 처리 방식은 이 규정이 정하지 않는다.",
   "review": {
    "current": "체험 만료는 고지 뒤 COMMERCIAL/TRIAL_EXPIRED DC3로 주행 중에는 미루고 다음 시동에 INACTIVE가 된다(trial-expiry.listener.ts:64).",
    "gap": "체험이 아닌 일반 구독 만료와 주행·정차 중 만료 HMI 안내 시험이 없다.",
    "plan": [
     "ADS-SIM01"
    ]
   }
  },
  {
   "id": "S09",
   "title": "One-Binary에서 ODD만 확대",
   "situation": "재빌드 없이 설정으로 운행 지역·도로 조건을 넓힌다.",
   "handling": "바이너리 동일성과 검증·승인 범위 동일성을 분리한다. 변경된 ODD의 위험·시나리오·동작·형상과 필요한 승인 절차를 평가한다.",
   "review": {
    "current": "ODD·시장·Variant 확대는 재-HARA(SCOPE) 요청을 열고 닫힐 때까지 G3 이후 PASS를 막는다(rehara.ts:3).",
    "gap": "ODD 전후 비교, 추가 시나리오 시험, 형식승인 영향 판단 기록이 자동으로 이어지지 않고, G8·G9 PASS 뒤 열린 재-HARA는 출시·배포를 막지 않는다.",
    "plan": [
     "ADS-UI09",
     "ADS-BE06",
     "ADS-BE09"
    ]
   }
  },
  {
   "id": "S10",
   "title": "Rollback 성공 후 원격 종료 해제",
   "situation": "결함 있는 구성을 복구했고 운영자가 다시 사용 허용을 요청한다.",
   "handling": "복구된 전체 구성·결함 조치·검증 결과를 확인한 뒤 종료 차단 해제를 처리한다. 이때 차량이 ODD 밖이거나 고장이 남아 있으면 여전히 활성화하지 않는다.",
   "review": {
    "current": "복원은 차단 승인자와 다른 2인이 승인하고 RESTORE_PENDING을 거쳐 다음 시동에 ACTIVE가 된다(vehicle-runtime.service.ts:221).",
    "gap": "복구 구성·결함 조치 검증을 해제 조건으로 보지 않고, 해제 뒤 ODD·고장 재판정 없이 자동 ACTIVE가 된다(F036 결함).",
    "plan": [
     "ADS-UI02",
     "ADS-BE03"
    ]
   }
  }
 ]
};
