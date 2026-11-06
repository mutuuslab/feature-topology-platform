// Feature DB 출처 주소 — 원천(xlsx)은 한 칸에 여러 주소를 ' ; '로 잇고, 논문은 'doi:10.x/…'로 적는다. 데이터는 그대로 두고 화면에서 주소별 링크로 나눈다.
import { refSources as T } from '../../copy/refdb';

export interface SourceLink {
  /** 열 주소 — 링크로 만들 수 없는 조각이면 null */
  href: string | null;
  /** 보이는 글자 — 호스트(또는 doi) */
  label: string;
  /** 주소 뒤에 붙은 설명(예: '(첨부 번들)') */
  note: string | null;
}

const DOI = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i;

/** 한 칸의 출처 주소를 나눈다 — 'a ; b'·'doi:10.x/y (설명)'. http(s)·doi만 링크로 만든다 */
export function splitSourceUrls(raw: string | null | undefined): SourceLink[] {
  if (!raw) return [];
  return raw
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [, token, rest] = /^(\S+)(?:\s+(.*))?$/.exec(part) ?? [part, part, undefined];
      const note = rest?.trim() || null;
      const doi = /^doi:/i.test(token) || /^10\.\d{4,9}\//.test(token) ? DOI.exec(token.replace(/^doi:\s*/i, 'doi:')) : null;
      if (doi) return { href: `https://doi.org/${doi[1]}`, label: `doi:${doi[1]}`, note };
      if (/^https?:\/\//i.test(token)) {
        try {
          const u = new URL(token);
          return { href: u.href, label: u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : ''), note };
        } catch {
          /* 주소 모양이 깨지면 글자로 둔다 */
        }
      }
      return { href: null, label: part, note: null };
    });
}

/** 자료 제목은 첫 주소로, 나머지 주소는 그 아래 주소별 링크로 */
export function SourceTitleLinks({ url, title }: { url: string | null | undefined; title: string }) {
  const links = splitSourceUrls(url);
  const first = links[0];
  const rest = links.slice(1);
  return (
    <>
      {first?.href ? (
        <a href={first.href} target="_blank" rel="noreferrer">
          {title}
        </a>
      ) : (
        <span>{title}</span>
      )}
      {first?.note && <span className="ds-field__hint"> {first.note}</span>}
      {rest.length > 0 && (
        <span className="ds-field__hint" data-source-links="">
          {T.moreLinks}:{' '}
          {rest.map((l, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {l.href ? (
                <a href={l.href} target="_blank" rel="noreferrer">
                  {l.label}
                </a>
              ) : (
                l.label
              )}
              {l.note && ` ${l.note}`}
            </span>
          ))}
        </span>
      )}
    </>
  );
}
