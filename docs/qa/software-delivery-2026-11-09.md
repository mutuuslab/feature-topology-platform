# 실제 Flag 조건 SW 원문 다운로드

기존 IF-13 기록과 OTA 캠페인은 SW 원문 바이트 보관·다운로드의 근거가 아니었다. 신규 `/deployments/software`는 원문 업로드 → Feature 버전/SW 구성품 연결 → 다른 출시 담당자의 검토 → Ed25519 서명 매니페스트 → 현재 배포 Flag와 차량 지원/대상/권리/차단 평가 → 실제 원문 스트리밍으로 연결한다.

원문은 공용 BinaryStore의 실제 청크 저장소(파일당64MiB/전체1GiB)로 전달한다. 파일명·길이·SHA-256·소유자·전용scope를 검토와 다운로드 시 다시 대조한다. 생성한 CycloneDX 1.5 SBOM은 실제 SW 구성품과 원문 해시의 목록이며 협력사 인증·취약점 검증 완료를 주장하지 않는다. 패키지 승인과 정책 배포·G6·G7 승인은 별개다. 다운로드는 설치·활성화·실차 적용 완료로 기록하지 않는다.

차량 API는 기존 차량 요청 인증을 사용한다. VIN·메서드·전체query경로·시각·nonce·본문 해시를 차량 키로 서명한다. 서명된 manifest와 byte다운로드는 같은 VIN에 한정하고 요청마다 Flag를 재평가한다. 사람 검증 API도 실제 평가를 거치며 `IMPLEMENTER/RELEASE_MANAGER/OPERATOR`만 원문을 받을 수 있다. AUDITOR는 조건 확인만 가능하다.

브라우저는 공개키로 Ed25519 서명과 canonical manifest 해시를 확인하고, 표시된 패키지가 서명 내용과 일치하는지 비교한다. 실제 내려받은 Blob의 길이/SHA-256이 맞아야 저장 링크를 만든다. 이력 `STREAM_OPENED`는 서버 스트림 요청 사실이며 클라이언트 수신 완료와 구분한다. 파일 원문·서명·고정구성은 새 업로드로만 바꾸며, 승인 회수 뒤에는 다운로드를 거부한다.

## 현재 실행 근거

- `out/resume-20261107/software-delivery-native-r4.log`: 실제 시드 배포 정책/지원 차량으로 허용 경로를 찾고 테스트 대역 없는 native 서비스·HTTP를 사용. SW8시험 + API 계약3시험 = **11 PASS**.
- 실제 바이트 업로드/동일원문 재전송, 다른원문 재사용·잘못된hash·없는구성품 거부, 초안 다운로드 거부, 자기승인/잘못된역할/낡은revision 거부, 다른검토자 승인·서명 확인.
- 실제 Flag 평가 후 원문 다운로드·클라이언트 독립SHA 비교, Flag OFF/대상 NONE 거부, 무서명/동일서명재생/다른VIN 거부, 차량키 서명 HTTP 원문·manifest 성공.
- 만료 키·서명손상·원문손상·다른Flag·승인회수 거부. false/불확실한 결과를 성공으로 바꾸지 않음.
- `software-delivery-native-r3.log`는 앞선 동일 본문8시험·계약3·마이그레이션6 **17 PASS**; 이후SBOM과차량manifest추가분은r4로구분.
- `software-delivery-client.log`: 실제 Ed25519 검증/metadata위조·키만료·용도오류·서명손상/실제Blob SHA/원문손상/미승인시네트워크요청0 **5 PASS**.
- FE·BE TypeScript 빌드 PASS. 마이그레이션 잠금92(신규441), 기존91 SQL 해시 불변. OpenAPI550경로·raw binary request/response와필수query명시.

## 실제 production 브라우저 수락

고정 source `2aa42b0b8a3019f8fc545d170d3aa219f460264c`의 web9581/API9580에서 원문 생성·업로드·등록 → 실제 다른 사람(`usr-integrator`→`usr-coordinator`)의 승인 → `KMH-NX4-0001`/`care_00022_signal`의 native `POLICY_MATCH` → 실제 파일 다운로드/Ed25519·길이·SHA 확인을 실행했다. 이 API는 v0.81+native demo activity이며 이전 2배 Showcase E2E와 다른 격리 데이터다.

- 내려받은 실행 가능한 시험 JS **394바이트**, SHA-256 `9c99a0c2bc405a42f65ba8b15719a0173bbb96c251417988332e3ec5c1833a55`.
- 직접 생성한 해당 파일만 Node에서 실행하여 `selfTest:true`/`installationPerformed:false` 확인. 실제 ECU SW 실행·실차 인증 근거가 아님.
- 1366/390 가로 넘침0·JS0·HTTP오류0. 생성 manifest signature와 화면 package의 원문 속성을 클라이언트에서 독립 검증했다. 실제 PNG를 직접 검토했다.
- `out/software-browser-20261109/results.json`, `browser-r2.log`, `actual-downloaded-demo.mjs`, `verified-{1366,390}.png`. `public-demo-allowlist.json`의 단일 ID만 공개 시험 SW 캡처 허용 대상이다.

상세 후속에는 판정 trace·중단 원인·키 검증 사유·서명 manifest/SBOM 저장과 모바일 metadata 구획을 추가한다. 기존 토큰 lint raw color0. 별도 실제 API9580에서 IAM24역할/217권한/SoD16/109화면/13계정·dist diff0을 추출했다. FPW.6-A04(원문 등록)와 FPW.6-A06(출시 담당자의 독립 승인)에 권한을 나눠 연결하고 모델0오류/0경고·생성59문서·pytest7 PASS. R-INT에게 승인 권한을 추가하지 않았다.

## 남은 수락

최신 상세 후속까지 같은 source의 production 재검증, 영어, 정적 browser Blob/공개 허용 시험SW capture와 pack의 RC 통합, 전체 E2E는 후속 검증한다. 이 체크포인트를 최종 Publish 완료로 보고하지 않는다. 시험용 executable JavaScript는 실제 회사 SW/인증 ECU 이미지가 아니다.
