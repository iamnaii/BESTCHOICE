import { ChatChannel, MessageType } from '@prisma/client';
import { FacebookAdapter, isOutsideWindowError, formatFbError } from './facebook.adapter';
import type { OutboundMessage } from '../chat-engine/interfaces/channel-adapter.interface';
import type { IntegrationConfigService } from '../integrations/integration-config.service';

/**
 * หน้าต่าง 24 ชม. ของ Messenger
 *
 * เดิม adapter ฝัง `messaging_type: 'RESPONSE'` ตายตัว ⇒ ลูกค้าที่เงียบเกิน 24 ชม. ตอบจากระบบเรา
 * ไม่ได้เลย ขณะที่แอป Facebook ของ Meta เองตอบได้ถึง 7 วัน (prod: 8,703 จาก 8,789 ห้องอยู่นอก
 * หน้าต่าง) — ย้ายทีมมาใช้ระบบเรา = หน้าต่างตอบหดจาก 7 วันเหลือ 24 ชม.
 */

// รูป error จริงที่ Graph API ตอบเมื่อส่งนอกหน้าต่าง
const OUTSIDE_WINDOW = JSON.stringify({
  error: {
    message:
      '(#10) This message is sent outside of allowed window. Learn more about the new policy here: https://developers.facebook.com/docs/messenger-platform/policy-overview',
    type: 'OAuthException',
    code: 10,
    error_subcode: 2018278,
  },
});

// code 10 ตัวเดียวกัน แต่เป็นเรื่องสิทธิ์ของ token ไม่ใช่หน้าต่างเวลา
const PERMISSION_DENIED = JSON.stringify({
  error: {
    message: '(#10) Application does not have permission for this action',
    type: 'OAuthException',
    code: 10,
  },
});

const TOKEN_EXPIRED = JSON.stringify({
  error: { message: 'Error validating access token', type: 'OAuthException', code: 190 },
});

function textMessage(text: string): OutboundMessage {
  return { channel: ChatChannel.FACEBOOK, type: MessageType.TEXT, externalUserId: 'psid1', text };
}

function makeAdapter() {
  const integrationConfig = {
    getConfig: jest.fn().mockResolvedValue({ pageAccessToken: 'tok', pageId: 'page1' }),
  } as unknown as IntegrationConfigService;
  return new FacebookAdapter(integrationConfig);
}

function response(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(body),
    json: jest.fn().mockResolvedValue(JSON.parse(body)),
  };
}

describe('isOutsideWindowError', () => {
  it('จับ subcode 2018278 ได้', () => {
    expect(isOutsideWindowError(OUTSIDE_WINDOW)).toBe(true);
  });

  it('ไม่นับ code 10 ที่เป็นเรื่องสิทธิ์ของ token', () => {
    // ถ้านับรวม จะไปลองแท็กซ้ำโดยเปล่าประโยชน์ แล้วบอกผิดว่าเพจยังไม่ได้รับอนุมัติ Human Agent
    expect(isOutsideWindowError(PERMISSION_DENIED)).toBe(false);
  });

  it('ไม่นับ token หมดอายุ', () => {
    expect(isOutsideWindowError(TOKEN_EXPIRED)).toBe(false);
  });

  it('ไม่พังเมื่อ body ไม่ใช่ JSON', () => {
    expect(isOutsideWindowError('<html>502 Bad Gateway</html>')).toBe(false);
  });
});

describe('formatFbError', () => {
  it('ใส่หัว fb:<code>:<subcode> ให้ฝั่งเว็บแปลเป็นไทยได้', () => {
    expect(formatFbError(OUTSIDE_WINDOW)).toMatch(/^fb:10:2018278 /);
  });

  it('ไม่มี subcode ใส่แค่ fb:<code>', () => {
    expect(formatFbError(TOKEN_EXPIRED)).toMatch(/^fb:190 /);
  });

  it('body ที่ไม่ใช่ JSON คืนค่าเดิม', () => {
    expect(formatFbError('boom')).toBe('boom');
  });
});

describe('FacebookAdapter.sendMessage — หน้าต่าง 24 ชม.', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

  it('ในหน้าต่าง 24 ชม. ส่งแบบ RESPONSE ครั้งเดียว ไม่มีอะไรเปลี่ยน', async () => {
    fetchMock.mockResolvedValueOnce(response(200, JSON.stringify({ message_id: 'm1' })));

    const result = await makeAdapter().sendMessage(textMessage('สวัสดีครับ'));

    expect(result).toEqual({ success: true, externalMessageId: 'm1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(0).messaging_type).toBe('RESPONSE');
    expect(bodyOf(0).tag).toBeUndefined();
  });

  it('พ้น 24 ชม. → ลองซ้ำด้วยแท็ก HUMAN_AGENT แล้วส่งสำเร็จ', async () => {
    fetchMock
      .mockResolvedValueOnce(response(400, OUTSIDE_WINDOW))
      .mockResolvedValueOnce(response(200, JSON.stringify({ message_id: 'm2' })));

    const result = await makeAdapter().sendMessage(textMessage('ยังสนใจอยู่ไหมครับ'));

    expect(result).toEqual({ success: true, externalMessageId: 'm2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(1)).toMatchObject({
      messaging_type: 'MESSAGE_TAG',
      tag: 'HUMAN_AGENT',
      recipient: { id: 'psid1' },
      message: { text: 'ยังสนใจอยู่ไหมครับ' },
    });
  });

  it('ลองแท็กแล้วยังไม่ผ่าน → บอกชัดว่าลองแล้ว ไม่ใช่ขึ้นแค่ "พ้น 24 ชม."', async () => {
    fetchMock
      .mockResolvedValueOnce(response(400, OUTSIDE_WINDOW))
      .mockResolvedValueOnce(response(400, OUTSIDE_WINDOW));

    const result = await makeAdapter().sendMessage(textMessage('x'));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^fb:10:2018278 /);
    expect(result.error).toContain('ลองแท็ก HUMAN_AGENT แล้วยังไม่ผ่าน');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('error อื่นที่ไม่ใช่หน้าต่างเวลา → ไม่ลองซ้ำ', async () => {
    fetchMock.mockResolvedValueOnce(response(400, TOKEN_EXPIRED));

    const result = await makeAdapter().sendMessage(textMessage('x'));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^fb:190 /);
    expect(result.error).not.toContain('HUMAN_AGENT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('code 10 ที่เป็นเรื่องสิทธิ์ → ไม่ลองซ้ำด้วยแท็ก', async () => {
    fetchMock.mockResolvedValueOnce(response(400, PERMISSION_DENIED));

    const result = await makeAdapter().sendMessage(textMessage('x'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error).not.toContain('HUMAN_AGENT');
  });
});
