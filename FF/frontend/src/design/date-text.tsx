import { Fragment, type ReactNode } from 'react';
/** Keep a calendar date intact while surrounding translated text can wrap normally. */
export function DateText({ text, renderText = (value) => value }: { text: string; renderText?: (value: string) => ReactNode }) {
  return <>{text.split(/(\d{4}-\d{2}-\d{2})/).map((part, i) => /^\d{4}-\d{2}-\d{2}$/.test(part)
    ? <span key={i} className="ds-nowrap">{part}</span>
    : <Fragment key={i}>{renderText(part)}</Fragment>)}</>;
}
