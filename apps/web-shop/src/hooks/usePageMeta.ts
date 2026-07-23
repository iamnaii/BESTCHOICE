import { useEffect } from 'react';

const BASE_TITLE = 'BESTCHOICE — ร้านขายไอโฟนผ่อนได้ลพบุรี';
const CANONICAL_BASE = 'https://www.bestchoicephone.com';

/** ตั้ง document.title + meta description + canonical ต่อหน้า (คืนค่าเดิมเมื่อ unmount) */
export function usePageMeta(title?: string, description?: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title ? `${title} | BESTCHOICE ลพบุรี` : BASE_TITLE;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = meta?.content;
    if (meta && description) meta.content = description;
    // canonical per-route — index.html ตั้ง base ไว้ที่ /; SPA ต้อง stamp path ปัจจุบันเอง
    const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const prevHref = link?.getAttribute('href') ?? undefined;
    if (link) link.setAttribute('href', `${CANONICAL_BASE}${window.location.pathname}`);
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== undefined) meta.content = prevDesc;
      if (link && prevHref !== undefined) link.setAttribute('href', prevHref);
    };
  }, [title, description]);
}
