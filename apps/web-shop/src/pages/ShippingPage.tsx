import ShopLayout from '@/components/layout/ShopLayout';

export default function ShippingPage() {
  return (
    <ShopLayout>
      <article className="container mx-auto px-4 py-8 max-w-3xl prose">
        <h1>การจัดส่ง</h1>
        <p>BESTCHOICE จัดส่งสินค้า <strong>เงินสด</strong> ไปทั่วประเทศไทย</p>
        <h2>ขนส่งที่รองรับ</h2>
        <ul>
          <li>Kerry Express — 60 บาท ส่งถึง 2 วันทำการ</li>
          <li>Flash Express — 50 บาท ส่งถึง 2 วันทำการ</li>
          <li>J&T Express — 50 บาท ส่งถึง 2 วันทำการ</li>
          <li>รับที่ร้านลพบุรี — ฟรี (เปิดทุกวัน 09:00-19:00)</li>
        </ul>
        <h2>ระยะเวลาจัดส่ง</h2>
        <p>1-3 วันทำการ ขึ้นกับขนส่งและพื้นที่จัดส่ง</p>
        <h2>การประกัน</h2>
        <p>เครื่องทุกเครื่องมีรับประกันร้าน 30 วัน + รับคืนภายใน 7 วันถ้าไม่พอใจ (ตามนโยบาย)</p>
        <p><strong>ผ่อน</strong> ต้องมารับที่ร้านลพบุรีเท่านั้น (เพื่อตรวจสอบเอกสารตัวจริง)</p>
      </article>
    </ShopLayout>
  );
}
