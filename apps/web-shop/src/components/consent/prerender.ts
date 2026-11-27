declare global {
  interface Window {
    /** scripts/prerender.mjs ตั้งเป็น true ก่อนสคริปต์ของหน้าทำงาน */
    __BC_PRERENDER__?: boolean;
  }
}

/** true ระหว่างสร้าง snapshot HTML — UI คุกกี้ต้องไม่ render เลย */
export function isPrerendering(): boolean {
  return typeof window !== 'undefined' && window.__BC_PRERENDER__ === true;
}
