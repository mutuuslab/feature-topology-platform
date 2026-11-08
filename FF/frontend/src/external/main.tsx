import '../zod-config';
import ReactDOM from 'react-dom/client';
import { DEMO_EXTRAS } from '../auth-mode';
import { externalLaunch } from '../copy/external';
import { initializeExternalLanguage } from './language';

const root = ReactDOM.createRoot(document.getElementById('root')!);
// 운영 SSO 빌드에서는 가상 앱·계정·모의 API 호출 코드가 지연 묶음에서도 빠진다.
if (DEMO_EXTRAS) {
  initializeExternalLanguage().then(() => import('./ExternalApp')).then(({ ExternalApp }) => root.render(<ExternalApp />));
} else {
  root.render(<main><h1>{externalLaunch.unavailable}</h1></main>);
}
