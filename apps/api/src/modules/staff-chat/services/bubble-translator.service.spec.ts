import { Test } from '@nestjs/testing';
import { BubbleTranslatorService, Bubble, QuickReply } from './bubble-translator.service';

describe('BubbleTranslatorService', () => {
  let svc: BubbleTranslatorService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [BubbleTranslatorService],
    }).compile();
    svc = mod.get(BubbleTranslatorService);
  });

  const makeBubble = (overrides: Partial<Bubble>): Bubble => ({
    id: 'b1',
    type: 'TEXT',
    channels: [],
    text: null,
    mediaUrl: null,
    thumbnailUrl: null,
    stickerPackageId: null,
    stickerId: null,
    latitude: null,
    longitude: null,
    address: null,
    locationTitle: null,
    json: null,
    ...overrides,
  });

  describe('filterByChannel', () => {
    it('includes bubbles with empty channels[] for any channel (empty = all)', () => {
      const bubbles = [makeBubble({ id: 'a', channels: [] }), makeBubble({ id: 'b', channels: [] })];
      expect(svc.filterByChannel(bubbles, 'LINE_FINANCE')).toHaveLength(2);
      expect(svc.filterByChannel(bubbles, 'FACEBOOK')).toHaveLength(2);
    });

    it('excludes bubbles whose channels[] does not include target', () => {
      const bubbles = [
        makeBubble({ id: 'line', channels: ['LINE_FINANCE'] }),
        makeBubble({ id: 'fb', channels: ['FACEBOOK'] }),
        makeBubble({ id: 'both', channels: ['LINE_FINANCE', 'FACEBOOK'] }),
      ];
      const result = svc.filterByChannel(bubbles, 'LINE_FINANCE');
      expect(result.map((b) => b.id).sort()).toEqual(['both', 'line']);
    });

    it('mixes empty-channels and explicit-channels rows correctly', () => {
      const bubbles = [
        makeBubble({ id: 'allCh', channels: [] }),
        makeBubble({ id: 'lineOnly', channels: ['LINE_FINANCE'] }),
        makeBubble({ id: 'fbOnly', channels: ['FACEBOOK'] }),
      ];
      const fb = svc.filterByChannel(bubbles, 'FACEBOOK');
      expect(fb.map((b) => b.id).sort()).toEqual(['allCh', 'fbOnly']);
    });
  });

  describe('toOutboundMessage', () => {
    it('TEXT returns { externalUserId, text }', () => {
      const b = makeBubble({ type: 'TEXT', text: 'สวัสดีค่ะ' });
      const out = svc.toOutboundMessage(b, 'U123');
      expect(out.externalUserId).toBe('U123');
      expect(out.text).toBe('สวัสดีค่ะ');
    });

    it('IMAGE returns { externalUserId, imageUrl, thumbnailUrl }', () => {
      const b = makeBubble({
        type: 'IMAGE',
        mediaUrl: 'https://cdn/x.jpg',
        thumbnailUrl: 'https://cdn/x-thumb.jpg',
      });
      const out = svc.toOutboundMessage(b, 'U123');
      expect(out.imageUrl).toBe('https://cdn/x.jpg');
      expect(out.thumbnailUrl).toBe('https://cdn/x-thumb.jpg');
    });

    it('STICKER builds sticker payload from packageId+stickerId', () => {
      const b = makeBubble({ type: 'STICKER', stickerPackageId: '11537', stickerId: '52002734' });
      const out = svc.toOutboundMessage(b, 'U123');
      expect(out.sticker).toEqual({ packageId: '11537', stickerId: '52002734' });
    });

    it('STICKER returns undefined when ids missing', () => {
      const b = makeBubble({ type: 'STICKER', stickerPackageId: null, stickerId: null });
      const out = svc.toOutboundMessage(b, 'U123');
      expect(out.sticker).toBeUndefined();
    });

    it('LOCATION builds full location object', () => {
      const b = makeBubble({
        type: 'LOCATION',
        locationTitle: 'BESTCHOICE Ladprao',
        address: 'Ladprao 122',
        latitude: 13.7,
        longitude: 100.5,
      });
      const out = svc.toOutboundMessage(b, 'U123');
      expect(out.location).toEqual({
        title: 'BESTCHOICE Ladprao',
        address: 'Ladprao 122',
        latitude: 13.7,
        longitude: 100.5,
      });
    });

    it('VIDEO returns videoUrl + thumbnailUrl', () => {
      const b = makeBubble({
        type: 'VIDEO',
        mediaUrl: 'https://cdn/v.mp4',
        thumbnailUrl: 'https://cdn/v-thumb.jpg',
      });
      const out = svc.toOutboundMessage(b, 'U123');
      expect(out.videoUrl).toBe('https://cdn/v.mp4');
      expect(out.thumbnailUrl).toBe('https://cdn/v-thumb.jpg');
    });

    it('CARD returns flexJson from bubble.json', () => {
      const cardJson = { title: 'iPhone 15', subtitle: 'จำกัด 5 เครื่อง', heroImageUrl: 'x' };
      const b = makeBubble({ type: 'CARD', json: cardJson });
      const out = svc.toOutboundMessage(b, 'U123');
      expect(out.flexJson).toEqual(cardJson);
    });

    it('JSON returns jsonPayload', () => {
      const payload = { custom: 'thing' };
      const b = makeBubble({ type: 'JSON', json: payload });
      const out = svc.toOutboundMessage(b, 'U123');
      expect(out.jsonPayload).toEqual(payload);
    });
  });

  describe('translateQuickReplies', () => {
    const makeQr = (o: Partial<QuickReply>): QuickReply => ({
      id: 'q1',
      label: 'ตกลง',
      type: 'MESSAGE',
      payload: null,
      url: null,
      message: null,
      ...o,
    });

    it('converts nulls to undefined for adapter clarity', () => {
      const qrs = [makeQr({ type: 'POSTBACK', payload: 'PAID' })];
      const out = svc.translateQuickReplies(qrs);
      expect(out[0]).toEqual({
        label: 'ตกลง',
        type: 'POSTBACK',
        payload: 'PAID',
        url: undefined,
        message: undefined,
      });
    });

    it('handles URL and MESSAGE types', () => {
      const qrs = [
        makeQr({ id: 'a', label: 'เปิดเว็บ', type: 'URL', url: 'https://bestchoice.app' }),
        makeQr({ id: 'b', label: 'พูดคุยต่อ', type: 'MESSAGE', message: 'สวัสดี' }),
      ];
      const out = svc.translateQuickReplies(qrs);
      expect(out[0].url).toBe('https://bestchoice.app');
      expect(out[1].message).toBe('สวัสดี');
    });
  });
});
