# Feature Flag 소비 코드

`distance.ts`는 실제 실행되는 Signal·Parameter 분기 예제다. Signal이 꺼져 있으면 기본 제어 모드로 반환하고, Parameter는 별도 Flag로 판단한다. 차량 제어 명령이나 안전 승인을 대신하지 않는다. SDK Provider는 FF 차량 인증·서명·오프라인 유효 기간 경계 안에서 구성한다.

```powershell
node --test examples/feature-flag-consumer/distance.test.ts
npm run flags:scan -- --repo .. --url https://github.com/mutuuslab/feature-topology-platform --path FF/examples/feature-flag-consumer --out flag-sources.json
```

소스를 먼저 Git에 커밋한다. 스캐너는 지정 커밋의 파일만 읽어 Flag 키·실제 경로·줄·전체 커밋 SHA·파일 해시를 출력한다. 작업 중인 수정과 추적하지 않는 파일은 포함하지 않는다. TypeScript/JavaScript의 정적 SDK 호출을 지원하고 동적 키 호출 수를 별도로 보고한다. 가져온 소스 위치는 개발자가 제출한 스냅샷이며, 플랫폼 승인·차량 적용 여부와 별도로 확인한다.
