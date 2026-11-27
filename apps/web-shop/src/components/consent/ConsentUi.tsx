import CookieBanner from './CookieBanner';
import CookieSettingsDialog from './CookieSettingsDialog';

/** แบนเนอร์ + หน้าต่างตั้งค่าคุกกี้ — เมาท์ครั้งเดียวที่ราก App */
export default function ConsentUi() {
  return (
    <>
      <CookieBanner />
      <CookieSettingsDialog />
    </>
  );
}
