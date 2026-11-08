---
id: WF-ROLE-SYS
type: workflow
title: "시스템 관리자 업무 절차서 / System Administrator Procedure"
status: draft
version: 0.3.0
owner: governance
cycle: 0
traces:
  depends_on:
    - WF-FPW-16
last_updated: 2026-11-08
---
<!-- 생성물: docs/65-workflows/scripts/build_md.py — 손으로 고치지 않는다 -->

# WF-ROLE-SYS · 시스템 관리자 업무 절차서

> 퇴사·전보한 계정을 비활성으로 기록하고, 소유자가 없거나 비활성인 기록의 소유자를 담당 역할의 다른 계정으로 옮긴다. 기록 내용은 고치지 않는다.

- IAM 역할: SYSTEM_ADMIN(시스템 관리자)
- IAM 데모 계정: sysadmin
- 매핑 근거: 보고서 어휘 밖. D-GAP-1(2026-11-07) IAM SYSTEM_ADMIN — deactivateAccount·reactivateAccount·transferComplianceRuleOwner, 데모 계정 sysadmin

## 1. 내가 하는 일 (수행 R · 책임 A)

### FPW.16-A01 계정 상태 변경 — 수행·책임
- 프로세스: FPW.16 플랫폼 접근·운영·복구
- 시작: 앞 활동 완료
- 입력: – → 출력: WP-ACCESS-CHANGE
- 플랫폼: `deactivateAccount`, `reactivateAccount`, `/admin/iam`
1. 입퇴사·전보 근거와 대상 계정 및 영향 업무를 확인한다
2. 자기 계정을 제외하고 사유를 적어 비활성 또는 재활성 처리를 수행한다
3. 응답 상태와 감사 이력을 확인하고 권한 변경이 필요한 사항은 외부 IdP 담당자에게 인계한다
- [ ] 미확인 또는 실패 응답을 변경 완료로 기록하지 않는다
- [ ] 계정 상태 기록이 역할 부여 권한으로 확대되지 않는다

### FPW.16-A02 부재 소유자 이관 — 수행·책임
- 프로세스: FPW.16 플랫폼 접근·운영·복구
- 시작: 앞 활동 완료
- 입력: WP-ACCESS-CHANGE → 출력: WP-OWNER-HANDOVER
- 플랫폼: `transferComplianceRuleOwner`, `/admin/iam`, `/verify/compliance`
1. 원소유자가 없거나 비활성인 기록과 미결 업무를 확인한다
2. 기록 담당 역할을 가진 새 계정을 지정하고 이관 사유를 적는다
3. 소유자 이관 뒤 기록 내용·버전·상태와 감사 흔적이 보존됐는지 확인한다
- [ ] 활성 소유자의 기록이나 부적격 새 소유자 이관이 차단된다
- [ ] 기록 본문을 고치지 않고 소유권만 변경한다

## 2. 협의·통보 받는 활동

- FPW.16-A03 운영 설정·상태 점검 (협의)
- FPW.16-A04 백업·복구 점검 (협의)

## 3. 보고서가 이 역할에 지정한 규칙

- 없음
