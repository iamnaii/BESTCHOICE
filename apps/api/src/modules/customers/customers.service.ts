import { Injectable } from '@nestjs/common';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { FillProspectContactDto } from './dto/fill-prospect-contact.dto';
import { CustomerQueryService, type CustomersReadFilters } from './services/customer-query.service';
import { CustomerWriteService } from './services/customer-write.service';
import { CustomerAnalyticsService } from './services/customer-analytics.service';

/**
 * Facade over the decomposed customer slices. Keeps the 17-method public
 * surface intact and delegates each call to the owning sub-service:
 *
 *   - CustomerQueryService     — read path (findAll/findOne/search/getReferrals/
 *                                getSummary) + read-path PII decrypt + the
 *                                shared findOne existence-guard.
 *   - CustomerWriteService     — write path (create/
 *                                update/remove/uploadDocument/deleteDocument).
 *                                Holds the 2 $transaction write paths + the
 *                                write-path PII encrypt helpers.
 *   - CustomerAnalyticsService — $queryRaw reports + read aggregations
 *                                (getReferralStats/getUpsellCandidates/
 *                                getWatchList/getChatSummary/getRiskFlag/
 *                                getContracts).
 *
 * Behavior is byte-identical to the pre-decompose monolith. The @Optional
 * piiService + inline PII fallback live unchanged inside the Query/Write
 * slices (NOT made required — legacy specs omit it on purpose).
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly query: CustomerQueryService,
    private readonly write: CustomerWriteService,
    private readonly analytics: CustomerAnalyticsService,
  ) {}

  exportRows(filters: CustomersReadFilters) {
    return this.query.exportRows(filters);
  }

  /**
   * 🔴 ส่ง filters ทั้งก้อนต่อแบบไม่แตะต้อง — ไฟล์นี้เคยรับ 11 พารามิเตอร์เรียงตำแหน่ง
   * แล้วส่งต่อ 11 ตัวในขณะที่ findAll รับ 13 ⇒ ตัวกรองที่เพิ่มใหม่ถูกทิ้งเงียบ ๆ
   * เฉพาะขา "หน้าจอ" ส่วนขา "export" ยังเห็น ⇒ ตารางกับ Excel ให้ผลไม่ตรงกัน
   * ห้ามแตกเป็นพารามิเตอร์รายตัวอีก
   */
  findAll(filters: CustomersReadFilters) {
    return this.query.findAll(filters);
  }

  findOne(id: string) {
    return this.query.findOne(id);
  }

  getReferrals(id: string) {
    return this.query.getReferrals(id);
  }

  getReferralStats(limit = 10) {
    return this.analytics.getReferralStats(limit);
  }

  search(q: string) {
    return this.query.search(q);
  }

  create(dto: CreateCustomerDto) {
    return this.write.create(dto);
  }

  update(id: string, dto: UpdateCustomerDto) {
    return this.write.update(id, dto);
  }

  fillPlaceholderContact(id: string, dto: FillProspectContactDto, actor: { id: string; role: string }) {
    return this.write.fillPlaceholderContact(id, dto, actor);
  }

  remove(id: string) {
    return this.write.remove(id);
  }

  getContracts(id: string) {
    return this.analytics.getContracts(id);
  }

  getRiskFlag(id: string) {
    return this.analytics.getRiskFlag(id);
  }

  uploadDocument(id: string, dto: { fileName: string; fileUrl: string; mimeType: string; fileSize: number }) {
    return this.write.uploadDocument(id, dto);
  }

  deleteDocument(id: string, fileUrl: string) {
    return this.write.deleteDocument(id, fileUrl);
  }

  getUpsellCandidates(branchId?: string, limit = 20) {
    return this.analytics.getUpsellCandidates(branchId, limit);
  }

  getWatchList(branchId?: string, limit = 30) {
    return this.analytics.getWatchList(branchId, limit);
  }

  getChatSummary(customerId: string) {
    return this.analytics.getChatSummary(customerId);
  }

  getSummary(customerId: string) {
    return this.query.getSummary(customerId);
  }
}
