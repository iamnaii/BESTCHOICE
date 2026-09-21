import { BadRequestException } from '@nestjs/common';
import { DeviceOrigin } from '@prisma/client';

/** Input answers must be the server-validated assessment/stored snapshot, never client labels. */
export function resolveTradeInDeviceOrigin(explicit: DeviceOrigin | null | undefined, answers: unknown): DeviceOrigin | null {
  const answer = Array.isArray(answers) ? answers.find(a => a?.questionKey === 'device-origin') : undefined;
  const label = answer?.choices?.length === 1 ? answer.choices[0]?.label : undefined;
  const assessed = typeof label === 'string'
    ? /^เครื่องนอก/.test(label.trim()) ? DeviceOrigin.IMPORTED
      : /^เครื่อง(ศูนย์)?ไทย/.test(label.trim()) ? DeviceOrigin.THAI : null
    : null;
  if (explicit && assessed && explicit !== assessed) throw new BadRequestException('ประเภทเครื่องไทย/นอกไม่ตรงกับผลตรวจสภาพ กรุณาตรวจสอบก่อนรับซื้อ');
  return explicit ?? assessed;
}
