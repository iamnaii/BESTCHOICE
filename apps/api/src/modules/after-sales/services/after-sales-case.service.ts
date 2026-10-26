import { AfterSalesMutationAcknowledgement } from '../../employee-access/access-after-sales-action';
import { canAccess } from '@installment/shared';
import { createHash } from 'node:crypto';
import { AccessResourceService } from '../../employee-access/access-resource.service';
import { AccessRepairSourceService } from '../../employee-access/access-repair-source.service';
import { AccessExchangeSourceService } from '../../employee-access/access-exchange-source.service';
import { procurementPreparation } from '../../employee-access/access-preparation-context';
import { afterSalesActor } from '../../employee-access/access-after-sales-source.service';
import {
  domainAccessClient,
  currentDomainAccess,
  onDomainCommit,
} from '../../employee-access/access-execution-context';
import { hasGlobalOpenAfterSalesCase } from './after-sales-stage-reconcile';
import { ChatServiceCaseLinkService } from './chat-service-case-link.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AfterSalesOutcome, AfterSalesStage } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import {
  CreateRepairTicketDto,
  RepairPayerInput,
} from '../../repair-tickets/dto/create-repair-ticket.dto';
import { DefectExchangeService } from '../../defect-exchange/defect-exchange.service';
import { AfterSalesDocNumberService } from './after-sales-doc-number.service';
import { AfterSalesLookupService, LookupResult } from './after-sales-lookup.service';
import { AfterSalesLineService } from './after-sales-line.service';
import { reconcileStage, RECONCILE_SELECT } from './after-sales-stage-reconcile';
import { WINDOW_REASON_RE } from '../utils/after-sales-outcomes.util';
import { assertCashReplacement } from '../utils/assert-cash-replacement';
import type { AfterSalesLineMoment } from '../utils/after-sales-line-copy.util';
import { CreateCaseDto } from '../dto/create-case.dto';
import { assertEvidenceImage, evidenceImageExtension } from '../../../utils/upload-image.util';
import { hashLockKey } from '../../../utils/advisory-lock.util';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import { deviceSwapClosed } from '../../contract-exchange/device-swap-closed.policy';

type ReqUser = { id: string; role: string; branchId?: string | null };

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export const MAX_INTAKE_PHOTOS = 6;

export interface CreateCaseResult {
  id: string;
  caseNumber: string;
  repairTicketId: string | null;
  outcome: AfterSalesOutcome;
  exchangeRequestId: string | null;
  stage: AfterSalesStage;
}

@Injectable()
export class AfterSalesCaseService {
  constructor(
    private readonly basePrisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly repair: RepairTicketsService,
    private readonly docNumber: AfterSalesDocNumberService,
    private readonly lookupSvc: AfterSalesLookupService,
    private readonly defect: DefectExchangeService,
    private readonly line: AfterSalesLineService,
    @Optional() private readonly chatLinks?: ChatServiceCaseLinkService,
    @Optional() private readonly resources?: AccessResourceService,
    @Optional() private readonly repairAccess?: AccessRepairSourceService,
    @Optional() private readonly exchangeAccess?: AccessExchangeSourceService,
  ) {}

  private get prisma() {
    return domainAccessClient(this.basePrisma);
  }

  // R29 (fix round 1) — ฟิลด์ที่ REPAIR กับกิ่งเปลี่ยนเครื่องเหมือนกันทุกประการ (~15 ฟิลด์)
  // เคยก็อปสองชุดโดยไม่มีอะไรบังคับให้ตรงกัน — รวมเป็นจุดเดียว ต่างกันแค่ที่มาของ device*
  // (REPAIR อ่านจาก repair ticket ที่ผ่าน createInTx แล้ว ส่วนเปลี่ยนเครื่องอ่านจาก look/dto ตรงๆ)
  private buildBaseCaseData(params: {
    id: string;
    caseNumber: string;
    dto: CreateCaseDto;
    customerId: string;
    look: LookupResult;
    user: ReqUser;
    deviceBrand: string | null | undefined;
    deviceModel: string | null | undefined;
    deviceImei: string | null | undefined;
    deviceSerial: string | null | undefined;
    photoKeys: string[];
    purchasePhotoKeys: string[];
  }) {
    const { id, caseNumber, dto, customerId, look, user, photoKeys, purchasePhotoKeys } = params;
    return {
      id,
      caseNumber,
      branchId: dto.branchId,
      customerId,
      source: look.source,
      contractId: look.contract?.id ?? null,
      saleId: look.sale?.id ?? null,
      productId: look.product?.id ?? null,
      deviceBrand: params.deviceBrand,
      deviceModel: params.deviceModel,
      deviceImei: params.deviceImei,
      deviceSerial: params.deviceSerial,
      symptom: dto.symptom,
      accessories: dto.accessories ?? {},
      unlockConfirmed: dto.unlockConfirmed,
      photoKeys,
      purchasePhotoKeys,
      warrantySnapshot: {
        ...look.warranty,
        within7Days: look.warranty.daysRemainingIn7Day > 0,
      },
      receivedById: user.id,
    };
  }

  private async preflight(dto: CreateCaseDto, files: Express.Multer.File[], user: ReqUser) {
    const ctx = await afterSalesActor(this.basePrisma, user.id, this.prisma);
    if (ctx) {
      if (
        !this.resources ||
        !this.repairAccess ||
        !this.exchangeAccess ||
        ctx.scope.permission !== 'after-sales.create'
      )
        throw new ForbiddenException('ต้องตรวจแหล่งรับฝาก');
      const source = await this.resources.branch(ctx.client, dto.branchId, true);
      if (source.company !== 'SHOP' || !canAccess(ctx.snapshot, 'after-sales.create', source))
        throw new ForbiddenException('ไม่มีสิทธิ์รับฝากที่สาขานี้');
    }
    // R16 (fix round 1, Critical) — BranchGuard อ่าน request.body?.branchId แต่ guards รันก่อน
    // FilesInterceptor แกะ multipart/form-data เสร็จ ⇒ ตอนถึง guard body ยังว่าง (ไม่มี branchId
    // ให้เห็น) จึงปล่อยผ่านเสมอบน POST /after-sales — ต้องบังคับ scope สาขาที่ service เอง ก่อนแตะ
    // storage/lookup/tx ใด ๆ (แบบเดียวกับ security.md "Branch scope บน route ที่มีแต่ :id")
    if (!currentDomainAccess() && !hasCrossBranchAccess(user) && dto.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถเข้าถึงสาขาอื่นได้');
    }
    // DTO ไม่บังคับ UUID แล้ว (seed ใช้ `branch-001`) — ตรวจว่าสาขามีจริงแทน ให้ role ข้ามสาขาที่ส่ง
    // รหัสมั่วได้ 400 ภาษาไทย แทน FK error ตอนสร้างแถว
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('ไม่พบสาขา');
    if (!files?.length) throw new BadRequestException('ต้องมีรูปตอนรับฝากอย่างน้อย 1 รูป');
    if (files.length > MAX_INTAKE_PHOTOS) {
      throw new BadRequestException(`รูปตอนรับฝากได้ไม่เกิน ${MAX_INTAKE_PHOTOS} รูป`);
    }
    files.forEach((f) => assertEvidenceImage(f, 'รูปตอนรับฝาก'));

    const look = currentDomainAccess()
      ? await this.lookupSvc.lookupForCreation(
          { imei: dto.imei },
          user,
          dto.outcome,
          dto.replacementProductId,
        )
      : await this.lookupSvc.lookup({ imei: dto.imei }, user);
    const customerId = look.customer?.id ?? dto.customerId;
    if (!customerId) throw new BadRequestException('ไม่พบเครื่องในระบบ — ต้องเลือกลูกค้า');
    const outcome = look.outcomes.find((o) => o.outcome === dto.outcome);
    if (!outcome?.enabled)
      throw new BadRequestException(outcome?.reason ?? 'ทางออกนี้ทำไม่ได้กับเครื่องนี้');

    // Task 4 — เปิดทางออกเปลี่ยนเครื่องตอนแจ้งปัญหา (SAME_MODEL_EXCHANGE — PRICED_EXCHANGE ถูกปิด 410 ด้านบน)
    const isSameModel = dto.outcome === 'SAME_MODEL_EXCHANGE';
    // PR 5 — เปลี่ยนรุ่นเดิมขายสด: ไม่มีสัญญา ด่านเครื่องทดแทนเป็น assertCashReplacement (ตัวเดียวกับตอนยืนยัน)
    // (PRICED_EXCHANGE ปิด 410 ตั้งแต่ต้นเมธอด 2026-10-06 จึงไม่มีกิ่งของมันที่นี่)
    const isCashSameModel = dto.outcome === 'CASH_SAME_MODEL_EXCHANGE';
    if ((isSameModel || isCashSameModel) && !dto.replacementProductId) {
      throw new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก');
    }
    if (isSameModel && !look.contract) {
      throw new BadRequestException('ทางออกนี้ใช้ได้กับสัญญาผ่อนเท่านั้น');
    }
    if (isCashSameModel && (!look.sale || look.contract || !look.product)) {
      throw new BadRequestException('ทางออกนี้ใช้ได้กับใบขายสด/ไฟแนนซ์นอกเท่านั้น');
    }
    // R28 — ข้อมูลเครื่องทดแทน (สำหรับข้อความ event OUTCOME_SET ของ (a)) ต้องมาจากการค้นจริง
    // ไม่ใช่จาก DefectExchangeService.checkEligibility ซึ่งไม่คืน imeiSerial กลับมา
    let replacementProduct: {
      brand: string;
      model: string;
      storage: string | null;
      imeiSerial: string | null;
    } | null = null;
    if (isSameModel) {
      const elig = currentDomainAccess()
        ? await this.defect.checkCreationEligibility(
            look.contract!.id,
            dto.replacementProductId,
            user,
          )
        : await this.defect.checkEligibility(look.contract!.id, dto.replacementProductId);
      // I1 — กติกาเปลี่ยนรุ่นเดิมของ engine คงเดิมทุกข้อ (spec §4.3): ผจก. ข้ามได้ "เฉพาะกรอบ 7 วัน"
      // (ตัดสินตอนยืนยัน) — เหตุผลอื่นทุกข้อ (PHONE_USED · สถานะสัญญา · เครดิตเทิร์น · เครื่องใหม่
      // ไม่พร้อมขาย · รุ่น/ความจุไม่ตรง) บล็อกตั้งแต่ตอนแจ้ง
      const blocking = elig.reasons.filter((r) => !WINDOW_REASON_RE.test(r));
      if (!elig.newProduct || blocking.length) {
        throw new BadRequestException(
          blocking[0] ?? 'เครื่องทดแทนไม่ตรงรุ่น/ความจุ หรือไม่พร้อมขาย',
        );
      }
      replacementProduct = await this.prisma.product.findUnique({
        where: { id: dto.replacementProductId, deletedAt: null },
        select: { brand: true, model: true, storage: true, imeiSerial: true },
      });
    }
    if (isCashSameModel) {
      const p = await assertCashReplacement(
        this.prisma,
        {
          sale: { id: look.sale!.id, productId: look.product!.id, customerId },
          caseBranchId: dto.branchId,
        },
        dto.replacementProductId!,
      );
      replacementProduct = {
        brand: p.brand,
        model: p.model,
        storage: p.storage,
        imeiSerial: p.imeiSerial,
      };
    }

    const imei = look.product?.imeiSerial ?? dto.imei;
    const requestFingerprint = dto.serviceRequestId
      ? await this.chatLinks!.candidateForCreation(
          dto.serviceRequestId,
          {
            branchId: dto.branchId,
            customerId,
            productId: look.product?.id ?? null,
            contractId: look.contract?.id ?? null,
            saleId: look.sale?.id ?? null,
            deviceImei: imei,
          },
          user,
        )
      : undefined;
    if (ctx) {
      const input = {
        branchId: dto.branchId,
        customerId,
        productId: look.product?.id,
        contractId: look.contract?.id,
        repairSupplierId: dto.repairSupplierId,
      };
      if (dto.outcome === 'REPAIR')
        await this.repairAccess!.resolve(
          ctx.client,
          ctx.snapshot,
          'repair-tickets.create',
          'create',
          undefined,
          input,
          true,
        );
      else if (dto.outcome === 'CASH_SAME_MODEL_EXCHANGE')
        // PR 5 cash swap is sale-sourced: the managed exchange boundary authorizes contract
        // sources only (confirm/deliver deny it too) ⇒ fail closed until a sale-source rule exists.
        throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการในแหล่งนี้');
      else {
        await this.repairAccess!.linked(ctx.client, ctx.snapshot, input, true);
        this.exchangeAccess!.assert(
          dto.outcome === 'SAME_MODEL_EXCHANGE'
            ? 'defect-exchanges.create'
            : 'contract-exchanges.create',
          await this.exchangeAccess!.sources({
            oldContractId: look.contract!.id,
            oldProductId: look.product!.id,
            newProductId: dto.replacementProductId,
          }),
        );
      }
    }
    const sourceFingerprint = ctx
      ? {
          product: look.product
            ? await ctx.client.product.findUnique({
                where: { id: look.product.id },
                select: { branchId: true, ownedByCompanyId: true },
              })
            : null,
          sale: look.sale
            ? await ctx.client.sale.findUnique({
                where: { id: look.sale.id },
                select: { branchId: true, customerId: true, contractId: true, productId: true },
              })
            : null,
          contract: look.contract
            ? await ctx.client.contract.findUnique({
                where: { id: look.contract.id },
                select: { branchId: true, customerId: true, productId: true },
              })
            : null,
          replacement: dto.replacementProductId
            ? await ctx.client.product.findUnique({
                where: { id: dto.replacementProductId },
                select: { branchId: true, ownedByCompanyId: true },
              })
            : null,
        }
      : undefined;
    return {
      look,
      customerId,
      outcome,
      isSameModel,
      isCashSameModel,
      replacementProduct,
      imei,
      requestFingerprint,
      sourceFingerprint,
    };
  }
  private fingerprint(input: {
    look: LookupResult;
    customerId: string;
    replacementProduct: unknown;
  }) {
    const { warranty, ...look } = input.look;
    const stableWarranty = { ...warranty, checkedAt: undefined };
    return createHash('sha256')
      .update(JSON.stringify({ ...input, look: { ...look, warranty: stableWarranty } }))
      .digest('hex');
  }

  async createCase(dto: CreateCaseDto, files: Express.Multer.File[], user: ReqUser) {
    // คำตัดสินเจ้าของ 2026-10-06 — เมนูเปลี่ยนเครื่องแบบมีราคาปิดทั้งหมด: 410 ตั้งแต่บรรทัดแรก ก่อนแตะ
    // สาขา/รูป/lookup/storage/tx/engine (DTO ยังรับค่า PRICED_EXCHANGE เพื่อให้ไคลเอนต์เก่าได้ข้อความชี้ทาง)
    // — ทั้งผู้ใช้ทั่วไปและ managed actor (ก่อนเข้า preparation/preflight ใด ๆ)
    if (dto.outcome === 'PRICED_EXCHANGE') throw deviceSwapClosed();
    return this.createAttempt(dto, files, user);
  }
  private async createAttempt(
    dto: CreateCaseDto,
    files: Express.Multer.File[],
    user: ReqUser,
    prepared?: {
      id: string;
      fingerprint: string;
      photoKeys: string[];
      purchasePhotoKeys: string[];
    },
  ): Promise<CreateCaseResult | AfterSalesMutationAcknowledgement> {
    const preparation = procurementPreparation.getStore();
    if (preparation && !prepared) {
      const initial = await preparation.execute(async () => {
        if (dto.serviceRequestId) {
          if (!this.chatLinks) throw new BadRequestException('ระบบเชื่อมใบรับเรื่องยังไม่พร้อม');
          const existing = await this.chatLinks!.existingForCreation(dto.serviceRequestId, user);
          if (existing) return { existing };
        }
        return { input: await this.preflight(dto, files, user) };
      });
      if (initial.existing) return { id: initial.existing.id, stage: initial.existing.stage };
      const input = initial.input!;
      const id = randomUUID(),
        owned: string[] = [],
        photoKeys: string[] = [],
        purchasePhotoKeys: string[] = [];
      const put = async (key: string, buffer: Buffer, mime: string) => {
        owned.push(key);
        await this.storage.upload(key, buffer, mime);
        return key;
      };
      try {
        // Validate every copied image before the first external storage call.
        const copies = ANGLES.flatMap((angle) => {
          const value = input.look.purchasePhotos?.[angle];
          if (!value) return [];
          const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
          if (!match) throw new BadRequestException('รูปต้นทางไม่ถูกต้อง');
          const file = {
            buffer: Buffer.from(match[2], 'base64'),
            mimetype: match[1],
          } as Express.Multer.File;
          assertEvidenceImage(file, 'รูปต้นทาง');
          return [{ angle, file }];
        });
        for (const file of files)
          photoKeys.push(
            await put(
              `after-sales/${id}/intake-${randomUUID()}.${evidenceImageExtension(file.mimetype)}`,
              file.buffer,
              file.mimetype,
            ),
          );
        for (const { angle, file } of copies)
          purchasePhotoKeys.push(
            await put(
              `after-sales/${id}/purchase-${angle}.${evidenceImageExtension(file.mimetype)}`,
              file.buffer,
              file.mimetype,
            ),
          );
        const result = await preparation.execute(() =>
          this.createAttempt(dto, files, user, {
            id,
            fingerprint: this.fingerprint(input),
            photoKeys,
            purchasePhotoKeys,
          }),
        );
        if (result.id !== id)
          await Promise.all(owned.map((key) => this.storage.delete(key).catch(() => undefined)));
        return { id: result.id, stage: result.stage };
      } catch (error) {
        await Promise.all(owned.map((key) => this.storage.delete(key).catch(() => undefined)));
        throw error;
      }
    }
    const managed = await afterSalesActor(this.basePrisma, user.id, this.prisma);
    if (managed && !prepared) throw new ForbiddenException('ต้องเตรียมรับฝากนอกธุรกรรม');
    if (dto.serviceRequestId) {
      if (!this.chatLinks) throw new BadRequestException('ระบบเชื่อมใบรับเรื่องยังไม่พร้อม');
      const existing = await this.chatLinks.existingForCreation(dto.serviceRequestId, user);
      if (existing) return existing;
    }
    const input = await this.preflight(dto, files, user);
    const { look, customerId, outcome, isSameModel, isCashSameModel, replacementProduct, imei } =
      input;
    if (look.openCase) {
      if (dto.serviceRequestId) {
        const existing = await this.chatLinks!.existingForCreation(dto.serviceRequestId, user);
        if (existing) return existing;
      }
      throw new ConflictException(
        `เครื่องนี้มีเคสที่ยังไม่ปิดอยู่แล้ว: ${look.openCase.caseNumber}`,
      );
    }
    if (prepared && prepared.fingerprint !== this.fingerprint(input))
      throw new ConflictException('ข้อมูลรับฝากเปลี่ยน กรุณาลองใหม่');
    const id = prepared?.id ?? randomUUID();
    const uploaded: string[] = [];
    const put = async (key: string, buf: Buffer, mime: string) => {
      await this.storage.upload(key, buf, mime);
      uploaded.push(key);
      return key;
    };

    let result: CreateCaseResult;
    let reusedChatCase = false;
    try {
      // R14: sequential — ทุก key ที่อัปโหลดสำเร็จต้องถูกจดไว้ใน `uploaded` ก่อนไฟล์ถัดไป
      // (Promise.all ปล่อยให้ upload ที่ยังไม่ resolve ตอนตัวอื่นพัง หลุดจากการ cleanup)
      const photoKeys: string[] = prepared?.photoKeys ?? [];
      for (const f of prepared ? [] : files) {
        photoKeys.push(
          await put(
            `after-sales/${id}/intake-${Date.now()}-${randomUUID()}.${evidenceImageExtension(f.mimetype)}`,
            f.buffer,
            f.mimetype,
          ),
        );
      }

      const purchasePhotoKeys: string[] = prepared?.purchasePhotoKeys ?? [];
      for (const angle of prepared ? [] : ANGLES) {
        // สำเนา ProductPhoto (data URL) ณ วันแจ้ง — D6
        const dataUrl = look.purchasePhotos?.[angle];
        if (!dataUrl) continue;
        const [head, b64] = dataUrl.split(',');
        const mime = /^data:(image\/[a-z]+);base64$/.exec(head)?.[1] ?? 'image/jpeg';
        purchasePhotoKeys.push(
          await put(
            `after-sales/${id}/purchase-${angle}.${evidenceImageExtension(mime)}`,
            Buffer.from(b64, 'base64'),
            mime,
          ),
        );
      }

      result = await this.prisma.$transaction(async (tx) => {
        if (dto.serviceRequestId) {
          const existing = await this.chatLinks!.creationInTx(tx, dto.serviceRequestId, user);
          if (existing) {
            reusedChatCase = true;
            return existing;
          }
        }
        // R12 — re-check ภายใน tx ด้วย advisory lock ก่อน nextCaseNumber (กัน 2 คำขอพร้อมกันสำหรับ IMEI เดียวกัน
        // ทั้งคู่ผ่าน pre-tx fast-path แล้วคอมมิตสำเร็จทั้งคู่ — Review Focus 2)
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${hashLockKey(`as-imei:${imei}`)})`,
        );
        // A1 (final-fix brief) — โหลดผู้สมัคร stored-open ของ IMEI นี้พร้อมใบซ่อม แล้ว reconcile
        // ทีละแถวก่อนตัดสิน "ยังเปิดอยู่จริงไหม" — stage ที่เก็บไว้อาจดริฟท์จากใบซ่อมจริง (sync()
        // ของ proxy ไม่เคยรัน เพราะใบซ่อมถูกแก้นอก proxy) ไม่งั้น IMEI นี้จะถูกบล็อก 409 ตลอดไป
        // แม้เคสเก่าจะปิดไปแล้วจริง ๆ
        if (currentDomainAccess()) {
          if (await hasGlobalOpenAfterSalesCase(tx, imei))
            throw new ConflictException('เครื่องนี้มีเคสที่ยังไม่ปิด');
        } else {
          const candidates = await tx.afterSalesCase.findMany({
            where: { deviceImei: imei, deletedAt: null, stage: { notIn: ['CLOSED', 'CANCELLED'] } },
            select: { ...RECONCILE_SELECT, caseNumber: true },
          });
          const reconciledCandidates = await Promise.all(
            candidates.map((c) => reconcileStage(tx, c)),
          );
          const stillOpen = reconciledCandidates.find(
            (c) => !['CLOSED', 'CANCELLED'].includes(c.stage),
          );
          if (stillOpen)
            throw new ConflictException(
              `เครื่องนี้มีเคสที่ยังไม่ปิดอยู่แล้ว: ${stillOpen.caseNumber}`,
            );
        }
        const caseNumber = await this.docNumber.nextCaseNumber(tx);
        const receivedEvent = {
          kind: 'RECEIVED' as const,
          actorId: user.id,
          note: `รับเรื่องแล้ว · รูป ${photoKeys.length} · รูปตอนซื้อ ${purchasePhotoKeys.length}`,
        };

        if (dto.outcome === 'REPAIR') {
          const repairDto: CreateRepairTicketDto = {
            customerId,
            contractId: look.contract?.id,
            productId: look.product?.id,
            branchId: dto.branchId,
            deviceBrand: look.product?.brand ?? dto.deviceBrand,
            deviceModel: look.product?.model ?? dto.deviceModel,
            deviceImei: imei,
            deviceSerial: dto.deviceSerial,
            defectDescription: dto.symptom,
            payer: (dto.payer ?? outcome.payerDefault) as RepairPayerInput,
            estimatedCost: dto.estimatedCost,
            repairSupplierId: dto.repairSupplierId,
            notes: dto.note,
          };
          const { ticket } = await this.repair.createInTx(repairDto, user, tx);
          const c = await tx.afterSalesCase.create({
            data: {
              ...this.buildBaseCaseData({
                id,
                caseNumber,
                dto,
                customerId,
                look,
                user,
                deviceBrand: ticket.deviceBrand,
                deviceModel: ticket.deviceModel,
                deviceImei: ticket.deviceImei,
                deviceSerial: ticket.deviceSerial,
                photoKeys,
                purchasePhotoKeys,
              }),
              outcome: 'REPAIR',
              repairTicketId: ticket.id,
              stage: 'RECEIVED',
              events: {
                create: [
                  receivedEvent,
                  {
                    kind: 'OUTCOME_SET',
                    actorId: user.id,
                    note: `ซ่อม · ผู้จ่าย ${ticket.payer}${ticket.repairSupplierId ? ' · ส่งศูนย์' : ' · ซ่อมที่ร้าน'}`,
                  },
                ],
              },
            },
            select: { id: true, caseNumber: true, repairTicketId: true },
          });
          const repairResult: CreateCaseResult = {
            id: c.id,
            caseNumber: c.caseNumber,
            repairTicketId: c.repairTicketId,
            outcome: 'REPAIR',
            exchangeRequestId: null,
            stage: 'RECEIVED',
          };
          if (dto.serviceRequestId)
            await this.chatLinks!.linkInTx(tx, {
              requestId: dto.serviceRequestId,
              caseId: c.id,
              actor: user,
            });
          return repairResult;
        }

        // กิ่งเปลี่ยนเครื่อง (SAME_MODEL_EXCHANGE / CASH_SAME_MODEL_EXCHANGE) — ไม่เรียก repair.createInTx
        // events: RECEIVED เสมอ + OUTCOME_SET (ผ่อน/ขายสด — ข้อความ (a)) · PRICED_EXCHANGE ปิด 410 ตั้งแต่ต้นเมธอด
        // (2026-10-06) จึงไม่มีกิ่ง submit หลัง commit อีกต่อไป
        const exchangeEvents = isSameModel || isCashSameModel
          ? [
              receivedEvent,
              {
                kind: 'OUTCOME_SET' as const,
                actorId: user.id,
                note: `เปลี่ยนรุ่นเดิม · รอ ผจก.สาขา ยืนยัน · เครื่องทดแทน ${replacementProduct?.brand ?? ''} ${replacementProduct?.model ?? ''} ${replacementProduct?.storage ?? ''} IMEI ${replacementProduct?.imeiSerial ?? ''}`,
              },
            ]
          : [receivedEvent];
        const c = await tx.afterSalesCase.create({
          data: {
            ...this.buildBaseCaseData({
              id,
              caseNumber,
              dto,
              customerId,
              look,
              user,
              deviceBrand: look.product?.brand ?? dto.deviceBrand,
              deviceModel: look.product?.model ?? dto.deviceModel,
              deviceImei: imei,
              deviceSerial: dto.deviceSerial,
              photoKeys,
              purchasePhotoKeys,
            }),
            outcome: dto.outcome,
            repairTicketId: null,
            replacementProductId: dto.replacementProductId,
            stage: 'AWAITING_APPROVAL',
            events: { create: exchangeEvents },
          },
          select: { id: true, caseNumber: true },
        });
        const exchangeResult: CreateCaseResult = {
          id: c.id,
          caseNumber: c.caseNumber,
          repairTicketId: null,
          outcome: dto.outcome,
          exchangeRequestId: null,
          stage: 'AWAITING_APPROVAL',
        };
        if (dto.serviceRequestId)
          await this.chatLinks!.linkInTx(tx, {
            requestId: dto.serviceRequestId,
            caseId: c.id,
            actor: user,
          });
        return exchangeResult;
      });
    } catch (err) {
      await Promise.all(uploaded.map((k) => this.storage.delete(k).catch(() => undefined)));
      throw err;
    }

    // A competing request may have uploaded temporary images before winning the room lock.
    // Discard only this attempt's uploads and skip all document/LINE/exchange side effects.
    if (reusedChatCase) {
      await Promise.all(uploaded.map((k) => this.storage.delete(k).catch(() => undefined)));
      return result;
    }

    // R13 — audit.log อยู่นอก try/catch: ถ้ามันเองพังหลัง tx commit แล้ว ต้องไม่ไปลบรูปของ
    // เคสที่บันทึกสำเร็จแล้ว (catch ด้านบนมีไว้กัน storage/tx เท่านั้น)
    const auditEntry = {
      userId: user.id,
      action: 'AFTER_SALES_CASE_CREATED',
      entity: 'after_sales_case',
      entityId: result.id,
      newValue: {
        caseNumber: result.caseNumber,
        outcome: dto.outcome,
        repairTicketId: result.repairTicketId,
        exchangeRequestId: result.exchangeRequestId,
      },
    };
    if (currentDomainAccess()) await this.audit.log(auditEntry, currentDomainAccess()!.client);
    else await this.audit.log(auditEntry);

    // Task 3 — จังหวะ 1 (RECEIVED): หลัง commit + audit เสมอ — ทุก outcome ที่ยังเปิด (REPAIR = RECEIVED ·
    // SAME_MODEL = AWAITING_APPROVAL; PRICED_EXCHANGE ปิด 410 ตั้งแต่ต้นเมธอด จึงไม่มีจังหวะ READY/CLOSED
    // ต่อท้ายตอนสร้างเคสอีก). fire-and-forget: LINE ล้มต้องไม่ทำให้การบันทึกล้ม (Global Constraints) —
    // `.catch` เป็นเข็มขัดคู่กับ notifyMoment เองที่ไม่ throw. Managed: ส่งหลัง owned execution commit.
    const notify = () =>
      this.line.notifyMoment(result.id, 'RECEIVED', user.id).catch(() => undefined);
    if (currentDomainAccess())
      onDomainCommit(async () => {
        await notify();
      });
    else void notify();

    return result;
  }
}
