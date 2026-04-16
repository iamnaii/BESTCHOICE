/**
 * Public Privacy Policy page — accessible without login.
 * Used as the Privacy Policy URL for Facebook App and other integrations.
 * Route: /privacy
 */
export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-foreground leading-snug">
            นโยบายความเป็นส่วนตัว
          </h1>
          <p className="mt-2 text-muted-foreground leading-snug">
            BESTCHOICE — Privacy Policy
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            ปรับปรุงล่าสุด: 16 เมษายน 2569
          </p>
        </div>

        <div className="space-y-8 text-foreground leading-relaxed">
          <section>
            <h2 className="mb-3 text-xl font-semibold leading-snug">1. บทนำ</h2>
            <p className="leading-snug">
              บริษัท เบสช้อยส์ จำกัด (&quot;บริษัท&quot;, &quot;เรา&quot;) ให้ความสำคัญกับการคุ้มครองข้อมูลส่วนบุคคลของลูกค้า
              ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)
              นโยบายนี้อธิบายวิธีการเก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของท่าน
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold leading-snug">2. ข้อมูลที่เราเก็บรวบรวม</h2>
            <ul className="ml-6 list-disc space-y-1 leading-snug">
              <li>ชื่อ-นามสกุล, เลขบัตรประชาชน, ที่อยู่, เบอร์โทรศัพท์</li>
              <li>ข้อมูลสัญญาเช่าซื้อและประวัติการชำระเงิน</li>
              <li>ข้อมูลการติดต่อผ่าน LINE, Facebook Messenger และช่องทางอื่น</li>
              <li>ข้อมูลอุปกรณ์ (IMEI, รุ่น, สี) สำหรับสินค้าที่อยู่ระหว่างผ่อนชำระ</li>
              <li>รูปถ่ายสลิปการโอนเงิน</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold leading-snug">3. วัตถุประสงค์ในการใช้ข้อมูล</h2>
            <ul className="ml-6 list-disc space-y-1 leading-snug">
              <li>จัดทำสัญญาเช่าซื้อและบริหารจัดการการผ่อนชำระ</li>
              <li>ยืนยันตัวตนและตรวจสอบเครดิต</li>
              <li>แจ้งเตือนค่างวด, ใบเสร็จ, และข้อมูลสัญญา</li>
              <li>ให้บริการลูกค้าผ่านระบบแชทอัตโนมัติและพนักงาน</li>
              <li>ปรับปรุงบริการและวิเคราะห์ข้อมูลเพื่อพัฒนาธุรกิจ</li>
              <li>ปฏิบัติตามกฎหมายและข้อบังคับที่เกี่ยวข้อง</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold leading-snug">4. การเปิดเผยข้อมูล</h2>
            <p className="leading-snug">
              เราอาจเปิดเผยข้อมูลส่วนบุคคลของท่านแก่บุคคลภายนอกในกรณีดังนี้:
            </p>
            <ul className="ml-6 mt-2 list-disc space-y-1 leading-snug">
              <li>ผู้ให้บริการชำระเงิน (PaySolutions) เพื่อประมวลผลการชำระ</li>
              <li>ผู้ให้บริการ LINE และ Facebook เพื่อส่งข้อความแจ้งเตือน</li>
              <li>หน่วยงานราชการตามที่กฎหมายกำหนด</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold leading-snug">5. ระยะเวลาการเก็บรักษา</h2>
            <p className="leading-snug">
              เราจัดเก็บข้อมูลส่วนบุคคลตลอดระยะเวลาที่ท่านเป็นลูกค้า
              และอีก 10 ปีหลังสัญญาสิ้นสุด ตามข้อกำหนดทางบัญชีและภาษี
              ข้อมูลแชทจัดเก็บ 6 เดือน, บันทึกการตรวจสอบ 1-2 ปี
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold leading-snug">6. สิทธิของเจ้าของข้อมูล</h2>
            <p className="mb-2 leading-snug">ท่านมีสิทธิตาม PDPA ดังนี้:</p>
            <ul className="ml-6 list-disc space-y-1 leading-snug">
              <li>สิทธิในการเข้าถึงข้อมูลส่วนบุคคลของท่าน</li>
              <li>สิทธิในการแก้ไขข้อมูลให้ถูกต้อง</li>
              <li>สิทธิในการขอลบข้อมูล (ภายใต้เงื่อนไขที่กฎหมายกำหนด)</li>
              <li>สิทธิในการคัดค้านการประมวลผล</li>
              <li>สิทธิในการถอนความยินยอม</li>
              <li>สิทธิในการขอให้โอนย้ายข้อมูล</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold leading-snug">7. การรักษาความปลอดภัย</h2>
            <p className="leading-snug">
              เราใช้มาตรการรักษาความปลอดภัยที่เหมาะสม รวมถึงการเข้ารหัสข้อมูล
              การจำกัดสิทธิ์การเข้าถึง และการตรวจสอบบันทึกการใช้งาน
              เพื่อป้องกันการเข้าถึง เปลี่ยนแปลง หรือเปิดเผยข้อมูลโดยไม่ได้รับอนุญาต
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold leading-snug">8. ช่องทางติดต่อ</h2>
            <p className="leading-snug">
              หากท่านมีคำถามเกี่ยวกับนโยบายนี้ หรือต้องการใช้สิทธิตาม PDPA
              สามารถติดต่อได้ที่:
            </p>
            <div className="mt-3 rounded-lg border border-border bg-card p-4 leading-snug">
              <p className="font-semibold">บริษัท เบสช้อยส์ จำกัด</p>
              <p className="mt-1 text-muted-foreground">อีเมล: akenarin.ak@gmail.com</p>
              <p className="text-muted-foreground">LINE OA: @bestchoice</p>
              <p className="text-muted-foreground">Facebook: BESTCHOICE</p>
            </div>
          </section>
        </div>

        <div className="mt-12 border-t border-border pt-6 text-center text-sm text-muted-foreground">
          <p>© 2026 BESTCHOICE. สงวนลิขสิทธิ์.</p>
        </div>
      </div>
    </div>
  );
}
