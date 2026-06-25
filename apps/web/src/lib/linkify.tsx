import React from 'react';

// http(s)://… or bare www.… — the trailing class strips one closing
// punctuation so a URL at a sentence end doesn't swallow it.
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,!?)\]}'"]|www\.[^\s<]+[^\s<.,!?)\]}'"])/gi;

/**
 * Split text into plain strings and <a> elements for URLs. Every segment is a
 * JS string or a React element with the href as a prop, so React escapes all
 * content — there is no HTML-injection path (never dangerouslySetInnerHTML).
 */
export function linkifyText(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    out.push(
      <a
        key={start}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all"
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
