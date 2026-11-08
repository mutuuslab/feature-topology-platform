# 정적 SW 원문 전달·공개 시험용 캡처 검증

`42ff9d4d` → `47ff64d5`는 root의 native SW 전달 기능을 브라우저 안 실제 바이트 시연에 연결한다. Node의 native 기능·차량 인증은 root의 별도 검증이며, 여기서 기록하는 새 검토·영수증은 `LOCAL_SIMULATION`이다. 원문을 받았다는 사실을 설치·활성화·실차 적용으로 기록하지 않는다.

## 구현

- 실제 IndexedDB Blob 업로드, 파일별64MiB/전체1GiB 한도, Feature 버전의 실제 SW 구성품·원문 SHA 연결, 다른 출시 담당자의 검토, revision/자기검토/역할 제한을 보존한다. 브라우저 전용 WebCrypto Ed25519 키로 LOCAL_SIMULATION을 포함한 매니페스트를 실제 서명하고 클라이언트가 공개키로 다시 검증한다. 운영 PKI/HSM 서명이라고 주장하지 않는다.
- 다운로드마다 현재 배포 정책·Feature 버전·차량 범위/지원·권리·차단·구성품을 native와 같은 순수 평가기로 다시 확인한다. Native가 서명한 허용 시험용 캡처는 그 서명과 원문을 그대로 사용한다. 미캡처 native 파일이나 누락된 원천을 성공으로 만들지 않는다.
- 연결된 실제 Blob을 동일 IndexedDB 트랜잭션에서 확인하고 attached 표식을 저장한다. 다른 도메인/업로더가 임시 파일을 정리해도 이미 연결된 원문은 지우지 않는다. 원문을 확인한 binary GET만 제한된 효과 핸들러로 감사·`BROWSER_BLOB_READY` 영수증을 커밋한 뒤 Blob을 내준다. 일반 GET에는 이 등록을 허용하지 않는다.
- 브라우저는 실제 차량 키 신원을 만들지 않는다. 차량 서명 API는 native 채널을 사용하며 정적 시연에서 요청하면 거부한다. Native의 `STREAM_OPENED`, 브라우저의 준비 영수증, 클라이언트 수신 후 SHA 검증, 실제 OTA 설치 사실을 구분한다.
- `softwarePackages/softwarePackage/history`는 첫 쓰기 전에도 시연 읽기를 거쳐 캡처 provenance를 표시한다. snapshot main에는 메타데이터 조회와 빈 공개 인덱스를 기본 연결했다.

## 공개 캡처의 정확한 범위

`tools/software-demo-capture.ts`는 명시적 `{apiUrl, expectedBuildSha, allowlist:[{packageId,vin,flagKey,expectedSha256}]}`를 받는다. `FF_SOFTWARE_CAPTURE_CONFIG`에 이 JSON의 경로를 주면 snapshot main에서 실행한다. 출처 enum만으로 원문을 자동 공개하지 않는다.

확인 순서는 source 전체 SHA/격리 demo API → 정확한 VIN/Flag의 native POLICY_MATCH → APPROVED/다른 등록자·검토자 → text/javascript/정해진 demo 파일명/4MiB 이하 → 실제 Ed25519 서명·키 용도·만료·매니페스트와 보이는 메타데이터 → 다운로드 응답/원문 SHA·크기 → 정확한 시험용 코드 marker와 `installationPerformed:false` 메타데이터다. 모든 항목 검증 뒤에만 공개 폴더를 쓴다. 실제 회사 SW/미승인 첨부는 캡처하지 않는다.

이번에 허용된 원문은 **SWP-446e9706-0731-4be1-9cf2-ec0fa9334585**, source `2aa42b0b8a3019f8fc545d170d3aa219f460264c`의 사용자 생성 시험용 JS **394 bytes**, SHA `9c99a0c2bc405a42f65ba8b15719a0173bbb96c251417988332e3ec5c1833a55` 한 건이다. actual API9580에서 실제 판정·서명·바이트를 대조했다. 결과 `api-snapshot/software-demo-index.json`과 `api-snapshot/files/software/<SHA>.mjs`는 CAPTURED_EXECUTABLE_DEMO이며 native 다운로드 요청 이력도 함께 보존한다. 기존 파일을 덮어쓰는 재캡처는 거부하고 새 artifact 디렉터리를 요구한다.

## 실제 검증

- Frontend **4파일 46 PASS**: 신규 정적16 + 기존 client5 + TX22 + 업무 인계3. 만료/손상 서명·메타데이터 변경·미캡처·Flag OFF/NONE·지원 미달/불확실·긴급 차단·조회 이후 정책 변경·권한·차량 신원 위조 거부·실제 원문 손상 및 성공 영수증 미기록을 포함한다. 타입 검사 PASS.
- Node **34 PASS**: 캡처10 + resource pack7 + 기존 cookie gate17. 허용목록·출처·자기검토·차단·키만료·서명/바이트/marker/예상SHA 오류는 공개 index나 byte 디렉터리를 쓰기 전에 거부한다. 새 JS·capture index의 pack 전후 바이트 보존과 서명 쿠키 없는 GET/HEAD401, 인증 후 private 캐시·정확한 바이트/HEAD 길이를 확인했다.
- Production static source **47ff64d5ea859c1af3d128701d12c5bacf632463**, artifact `dist-software-static-20261109-r2`, 확인 서버9583. **첫 화면290.3/297KiB · 화면 최대32.7/40KiB**, 이 범위 artifact **408/20,000파일**.
- 실제 Chromium에서 native 서명 캡처 다운로드 → 실제 IDB 업로드 → 초안 거부 → usr-integrator 작성/다른 usr-coordinator 검토·실서명 → 원문 다운로드 → Blob 손상 거부 → reload 복원 → 승인 회수 거부를 실행했다. 임시 기한을 지난 attached 원문이 다른 업로더의 새 저장 뒤에도 남는 것과 같은 출시 담당자 계정의 자기검토 UI 거부도 확인했다.
- native 캡처와 새 local 원문 모두 같은394bytes/SHA. 실제 내려받은 모듈을 Node로 실행해 `selfTest:true`, `installationPerformed:false`를 확인했다. IndexedDB의 실제 Blob/attached/SHA와 localStorage에 원문이 없는 것도 확인했다. **JS0 · HTTP오류0 · business network쓰기0 · 390/1366px 가로넘침0**, 최종 PNG 직접 검토.

키트 근거는 `out/software-static-20261109/`의 `browser_software.py`, `browser-results.json`, `captured-sources.json`, `build-r2.log`, `approved-{390,1366}.png`, 실제 다운로드 두 `.mjs`, 최종 `capture-final/`이다. root의 원문 허용목록은 `out/software-browser-20261109/public-demo-allowlist.json`이다.

## 후속 경계

이 artifact는 실제 native demo 원천21개 조회와 허용 원문 한 건으로 검증한 SW 수락본이다. 2배 전체 corpus나 최신 root 전체 원천의 게시본이 아니다. 원천 source47ff와 native 캡처 source2aa를 구분한다. 최종 root 통합 뒤 전체 snapshot/파일수·영어·같은 source 전체 E2E·팀/이해관계자 리뷰를 다시 확인해야 한다. requirements 판정·기존297KiB 예산·사이트 공개 설정은 바꾸지 않았으며 최종 Publish는 하지 않았다.
