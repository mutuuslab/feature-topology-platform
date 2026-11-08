# 업무 건·절차 간 인계와 실제 대용량 첨부

범위: `feat/workflow-artifacts-20261109`, base `4c3f017c`. 계약 결합 하네스 수정 `5759ea62`를 `ee163b32`로 먼저 적용했다. 이 기록은 격리된 로컬 검증이며, 최종 통합·이해관계자 검토·Publish 완료 기록이 아니다.

## 동작과 권한

- 서로 다른 업무 건의 `targetRef`가 같고, 원천 모델의 발신 `outputs`와 수신 `inputs`에 정확히 같은 WP 키가 있는 경우만 인계한다. 현재 base 모델의 절차 간 관계 63개를 회귀한다. 임의 링크·같은 화면 사용만으로 인계 관계를 만들지 않는다.
- 독립 검토가 수락한 `artifactIds`의 실제 산출물만 봉인한다. 원천 case/version, 활동, 개정 번호, 작성자, 내용, 참조, 파일 메타데이터·실바이트 해시, 실제 독립 검토자·시각을 보존한다. 묶음 SHA-256은 canonical JSON으로 서버/브라우저에서 계산한다.
- 발신 R/A가 인계하고, 발신자와 다른 수신 활동 R/A가 인수 또는 반송한다. 양쪽 case version CAS와 기록·감사·이벤트가 한 transaction이다. 수신자에게 발신 업무 건 전체의 추가 조회·편집 권한을 부여하지 않는다.
- 같은 요청 번호·계정·내용은 중복 생성하지 않는다. 버전 충돌·서로 다른 내용·미검토 원천·다른 대상·산출물 누락·정의되지 않은 관계는 거부한다. 반송 뒤 같은 관계를 다시 인계할 수 있다.
- 인수 확인은 수신 기록이며 수신 활동의 산출물 수락, 원천 Gate·정책·안전·출시 승인으로 전환하지 않는다. 선행 활동 검토와 필수 산출물 조건도 유지한다.

## 실제 파일 저장

- `BinaryStorageModule`/`BinaryStore`는 도메인과 분리된 바이트 저장 계층이다. 다른 도메인도 이 모듈을 가져와 자기 권한과 CAS로 연결할 수 있다. P13/Evidence를 자동 전환하거나 그 승인을 대체하지 않는다.
- SQLite BLOB / PostgreSQL BYTEA용 migration `431_binary_objects`; 최대 청크 256KiB, 단일 파일 64MiB, 전체 1GiB. 실제 받은 바이트의 길이와 SHA-256을 계산한다. 서버가 계산하지 않은 URL·주장 해시를 검증 성공으로 취급하지 않는다.
- 별도 `application/octet-stream` upload/download. JSON 기본 100kb와 산출물 본문 96KiB는 유지한다. 기존 inline 3파일 형식은 호환하며, 신규 별도 첨부는 산출물 개정당 20개다.
- 불완전 업로드는 1시간, 연결하지 않은 READY 파일은 24시간 만료다. 부팅·매시간·새 업로드 때 정리한다. 실제 산출물 버전에 연결한 파일은 보존한다. 중간 스트림/저장/용량/권한/CAS/audit 실패는 임시 청크·용량 예약을 정리한다.
- 파일 연결은 case CAS transaction 안에서 처리해 실패 시 READY 상태와 업무 기록을 함께 되돌린다. 기존 연결 파일은 같은 활동의 다른 수행자가 개정에 재사용할 수 있으나, 최초 uploader는 자기 파일을 포함한 산출물을 독립 검토할 수 없다.
- 새 별도 첨부의 다운로드는 해당 활동 R/A/C 또는 유효한 수신 인계 R/A/C를 다시 확인한다. 역할 철회·반송 뒤 수신 경로를 막고, 원천의 실제 파일과 이전 개정은 유지한다. 이미 전달·다운로드한 사본을 회수하는 기능은 아니다.
- 정적 시연은 IndexedDB 실제 Blob을 저장한다. localStorage에는 marker만 남기며 큰 base64를 저장하지 않는다. IndexedDB 미지원·저장 실패를 영속 저장 성공으로 보고하지 않는다.
- 정적 overlay와 첨부 존재 확인은 같은 IDB transaction이고, `storageRevision` CAS로 다른 탭의 변경을 덮지 않는다. 저장 성공 뒤에만 메모리와 이벤트를 갱신한다. 전역 JSON/권한 규칙은 완화하지 않는다.

## 검증

- contracts build, backend build, frontend TypeScript PASS.
- BE 5파일 44 PASS: 새 인계·실제 파일 HTTP 7, BinaryStore 5, 기존 업무 실행 12, migration upgrade 6, PG 방언 14. 두 번째 case 저장 실패의 전체 rollback, 동시 인계 1성공/1충돌, 실제 역할 철회·반송, 파일 재시도 실제 바이트 비교, 청크 중단·용량·만료·audit 실패를 포함한다.
- FE 4파일 22 PASS: 인계/수신/반송/기존 실행/최초 snapshot 권한 필터/기존 simEngine. 실제 IndexedDB는 아래 Chromium에서 별도로 검증한다.
- 기존 원천 모델 총수의 오래된 기대값 122를 base의 실제 123 WP로 정합했다(활동124). root에서 추가 중인 FPW.14-A06과 신규 WP는 root 통합 시 최신 원천 총수로 갱신한다. 모델 원문은 이 작업에서 편집하지 않았다.
- 기존 outbox 실패 시험의 `mockImplementationOnce`가 예약된 telemetry 이벤트에 먼저 소비되는 비결정성을 재현했다. 대상 workflow case 이벤트에만 실패를 주입해 원자 rollback 판정을 보존했다.
- migration 잠금90개, 기존89개 SQL 해시 불변·신규431 한 개 추가. 독립 migration 원천 import를 위한 Node resolve hook은 migrations entry의 로컬 `migrations-*` 모듈에만 한정한다.
- production native/정적 UI 모두 첫 화면297KiB·화면 묶음40KiB 예산을 유지한다. 하네스 결과 native288.0/297, static287.7/297, 최대32.7/40KiB.

## 실제 production Chromium 증거

키트 `out/workflow-artifacts-20261109/`에 Python Playwright 실행 파일, JSON, PNG, 전용 SQLite DB를 보존한다.

- `native-browser.json`: UI에서 1,048,713byte 파일 작성/저장→독립 검토→FPW.1에서 FPW.2의 다른 case로 인계→인수→실제 다운로드. SHA-256 `4eb85990ae06c6e674331fe5dcfed1aacaed44520a05130e63ec2aa07e645f99` 일치. 390/1366 overflow0·JS0·reload PASS.
- `native-restart.json`: 실제 SQLite 파일을 닫고 Node API를 다시 시작한 뒤 기존 수신 case에서 다운로드한 원문 SHA 동일.
- `static-browser.json`: 1,048,777byte IndexedDB Blob, base64 빈 문자열·localStorage925byte. reload와 같은 다중 담당자·절차 인계 뒤 SHA-256 `e91ed38a905bbb3b404fa7e03f7533dd5f89f903ff8bf9c39601553e88eca335` 일치. 네트워크 업무 쓰기0·JS0·390/1366 overflow0.
- 정적 실제 두 탭 CAS 후 후발의 메모리 재조회와 reload에서 미저장 초안이 발행되지 않음. 첨부 원문 삭제 후 case version1/artifacts0 유지. Blob 손상 후 해시 오류·다운로드0.
- 모바일에서 긴 case 목록이 본문을 밀어내는 문제는 목록 자체 스크롤(70vh, 모바일40vh)로 보정했다. 인계 카드에는 기술 식별자 외에 실제 담당자·역할·산출물 항목 이름과 KO/EN 안내를 표시한다.
- 정적 UI만 별도 빌드하고, 기존329,396,696byte/19,071파일 단일 snapshot artifact를 실제 게이트·리졸버로 읽기 연결했다. 원본 SHA tree `3a4665aa8dc73cad2124d8a24fa54e9c33c0eddeeabf2d907b41bf93d4753919` 유지. 전체 snapshot 복제·재생성·승인 주입 없음.

PostgreSQL 실 DB는 이번 환경에서 실행하지 않았다. BYTEA/schema·adapter 전제·방언 회귀와 실제 SQLite/브라우저 실증을 구분한다. 배포 환경 PG smoke와 root 통합 뒤 팀별·전체 이해관계자 리뷰 및 최종 Publish는 별도 완료 조건이다.

정적 신규 업로드는 IDB 실제 Blob으로 동작한다. 향후 native snapshot에 fileId 메타데이터만 캡처되고 해당 브라우저에 원문이 없는 파일은 바이트 없음으로 거부한다. Native 비공개 파일의 정적 공개용 자동 export/byte-pack은 이 작업에서 구현하지 않았다. 현재 frozen 2배 seed의 업무 초안은 별도 binary 첨부가 없으므로 이 경계와 분리해 검증했다. 공개용 native 첨부가 필요하면 공개가 허용된 실제 원문을 캡처·검증·패킹하는 별도 계약이 필요하며, 메타데이터만 있는 파일을 다운로드 검증 완료로 세지 않는다.
