import { useEffect } from 'react';

const BASE_TITLE = 'BESTCHOICE — ร้านขายไอโฟนผ่อนได้ลพบุรี';

/** ตั้ง document.title + meta description ต่อหน้า (คืนค่าเดิมเมื่อ unmount) */
export function usePageMeta(title?: string, description?: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title ? `${title} | BESTCHOICE ลพบุรี` : BASE_TITLE;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = meta?.content;
    if (meta && description) meta.content = description;
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== undefined) meta.content = prevDesc;
    };
  }, [title, description]);
}
