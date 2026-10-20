import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PDPAConsent, Prisma } from '@prisma/client';

export const DEFAULT_PRIVACY_NOTICE = `ประกาศความเป็นส่วนตัว (Privacy Notice)

บริษัท เบสท์ช้อยส์โฟน จำกัด ("บริษัท") ให้ความสำคัญกับการคุ้มครองข้อมูลส่วนบุคคลของท่าน ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562

วัตถุประสงค์ในการเก็บรวบรวมข้อมูล:
1. เพื่อการทำสัญญาผ่อนชำระสินค้า
2. เพื่อการติดตามหนี้และบริหารสัญญา
3. เพื่อการจัดทำเอกสารทางกฎหมาย
4. เพื่อการติดต่อสื่อสารเกี่ยวกับสัญญา

ข้อมูลที่เก็บรวบรวม:
- ชื่อ-นามสกุล, เลขบัตรประชาชน
- ที่อยู่, เบอร์โทรศัพท์, อีเมล, Line ID
- ข้อมูลอาชีพและรายได้
- ข้อมูลบุคคลอ้างอิง/ผู้ค้ำประกัน
- รูปถ่ายบัตรประชาชน, รูปถ่ายลูกค้า
- ข้อมูลสินค้า (IMEI/Serial Number)

สิทธิ์ของท่านตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล:
- สิทธิ์ในการเข้าถึงข้อมูลส่วนบุคคล
- สิทธิ์ในการแก้ไขข้อมูลให้ถูกต้อง
- สิทธิ์ในการลบข้อมูล (หลังสิ้นสุดสัญญาและหมดระยะเก็บ)
- สิทธิ์ในการคัดค้านการประมวลผล
- สิทธิ์ในการโอนย้ายข้อมูล

ระยะเวลาเก็บข้อมูล:
- ตลอดอายุสัญญา + 5 ปีหลังปิดสัญญา (ตามอายุความทางกฎหมาย)

ข้าพเจ้ายินยอมให้เก็บรวบรวม ใช้ เปิดเผยข้อมูลส่วนบุคคลเพื่อวัตถุประสงค์ข้างต้น`;
export const CONTRACT_CONSENT_PURPOSES = [
  'สัญญาผ่อนชำระสินค้า',
  'ติดตามหนี้และบริหารสัญญา',
  'จัดทำเอกสารทางกฎหมาย',
  'ติดต่อสื่อสารเกี่ยวกับสัญญา',
];
export async function currentContractNotice(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT key FROM system_config WHERE key='pdpa_privacy_notice_version' FOR SHARE`;
  const config = await tx.systemConfig.findUnique({
    where: { key: 'pdpa_privacy_notice_version' },
  });
  const notice = {
    version: config?.value || '1.0',
    text: DEFAULT_PRIVACY_NOTICE,
    purposes: [...CONTRACT_CONSENT_PURPOSES],
  };
  return {
    ...notice,
    digest: createHash('sha256').update(JSON.stringify(notice), 'utf8').digest('hex'),
  };
}
export interface PresentedConsentNotice {
  presentedNoticeVersion?: string;
  presentedNoticeDigest?: string;
  acceptedPurposes?: string[];
}
export function assertPresentedNotice(
  input: PresentedConsentNotice,
  notice: Awaited<ReturnType<typeof currentContractNotice>>,
) {
  if (
    typeof input.presentedNoticeVersion !== 'string' ||
    !input.presentedNoticeVersion.trim() ||
    input.presentedNoticeVersion.length > 200 ||
    typeof input.presentedNoticeDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(input.presentedNoticeDigest) ||
    !Array.isArray(input.acceptedPurposes) ||
    input.acceptedPurposes.length !== CONTRACT_CONSENT_PURPOSES.length ||
    new Set(input.acceptedPurposes).size !== CONTRACT_CONSENT_PURPOSES.length ||
    !CONTRACT_CONSENT_PURPOSES.every((p) => input.acceptedPurposes!.includes(p))
  )
    throw new BadRequestException('กรุณายืนยันประกาศและวัตถุประสงค์ที่ลูกค้าได้รับทราบ');
  if (
    input.presentedNoticeVersion !== notice.version ||
    input.presentedNoticeDigest !== notice.digest
  )
    throw new ConflictException('ประกาศเปลี่ยนแปลง กรุณาอ่านและลงนามยินยอมใหม่');
}
export function isValidContractConsent(consent: PDPAConsent | null, customerId: string): boolean {
  return (
    !!consent &&
    consent.customerId === customerId &&
    !consent.deletedAt &&
    consent.status === 'GRANTED' &&
    !!consent.grantedAt &&
    !consent.revokedAt &&
    !!consent.consentVersion.trim() &&
    !!consent.privacyNoticeText.trim() &&
    CONTRACT_CONSENT_PURPOSES.every((p) => consent.purposes.includes(p))
  );
}
export async function linkedContractConsent(tx: Prisma.TransactionClient, id: string | null) {
  if (!id) return null;
  await tx.$queryRaw`SELECT id FROM pdpa_consents WHERE id=${id} FOR SHARE`;
  return tx.pDPAConsent.findUnique({ where: { id } });
}
export async function assertValidContractConsent(
  tx: Prisma.TransactionClient,
  contract: { customerId: string; pdpaConsentId: string | null },
) {
  if (
    !isValidContractConsent(
      await linkedContractConsent(tx, contract.pdpaConsentId),
      contract.customerId,
    )
  )
    throw new BadRequestException('ต้องได้รับความยินยอม PDPA ที่ถูกต้องจากลูกค้าของสัญญา');
}
