// 생성 파일 — tools/workflow-sync.ts가 docs/65-workflows/out/workflows.json에서 만든다. 손으로 고치지 않는다(workflow:check가 잡는다).
import type { WorkflowMapDoc } from '../rules/workflows';

export const WORKFLOW_MAP: WorkflowMapDoc = {
 "processes": [
  {
   "id": "FPW.1",
   "name": "Feature 등록·분류",
   "group": "생애주기",
   "gates": [
    "G1"
   ],
   "activities": 5
  },
  {
   "id": "FPW.2",
   "name": "HARA·변경 영향 판단",
   "group": "생애주기",
   "gates": [
    "G2"
   ],
   "activities": 5
  },
  {
   "id": "FPW.3",
   "name": "안전요구 확정",
   "group": "생애주기",
   "gates": [
    "G3"
   ],
   "activities": 4
  },
  {
   "id": "FPW.4",
   "name": "안전 설계·정책 설계",
   "group": "생애주기",
   "gates": [
    "G4"
   ],
   "activities": 5
  },
  {
   "id": "FPW.5",
   "name": "검증·V&V",
   "group": "생애주기",
   "gates": [
    "G5"
   ],
   "activities": 6
  },
  {
   "id": "FPW.6",
   "name": "서명 배포",
   "group": "생애주기",
   "gates": [
    "G6"
   ],
   "activities": 6
  },
  {
   "id": "FPW.7",
   "name": "출시·활성화·단계적 확대",
   "group": "생애주기",
   "gates": [
    "G7"
   ],
   "activities": 12
  },
  {
   "id": "FPW.8",
   "name": "운영·긴급 차단·복원",
   "group": "생애주기",
   "gates": [
    "G8"
   ],
   "activities": 11
  },
  {
   "id": "FPW.9",
   "name": "사후 검토·Flag Retirement",
   "group": "생애주기",
   "gates": [],
   "activities": 5
  },
  {
   "id": "FPW.10",
   "name": "협력사 관리",
   "group": "지원",
   "gates": [],
   "activities": 7
  },
  {
   "id": "FPW.11",
   "name": "보안·키·취약점 관리",
   "group": "지원",
   "gates": [],
   "activities": 6
  },
  {
   "id": "FPW.12",
   "name": "운영 데이터·데이터 보호",
   "group": "지원",
   "gates": [],
   "activities": 5
  },
  {
   "id": "FPW.13",
   "name": "규정·Compliance Profile 관리",
   "group": "지원",
   "gates": [],
   "activities": 4
  }
 ]
};
