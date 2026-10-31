import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  classifyCommentIngestFailure,
  FacebookCommentIngestSkipped,
  receiveNotReadyFailure,
} from './facebook-comment-ingest-failure';

/**
 * Task 35 (owner 2026-10-31, option 4): the single place that decides whether a comment-ingest
 * failure may hold the Messenger events of the same webhook request (TRANSIENT → 5xx, Meta
 * redelivers) or not (PERMANENT → Messenger continues, 200). Unknown = TRANSIENT.
 */
describe('classifyCommentIngestFailure — one decision for every comment-ingest failure', () => {
  it('only the explicit permanent class is not retried', () => {
    const skipped = new FacebookCommentIngestSkipped('COMMENT_EVENT_MALFORMED', 'รูปแบบไม่ครบ', 2);
    expect(classifyCommentIngestFailure(skipped)).toEqual({
      retry: false,
      reasonCode: 'COMMENT_EVENT_MALFORMED',
      skippedChanges: 2,
    });
  });

  it.each([
    ['503 capability check', new ServiceUnavailableException('ตรวจสิทธิ์กับ Meta ไม่สำเร็จ')],
    ['generic 400', new BadRequestException('x')],
    ['database outage', new Error('database unavailable')],
    [
      'Prisma serialization / timeout',
      new Prisma.PrismaClientKnownRequestError('tx', { code: 'P2034', clientVersion: 'test' }),
    ],
    ['non-Error throw', 'boom'],
    ['undefined', undefined],
  ])('anything else is retried (%s)', (_label, error) => {
    expect(classifyCommentIngestFailure(error)).toEqual({ retry: true });
  });
});

describe('receiveNotReadyFailure — capability that cannot receive', () => {
  it('configuration proven incomplete → permanent, keeps the Thai reason as the message', () => {
    const error = receiveNotReadyFailure(
      {
        reason: 'ตั้งค่า Page ID, App ID, Page Access Token และ App Secret ให้ครบ',
        notReady: 'CONFIG',
      },
      3,
    );
    expect(error).toBeInstanceOf(FacebookCommentIngestSkipped);
    expect(error.message).toBe('ตั้งค่า Page ID, App ID, Page Access Token และ App Secret ให้ครบ');
    expect(classifyCommentIngestFailure(error)).toEqual({
      retry: false,
      reasonCode: 'COMMENT_CONFIG_INCOMPLETE',
      skippedChanges: 3,
    });
  });

  it('Meta answered that the token/permission/feed is not ready → permanent', () => {
    const error = receiveNotReadyFailure(
      { reason: 'ยังไม่พร้อม: …', notReady: 'META_PERMISSION' },
      1,
    );
    expect(classifyCommentIngestFailure(error)).toEqual({
      retry: false,
      reasonCode: 'COMMENT_META_NOT_READY',
      skippedChanges: 1,
    });
  });

  it('no proof (outage, unknown) → the 503 it always was', () => {
    const error = receiveNotReadyFailure(
      { reason: 'ตรวจสิทธิ์กับ Meta ไม่สำเร็จ กรุณาลองตรวจอีกครั้ง' },
      1,
    );
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.message).toBe('ตรวจสิทธิ์กับ Meta ไม่สำเร็จ กรุณาลองตรวจอีกครั้ง');
    expect(classifyCommentIngestFailure(error)).toEqual({ retry: true });
    expect(receiveNotReadyFailure({ reason: null }, 1).message).toBe(
      'ยังไม่ยืนยันสิทธิ์การเชื่อมต่อ',
    );
  });
});
