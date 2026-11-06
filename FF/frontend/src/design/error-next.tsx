// 오류 다음 행동 본체(출시 준비 RD-UX-01) — design/errors.tsx의 ErrorNextStep이 필요할 때만 읽는다(첫 화면 묶음 밖).
import { useState } from 'react';
import { errorActions as A } from '../copy/error-actions';
import { errorActions, hasFieldDetails, type ErrorLike } from './errors';
import { Button, IdChip } from './primitives';

export default function ErrorNext({ error }: { error: ErrorLike }) {
  const [reloaded, setReloaded] = useState(false);
  const act = errorActions();
  return (
    <div className="ds-error__next" data-error-kind={error.kind ?? 'other'}>
      {error.kind === 'conflict' && <p>{reloaded ? A.reloaded : A.conflictHint}</p>}
      {error.kind === 'validation' && hasFieldDetails(error) && <p>{A.validationHint}</p>}
      {error.kind === 'server' && error.correlationId && (
        <p className="ds-error__cid">
          <span>{A.correlation}</span> <IdChip id={error.correlationId} />
        </p>
      )}
      {error.kind === 'auth' && act.relogin && (
        <Button variant="primary" onClick={() => act.relogin?.()}>
          {A.relogin}
        </Button>
      )}
      {error.kind === 'conflict' && act.reload && !reloaded && (
        <Button onClick={() => void Promise.resolve(act.reload?.()).then(() => setReloaded(true))}>{A.reload}</Button>
      )}
    </div>
  );
}
