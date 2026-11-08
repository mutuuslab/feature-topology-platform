// FFV1-MSG 시험 벡터 v1 (TL-M01) — 차량(vECU)·참조 Lake·FF 검증기가 같은 값을 내야 한다. 사본: docs/80-integration/datalake-if15/ffv1-msg.vectors.json
// 차량 키를 바로 준다(공장 주입 값을 흉내). 요청 키·가명·태그 계산은 vehicle-message.ts 머리말과 rules/vehicle-auth.ts.
// 본문 STATUS_REPORT는 부록 D 상태 보고 v2 예제(안쪽 state_auth는 자리값 — 바깥 서명 벡터만 본다).
// 이 파일은 손으로 고치지 않는다 — 값을 바꾸면 차량 쪽 시험도 바뀐다.
export const FFV1_MSG_TEST_VECTORS = {
  "title": "FFV1-MSG 시험 벡터 v1 — 차량 서명 메시지(ff.vehicle.msg/1). 차량·Lake·FF가 같은 값을 내야 한다",
  "source": "FF/contracts/src/schemas/vehicle-message.vectors.ts (이 파일은 그 사본 — 시험이 같은지 본다)",
  "derivation": {
    "vehicleKey": "HKDF-SHA256(epoch 루트, salt=\"epoch:<n>\", info=\"ffp-vehicle-key|<VIN>\") 16바이트 — 공장 주입. 아래 벡터는 차량 키를 바로 준다",
    "requestKey": "K_r = HKDF-SHA256(차량 키, salt=\"ffp-request-auth\", info=\"ffp-vehicle-request-key|v1\") 16바이트 — FFV1-REQ와 같은 키",
    "pseudonym": "sha256(\"ffp-pseudonym|\" + VIN) 소문자 hex 앞 16자",
    "mac": "AES-CMAC-128(K_r, UTF-8 정규 문자열) → base64url(패딩 없음) 22자"
  },
  "vin": "KMH-NX4-0002",
  "pseudonym": "d06909d1006dbbfb",
  "vehicleKeyHex": "000102030405060708090a0b0c0d0e0f",
  "requestKeyHex": "db3ad6813095debf0fb84824ee94f272",
  "vectors": [
    {
      "name": "STATUS_REPORT",
      "body": "{\"type\":\"status_report\",\"schema_version\":\"2.0\",\"vehicle_pseudonym\":\"d06909d1006dbbfb\",\"feature\":{\"id\":\"FEAT-00022\",\"version\":\"1.0.0\"},\"state\":\"DISABLED\",\"reason\":{\"category\":\"SAFETY\",\"source\":\"REMOTE\"},\"request_result\":\"ACCEPTED\",\"vehicle_seq\":11,\"key_epoch\":0,\"report_seq\":196650,\"durable\":true,\"hmi\":\"INFO_DISABLED\",\"feature_weight_permille\":0,\"policy_hash\":\"sha256:abababababababababababababababababababababababababababababababab\",\"dtc\":[\"C1A2B3\"],\"edr_aligned_state\":\"OFF_BY_COMMAND\",\"received_at\":\"2026-10-13T00:01:02Z\",\"applied_at\":\"2026-10-13T00:01:09Z\",\"observed_at\":\"2026-10-13T00:01:10Z\",\"time_sync\":\"SYNCED\",\"offline_since\":null,\"data_category\":\"SAFETY_OPERATION\",\"state_auth\":\"fyDAwJbxHWhQZ0_k-jTTDA\",\"persistence\":\"DURABLE\"}",
      "canonical": "FFV1-MSG\nSTATUS_REPORT\n-\nd06909d1006dbbfb\n1\n1760313670000\nq3J8vX0bN2kLmP4sT6wY\nc77e762d78b037374ea4b7d6b3f25ffdd0f430306857e8f422637783f69400d6",
      "message": {
        "schema": "ff.vehicle.msg/1",
        "message_id": "d06909d1006dbbfb:q3J8vX0bN2kLmP4sT6wY",
        "pseudonym": "d06909d1006dbbfb",
        "kind": "STATUS_REPORT",
        "ref": null,
        "auth": {
          "scheme": "FFV1-MSG",
          "key_epoch": 1,
          "timestamp": "1760313670000",
          "nonce": "q3J8vX0bN2kLmP4sT6wY",
          "mac": "f6Vc3d-yLq0IZaMeuGhdCQ"
        },
        "body_b64": "eyJ0eXBlIjoic3RhdHVzX3JlcG9ydCIsInNjaGVtYV92ZXJzaW9uIjoiMi4wIiwidmVoaWNsZV9wc2V1ZG9ueW0iOiJkMDY5MDlkMTAwNmRiYmZiIiwiZmVhdHVyZSI6eyJpZCI6IkZFQVQtMDAwMjIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwic3RhdGUiOiJESVNBQkxFRCIsInJlYXNvbiI6eyJjYXRlZ29yeSI6IlNBRkVUWSIsInNvdXJjZSI6IlJFTU9URSJ9LCJyZXF1ZXN0X3Jlc3VsdCI6IkFDQ0VQVEVEIiwidmVoaWNsZV9zZXEiOjExLCJrZXlfZXBvY2giOjAsInJlcG9ydF9zZXEiOjE5NjY1MCwiZHVyYWJsZSI6dHJ1ZSwiaG1pIjoiSU5GT19ESVNBQkxFRCIsImZlYXR1cmVfd2VpZ2h0X3Blcm1pbGxlIjowLCJwb2xpY3lfaGFzaCI6InNoYTI1NjphYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiIiwiZHRjIjpbIkMxQTJCMyJdLCJlZHJfYWxpZ25lZF9zdGF0ZSI6Ik9GRl9CWV9DT01NQU5EIiwicmVjZWl2ZWRfYXQiOiIyMDI2LTEwLTEzVDAwOjAxOjAyWiIsImFwcGxpZWRfYXQiOiIyMDI2LTEwLTEzVDAwOjAxOjA5WiIsIm9ic2VydmVkX2F0IjoiMjAyNi0xMC0xM1QwMDowMToxMFoiLCJ0aW1lX3N5bmMiOiJTWU5DRUQiLCJvZmZsaW5lX3NpbmNlIjpudWxsLCJkYXRhX2NhdGVnb3J5IjoiU0FGRVRZX09QRVJBVElPTiIsInN0YXRlX2F1dGgiOiJmeURBd0pieEhXaFFaMF9rLWpUVERBIiwicGVyc2lzdGVuY2UiOiJEVVJBQkxFIn0=",
        "body_sha256": "c77e762d78b037374ea4b7d6b3f25ffdd0f430306857e8f422637783f69400d6"
      },
      "ffv1ReqMac": "ufnC48yKlWGZL5g0AWZ1Ew"
    },
    {
      "name": "INBOX_ACK",
      "body": "{\"bootId\":\"BOOT-7\",\"result\":\"APPLIED\",\"observed\":\"sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd\",\"policyHash\":\"sha256:abababababababababababababababababababababababababababababababab\"}",
      "canonical": "FFV1-MSG\nINBOX_ACK\nDLV-3QpZ7a9b\nd06909d1006dbbfb\n1\n1760313669000\nHk2mN8pQ4rS6tV1wX3yZ\n7355379c785ce86294cc313b5cd204fc400aa3417a9540582eeca50940839793",
      "message": {
        "schema": "ff.vehicle.msg/1",
        "message_id": "d06909d1006dbbfb:Hk2mN8pQ4rS6tV1wX3yZ",
        "pseudonym": "d06909d1006dbbfb",
        "kind": "INBOX_ACK",
        "ref": "DLV-3QpZ7a9b",
        "auth": {
          "scheme": "FFV1-MSG",
          "key_epoch": 1,
          "timestamp": "1760313669000",
          "nonce": "Hk2mN8pQ4rS6tV1wX3yZ",
          "mac": "d_rXpSc3uGro3966bBnUzA"
        },
        "body_b64": "eyJib290SWQiOiJCT09ULTciLCJyZXN1bHQiOiJBUFBMSUVEIiwib2JzZXJ2ZWQiOiJzaGEyNTY6Y2RjZGNkY2RjZGNkY2RjZGNkY2RjZGNkY2RjZGNkY2RjZGNkY2RjZGNkY2RjZGNkY2RjZGNkY2RjZGNkY2RjZCIsInBvbGljeUhhc2giOiJzaGEyNTY6YWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYiJ9",
        "body_sha256": "7355379c785ce86294cc313b5cd204fc400aa3417a9540582eeca50940839793"
      },
      "ffv1ReqMac": "STPKbmp9_AzkVoJFeOhNhg"
    },
    {
      "name": "VEHICLE_REPORT",
      "body": "{\"type\":\"FAULT\",\"bootId\":\"BOOT-7\",\"sequence\":31,\"observedAt\":\"2026-10-13T03:15:00Z\",\"featureId\":\"FEAT-00022\",\"code\":\"ECU_TIMEOUT\",\"severity\":\"WARNING\"}",
      "canonical": "FFV1-MSG\nVEHICLE_REPORT\n-\nd06909d1006dbbfb\n1\n1760325300000\nLm4nB6vC8xZ0aS2dF4gH\na20075ad4ac96e6c1de9f7575486a76892f8e6c3d0b63bb2e6174b48b3801a75",
      "message": {
        "schema": "ff.vehicle.msg/1",
        "message_id": "d06909d1006dbbfb:Lm4nB6vC8xZ0aS2dF4gH",
        "pseudonym": "d06909d1006dbbfb",
        "kind": "VEHICLE_REPORT",
        "ref": null,
        "auth": {
          "scheme": "FFV1-MSG",
          "key_epoch": 1,
          "timestamp": "1760325300000",
          "nonce": "Lm4nB6vC8xZ0aS2dF4gH",
          "mac": "xKhwSSbaDAD6uGloSIk2cg"
        },
        "body_b64": "eyJ0eXBlIjoiRkFVTFQiLCJib290SWQiOiJCT09ULTciLCJzZXF1ZW5jZSI6MzEsIm9ic2VydmVkQXQiOiIyMDI2LTEwLTEzVDAzOjE1OjAwWiIsImZlYXR1cmVJZCI6IkZFQVQtMDAwMjIiLCJjb2RlIjoiRUNVX1RJTUVPVVQiLCJzZXZlcml0eSI6IldBUk5JTkcifQ==",
        "body_sha256": "a20075ad4ac96e6c1de9f7575486a76892f8e6c3d0b63bb2e6174b48b3801a75"
      },
      "ffv1ReqMac": "05cmNfH-7QrNHB78pJw72Q"
    }
  ]
} as const;
