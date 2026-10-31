import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Task 30 รอบ 3 M3 — แถว `notification_logs` ของข้อความที่ **push ถึงลูกค้าแล้ว** (หรือแถว FAILED ที่ผู้ส่งอื่นใช้ตัดสิน) — แถวพวกนี้คือ
 * หลักฐานที่การกันซ้ำ (`payment-notice-dedupe.ts`) อ่าน ⇒ ลงไม่ได้ต้อง**ไม่ทำให้ส่งซ้ำ**: ผู้เรียกแยก try ของ push ออกจาก log
 * (log พังไม่เข้าทางสำรองของการส่ง) · ที่นี่ลองลงใหม่หนึ่งครั้ง · ยังไม่ได้ = Sentry warning ระดับ warning **ไม่มี PII**
 * (ไม่มีข้อความ/ผู้รับ/ชื่อ — มีแค่ id งวด/สัญญา หัวข้อ ช่องทาง สถานะ หมวด) ให้ตามแก้ (ผู้ส่งตัวอื่นในวันเดียวกันอาจส่งซ้ำได้)
 */
export async function recordNoticeLog(
  prisma: Pick<PrismaService, 'notificationLog'>,
  data: Prisma.NotificationLogUncheckedCreateInput,
  logger: Logger,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await prisma.notificationLog.create({ data });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  // ข้อความ error ของ Prisma อาจพิมพ์ค่าที่ส่งเข้าไป (ผู้รับ/ข้อความ) ⇒ เก็บแค่รหัส/ชนิดของ error
  const reason =
    (lastError as { code?: string } | undefined)?.code ??
    (lastError instanceof Error ? lastError.name : 'unknown');
  logger.warn(
    `notification log write failed after ${data.status} (${data.subject ?? '-'} · related ${data.relatedId ?? '-'}): ${reason}`,
  );
  Sentry.captureMessage(
    'notification log write failed after the push — same-day dedupe cannot see it',
    {
      level: 'warning',
      tags: { subsystem: 'notice-log' },
      extra: {
        relatedId: data.relatedId ?? null,
        subject: data.subject ?? null,
        channel: data.channel,
        status: data.status,
        category: data.category ?? null,
        error: reason,
      },
    },
  );
}
