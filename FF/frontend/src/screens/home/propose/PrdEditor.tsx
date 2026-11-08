import { useState, type ReactNode } from 'react';
import { Button, Field } from '../../../design';
import { propose as P } from '../../../copy/propose';
import { PRD_BODY_LIMIT, hasPrdOutline, prdTemplate, proposePrd as D } from '../../../copy/propose-prd';
import { proposeGuide as G } from '../../../copy/propose-guide';
import './prd.css';

export function PrdEditor({ name, description, onName, onDescription, nameError, descriptionError, nameMark, descriptionMark }: {
  name: string; description: string; onName: (value: string) => void; onDescription: (value: string) => void;
  nameError?: string; descriptionError?: string; nameMark?: ReactNode; descriptionMark?: ReactNode;
}) {
  const [preview, setPreview] = useState(false);
  const template = prdTemplate();
  const appended = description.trim() ? `${description}\n\n${template}` : template;
  const hasOutline = hasPrdOutline(description);
  const templateReason = hasOutline ? D.templateExists : appended.length > PRD_BODY_LIMIT ? D.templateLimit : undefined;
  return <article className="propose-document">
    <header className="propose-document__head"><h2>{D.document}</h2><span className="ds-tag">{D.draft}</span></header>
    <div className="propose-actions" role="group" aria-label={D.editorModes}>
      <Button variant="ghost" aria-pressed={!preview} onClick={() => setPreview(false)}>{D.edit}</Button>
      <Button variant="ghost" aria-pressed={preview} onClick={() => setPreview(true)}>{D.preview}</Button>
    </div>
    {preview ? <section className="propose-document__preview" aria-label={D.previewTitle}>
      <h3>{name.trim() || D.untitled}</h3>
      <p className="propose-document__body">{description || D.emptyBody}</p>
    </section> : <div className="ds-stack">
      <Field label={P.name} error={nameError} hint={<>{nameMark} {P.form.nameHint}</>}>
        <input className="ds-input propose-document__title" name="name" required maxLength={200} value={name} onChange={(e) => onName(e.target.value)} />
      </Field>
      <div className="propose-document__tools">
        <Button variant="ghost" disabled={!!templateReason} reason={templateReason} onClick={() => onDescription(appended)}>{D.template}</Button>
        <span className="ds-field__hint">{D.bodyCount(description.length)}</span>
      </div>
      <Field label={P.description} error={descriptionError} hint={<>{descriptionMark} {D.bodyHint}</>}>
        <textarea className="ds-input propose-document__editor" name="description" required maxLength={PRD_BODY_LIMIT} rows={8} placeholder={D.emptyBody} value={description} onChange={(e) => onDescription(e.target.value)} />
      </Field>
      <details className="propose-writing-help"><summary>{G.editorHelp}</summary><dl>{G.examples.map((example) => <div key={example.title}><dt>{example.title}</dt><dd>{example.text}</dd></div>)}</dl></details>
    </div>}
  </article>;
}
