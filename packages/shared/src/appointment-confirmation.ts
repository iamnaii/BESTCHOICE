export type AppointmentMessageKind = 'BOOKED' | 'RESCHEDULED' | 'CANCELED';
export function appointmentConfirmationText(
  visit: {
    reference: string;
    startsAt: string | Date;
    endsAt: string | Date;
    branch: { name: string; location?: string | null; phone?: string | null };
  },
  kind: AppointmentMessageKind = 'BOOKED',
) {
  const date = new Date(visit.startsAt).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = (value: string | Date) =>
    new Date(value).toLocaleTimeString('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
    });
  return [
    kind === 'CANCELED'
      ? 'BESTCHOICE ยืนยันยกเลิกนัดหมาย'
      : kind === 'RESCHEDULED'
        ? 'BESTCHOICE ยืนยันการเลื่อนนัดหมาย'
        : 'BESTCHOICE ยืนยันนัดหมายเข้าร้านแล้วครับ',
    `วันที่ ${date}`,
    `เวลา ${time(visit.startsAt)}–${time(visit.endsAt)} น.`,
    `สาขา ${visit.branch.name}`,
    `เลขนัด ${visit.reference}`,
    ...(kind !== 'CANCELED' && visit.branch.location
      ? [
          `แผนที่: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(visit.branch.location)}`,
        ]
      : []),
    ...(visit.branch.phone ? [`ติดต่อสาขา ${visit.branch.phone}`] : []),
    kind === 'CANCELED'
      ? 'หากต้องการนัดใหม่ เปิดลิงก์นัดหมายเดิมหรือติดต่อสาขาได้ครับ'
      : 'เมื่อถึงร้าน แจ้งเลขนัดกับพนักงานได้เลยครับ หากต้องการเลื่อนหรือยกเลิก เปิดลิงก์นัดหมายเดิมหรือติดต่อสาขา',
  ].join('\n');
}
