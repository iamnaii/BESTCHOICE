import { PrismaClient } from '@prisma/client';

export async function seedCollectionsFoundation(prisma: PrismaClient): Promise<void> {
  // System user — never logs in, used as actor for system-generated audit logs
  await prisma.user.upsert({
    where: { email: 'system@bestchoice.internal' },
    update: { isSystemUser: true, isActive: false },
    create: {
      email: 'system@bestchoice.internal',
      name: 'SYSTEM',
      role: 'OWNER',
      password: '__NO_LOGIN__',
      isActive: false,
      isSystemUser: true,
    },
  });

  // 8 event-triggered dunning rules (upsert by deterministic id for idempotency)
  const eventRules: Array<{
    id: string;
    name: string;
    eventTrigger:
      | 'CALL_NO_ANSWER'
      | 'CALL_ANSWERED_PROMISE'
      | 'CALL_REFUSED'
      | 'DEVICE_LOCKED'
      | 'DEVICE_UNLOCKED'
      | 'BROKEN_PROMISE'
      | 'LETTER_DISPATCHED'
      | 'CONTRACT_TERMINATED';
    channel: 'LINE' | 'SMS';
    messageTemplate: string;
    includePaymentLink: boolean;
    autoExecute: boolean;
    sortOrder: number;
  }> = [
    {
      id: 'dunning-event-CALL_NO_ANSWER',
      name: 'dunning_on_no_answer',
      eventTrigger: 'CALL_NO_ANSWER',
      channel: 'LINE',
      messageTemplate:
        'เรียน {{customerName}} เราไม่สามารถติดต่อท่านได้ กรุณาติดต่อกลับเพื่อชำระงวดที่ {{installmentNo}} ยอด {{amount}} ฿',
      includePaymentLink: true,
      autoExecute: true,
      sortOrder: 100,
    },
    {
      id: 'dunning-event-CALL_ANSWERED_PROMISE',
      name: 'dunning_confirm_promise',
      eventTrigger: 'CALL_ANSWERED_PROMISE',
      channel: 'LINE',
      messageTemplate:
        'ขอบคุณที่รับสาย กรุณาชำระยอด {{amount}} ฿ ภายใน {{settlementDate}} ผ่านลิงก์ด้านล่าง',
      includePaymentLink: true,
      autoExecute: true,
      sortOrder: 101,
    },
    {
      id: 'dunning-event-CALL_REFUSED',
      name: 'dunning_firm_warning',
      eventTrigger: 'CALL_REFUSED',
      channel: 'LINE',
      messageTemplate:
        'เรียน {{customerName}} หากไม่ชำระงวด {{installmentNo}} ยอด {{amount}} ฿ บริษัทจำเป็นต้องดำเนินการตามขั้นตอนต่อไป',
      includePaymentLink: true,
      autoExecute: true,
      sortOrder: 102,
    },
    {
      id: 'dunning-event-DEVICE_LOCKED',
      name: 'dunning_device_locked',
      eventTrigger: 'DEVICE_LOCKED',
      channel: 'LINE',
      messageTemplate:
        'เครื่องของท่านถูกล็อคและตั้ง wallpaper แจ้งเตือน กรุณาชำระยอดค้าง {{amount}} ฿ เพื่อปลดล็อคทันที',
      includePaymentLink: true,
      autoExecute: true,
      sortOrder: 103,
    },
    {
      id: 'dunning-event-DEVICE_UNLOCKED',
      name: 'dunning_device_unlocked',
      eventTrigger: 'DEVICE_UNLOCKED',
      channel: 'LINE',
      messageTemplate: 'ขอบคุณที่ชำระยอดค้างชำระ เครื่องของท่านถูกปลดล็อคเรียบร้อยแล้ว',
      includePaymentLink: false,
      autoExecute: true,
      sortOrder: 104,
    },
    {
      id: 'dunning-event-BROKEN_PROMISE',
      name: 'dunning_broken_promise',
      eventTrigger: 'BROKEN_PROMISE',
      channel: 'LINE',
      messageTemplate:
        'เรียน {{customerName}} ท่านไม่ได้ชำระตามนัดที่ {{settlementDate}} กรุณาติดต่อกลับโดยด่วน',
      includePaymentLink: true,
      autoExecute: true,
      sortOrder: 105,
    },
    {
      id: 'dunning-event-LETTER_DISPATCHED',
      name: 'dunning_letter_dispatched',
      eventTrigger: 'LETTER_DISPATCHED',
      channel: 'LINE',
      messageTemplate:
        'บริษัทได้จัดส่งหนังสือถึงท่านทางไปรษณีย์ลงทะเบียน (EMS: {{trackingNumber}}) กรุณาติดต่อกลับโดยด่วน',
      includePaymentLink: false,
      autoExecute: true,
      sortOrder: 106,
    },
    {
      id: 'dunning-event-CONTRACT_TERMINATED',
      name: 'dunning_contract_terminated',
      eventTrigger: 'CONTRACT_TERMINATED',
      channel: 'LINE',
      messageTemplate:
        'เรียน {{customerName}} สัญญาเลขที่ {{contractNumber}} ได้ถูกบอกเลิกและอยู่ระหว่างดำเนินคดีทางกฎหมาย',
      includePaymentLink: false,
      autoExecute: true,
      sortOrder: 107,
    },
  ];

  for (const rule of eventRules) {
    await prisma.dunningRule.upsert({
      where: { id: rule.id },
      update: {
        name: rule.name,
        eventTrigger: rule.eventTrigger,
        channel: rule.channel,
        messageTemplate: rule.messageTemplate,
        includePaymentLink: rule.includePaymentLink,
        autoExecute: rule.autoExecute,
        sortOrder: rule.sortOrder,
      },
      create: {
        id: rule.id,
        name: rule.name,
        triggerDay: null,
        eventTrigger: rule.eventTrigger,
        channel: rule.channel,
        messageTemplate: rule.messageTemplate,
        includePaymentLink: rule.includePaymentLink,
        autoExecute: rule.autoExecute,
        isActive: true,
        sortOrder: rule.sortOrder,
      },
    });
  }

  // 9 SystemConfig keys for MDM + letter settings
  const mdmLetterConfigs: Array<{ key: string; value: string; label: string }> = [
    {
      key: 'mdm_auto_propose_enabled',
      value: 'true',
      label: 'เปิดใช้งาน cron เสนอล็อค MDM อัตโนมัติรายวัน',
    },
    {
      key: 'mdm_uncontactable_threshold_hours',
      value: '72',
      label: 'ชั่วโมงที่ถือว่าติดต่อไม่ได้ (นับจำนวน NO_ANSWER)',
    },
    {
      key: 'mdm_no_promise_threshold_days',
      value: '3',
      label: 'จำนวนวันค้างชำระโดยไม่มีนัดชำระก่อนเสนอล็อคอัตโนมัติ',
    },
    {
      key: 'mdm_lock_wallpaper_url',
      value: '',
      label: 'URL รูป wallpaper แจ้งเตือน (S3) — ตั้งค่าโดย OWNER',
    },
    {
      key: 'letter_auto_generate_enabled',
      value: 'false',
      label: 'เปิดใช้งาน cron สร้างหนังสืออัตโนมัติรายวัน (ปิดไว้จนกว่าจะผ่านการตรวจสอบทางกฎหมาย)',
    },
    {
      key: 'letter_return_device_days',
      value: '45',
      label: 'จำนวนวันค้างชำระก่อนออกหนังสือขอคืนเครื่อง (RETURN_DEVICE_45D)',
    },
    {
      key: 'letter_termination_days',
      value: '60',
      label: 'จำนวนวันค้างชำระก่อนออกหนังสือบอกเลิกสัญญา (CONTRACT_TERMINATION_60D)',
    },
    {
      key: 'letter_signature_url',
      value: '',
      label: 'URL รูปลายเซ็นผู้มีอำนาจลงนาม (S3)',
    },
    {
      key: 'letter_letterhead_url',
      value: '',
      label: 'URL รูปหัวจดหมายบริษัท (S3) — ไม่บังคับ',
    },
  ];

  for (const cfg of mdmLetterConfigs) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      update: { label: cfg.label },
      create: { key: cfg.key, value: cfg.value, label: cfg.label },
    });
  }

  console.log(
    `  ✓ Collections foundation: 1 system user, ${eventRules.length} event rules, ${mdmLetterConfigs.length} configs`,
  );
}
