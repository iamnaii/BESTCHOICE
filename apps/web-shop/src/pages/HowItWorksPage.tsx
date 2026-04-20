import ShopLayout from '@/components/layout/ShopLayout';

export default function HowItWorksPage() {
  return (
    <ShopLayout>
      <article className="container mx-auto px-4 py-8 max-w-3xl prose">
        <h1>วิธีซื้อ iPhone กับ BESTCHOICE</h1>
        <h2>เงินสด — ส่งถึงบ้าน</h2>
        <ol>
          <li>เลือกเครื่องที่ต้องการในเว็บ</li>
          <li>ใส่ที่อยู่จัดส่ง + เลือกขนส่ง (Kerry / Flash / J&T) หรือรับที่ร้าน</li>
          <li>จ่ายผ่าน QR PromptPay / โอนธนาคาร / บัตรเครดิต</li>
          <li>ทีมแพ็คเครื่อง → ส่ง 1-2 วันทำการ</li>
          <li>เปิดกล่องตรวจ → กดยืนยันรับสินค้าใน LINE</li>
        </ol>
        <h2>ผ่อน — ใช้บัตรประชาชนใบเดียว</h2>
        <ol>
          <li>เลือกเครื่อง + กด "ผ่อน" → เลือกจำนวนงวด + ดาวน์</li>
          <li>กรอกฟอร์มสั้น (ชื่อ + เบอร์ + เลขบัตร) — ส่งให้ทีม</li>
          <li>ทีมโทรกลับใน 2 ชั่วโมง — นัดวันมาที่ร้านลพบุรี</li>
          <li>ที่ร้าน: ตรวจเอกสาร + เซ็นสัญญา + รับเครื่อง (30 นาที)</li>
        </ol>
        <h2>เก่าแลกใหม่ / รับซื้อ / ออมดาวน์</h2>
        <p>เปิดให้บริการในเฟสถัดไป — ติดต่อ LINE @bestchoice เพื่อสอบถามล่วงหน้า</p>
      </article>
    </ShopLayout>
  );
}
