import { useEffect } from 'react';

const BASE_TITLE = 'BESTCHOICE — ร้านขายไอโฟนผ่อนได้ลพบุรี';
const BASE_DESCRIPTION =
  'ร้านขายไอโฟนมือสองคุณภาพ ผ่อนได้บัตรประชาชนใบเดียว ลพบุรี — BESTCHOICE Phone Shop';
const CANONICAL_BASE = 'https://www.bestchoicephone.com';
/** ตรงกับ og:image ใน index.html */
const DEFAULT_OG_IMAGE = `${CANONICAL_BASE}/media/og-default.jpg`;

function setContent(el: HTMLMetaElement | null, value: string): void {
  if (el) el.content = value;
}

/**
 * ตั้ง document.title + meta description + canonical + OG ต่อหน้า
 *
 * - canonical ไม่มีใน HTML shell (จงใจ — route ที่ไม่ prerender ต้องไม่ประกาศ
 *   canonical ผิดหน้าใน raw HTML) hook จึงสร้าง <link> เองเมื่อยังไม่มี
 * - cleanup คืนค่าเป็น "ค่า default ของเว็บ" เสมอ ไม่ใช่ค่าที่จำไว้ตอน mount —
 *   บนหน้า prerender ค่าตอน mount คือ meta ของหน้านั้นเอง จำแล้วคืน = meta ค้าง
 *   หน้าเก่าเมื่อผู้ใช้เดินต่อไปหน้าที่ไม่เรียก hook (เช่น /account)
 * - `noindex` สำหรับหน้าที่ "ไม่มีอยู่จริง" (path มั่ว / สินค้าที่ API ตอบ 404): Firebase rewrite
 *   `**` → spa-shell.html ตอบ 200 เสมอ จึงบอก crawler ด้วย <meta name="robots"> แทนสถานะ 404
 *   — cleanup คืนสภาพเดิมเสมอ ไม่งั้นหน้าถัดไปใน SPA ติด noindex ไปด้วย: แท็กที่ hook สร้างเอง
 *   ถูกลบ ส่วนแท็กที่มีอยู่ก่อน (ถ้าวันหน้าใส่ไว้ใน HTML) ได้ค่าเดิมคืน ไม่ถูกลบ
 * - `image` = URL เต็มของรูปตอนแชร์ (หน้าสินค้า) — ถอด og:image:width/height ของรูป default
 *   (1200×630) ออกระหว่างอยู่หน้านี้ เพราะรูปสินค้าเป็นจัตุรัส ประกาศขนาดผิดแย่กว่าไม่ประกาศ
 *   (Facebook/LINE อ่านขนาดจากไฟล์เอง) · cleanup คืนรูป default ตามกติกาข้างบน
 */
export function usePageMeta(
  title?: string,
  description?: string,
  options?: { noindex?: boolean; image?: string },
) {
  const noindex = options?.noindex === true;
  const image = options?.image;
  useEffect(() => {
    let restoreRobots: (() => void) | null = null;
    if (noindex) {
      const existing = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
      if (existing) {
        const previous = existing.getAttribute('content');
        existing.setAttribute('content', 'noindex');
        restoreRobots = () => {
          if (previous == null) existing.removeAttribute('content');
          else existing.setAttribute('content', previous);
        };
      } else {
        const created = document.createElement('meta');
        created.setAttribute('name', 'robots');
        created.setAttribute('content', 'noindex');
        document.head.appendChild(created);
        restoreRobots = () => created.remove();
      }
    }

    const fullTitle = title ? `${title} | BESTCHOICE ลพบุรี` : BASE_TITLE;
    document.title = fullTitle;
    const desc = description ?? BASE_DESCRIPTION;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    setContent(meta, desc);

    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    const canonicalUrl = `${CANONICAL_BASE}${window.location.pathname}`;
    link.setAttribute('href', canonicalUrl);

    // OG ค้างเป็นค่าโฮมเพจถ้าไม่ stamp — prerender snapshot อ่านค่าพวกนี้ไปแช่ใน HTML ต่อ route
    const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    const ogDesc = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
    const ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    setContent(ogTitle, fullTitle);
    setContent(ogDesc, desc);
    setContent(ogUrl, canonicalUrl);

    let restoreImage: (() => void) | null = null;
    if (image) {
      const existing = document.querySelector<HTMLMetaElement>('meta[property="og:image"]');
      const ogImage = existing ?? document.createElement('meta');
      if (!existing) {
        ogImage.setAttribute('property', 'og:image');
        document.head.appendChild(ogImage);
      }
      ogImage.setAttribute('content', image);
      const dimensions = Array.from(
        document.querySelectorAll<HTMLMetaElement>(
          'meta[property="og:image:width"], meta[property="og:image:height"]',
        ),
      );
      dimensions.forEach((el) => el.remove());
      restoreImage = () => {
        if (existing) ogImage.setAttribute('content', DEFAULT_OG_IMAGE);
        else ogImage.remove();
        dimensions.forEach((el) => document.head.appendChild(el));
      };
    }

    return () => {
      document.title = BASE_TITLE;
      setContent(meta, BASE_DESCRIPTION);
      document.querySelector('link[rel="canonical"]')?.remove();
      restoreRobots?.();
      setContent(ogTitle, BASE_TITLE);
      setContent(ogDesc, BASE_DESCRIPTION);
      setContent(ogUrl, CANONICAL_BASE);
      restoreImage?.();
    };
  }, [title, description, noindex, image]);
}
