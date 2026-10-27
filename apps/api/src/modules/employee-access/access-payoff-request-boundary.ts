import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { canAccess } from '@installment/shared';
import { plainToInstance } from 'class-transformer';
import { IsString, MaxLength, validate } from 'class-validator';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { EarlyPayoffDto } from '../contracts/dto/contract.dto';
import { createEarlyPayoffRequest } from '../payments/services/early-payoff-request';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessPartySourceService } from './access-party-source.service';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';

class ManagedPayoffRequestDto extends EarlyPayoffDto {
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

@Injectable()
export class AccessPayoffRequestBoundary implements OnModuleInit {
  constructor(
    private readonly modules: ModuleRef,
    private readonly resources: AccessResourceService,
    private readonly sources: AccessPartySourceService,
  ) {}

  onModuleInit() {
    ACCESS_BOUNDARIES.set('ContractsController.earlyPayoff', async (req, snapshot) => {
      if (requestedAccessCompany(req) !== 'FINANCE')
        throw new ForbiddenException('คำขอนี้อยู่ในงานการเงิน');
      const id = String(req.params?.id ?? '');
      return {
        kind: 'selection',
        company: 'FINANCE',
        execute: async () =>
          (
            await this.resources.execute(
              snapshot.userId,
              'payments.create',
              'FINANCE',
              async (tx, current, lock) => {
                const source = await this.sources.financeContract(tx, id, lock);
                if (
                  !canAccess(current, 'contracts.read', source) ||
                  !canAccess(current, 'payments.read', source)
                )
                  throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');
                // Ordinary reads may use current case assignment; writes cannot.
                return {
                  company: 'FINANCE',
                  resources: [{ company: source.company, branchId: source.branchId }],
                  productIds: [],
                };
              },
              async () => {
                const ctx = currentDomainAccess()!;
                const tx = ctx.client;
                // This selection replaces the handler; validate its real HTTP
                // body explicitly, including inherited canonical DTO fields.
                if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
                  throw new BadRequestException('ข้อมูลคำขอไม่ถูกต้อง');
                const dto = plainToInstance(ManagedPayoffRequestDto, req.body);
                const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
                if (
                  errors.length ||
                  !dto.reason?.trim() ||
                  (dto.slipUrl !== undefined && dto.slipUrl !== '')
                )
                  throw new BadRequestException(
                    'ข้อมูลคำขอไม่ถูกต้องหรือสลิปยังไม่มีหลักฐานที่ตรวจสอบแล้ว',
                  );
                const { reason, ...payload } = dto;
                await tx.$queryRaw`SELECT id FROM payments WHERE contract_id=${id} AND deleted_at IS NULL ORDER BY id FOR SHARE`;
                await tx.$queryRaw`SELECT id FROM installment_schedules WHERE contract_id=${id} AND deleted_at IS NULL ORDER BY id FOR SHARE`;
                await tx.$queryRaw`SELECT id FROM receipts WHERE contract_id=${id} AND deleted_at IS NULL ORDER BY id FOR SHARE`;
                await tx.$queryRaw`SELECT id FROM system_config WHERE key IN ('late_fee_tier1_amount', 'late_fee_tier2_amount', 'late_fee_tier2_min_days') AND deleted_at IS NULL ORDER BY id FOR SHARE`;
                const contract = await tx.contract.findUniqueOrThrow({
                  where: { id },
                  select: { branchId: true },
                });
                const origin = await tx.branch.findUniqueOrThrow({
                  where: { id: contract.branchId },
                  select: { companyId: true },
                });
                const finance = await tx.companyInfo.findFirstOrThrow({
                  where: { companyCode: 'FINANCE', isActive: true, deletedAt: null },
                  select: { id: true },
                });
                try {
                  const request = await createEarlyPayoffRequest(
                    tx,
                    this.modules.get(ContractPaymentService, { strict: false }),
                    {
                      targetId: id,
                      userId: ctx.snapshot.userId,
                      reason,
                      payload,
                      managedSource: {
                        version: 1,
                        requesterId: ctx.snapshot.userId,
                        contractId: id,
                        financeCompanyId: finance.id,
                        originShopCompanyId: origin.companyId!,
                        originBranchId: contract.branchId,
                      },
                    },
                  );
                  return { requestId: request.id, status: 'PENDING_APPROVAL' };
                } catch (error) {
                  if (error instanceof BadRequestException || error instanceof NotFoundException)
                    throw new BadRequestException('ไม่สามารถสร้างคำขอรายการนี้ได้');
                  throw error;
                }
              },
              false,
              { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result,
      };
    });
  }
}
