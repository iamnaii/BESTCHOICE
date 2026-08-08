/** Response shape from POST /staff-chat/rooms/:id/upload (Task 3 contract). */
export interface UploadFileResponse {
  delivered?: boolean;
  error?: string;
}

export type UploadFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'retryable'; message: string }
  | { kind: 'unsupported'; message: string };

/**
 * Decide what to tell the admin about an uploaded file's delivery status.
 * `delivered: false` has TWO different meanings coming out of the backend
 * (Task 3) and the UI must not conflate them:
 *   - image send failed → `error` is present → retryable, admin can try again
 *   - non-image file, channel doesn't support file bubbles (LINE has no file
 *     bubble type) → `error` is absent → normal, not a failure
 */
export function resolveUploadFeedback(res: UploadFileResponse): UploadFeedback {
  if (res?.delivered) {
    return { kind: 'success', message: 'ส่งรูปให้ลูกค้าแล้ว' };
  }
  if (res?.error) {
    return {
      kind: 'retryable',
      message: `อัปโหลดแล้วแต่ส่งถึงลูกค้าไม่สำเร็จ — ${res.error}`,
    };
  }
  return {
    kind: 'unsupported',
    message: 'แนบไฟล์ในห้องแล้ว — ลูกค้ายังไม่ได้รับ (ช่องทางนี้ส่งไฟล์ไม่ได้)',
  };
}
