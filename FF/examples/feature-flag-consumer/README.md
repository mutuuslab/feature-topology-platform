# Feature Flag 소비 코드

`distance.ts`는 실제 실행되는 Signal·Parameter 분기 예제다. Signal이 꺼져 있으면 기본 제어 모드로 반환하고, Parameter는 별도 Flag로 판단한다. 차량 제어 명령이나 안전 승인을 대신하지 않는다. SDK Provider는 FF 차량 인증·서명·오프라인 유효 기간 경계 안에서 구성한다.

```powershell
node --test examples/feature-flag-consumer/distance.test.ts
npm run flags:scan -- --repo .. --url https://github.com/mutuuslab/feature-topology-platform --path FF/examples/feature-flag-consumer --out flag-sources.json
```

소스를 먼저 Git에 커밋한다. 스캐너는 지정 커밋의 파일만 읽어 Flag 키·실제 경로·줄·전체 커밋 SHA·파일 해시를 출력한다. 작업 중인 수정과 추적하지 않는 파일은 포함하지 않는다. TypeScript/JavaScript의 정적 SDK 호출을 지원하고 동적 키 호출 수를 별도로 보고한다. 가져온 소스 위치는 개발자가 제출한 스냅샷이며, 플랫폼 승인·차량 적용 여부와 별도로 확인한다.

사용자 결정: 업무용 Git 저장소는 가상 시나리오로 구성한다. 이 디렉터리는 가상 차량 앱의 소비 코드를 플랫폼 Git에 보관한 것이며 고객 차량 소스가 아니다. 화면의 예제 커밋은 실제 Git 객체와 실행 시험으로 연결한다.

`infotainment.ts`는 IVI 화면·배너·음성·경로안내4개 키를 독립적으로 적용한다. 거리 제어2개 키와 합쳐 데모6개 Flag 모두에 실제 소스 사용처가 있다.

## OFREP SDK 키

OFREP 평가 경로(`/ofrep/v1/evaluate/*`)는 SDK 키가 필수다. 키가 없거나 틀리거나 폐기·만료되면 401이고, SDK는 기본값(Safe Default)을 쓴다. 키는 플랫폼의 외부 API 키 화면에서 보안 담당이 발급한다(조회 전용 역할이면 충분하다). 데모 설치에는 공개 기본 키(`DEMO_SDK_KEY`, ID `AK-0000`)가 있고, 회사 SSO 설치에는 없다(`FF_OFREP_DEMO_KEY=off`로 데모에서도 끌 수 있다).

```ts
import { OpenFeature } from '@openfeature/server-sdk';
import { OFREPProvider } from '@openfeature/ofrep-provider';

const sdkKey = process.env.FF_SDK_KEY!; // 발급받은 키 원문(ffk_AK-…). 저장소·로그에 남기지 않는다
await OpenFeature.setProviderAndWait('ff', new OFREPProvider({ baseUrl: 'https://ff.example.com', headers: [['Authorization', `Bearer ${sdkKey}`]] }));
```
