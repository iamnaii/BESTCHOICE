import { buildFbAttribution } from './facebook-webhook.controller';

/** โครง referral ตามเอกสาร Meta: ลูกค้าใหม่จากโฆษณา → message.referral · ลูกค้าเก่า → event referral (messaging_referrals) */
describe('buildFbAttribution — แปล Messenger referral เป็นที่มาของลูกค้า', () => {
  it('โฆษณา: เก็บ ad_id + ชื่อ + รูป จาก ads_context_data โดยไม่ต้องใช้ Marketing API', () => {
    const out = buildFbAttribution({
      ref: '',
      ad_id: '120246504706250534',
      source: 'ADS',
      type: 'OPEN_THREAD',
      ads_context_data: {
        ad_title: 'ฝนตกไม่อยากออกจากบ้าน',
        photo_url: 'https://scontent.example/ad.jpg',
        post_id: '372552152915910_123',
      },
    });
    expect(out).toEqual({
      utmSource: 'facebook',
      utmCampaign: '120246504706250534',
      utmContent: undefined,
      referrerUrl: 'ADS',
      adId: '120246504706250534',
      adTitle: 'ฝนตกไม่อยากออกจากบ้าน',
      adPhotoUrl: 'https://scontent.example/ad.jpg',
      postId: '372552152915910_123',
    });
  });

  it('ไม่มีรูปนิ่ง → ใช้ thumbnail วิดีโอ · ชื่อว่าง → undefined (แผงจะใส่ fallback เอง)', () => {
    const out = buildFbAttribution({
      ad_id: 1, source: 'ADS', ads_context_data: { ad_title: '  ', video_url: 'https://v/thumb.jpg' },
    });
    expect(out?.adId).toBe('1');
    expect(out?.adTitle).toBeUndefined();
    expect(out?.adPhotoUrl).toBe('https://v/thumb.jpg');
  });

  it('m.me / ref สินค้า (ไม่ใช่โฆษณา) → ไม่มี adId แต่ยังมี utmContent=ref', () => {
    const out = buildFbAttribution({ ref: 'p:abc', source: 'SHORTLINK', type: 'OPEN_THREAD' });
    expect(out?.adId).toBeUndefined();
    expect(out?.utmCampaign).toBe('p:abc');
    expect(out?.utmContent).toBe('p:abc');
  });

  it('ไม่มี referral → undefined', () => {
    expect(buildFbAttribution(undefined)).toBeUndefined();
    expect(buildFbAttribution(null)).toBeUndefined();
  });
});
