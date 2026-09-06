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
});
