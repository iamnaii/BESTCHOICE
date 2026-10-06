import { Test } from '@nestjs/testing';
import { AdsPlatform } from '@prisma/client';
import { RoomManagerService } from './room-manager.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AssignmentService } from './assignment.service';

/** linkAttribution — ท่า OBI: แคมเปญคีย์ด้วย ad_id · ห้องเดิมก็บันทึก · โฆษณาตัวใหม่ชี้ห้องไปที่ล่าสุด */
describe('RoomManagerService.linkAttribution', () => {
  let service: RoomManagerService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      adsCampaign: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      adsAttribution: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      chatRoom: { update: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [
        RoomManagerService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: { configured: false } },
        { provide: AssignmentService, useValue: { autoAssign: jest.fn() } },
      ],
    }).compile();
    service = module.get(RoomManagerService);
  });

  const AD = {
    utmSource: 'facebook',
    utmCampaign: '120246504706250534',
    referrerUrl: 'ADS',
    adId: '120246504706250534',
    adTitle: 'ฝนตกไม่อยากออกจากบ้าน',
    adPhotoUrl: 'https://scontent.example/ad.jpg',
  };

  it('ห้องที่ยังไม่มีที่มา → สร้างแคมเปญจาก ad_id พร้อมชื่อ/รูป แล้วผูกห้อง', async () => {
    prisma.adsCampaign.findFirst.mockResolvedValue(null);
    prisma.adsCampaign.create.mockResolvedValue({ id: 'c1', campaignName: 'ฝนตกไม่อยากออกจากบ้าน', adName: 'ฝนตกไม่อยากออกจากบ้าน', adPhotoUrl: 'x' });
    prisma.adsAttribution.create.mockResolvedValue({ id: 'a1' });

    const res = await service.linkAttribution('room-1', AD, null);

    expect(prisma.adsCampaign.create).toHaveBeenCalledWith({
      data: {
        platform: AdsPlatform.FACEBOOK_ADS,
        campaignId: '120246504706250534',
        campaignName: 'ฝนตกไม่อยากออกจากบ้าน',
        adName: 'ฝนตกไม่อยากออกจากบ้าน',
        adPhotoUrl: 'https://scontent.example/ad.jpg',
      },
    });
    expect(prisma.adsAttribution.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ campaignId: 'c1', utmCampaign: '120246504706250534' }) }),
    );
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-1' }, data: { attributionId: 'a1' } });
    expect(res).toEqual({ campaignName: 'ฝนตกไม่อยากออกจากบ้าน', adTitle: 'ฝนตกไม่อยากออกจากบ้าน', changed: true });
  });

  it('ห้องเดิม โฆษณาตัวเดิม → แค่อัปเดต lastTouch ไม่สร้างซ้ำ', async () => {
    prisma.adsCampaign.findFirst.mockResolvedValue({ id: 'c1', campaignName: 'x', adName: 'x', adPhotoUrl: 'y' });
    prisma.adsAttribution.findUnique.mockResolvedValue({ id: 'a1', campaignId: 'c1' });

    const res = await service.linkAttribution('room-1', AD, 'a1');

    expect(prisma.adsAttribution.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { lastTouch: expect.any(Date) } });
    expect(prisma.adsAttribution.create).not.toHaveBeenCalled();
    expect(prisma.chatRoom.update).not.toHaveBeenCalled();
    expect(res?.changed).toBe(false);
  });

  it('ห้องเดิม โฆษณาตัวใหม่ → attribution ใหม่ และห้องชี้ไปที่ล่าสุด', async () => {
    prisma.adsCampaign.findFirst.mockResolvedValue({ id: 'c2', campaignName: 'ใหม่', adName: 'ใหม่', adPhotoUrl: 'y' });
    prisma.adsAttribution.findUnique.mockResolvedValue({ id: 'a1', campaignId: 'c1' });
    prisma.adsAttribution.create.mockResolvedValue({ id: 'a2' });

    const res = await service.linkAttribution('room-1', { ...AD, adId: '999', utmCampaign: '999' }, 'a1');

    expect(prisma.adsAttribution.create).toHaveBeenCalled();
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-1' }, data: { attributionId: 'a2' } });
    expect(res?.changed).toBe(true);
  });

  it('แคมเปญเดิมยังไม่มีชื่อ/รูป → เติมจาก referral รอบนี้ ไม่ทับของที่มีอยู่', async () => {
    prisma.adsCampaign.findFirst.mockResolvedValue({ id: 'c1', campaignName: 'Auto-detected', adName: null, adPhotoUrl: null });
    prisma.adsCampaign.update.mockResolvedValue({ id: 'c1', campaignName: AD.adTitle, adName: AD.adTitle, adPhotoUrl: AD.adPhotoUrl });
    prisma.adsAttribution.create.mockResolvedValue({ id: 'a1' });

    await service.linkAttribution('room-1', AD, null);

    expect(prisma.adsCampaign.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { adName: AD.adTitle, adPhotoUrl: AD.adPhotoUrl, campaignName: AD.adTitle },
    });
  });

  it('DB ล้ม → คืน null ไม่โยน (ห้ามทำให้ webhook ล้ม)', async () => {
    prisma.adsCampaign.findFirst.mockRejectedValue(new Error('boom'));
    await expect(service.linkAttribution('room-1', AD, null)).resolves.toBeNull();
  });

  // ── เจ้าของเคาะ 2026-09-15 ข้อ 7: นับเป็นโฆษณาเฉพาะ referral.source = 'ADS' ─────────────
  /** ลิงก์ m.me ของหน้าสินค้าบนเว็บร้าน — buildFbAttribution จาก { ref: 'p:abc', source: 'SHORTLINK' } */
  const PRODUCT_LINK = {
    utmSource: 'facebook',
    utmCampaign: 'p:abc',
    utmContent: 'p:abc',
    referrerUrl: 'SHORTLINK',
  };
  /** จำลองว่าถ้าเขียนได้จะเขียนสำเร็จ — เทสต้องล้มเพราะ "ถูกเรียก" ไม่ใช่เพราะ mock คืน undefined */
  function mockWritesSucceed() {
    prisma.adsCampaign.findFirst.mockResolvedValue(null);
    prisma.adsCampaign.create.mockResolvedValue({ id: 'c-link', campaignName: 'p:abc', adName: null, adPhotoUrl: null });
    prisma.adsAttribution.create.mockResolvedValue({ id: 'a-link' });
  }
  function expectNoAttributionWrites() {
    expect(prisma.adsCampaign.findFirst).not.toHaveBeenCalled();
    expect(prisma.adsCampaign.create).not.toHaveBeenCalled();
    expect(prisma.adsCampaign.update).not.toHaveBeenCalled();
    expect(prisma.adsAttribution.findUnique).not.toHaveBeenCalled();
    expect(prisma.adsAttribution.create).not.toHaveBeenCalled();
    expect(prisma.adsAttribution.update).not.toHaveBeenCalled();
    expect(prisma.chatRoom.update).not.toHaveBeenCalled();
  }

  it('ลิงก์สินค้า (SHORTLINK) บนห้องที่ยังไม่มีที่มา → คืน null ไม่สร้างแคมเปญ/attribution ไม่แตะห้อง', async () => {
    mockWritesSucceed();

    const res = await service.linkAttribution('room-1', PRODUCT_LINK, null);

    expect(res).toBeNull();
    expectNoAttributionWrites();
  });

  it('referral ที่ไม่มี source (Meta ส่ง {} → มีแต่ utmSource) → คืน null ไม่เขียนอะไร', async () => {
    mockWritesSucceed();

    const res = await service.linkAttribution('room-1', { utmSource: 'facebook' }, null);

    expect(res).toBeNull();
    expectNoAttributionWrites();
  });

  it('ห้องที่ชี้โฆษณา ADS อยู่ + ลิงก์สินค้า → ไม่อ่าน/ไม่สร้าง/ไม่ชี้ห้องใหม่ ห้องยังอยู่กับที่มาโฆษณาเดิม', async () => {
    mockWritesSucceed();
    prisma.adsAttribution.findUnique.mockResolvedValue({ id: 'a-ads', campaignId: 'c-ads' });

    const res = await service.linkAttribution('room-1', PRODUCT_LINK, 'a-ads');

    expect(res).toBeNull();
    expectNoAttributionWrites();
  });

  it('ห้องที่ชี้ที่มาเก่าที่ไม่ใช่โฆษณา + โฆษณา ADS → attribution ใหม่ และห้องชี้ไปที่โฆษณา (อนุญาต)', async () => {
    prisma.adsCampaign.findFirst.mockResolvedValue(null);
    prisma.adsCampaign.create.mockResolvedValue({ id: 'c1', campaignName: AD.adTitle, adName: AD.adTitle, adPhotoUrl: AD.adPhotoUrl });
    prisma.adsAttribution.findUnique.mockResolvedValue({ id: 'a-legacy-link', campaignId: 'c-legacy-link' });
    prisma.adsAttribution.create.mockResolvedValue({ id: 'a-ads-new' });

    const res = await service.linkAttribution('room-1', AD, 'a-legacy-link');

    expect(prisma.adsAttribution.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ campaignId: 'c1', referrerUrl: 'ADS' }) }),
    );
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-1' }, data: { attributionId: 'a-ads-new' } });
    expect(res?.changed).toBe(true);
  });
});
