import { contractCaptions as C } from '../copy/contract-captions';
import { useUiLocale } from '../locale/react';

/** Structured lifecycle codes only. Source responses and arbitrary user content stay available verbatim. */
export function TransitionBlocker({ blocker }: { blocker: { code?: string; ref?: string; message: string } }) {
  const { language } = useUiLocale();
  const caption = blocker.code && C.blocker[blocker.code as keyof typeof C.blocker];
  if (language !== 'en' || !caption) return <>{blocker.message}</>;
  return <><span>{caption}{blocker.ref ? <> <code>{blocker.ref}</code></> : null}</span><details><summary>{C.sourceResponse}</summary><p style={{ whiteSpace:'pre-wrap',overflowWrap:'anywhere' }}>{blocker.message}</p></details></>;
}
