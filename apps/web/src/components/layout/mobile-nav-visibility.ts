/** หน้าที่มีแถบของตัวเองติดขอบล่างจอ — ไม่แสดงเมนูล่างของแอป */
const HIDDEN = /^\/(?:inbox(?:\/|$)|expenses\/new$)/;

export function showsMobileBottomNav(pathname: string): boolean {
  return !HIDDEN.test(pathname);
}
