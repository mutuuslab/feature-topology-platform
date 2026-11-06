// 세션 만료 안내 띠(출시 준비 RD-UX-01) — 401을 받았는데 저장하지 않은 입력이 있어 바로 로그인으로 옮기지 않았을 때.
// 입력을 복사해 둘 시간을 주고, 사용자가 고르면 지금 화면으로 돌아오는 로그인으로 간다.
import { useSessionExpired } from '../api/session';
import { relogin } from '../auth';
import { errorActions as E } from '../copy/error-actions';
import { Button, Icon } from '../design';

export function SessionBanner() {
  const expired = useSessionExpired();
  if (!expired) return null;
  return (
    <div className="ds-stale" role="alert" data-session-expired>
      <Icon name="alert" size={16} />
      <span>{E.sessionBanner}</span>
      <Button variant="primary" onClick={relogin}>
        {E.relogin}
      </Button>
    </div>
  );
}
