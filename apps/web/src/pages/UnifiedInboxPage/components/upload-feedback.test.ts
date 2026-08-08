import { describe, it, expect } from 'vitest';
import { resolveUploadFeedback } from './upload-feedback';

describe('resolveUploadFeedback', () => {
  it('delivered:true → success (image ส่งถึงลูกค้าแล้ว)', () => {
    expect(resolveUploadFeedback({ delivered: true })).toEqual({
      kind: 'success',
      message: 'ส่งรูปให้ลูกค้าแล้ว',
    });
  });

  it('delivered:false + error → retryable (image ส่งไม่สำเร็จ, ลองใหม่ได้)', () => {
    expect(resolveUploadFeedback({ delivered: false, error: 'LINE 400' })).toEqual({
      kind: 'retryable',
      message: 'อัปโหลดแล้วแต่ส่งถึงลูกค้าไม่สำเร็จ — LINE 400',
    });
  });

  it('delivered:false, ไม่มี error → unsupported (non-image, ช่องทางไม่รองรับไฟล์ — ปกติ ไม่ใช่ error)', () => {
    expect(resolveUploadFeedback({ delivered: false })).toEqual({
      kind: 'unsupported',
      message: 'แนบไฟล์ในห้องแล้ว — ลูกค้ายังไม่ได้รับ (ช่องทางนี้ส่งไฟล์ไม่ได้)',
    });
  });
});
