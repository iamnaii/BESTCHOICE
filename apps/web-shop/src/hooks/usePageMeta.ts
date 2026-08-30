import { useEffect } from 'react';

const BASE_TITLE = 'BESTCHOICE — ร้านขายไอโฟนผ่อนได้ลพบุรี';
const CANONICAL_BASE = 'https://www.bestchoicephone.com';

function setContent(el: HTMLMetaElement | null, value: string | undefined): string | undefined {
  const prev = el?.content;
  if (el && value) el.content = value;
  return prev;
}

/** ตั้ง document.title + meta description + canonical + OG ต่อหน้า (คืนค่าเดิมเมื่อ unmount) */
export function usePageMeta(title?: string, description?: string) {
  useEffect(() => {
    const prevTitle = document.title;
    const fullTitle = title ? `${title} | BESTCHOICE ลพบุรี` : BASE_TITLE;
    document.title = fullTitle;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = setContent(meta, description);
    // canonical per-route — index.html ตั้ง base ไว้ที่ /; SPA ต้อง stamp path ปัจจุบันเอง
    const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const prevHref = link?.getAttribute('href') ?? undefined;
    const canonicalUrl = `${CANONICAL_BASE}${window.location.pathname}`;
    if (link) link.setAttribute('href', canonicalUrl);
    // OG tags ค้างเป็นค่าโฮมเพจถ้าไม่ stamp — prerender snapshot อ่านค่าพวกนี้ไปแช่ใน HTML ต่อ route
    const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    const ogDesc = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
    const ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    const prevOgTitle = setContent(ogTitle, fullTitle);
    const prevOgDesc = setContent(ogDesc, description);
    const prevOgUrl = setContent(ogUrl, canonicalUrl);
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== undefined) meta.content = prevDesc;
      if (link && prevHref !== undefined) link.setAttribute('href', prevHref);
      if (ogTitle && prevOgTitle !== undefined) ogTitle.content = prevOgTitle;
      if (ogDesc && prevOgDesc !== undefined) ogDesc.content = prevOgDesc;
      if (ogUrl && prevOgUrl !== undefined) ogUrl.content = prevOgUrl;
    };
  }, [title, description]);
}
