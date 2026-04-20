import ShopLayout from '@/components/layout/ShopLayout';

export default function AboutPage() {
  return (
    <ShopLayout>
      <article className="container mx-auto px-4 py-8 max-w-3xl prose">
        <h1>เกี่ยวกับ BESTCHOICE</h1>
        <p>BESTCHOICE Phone Shop เป็นร้านขายไอโฟนมือสองคุณภาพ ตั้งอยู่ที่จังหวัดลพบุรี ดำเนินกิจการมาหลายปี</p>
        <h2>ทำไมเลือกเรา</h2>
        <ul>
          <li><strong>iPhone มือสองคุณภาพ</strong> — ทุกเครื่องผ่านการตรวจสอบและประกัน 30 วัน</li>
          <li><strong>ผ่อนไม่ใช้บัตรเครดิต</strong> — ใช้บัตรประชาชนใบเดียว</li>
          <li><strong>โปร่งใส</strong> — โชว์ราคาและดอกเบี้ยชัดเจนตั้งแต่หน้าเว็บ</li>
          <li><strong>เห็นเครื่องจริง</strong> — รูปและ 360° ของเครื่องที่จะได้</li>
          <li><strong>ร้านในพื้นที่</strong> — ลพบุรี, สระบุรี, สิงห์บุรี, อยุธยา เดินทางมาง่าย</li>
        </ul>
      </article>
    </ShopLayout>
  );
}
