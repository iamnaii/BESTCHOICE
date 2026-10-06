import { readFileSync } from 'fs';
import { join } from 'path';
import type { InboundAttribution } from '../interfaces/channel-adapter.interface';
import { AD_REFERRAL_SOURCE, isAdAttribution } from './ad-attribution.util';

/**
 * นับเป็นโฆษณาเฉพาะ referral.source = 'ADS' (เจ้าของเคาะ 2026-09-15 ข้อ 7)
 * ด่านเดียวของ linkAttribution / recordAdReferral / โน้ต "ลูกค้าทักจากโฆษณา"
 */
describe('isAdAttribution', () => {
  it('AD_REFERRAL_SOURCE = ADS (ค่า Meta referral.source ของโฆษณาจริง)', () => {
    expect(AD_REFERRAL_SOURCE).toBe('ADS');
  });

  it.each<[string, boolean]>([
    ['ADS', true],
    ['SHORTLINK', false],
    ['ads', false],
    ['', false],
  ])('referrerUrl %p → %p (เทียบตรงตัว ไม่แปลงตัวพิมพ์)', (referrerUrl, expected) => {
    expect(isAdAttribution({ referrerUrl })).toBe(expected);
  });

  it('ไม่มี referrerUrl / ไม่มี attribution → ไม่ใช่โฆษณา', () => {
    expect(isAdAttribution({ referrerUrl: undefined })).toBe(false);
    expect(isAdAttribution({})).toBe(false);
    expect(isAdAttribution(null)).toBe(false);
    expect(isAdAttribution(undefined)).toBe(false);
  });

  it('มี adId แต่ source ไม่ใช่ ADS → ไม่ใช่โฆษณา (ไม่ถอยไปดู adId)', () => {
    const shortlinkWithAdId: InboundAttribution = {
      utmSource: 'facebook',
      referrerUrl: 'SHORTLINK',
      adId: '120246504706250534',
    };
    const adIdOnly: InboundAttribution = { utmSource: 'facebook', adId: '120246504706250534' };
    expect(isAdAttribution(shortlinkWithAdId)).toBe(false);
    expect(isAdAttribution(adIdOnly)).toBe(false);
  });

  it('journey-state.sql (CTE earliest_room) join ที่มาด้วย literal เดียวกับ AD_REFERRAL_SOURCE — แก้ต้องแก้คู่', () => {
    const sql = readFileSync(join(__dirname, '../../customer-journey/sql/journey-state.sql'), 'utf8');
    expect(sql).toContain(
      `LEFT JOIN ads_attributions aa ON aa.id = ro.attribution_id AND aa.referrer_url = '${AD_REFERRAL_SOURCE}'`,
    );
  });
});
