/**
 * Public Data Deletion Instructions page — accessible without login.
 * Used as the "Data Deletion Instructions URL" for Facebook App settings
 * (Settings → Basic) to satisfy Meta's PDPA/GDPR data deletion requirement.
 * Route: /privacy/data-deletion
 */
export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-foreground leading-snug">
            การลบข้อมูลส่วนบุคคล
          </h1>
          <p className="mt-2 text-muted-foreground leading-snug">
            BESTCHOICE — User Data Deletion Instructions
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            ปรับปรุงล่าสุด: 24 พฤษภาคม 2569
          </p>
        </div>

        <div className="space-y-8 text-foreground leading-relaxed">
          <section>
            <h2 className="mb-3 text-xl font-semibold leading-snug">วิธีขอลบข้อมูลส่วนบุคคล</h2>
            <p className="leading-snug">
              ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA) ลูกค้ามีสิทธิ์ขอลบข้อมูลส่วนบุคคลที่อยู่ในระบบของ BESTCHOICE
              ตามเงื่อนไขที่กฎหมายกำหนด
            </p>
            <p className="mt-3 leading-snug">
              หากท่านต้องการขอลบข้อมูล กรุณาติดต่อตามช่องทางใดช่องทางหนึ่งต่อไปนี้:
            </p>
            <ul className="mt-3 ml-6 list-disc space-y-2 leading-snug">
              <li>
                <strong>อีเมล:</strong>{' '}
                <a
                  href="mailto:akenarin.ak@gmail.com?subject=คำขอลบข้อมูลส่วนบุคคล%20PDPA"
                  className="text-primary underline"
                >
                  akenarin.ak@gmail.com
                </a>{' '}
                — แจ้งหัวข้ออีเมล "คำขอลบข้อมูลส่วนบุคคล PDPA"
              </li>
              <li>
                <strong>ทักผ่าน LINE OA:</strong>{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 text-sm">@bestchoice</code>{' '}
                — ส่งข้อความ "ขอลบข้อมูล"
              </li>
              <li>
                <strong>โทร:</strong>{' '}
                <a href="tel:0955678887" className="text-primary underline">
                  095-567-8887
                </a>{' '}
                (วันจันทร์–เสาร์ เวลา 9:00–18:00 น.)
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold leading-snug">ข้อมูลที่ต้องใช้ในการระบุตัวตน</h2>
            <p className="leading-snug">
              เพื่อความปลอดภัยและป้องกันการแอบอ้าง โปรดเตรียมข้อมูลต่อไปนี้:
            </p>
            <ul className="mt-3 ml-6 list-disc space-y-1 leading-snug">
              <li>ชื่อ-นามสกุล</li>
              <li>เลขบัตรประชาชน (4 ตัวท้าย)</li>
              <li>เบอร์โทรศัพท์ที่ลงทะเบียนไว้</li>
              <li>(สำหรับลูกค้า Facebook) ชื่อบัญชี Facebook หรือ Page ID ที่เคยทักแชทเข้ามา</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold leading-snug">ระยะเวลาดำเนินการ</h2>
            <p className="leading-snug">
              บริษัทจะดำเนินการลบข้อมูลของท่านภายใน <strong>30 วัน</strong> นับจากวันที่ได้รับคำขอครบถ้วน
              และจะแจ้งผลกลับให้ท่านทราบทางช่องทางที่ติดต่อมา
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold leading-snug">ข้อยกเว้น</h2>
            <p className="leading-snug">
              ข้อมูลบางส่วนอาจไม่สามารถลบได้ทันที หากอยู่ภายใต้เงื่อนไขดังต่อไปนี้:
            </p>
            <ul className="mt-3 ml-6 list-disc space-y-1 leading-snug">
              <li>มีสัญญาเช่าซื้อหรือยอดผ่อนชำระค้างชำระอยู่</li>
              <li>กฎหมายกำหนดให้ต้องเก็บรักษา (เช่น เอกสารบัญชี/ภาษี เก็บไว้ 5–10 ปี ตามประมวลรัษฎากร)</li>
              <li>ข้อมูลอยู่ระหว่างการดำเนินคดีหรือการระงับข้อพิพาท</li>
            </ul>
            <p className="mt-3 leading-snug">
              ในกรณีดังกล่าว บริษัทจะลบข้อมูลทันทีที่ข้อยกเว้นสิ้นสุด
            </p>
          </section>

          <hr className="border-border" />

          <section className="rounded-lg bg-muted/40 p-4">
            <h2 className="mb-2 text-lg font-semibold leading-snug">English Summary</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              To request deletion of your personal data held by BESTCHOICE, please contact us by
              email at <strong>akenarin.ak@gmail.com</strong> with the subject "PDPA Data Deletion
              Request", or send a LINE message to <strong>@bestchoice</strong>, or call{' '}
              <strong>+66 95-567-8887</strong> (Mon–Sat 9:00–18:00 ICT). Please include your full
              name, the last 4 digits of your national ID, and the phone number you registered
              with. We will process your request within 30 days, except where ongoing
              installment contracts or legal retention requirements apply.
            </p>
          </section>

          <section className="text-sm text-muted-foreground">
            <p className="leading-snug">
              ดู{' '}
              <a href="/privacy" className="text-primary underline">
                นโยบายความเป็นส่วนตัวฉบับเต็ม
              </a>{' '}
              สำหรับข้อมูลเพิ่มเติม
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
