import { messengerEventDedupe, postbackExternalMessageId } from './facebook-messaging-dedupe';

/**
 * Task 37 — per-event dedupe key. Every input below is a Meta webhook `messaging[]` item; a redelivery is
 * the same JSON again (Meta resends the notification), so the key may use only what the event carries —
 * never the time we received it.
 */
const PSID = 'psid-key-1';
const PAGE = 'page-key-1';
const OUR_APP_ID = '1234567890';
const KEY = /^fb:(message|echo|postback|referral):[0-9a-f]{64}$/;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const postback = (over: Record<string, unknown> = {}, pb: Record<string, unknown> = {}) => ({
  sender: { id: PSID },
  recipient: { id: PAGE },
  timestamp: 1790000000000,
  postback: { mid: 'm_pb_1', title: 'เริ่มต้นใช้งาน', payload: 'GET_STARTED', ...pb },
  ...over,
});
const referral = (over: Record<string, unknown> = {}, ref: Record<string, unknown> = {}) => ({
  sender: { id: PSID },
  recipient: { id: PAGE },
  timestamp: 1790000000000,
  referral: { ref: 'p:abc', source: 'SHORTLINK', type: 'OPEN_THREAD', ...ref },
  ...over,
});

describe('messengerEventDedupe', () => {
  it('customer message → keyed by message.mid', () => {
    const event = {
      sender: { id: PSID },
      recipient: { id: PAGE },
      timestamp: 1,
      message: { mid: 'm_1', text: 'hi' },
    };
    const d = messengerEventDedupe(event);
    expect(d?.kind).toBe('message');
    expect(d?.key).toMatch(KEY);
    expect(messengerEventDedupe(clone(event))?.key).toBe(d?.key);
    expect(messengerEventDedupe({ ...event, message: { mid: 'm_2', text: 'hi' } })?.key).not.toBe(
      d?.key,
    );
    // same mid, other timestamp (Meta never changes a message's mid) → same message
    expect(messengerEventDedupe({ ...event, timestamp: 2 })?.key).toBe(d?.key);
  });

  it('message without mid → no key (nothing stable)', () => {
    expect(
      messengerEventDedupe({ sender: { id: PSID }, timestamp: 1, message: { text: 'hi' } }),
    ).toBeNull();
  });

  it('external echo → keyed by mid · our own echo or one without recipient → none', () => {
    const echo = {
      sender: { id: PAGE },
      recipient: { id: PSID },
      timestamp: 1,
      message: { is_echo: true, app_id: 99, mid: 'm_e' },
    };
    expect(messengerEventDedupe(echo, OUR_APP_ID)).toEqual({
      kind: 'echo',
      key: expect.stringMatching(KEY),
    });
    expect(messengerEventDedupe(echo)).toEqual({ kind: 'echo', key: expect.stringMatching(KEY) });
    expect(
      messengerEventDedupe(
        { ...echo, message: { ...echo.message, app_id: Number(OUR_APP_ID) } },
        OUR_APP_ID,
      ),
    ).toBeNull();
    expect(messengerEventDedupe({ ...echo, recipient: undefined }, OUR_APP_ID)).toBeNull();
    // echo and an inbound message never share a key even if Meta reused a mid string
    expect(messengerEventDedupe(echo)?.key).not.toBe(
      messengerEventDedupe({ sender: { id: PSID }, message: { mid: 'm_e' } })?.key,
    );
  });

  it('postback: the same event (redelivery) → the same key', () => {
    const d = messengerEventDedupe(postback());
    expect(d?.kind).toBe('postback');
    expect(d?.key).toMatch(KEY);
    expect(messengerEventDedupe(clone(postback()))?.key).toBe(d?.key);
    // Meta's reference example sends timestamp as a string — same value, same key
    expect(messengerEventDedupe(postback({ timestamp: '1790000000000' }))?.key).toBe(d?.key);
    // the CTA title is not part of the identity
    expect(messengerEventDedupe(postback({}, { title: 'Get Started' }))?.key).toBe(d?.key);
  });

  it('postback: any change in sender, page, timestamp, mid or payload → another event', () => {
    const base = messengerEventDedupe(postback())?.key;
    const variants = [
      postback({ sender: { id: 'psid-other' } }),
      postback({ recipient: { id: 'page-other' } }),
      postback({ timestamp: 1790000000001 }),
      postback({}, { mid: 'm_pb_2' }),
      postback({}, { payload: 'TEMPLATE:x' }),
    ];
    for (const v of variants) expect(messengerEventDedupe(v)?.key).not.toBe(base);
  });

  it('postback without mid keys on sender + timestamp + payload · without mid and timestamp → none', () => {
    const noMid = postback({}, { mid: undefined });
    expect(messengerEventDedupe(noMid)?.key).toMatch(KEY);
    expect(messengerEventDedupe(clone(noMid))?.key).toBe(messengerEventDedupe(noMid)?.key);
    expect(messengerEventDedupe(postback({ timestamp: undefined }, { mid: undefined }))).toBeNull();
    // mid alone (no timestamp) is still stable
    expect(messengerEventDedupe(postback({ timestamp: undefined }))?.key).toMatch(KEY);
  });

  it('standalone referral: same event → same key · other ref/ad/timestamp → other key · no timestamp → none', () => {
    const d = messengerEventDedupe(referral());
    expect(d?.kind).toBe('referral');
    expect(messengerEventDedupe(clone(referral()))?.key).toBe(d?.key);
    expect(messengerEventDedupe(referral({}, { ref: 'p:def' }))?.key).not.toBe(d?.key);
    expect(messengerEventDedupe(referral({}, { ad_id: '1202' }))?.key).not.toBe(d?.key);
    expect(messengerEventDedupe(referral({ timestamp: 1790000000001 }))?.key).not.toBe(d?.key);
    expect(messengerEventDedupe(referral({ timestamp: undefined }))).toBeNull();
  });

  it('events with no side effect we gate → none (read, delivery, no sender)', () => {
    expect(
      messengerEventDedupe({ sender: { id: PSID }, timestamp: 1, read: { watermark: 1 } }),
    ).toBeNull();
    expect(
      messengerEventDedupe({ sender: { id: PSID }, timestamp: 1, delivery: { mids: ['m'] } }),
    ).toBeNull();
    expect(messengerEventDedupe({ timestamp: 1, message: { mid: 'm' } })).toBeNull();
    expect(messengerEventDedupe(null)).toBeNull();
  });

  it('the stored key carries no PSID, payload or mid in clear', () => {
    const all = [
      messengerEventDedupe(postback({}, { payload: 'TEMPLATE:secret-payload' })),
      messengerEventDedupe(referral()),
      messengerEventDedupe({ sender: { id: PSID }, message: { mid: 'm_clear_mid' } }),
    ].map((d) => d?.key ?? '');
    for (const k of all) {
      expect(k).not.toContain(PSID);
      expect(k).not.toContain('secret-payload');
      expect(k).not.toContain('m_clear_mid');
      expect(k).not.toContain('p:abc');
    }
  });
});

describe('postbackExternalMessageId', () => {
  it('uses Meta’s event timestamp + sender (stable across redelivery), not the clock', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1790000099999);
    expect(postbackExternalMessageId(postback())).toBe(`postback_1790000000000_${PSID}`);
    nowSpy.mockRestore();
  });

  it('no timestamp → postback.mid · neither → previous behaviour (clock)', () => {
    expect(postbackExternalMessageId(postback({ timestamp: undefined }))).toBe('postback_m_pb_1');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1790000099999);
    expect(postbackExternalMessageId(postback({ timestamp: undefined }, { mid: undefined }))).toBe(
      `postback_1790000099999_${PSID}`,
    );
    nowSpy.mockRestore();
  });
});
