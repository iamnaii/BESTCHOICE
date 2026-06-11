import { Link } from 'react-router';
import {
  Calculator,
  FileCheck,
  Lock,
  Check,
  AlarmClock,
  BadgePercent,
  QrCode,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react';
import ShopLayout from '@/components/layout/ShopLayout';
import { Button, Card, CardBody, Container, Section, Stack } from '@/components';

/**
 * Transparency page — answers the questions installment customers actually
 * worry about (interest, ownership, device lock, late payment) in plain Thai.
 * Every claim here mirrors real system behavior; final terms always follow
 * the signed contract (disclaimer at the bottom).
 */

interface TermSection {
  icon: React.ReactNode;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

const SECTIONS: TermSection[] = [
  {
    icon: <Calculator className="size-6" />,
    title: 'ดอกเบี้ยและค่างวด — เห็นตัวเลขจริงก่อนสมัคร',
    paragraphs: [
      'เราใช้ดอกเบี้ยแบบคงที่ (flat rate) — ค่างวดเท่ากันทุกเดือนตั้งแต่งวดแรกถึงงวดสุดท้าย ไม่มีดอกเบี้ยลอยตัว ไม่มีค่าธรรมเนียมแอบแฝง',
      'ก่อนสมัคร คุณกดลองปรับจำนวนงวด (3–12 งวด) และเงินดาวน์ในเครื่องคิดค่างวดบนหน้าสินค้าได้เลย ตัวเลขที่เห็นคือประมาณการจากระบบจริงของเรา ไม่ใช่ตัวเลขโฆษณา',
    ],
    bullets: [
      'ค่างวดรวมภาษีมูลค่าเพิ่มแล้ว — ไม่มีบวกเพิ่มทีหลัง',
      'เงินดาวน์ขึ้นกับรุ่นเครื่องและจำนวนงวดที่เลือก — เห็นชัดในเครื่องคิดค่างวด',
      'ราคาเครื่องเงินสดกับผ่อนเท่ากัน ส่วนต่างคือดอกเบี้ยตามงวดเท่านั้น',
    ],
  },
  {
    icon: <FileCheck className="size-6" />,
    title: 'กรรมสิทธิ์เครื่อง — ของคุณทันทีที่ผ่อนครบ',
    paragraphs: [
      'ระหว่างผ่อน กรรมสิทธิ์เครื่องเป็นของ BESTCHOICE ตามสัญญาเช่าซื้อ และโอนเป็นของคุณโดยอัตโนมัติทันทีที่ชำระงวดสุดท้าย ไม่ต้องทำเรื่องเพิ่ม ไม่มีค่าโอน',
      'คุณใช้เครื่องได้ปกติทุกอย่างตั้งแต่วันแรก — ถ่ายรูป ลงแอป ใช้งานเต็มที่เหมือนเครื่องของตัวเอง',
    ],
  },
  {
    icon: <Lock className="size-6" />,
    title: 'ระบบดูแลเครื่อง (MDM) — ล็อคเมื่อไหร่ ปลดเมื่อไหร่',
    paragraphs: [
      'เครื่องผ่อนทุกเครื่องติดตั้งระบบดูแลเครื่อง (MDM) ตามมาตรฐานร้านผ่อน ระบบนี้ไม่อ่านข้อมูลส่วนตัว ไม่เห็นรูป ไม่เห็นแชทของคุณ — ใช้เพื่อดูแลสถานะเครื่องระหว่างผ่อนเท่านั้น',
      'เครื่องจะถูกล็อคการใช้งานชั่วคราว เฉพาะกรณีค้างชำระและติดต่อไม่ได้ หรือผิดนัดชำระที่ตกลงกันไว้ — ไม่มีการล็อคแบบสุ่มหรือล็อคทั้งที่จ่ายตรงเวลา',
    ],
    bullets: [
      'จ่ายตรงเวลา = ไม่มีวันโดนล็อค',
      'ถ้าโดนล็อค: ชำระยอดค้างแล้วระบบปลดล็อคให้อัตโนมัติ ไม่ต้องรอเจ้าหน้าที่',
      'ผ่อนครบ: ถอนระบบออกให้ เครื่องเป็นของคุณ 100%',
    ],
  },
  {
    icon: <AlarmClock className="size-6" />,
    title: 'ถ้าจ่ายช้า หรือเดือนนี้ไม่ไหว — คุยกันได้ก่อนเสมอ',
    paragraphs: [
      'ชำระล่าช้ามีค่าปรับตามที่ระบุในสัญญา แต่สิ่งที่เราอยากให้ทำที่สุดคือ ทักไลน์มาก่อนถึงวันครบกำหนด — ทีมงานช่วยหาทางออกได้จริง เช่น เลื่อนวันนัดชำระ ปรับแผนงวด หรือกรณีจำเป็นจริงๆ ก็คืนเครื่องเพื่อปิดภาระ',
      'การแจ้งล่วงหน้าไม่มีผลเสียใดๆ — ลูกค้าที่คุยกับเราก่อนได้เงื่อนไขที่ดีกว่าการเงียบหายเสมอ',
    ],
  },
  {
    icon: <BadgePercent className="size-6" />,
    title: 'ปิดยอดก่อนกำหนด — ลดดอกเบี้ยที่เหลือ 50%',
    paragraphs: [
      'อยากปิดยอดเร็ว? ทำได้ทุกเมื่อผ่าน LINE ด้วยตัวเอง — ระบบคำนวณยอดปิดให้ทันที พร้อมส่วนลดดอกเบี้ยส่วนที่ยังไม่ถึงกำหนด 50% (เงื่อนไขปัจจุบัน) ชำระเสร็จสัญญาปิดและกรรมสิทธิ์โอนเป็นของคุณทันที',
    ],
  },
  {
    icon: <QrCode className="size-6" />,
    title: 'จ่ายค่างวดง่าย มีหลักฐานทุกครั้ง',
    paragraphs: [
      'ชำระผ่าน LINE ได้ตลอด — สแกน QR พร้อมเพย์ บัตรเดบิต/เครดิต หรือโมบายแบงก์กิ้ง ระบบออกใบเสร็จให้ทุกรายการ ดาวน์โหลดย้อนหลังได้ และดูประวัติการผ่อนทั้งหมดได้ใน LINE',
    ],
    bullets: [
      'แจ้งเตือนก่อนถึงกำหนด 5, 3 และ 1 วัน ทาง LINE (ปิด/เปิดได้เอง)',
      'ใบเสร็จอิเล็กทรอนิกส์ทุกงวด ตรวจสอบย้อนหลังได้',
    ],
  },
];

export default function InstallmentTermsPage() {
  return (
    <ShopLayout>
      <Section padding="md">
        <Container narrow>
          <Stack gap={8} className="leading-snug">
            <div className="text-center space-y-3">
              <ShieldCheck className="size-12 text-emerald-500 mx-auto" aria-hidden="true" />
              <h1 className="text-2xl md:text-4xl font-bold leading-snug">
                ผ่อนแบบรู้ทุกอย่างก่อนเซ็น
              </h1>
              <p className="text-sm md:text-base text-muted-foreground max-w-xl mx-auto">
                เราเชื่อว่าลูกค้าที่เข้าใจเงื่อนไขครบคือลูกค้าที่ผ่อนจบ —
                นี่คือทุกเรื่องที่ควรรู้ก่อนตัดสินใจ เขียนแบบตรงไปตรงมา ไม่มีตัวหนังสือเล็กๆ ซ่อนไว้
              </p>
            </div>

            <Stack gap={4}>
              {SECTIONS.map((s, i) => (
                <Card key={i} variant="outlined">
                  <CardBody className="space-y-3 leading-snug">
                    <div className="flex items-center gap-3">
                      <span className="size-11 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                        {s.icon}
                      </span>
                      <h2 className="font-semibold text-base md:text-lg leading-snug">{s.title}</h2>
                    </div>
                    {s.paragraphs.map((p, j) => (
                      <p key={j} className="text-sm text-muted-foreground leading-snug">
                        {p}
                      </p>
                    ))}
                    {s.bullets && (
                      <ul className="space-y-1.5">
                        {s.bullets.map((b, j) => (
                          <li key={j} className="flex gap-2 text-sm leading-snug">
                            <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              ))}
            </Stack>

            <p className="text-xs text-muted-foreground text-center leading-snug">
              ข้อมูลในหน้านี้สรุปเพื่อความเข้าใจง่าย — เงื่อนไขที่มีผลผูกพันคือสัญญาที่คุณอ่านและลงนามที่สาขา
              ซึ่งทีมงานจะอธิบายให้ฟังทุกข้อก่อนเซ็นเสมอ
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button asChild variant="primary" size="lg" fullWidth>
                <Link to="/products">ดูสินค้า + ลองคำนวณค่างวด</Link>
              </Button>
              <Button asChild variant="outline" size="lg" fullWidth>
                <a href="https://line.me/R/ti/p/@bestchoice" target="_blank" rel="noreferrer">
                  <MessageCircle className="size-4" aria-hidden="true" />
                  มีคำถาม? ทักไลน์ได้เลย
                </a>
              </Button>
            </div>
          </Stack>
        </Container>
      </Section>
    </ShopLayout>
  );
}
