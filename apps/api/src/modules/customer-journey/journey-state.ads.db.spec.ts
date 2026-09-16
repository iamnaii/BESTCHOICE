import { PrismaClient } from '@prisma/client';
import { JourneyStateService } from './journey-state.service';

/**
 * ที่มา "โฆษณา" ของ journey-state.sql (CTE earliest_room) นับเฉพาะ ads_attributions.referrer_url = 'ADS'
 * (เจ้าของเคาะ 2026-09-15 ข้อ 7 · AD_REFERRAL_SOURCE ใน chat-engine/utils/ad-attribution.util.ts) — Postgres จริง
 * ห้องแรกของครอบครัวเป็นตัวตัดสิน: ห้องแรกไม่ใช่โฆษณา = CHAT_<ช่องทาง> แม้ห้องหลังจะมาจากโฆษณา
 * ไฟล์แยกจาก journey-state.service.db.spec.ts โดยตั้งใจ — หนึ่งไฟล์ต่อหนึ่งหัวข้อ แบบ journey-state.stage-order.db.spec.ts (Task 2) และ journey-state.signals.db.spec.ts (Task 3)
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand
 */
describe('journey-state.sql — ที่มาโฆษณานับเฉพาะ referrer_url ADS (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new JourneyStateService(prisma as any);
  const stamp = Date.now();
  const at = (value: string) => new Date(value);
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const attributionIds: string[] = [];
  const campaignIds: string[] = [];

  const stateOf = (customerId: string) => prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId } });

  /** ผู้สนใจจากแชท Facebook — acquisition_source CHAT_ ⇒ ไม่มีเวลาหน้าร้าน ห้องแรกเป็นจุดเริ่ม */
  async function chatCustomer(label: string) {
    const row = await prisma.customer.create({
      data: { name: `journey ads ${label}`, phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at('2026-09-01T00:00:00.000Z') },
    });
    customerIds.push(row.id);
    return row;
  }
  /** แคมเปญ + attribution หนึ่งคู่ · referrerUrl null = referral ที่ Meta ไม่ส่ง source · รหัสแคมเปญสั้นแบบ ad_id จริง (AD: ตัดที่ 30 ตัว) */
  async function adAttribution(referrerUrl: string | null) {
    const campaign = await prisma.adsCampaign.create({
      data: { platform: 'FACEBOOK_ADS', campaignId: `${stamp}${campaignIds.length}`, campaignName: 'journey ads spec' },
    });
    campaignIds.push(campaign.id);
    const attribution = await prisma.adsAttribution.create({
      data: { campaignId: campaign.id, utmSource: 'facebook', referrerUrl, firstTouch: at('2026-09-01T00:00:00.000Z') },
    });
    attributionIds.push(attribution.id);
    return { campaign, attribution };
  }
  /** ห้อง Facebook + ข้อความลูกค้าหนึ่งใบ ณ เวลาสร้างห้อง */
  async function room(customerId: string, label: string, createdAt: string, attributionId: string) {
    const row = await prisma.chatRoom.create({
      data: { channel: 'FACEBOOK', externalUserId: `journey-ads-${label}-${stamp}`, customerId, attributionId, createdAt: at(createdAt) },
    });
    roomIds.push(row.id);
    await prisma.chatMessage.create({ data: { roomId: row.id, role: 'CUSTOMER', createdAt: at(createdAt) } });
    return row;
  }

  afterAll(async () => {
    // chat_rooms.attribution_id มี FK ⇒ ลบห้องก่อน attribution · ads_attributions ไม่มี deleted_at (แถวของ spec เอง)
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.adsAttribution.deleteMany({ where: { id: { in: attributionIds } } });
    await prisma.adsCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
  });

  it('ห้องแรกชี้ attribution ADS → firstSource AD:<campaign_id> + firstAdCampaignId', async () => {
    const c = await chatCustomer('ads');
    const { campaign, attribution } = await adAttribution('ADS');
    await room(c.id, 'ads', '2026-09-02T03:00:00.000Z', attribution.id);

    await service.recompute([c.id]);

    expect(await stateOf(c.id)).toMatchObject({
      firstChannel: 'CHAT_FACEBOOK',
      firstSource: `AD:${campaign.campaignId}`,
      firstAdCampaignId: campaign.id,
    });
  });

  it.each<[string, string | null]>([
    ['SHORTLINK (ลิงก์สินค้า m.me)', 'SHORTLINK'],
    ['NULL (referral ไม่มี source)', null],
  ])('ห้องแรกชี้ attribution referrer_url %s → CHAT_FACEBOOK ไม่มีแคมเปญ', async (label, referrerUrl) => {
    const c = await chatCustomer(`not-ads-${label}`);
    const { attribution } = await adAttribution(referrerUrl);
    await room(c.id, `not-ads-${referrerUrl ?? 'null'}`, '2026-09-02T03:00:00.000Z', attribution.id);

    await service.recompute([c.id]);

    expect(await stateOf(c.id)).toMatchObject({ firstChannel: 'CHAT_FACEBOOK', firstSource: 'CHAT_FACEBOOK', firstAdCampaignId: null });
  });

  it('ห้องแรกไม่ใช่โฆษณา + ห้องหลังมาจากโฆษณา ADS → ยัง CHAT_FACEBOOK (ห้องแรกตัดสิน ไม่ถอยไปห้องหลัง)', async () => {
    const c = await chatCustomer('late-ads');
    const link = await adAttribution('SHORTLINK');
    const ad = await adAttribution('ADS');
    await room(c.id, 'late-ads-first', '2026-09-02T03:00:00.000Z', link.attribution.id);
    await room(c.id, 'late-ads-second', '2026-09-05T03:00:00.000Z', ad.attribution.id);

    await service.recompute([c.id]);

    const s = await stateOf(c.id);
    expect(s).toMatchObject({ firstChannel: 'CHAT_FACEBOOK', firstSource: 'CHAT_FACEBOOK', firstAdCampaignId: null });
    expect(s.contactedAt.toISOString()).toBe('2026-09-02T03:00:00.000Z');
  });
});
