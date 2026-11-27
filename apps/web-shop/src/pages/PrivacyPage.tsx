import type { ReactNode } from 'react';
import { CategoryHero, Container, Stack, Button } from '@/components';
import ShopLayout from '@/components/layout/ShopLayout';
import { useConsentUi } from '@/components/consent/useConsentUi';
import { shopInfo } from '@/lib/copy';
import {
  POLICY_EFFECTIVE_DATE,
  PRIVACY_EMAIL,
  VISIT_DATA_RETENTION,
  SELL_FORM_RETENTION,
} from '@/lib/privacy-facts';
import { usePageMeta } from '@/hooks/usePageMeta';

const TITLE = 'นโยบายความเป็นส่วนตัวและคุกกี้';
const INTRO =
  'นโยบายนี้อธิบายว่าเราเก็บข้อมูลส่วนบุคคลอะไรผ่านเว็บไซต์นี้ ใช้ทำอะไร และคุณมีสิทธิอะไรบ้างตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562';

const h3 = 'text-lg font-semibold leading-snug';
const p = 'reading-block text-foreground leading-snug';
const ul = 'list-disc pl-6 space-y-1 leading-snug';
const th = 'border border-border bg-muted px-3 py-2 text-left align-top font-semibold leading-snug';
const td = 'border border-border px-3 py-2 align-top leading-snug';

function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{children}</code>;
}

export default function PrivacyPage() {
  usePageMeta(TITLE, INTRO);
  const openSettings = useConsentUi((s) => s.openSettings);

  return (
    <ShopLayout>
      <CategoryHero
        title={TITLE}
        description={INTRO}
        breadcrumbs={[{ label: 'หน้าแรก', to: '/' }, { label: 'นโยบายความเป็นส่วนตัว' }]}
      />
      <Container>
        <Stack gap={6} className="py-8 max-w-3xl">
          <div className="space-y-3">
            {POLICY_EFFECTIVE_DATE && (
              <p className="leading-snug text-muted-foreground">
                ฉบับที่ 1 · มีผลตั้งแต่ {POLICY_EFFECTIVE_DATE}
              </p>
            )}
            <p className={p}>
              บริษัท เบสท์ช้อยส์โฟน จำกัด ("ร้าน" หรือ "เรา") เป็นผู้ดูแลเว็บไซต์
              www.bestchoicephone.com {INTRO}{' '}
              ข้อมูลที่เกิดจากการทำสัญญาผ่อนที่ร้านมีนโยบายแยกต่างหาก ซึ่งพนักงานจะแจ้งตอนทำสัญญา
            </p>
          </div>

          <section className="space-y-3">
            <h3 className={h3}>1. ข้อมูลที่เราเก็บ</h3>
            <p className="font-semibold leading-snug">ข้อมูลที่คุณกรอกเอง</p>
            <ul className={ul}>
              <li>
                แบบฟอร์มขายหรือเทิร์นเครื่อง: ชื่อ เบอร์โทรศัพท์ รุ่น ความจุ สภาพเครื่องที่คุณตอบ
                หมายเลข IMEI (ถ้ากรอก) วันที่สะดวกเข้าร้าน และหมายเหตุ
              </li>
              <li>การเข้าสู่ระบบด้วย LINE: ชื่อที่แสดงใน LINE และรหัสผู้ใช้ LINE ของคุณ</li>
              <li>
                บัญชีของคุณบนเว็บไซต์: เบอร์โทรศัพท์ ที่อยู่จัดส่งที่คุณบันทึกไว้
                และประวัติคำสั่งซื้อ
              </li>
            </ul>
            <p className="font-semibold leading-snug">ข้อมูลที่เกิดขึ้นเมื่อคุณเปิดเว็บไซต์</p>
            <ul className={ul}>
              <li>หน้าที่คุณเปิด เว็บไซต์ที่ส่งคุณมา และแคมเปญโฆษณาที่คุณกดเข้ามา</li>
              <li>
                ข้อมูลเบราว์เซอร์ที่อุปกรณ์ของคุณส่งมา (user agent) ประเภทอุปกรณ์ และระบบปฏิบัติการ
              </li>
              <li>
                รหัสผู้เข้าชมแบบสุ่มที่เก็บในเบราว์เซอร์ของคุณ ใช้นับว่าเป็นผู้เข้าชมคนเดิม
                ไม่ได้บอกว่าคุณเป็นใคร
              </li>
              <li>ที่อยู่ IP ซึ่งถูกแปลงเป็นรหัสที่อ่านย้อนกลับไม่ได้ก่อนบันทึก</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h3 className={h3}>2. เราใช้ข้อมูลทำอะไร</h3>
            <Table>
              <tbody>
                <tr>
                  <th scope="col" className={th}>
                    วัตถุประสงค์
                  </th>
                  <th scope="col" className={th}>
                    ข้อมูลที่ใช้
                  </th>
                  <th scope="col" className={th}>
                    ฐานตามกฎหมาย
                  </th>
                </tr>
                <tr>
                  <td className={td}>ประเมินราคาและติดต่อกลับเรื่องขายหรือเทิร์นเครื่อง</td>
                  <td className={td}>ข้อมูลในแบบฟอร์ม</td>
                  <td className={td}>ดำเนินการตามคำขอของคุณก่อนทำสัญญา</td>
                </tr>
                <tr>
                  <td className={td}>ให้คุณเข้าสู่ระบบ ดูคำสั่งซื้อ และจัดการที่อยู่</td>
                  <td className={td}>ข้อมูลบัญชี</td>
                  <td className={td}>ปฏิบัติตามสัญญา</td>
                </tr>
                <tr>
                  <td className={td}>
                    นับจำนวนผู้เข้าชมของร้านเอง ดูว่าลูกค้ามาจากช่องทางใด และป้องกันการใช้งานผิดปกติ
                  </td>
                  <td className={td}>
                    หน้าที่เปิด แหล่งที่มา ข้อมูลเบราว์เซอร์ รหัสผู้เข้าชม รหัส IP ที่แปลงแล้ว
                  </td>
                  <td className={td}>ประโยชน์โดยชอบด้วยกฎหมายของร้าน</td>
                </tr>
                <tr>
                  <td className={td}>
                    วิเคราะห์การใช้งานด้วย Google Analytics เพื่อปรับปรุงเว็บไซต์
                  </td>
                  <td className={td}>ข้อมูลการเข้าชมที่ส่งให้ Google</td>
                  <td className={td}>ความยินยอมของคุณ</td>
                </tr>
                <tr>
                  <td className={td}>วัดผลโฆษณา และแสดงโฆษณาของร้านที่ตรงกับความสนใจ</td>
                  {/* ชื่อผู้ให้บริการต้องตรงกับ components/consent/vendors.ts — เพิ่ม TikTok/LINE (Task 7)
                      ต้องแก้ข้อความนี้ แถวตารางคุกกี้ และข้อ 4 พร้อมกัน + ขึ้น CONSENT_POLICY_VERSION */}
                  <td className={td}>ข้อมูลการเข้าชมที่ส่งให้ Meta</td>
                  <td className={td}>ความยินยอมของคุณ</td>
                </tr>
              </tbody>
            </Table>
          </section>

          <section className="space-y-3">
            <h3 className={h3}>3. คุกกี้และการเก็บข้อมูลในเบราว์เซอร์</h3>
            <p className={p}>
              คุกกี้คือข้อมูลขนาดเล็กที่เว็บไซต์เก็บไว้ในเบราว์เซอร์ของคุณ
              เว็บไซต์นี้ใช้ทั้งคุกกี้และพื้นที่เก็บข้อมูลของเบราว์เซอร์ ซึ่งทำงานคล้ายกัน
              แบ่งเป็นสามหมวด
            </p>
            <Table>
              <tbody>
                <tr>
                  <th scope="col" className={th}>
                    หมวด
                  </th>
                  <th scope="col" className={th}>
                    ชื่อ
                  </th>
                  <th scope="col" className={th}>
                    ใช้ทำอะไร
                  </th>
                  <th scope="col" className={th}>
                    เก็บนานเท่าไร
                  </th>
                </tr>
                <tr>
                  <th scope="row" rowSpan={3} className={th}>
                    จำเป็น
                    <br />
                    เปิดเสมอ
                  </th>
                  <td className={td}>
                    <Code>bc_cookie_consent</Code>
                  </td>
                  <td className={td}>จำผลการเลือกคุกกี้ของคุณ</td>
                  <td className={td}>จนกว่าคุณจะเปลี่ยน หรือนโยบายเปลี่ยนฉบับ</td>
                </tr>
                <tr>
                  <td className={td}>
                    <Code>shop_auth_token</Code> <Code>shop_auth_customer</Code>
                  </td>
                  <td className={td}>จำการเข้าสู่ระบบ</td>
                  <td className={td}>จนกว่าคุณจะปิดแท็บ</td>
                </tr>
                <tr>
                  <td className={td}>
                    <Code>shop_session_id</Code>
                  </td>
                  <td className={td}>
                    รหัสผู้เข้าชมของร้านเอง ใช้นับจำนวนผู้เข้าชม ข้อมูลนี้ไม่ส่งให้บุคคลภายนอก
                  </td>
                  <td className={td}>จนกว่าคุณจะล้างข้อมูลเบราว์เซอร์</td>
                </tr>
                <tr>
                  <th scope="row" className={th}>
                    วิเคราะห์
                  </th>
                  <td className={td}>
                    <Code>_ga</Code> <Code>_ga_…</Code>
                  </td>
                  <td className={td}>Google Analytics แยกผู้เข้าชมแต่ละคนเพื่อนับสถิติ</td>
                  <td className={td}>สูงสุด 2 ปี</td>
                </tr>
                <tr>
                  <th scope="row" className={th}>
                    การตลาด
                  </th>
                  <td className={td}>
                    <Code>_fbp</Code> <Code>_fbc</Code>
                  </td>
                  <td className={td}>Meta Pixel วัดผลโฆษณาบน Facebook และ Instagram</td>
                  <td className={td}>สูงสุด 90 วัน</td>
                </tr>
              </tbody>
            </Table>
            <p className={p}>
              คุกกี้หมวดวิเคราะห์และการตลาดจะถูกใช้เมื่อคุณกดยอมรับเท่านั้น
              คุณเปลี่ยนการเลือกได้ทุกเมื่อที่ลิงก์ "ตั้งค่าคุกกี้" ท้ายทุกหน้า เมื่อปิดหมวดใด
              เราจะหยุดส่งข้อมูลของหมวดนั้นทันที ส่วนคุกกี้ที่ผู้ให้บริการภายนอกวางไว้แล้ว
              คุณลบได้จากการตั้งค่าของเบราว์เซอร์
            </p>
            {/* ห้ามใส่ data-consent-ui — หน้านี้ถูก prerender (ด่านใน scripts/prerender.mjs) */}
            <Button type="button" variant="outline" size="sm" onClick={openSettings}>
              ตั้งค่าคุกกี้
            </Button>
          </section>

          <section className="space-y-3">
            <h3 className={h3}>4. เราส่งข้อมูลให้ใครบ้าง</h3>
            <ul className={ul}>
              <li>
                Google (Google Analytics) เมื่อคุณยอมรับคุกกี้เพื่อการวิเคราะห์ และ Google Maps
                เมื่อคุณกดแสดงแผนที่
              </li>
              {/* ดู components/consent/vendors.ts — ต้องแก้พร้อมข้อ 2 และตารางคุกกี้ */}
              <li>Meta (Facebook และ Instagram) เมื่อคุณยอมรับคุกกี้เพื่อการตลาด</li>
              <li>LINE เมื่อคุณเข้าสู่ระบบด้วย LINE หรือกดแชทกับร้าน</li>
              <li>ผู้ให้บริการระบบคลาวด์ที่เก็บข้อมูลของเว็บไซต์</li>
              <li>หน่วยงานของรัฐ เมื่อกฎหมายกำหนด</li>
            </ul>
            <p className={p}>
              ผู้ให้บริการบางรายเก็บข้อมูลไว้นอกประเทศไทย เราไม่ขายข้อมูลส่วนบุคคลของคุณให้ใคร
            </p>
          </section>

          <section className="space-y-3">
            <h3 className={h3}>5. เราเก็บข้อมูลไว้นานเท่าไร</h3>
            <ul className={ul}>
              {VISIT_DATA_RETENTION && <li>ข้อมูลการเข้าชมเว็บไซต์: {VISIT_DATA_RETENTION}</li>}
              {SELL_FORM_RETENTION && (
                <li>แบบฟอร์มขายหรือเทิร์นเครื่องที่ไม่ได้ทำรายการต่อ: {SELL_FORM_RETENTION}</li>
              )}
              <li>
                ข้อมูลบัญชีและคำสั่งซื้อ: ตลอดเวลาที่คุณเป็นลูกค้า
                และต่ออีกตามที่กฎหมายบัญชีและภาษีกำหนด
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h3 className={h3}>6. สิทธิของคุณ</h3>
            <ul className={ul}>
              <li>ขอดูและขอสำเนาข้อมูลของคุณ</li>
              <li>ขอแก้ไขข้อมูลให้ถูกต้อง</li>
              <li>ขอลบข้อมูล หรือขอให้ระงับการใช้ข้อมูล</li>
              <li>คัดค้านการเก็บหรือใช้ข้อมูล</li>
              <li>ขอรับข้อมูลในรูปแบบที่ส่งต่อให้ผู้อื่นได้</li>
              <li>ถอนความยินยอมที่เคยให้ไว้ การถอนไม่กระทบสิ่งที่ทำไปแล้วก่อนถอน</li>
              <li>ร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล</li>
            </ul>
            <p className={p}>แจ้งใช้สิทธิได้ตามช่องทางในข้อ 7 เราจะตอบกลับภายใน 30 วัน</p>
          </section>

          <section className="space-y-3">
            <h3 className={h3}>7. ติดต่อเรา</h3>
            <p className={p}>
              บริษัท เบสท์ช้อยส์โฟน จำกัด (ร้าน BESTCHOICE ผ่อนไอโฟนลพบุรี)
              <br />
              {shopInfo.address}
              <br />
              โทร{' '}
              <a href={shopInfo.phoneHref} className="underline">
                {shopInfo.phoneDisplay}
              </a>{' '}
              · LINE{' '}
              <a href={shopInfo.lineUrl} className="underline">
                {shopInfo.lineHandle}
              </a>
              {PRIVACY_EMAIL && (
                <>
                  {' '}
                  · อีเมล{' '}
                  <a href={`mailto:${PRIVACY_EMAIL}`} className="underline">
                    {PRIVACY_EMAIL}
                  </a>
                </>
              )}
            </p>
          </section>

          <section className="space-y-3">
            <h3 className={h3}>8. การแก้ไขนโยบาย</h3>
            <p className={p}>
              เมื่อเราแก้ไขนโยบายนี้ในส่วนที่เกี่ยวกับคุกกี้ เว็บไซต์จะถามการเลือกของคุณใหม่อีกครั้ง
              ฉบับล่าสุดอยู่ที่หน้านี้เสมอ
            </p>
          </section>
        </Stack>
      </Container>
    </ShopLayout>
  );
}
