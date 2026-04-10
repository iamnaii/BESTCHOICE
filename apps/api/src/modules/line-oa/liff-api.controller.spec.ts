import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LiffApiController } from './liff-api.controller';
import { LiffApiService } from './liff-api.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { LiffTokenGuard, LiffRequest } from './guards/liff-token.guard';
import { Request } from 'express';

function mockReq(lineId: string): Request {
  return { liffUserId: lineId } as unknown as Request;
}

describe('LiffApiController', () => {
  let controller: LiffApiController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let liffService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let paymentLinkService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let contractPaymentService: any;

  beforeEach(async () => {
    liffService = {
      findCustomerContractsFull: jest.fn(),
      isLineIdLinked: jest.fn(),
      lookupCustomerByPhone: jest.fn(),
      confirmLinkLine: jest.fn(),
      findCustomerPaymentHistory: jest.fn(),
      findCustomerProfile: jest.fn(),
      unlinkLineAccount: jest.fn(),
      findCustomerByLineId: jest.fn(),
      findContractForCustomer: jest.fn(),
      countRecentPaymentLinks: jest.fn(),
      getConsentStatus: jest.fn(),
      updateConsent: jest.fn(),
    };

    paymentLinkService = {
      createPaymentLink: jest.fn(),
    };

    contractPaymentService = {
      getEarlyPayoffQuote: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LiffApiController],
      providers: [
        { provide: LiffApiService, useValue: liffService },
        { provide: PaymentLinkService, useValue: paymentLinkService },
        { provide: ContractPaymentService, useValue: contractPaymentService },
      ],
    })
      .overrideGuard(LiffTokenGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LiffApiController>(LiffApiController);
  });

  // ─── getLiffContracts ───────────────────────────────

  describe('getLiffContracts', () => {
    it('returns contracts for valid customer', async () => {
      const mockData = { customer: { name: 'สมชาย' }, contracts: [] };
      liffService.findCustomerContractsFull.mockResolvedValue(mockData);

      const result = await controller.getLiffContracts(mockReq('U_line'));
      expect(result).toEqual(mockData);
    });

    it('throws NotFoundException when customer not found', async () => {
      liffService.findCustomerContractsFull.mockResolvedValue(null);
      await expect(controller.getLiffContracts(mockReq('U_line')))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ─── liffRegisterLookup ─────────────────────────────

  describe('liffRegisterLookup', () => {
    it('returns lookup result for valid phone', async () => {
      liffService.isLineIdLinked.mockResolvedValue(false);
      liffService.lookupCustomerByPhone.mockResolvedValue({
        customerId: 'cust1', maskedName: 'สม***',
      });

      const result = await controller.liffRegisterLookup(
        mockReq('U_line'),
        { phone: '0812345678' },
      );
      expect(result.customerId).toBe('cust1');
    });

    it('throws BadRequestException if already linked', async () => {
      liffService.isLineIdLinked.mockResolvedValue(true);
      await expect(
        controller.liffRegisterLookup(mockReq('U_line'), { phone: '0812345678' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if phone not found', async () => {
      liffService.isLineIdLinked.mockResolvedValue(false);
      liffService.lookupCustomerByPhone.mockResolvedValue(null);
      await expect(
        controller.liffRegisterLookup(mockReq('U_line'), { phone: '0899999999' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── liffRegisterConfirm ────────────────────────────

  describe('liffRegisterConfirm', () => {
    it('returns success on valid confirm', async () => {
      liffService.confirmLinkLine.mockResolvedValue({ success: true });
      const result = await controller.liffRegisterConfirm(
        mockReq('U_line'),
        { customerId: 'cust1' },
      );
      expect(result.success).toBe(true);
    });

    it('throws BadRequestException if confirm fails', async () => {
      liffService.confirmLinkLine.mockResolvedValue({ success: false, error: 'ผิดพลาด' });
      await expect(
        controller.liffRegisterConfirm(mockReq('U_line'), { customerId: 'cust1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getLiffPaymentHistory ──────────────────────────

  describe('getLiffPaymentHistory', () => {
    it('returns history for valid customer', async () => {
      const mockData = { customer: { name: 'สมชาย' }, payments: [] };
      liffService.findCustomerPaymentHistory.mockResolvedValue(mockData);

      const result = await controller.getLiffPaymentHistory(mockReq('U_line'));
      expect(result).toEqual(mockData);
    });

    it('throws NotFoundException when customer not found', async () => {
      liffService.findCustomerPaymentHistory.mockResolvedValue(null);
      await expect(controller.getLiffPaymentHistory(mockReq('U_line')))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ─── getLiffProfile ─────────────────────────────────

  describe('getLiffProfile', () => {
    it('returns profile for valid customer', async () => {
      const mockData = { name: 'สมชาย', phone: '081xxx', lineDisplayName: '-', contractCount: 2, totalPoints: 100 };
      liffService.findCustomerProfile.mockResolvedValue(mockData);

      const result = await controller.getLiffProfile(mockReq('U_line'));
      expect(result).toEqual(mockData);
    });

    it('throws NotFoundException when customer not found', async () => {
      liffService.findCustomerProfile.mockResolvedValue(null);
      await expect(controller.getLiffProfile(mockReq('U_line')))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ─── unlinkLine ─────────────────────────────────────

  describe('unlinkLine', () => {
    it('returns success on valid unlink', async () => {
      liffService.unlinkLineAccount.mockResolvedValue({ success: true });
      const result = await controller.unlinkLine(mockReq('U_line'));
      expect(result.success).toBe(true);
    });

    it('throws BadRequestException when unlink fails', async () => {
      liffService.unlinkLineAccount.mockResolvedValue({ success: false, error: 'ไม่พบ' });
      await expect(controller.unlinkLine(mockReq('U_line')))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ─── liffCreatePaymentLink ──────────────────────────

  describe('liffCreatePaymentLink', () => {
    it('creates payment link for valid contract', async () => {
      liffService.findCustomerByLineId.mockResolvedValue({ id: 'cust1', name: 'สมชาย' });
      liffService.findContractForCustomer.mockResolvedValue({ id: 'con1', contractNumber: 'BC-001' });
      liffService.countRecentPaymentLinks.mockResolvedValue(0);
      paymentLinkService.createPaymentLink.mockResolvedValue({ url: 'https://pay/tok', token: 'tok' });

      const result = await controller.liffCreatePaymentLink(
        mockReq('U_line'),
        { contractId: 'con1' },
      );
      expect(result).toEqual({ url: 'https://pay/tok', token: 'tok' });
    });

    it('throws NotFoundException when customer not found', async () => {
      liffService.findCustomerByLineId.mockResolvedValue(null);
      await expect(
        controller.liffCreatePaymentLink(mockReq('U_line'), { contractId: 'con1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when contract not owned by customer', async () => {
      liffService.findCustomerByLineId.mockResolvedValue({ id: 'cust1' });
      liffService.findContractForCustomer.mockResolvedValue(null);
      await expect(
        controller.liffCreatePaymentLink(mockReq('U_line'), { contractId: 'con_other' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when rate limited (5/24h)', async () => {
      liffService.findCustomerByLineId.mockResolvedValue({ id: 'cust1' });
      liffService.findContractForCustomer.mockResolvedValue({ id: 'con1' });
      liffService.countRecentPaymentLinks.mockResolvedValue(5);

      await expect(
        controller.liffCreatePaymentLink(mockReq('U_line'), { contractId: 'con1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getLiffEarlyPayoffQuote ─────────────────────────

  describe('getLiffEarlyPayoffQuote', () => {
    it('returns quote for active contract', async () => {
      liffService.findCustomerByLineId.mockResolvedValue({ id: 'cust1', name: 'สมชาย' });
      liffService.findContractForCustomer.mockResolvedValue({
        id: 'con1', contractNumber: 'BC-001', status: 'ACTIVE',
      });
      contractPaymentService.getEarlyPayoffQuote.mockResolvedValue({
        totalPayoff: 8500, remainingMonths: 4,
      });

      const result = await controller.getLiffEarlyPayoffQuote(mockReq('U_line'), 'con1');
      expect(result.totalPayoff).toBe(8500);
      expect(result.contractNumber).toBe('BC-001');
      expect(result.customerName).toBe('สมชาย');
    });

    it('throws BadRequestException if no contractId', async () => {
      await expect(
        controller.getLiffEarlyPayoffQuote(mockReq('U_line'), ''),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if customer not found', async () => {
      liffService.findCustomerByLineId.mockResolvedValue(null);
      await expect(
        controller.getLiffEarlyPayoffQuote(mockReq('U_line'), 'con1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for non-active contract', async () => {
      liffService.findCustomerByLineId.mockResolvedValue({ id: 'cust1', name: 'สมชาย' });
      liffService.findContractForCustomer.mockResolvedValue({
        id: 'con1', contractNumber: 'BC-001', status: 'COMPLETED',
      });

      await expect(
        controller.getLiffEarlyPayoffQuote(mockReq('U_line'), 'con1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── liffEarlyPayoff ───────────────────────────────

  describe('liffEarlyPayoff', () => {
    it('creates payoff payment link', async () => {
      liffService.findCustomerByLineId.mockResolvedValue({ id: 'cust1' });
      liffService.findContractForCustomer.mockResolvedValue({ id: 'con1', status: 'ACTIVE' });
      contractPaymentService.getEarlyPayoffQuote.mockResolvedValue({ totalPayoff: 8500 });
      paymentLinkService.createPaymentLink.mockResolvedValue({ url: 'https://pay/tok', token: 'tok' });

      const result = await controller.liffEarlyPayoff(
        mockReq('U_line'),
        { contractId: 'con1' },
      );
      expect(result).toEqual({ url: 'https://pay/tok', token: 'tok', totalPayoff: 8500 });
    });

    it('throws NotFoundException if customer not found', async () => {
      liffService.findCustomerByLineId.mockResolvedValue(null);
      await expect(
        controller.liffEarlyPayoff(mockReq('U_line'), { contractId: 'con1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if contract not owned', async () => {
      liffService.findCustomerByLineId.mockResolvedValue({ id: 'cust1' });
      liffService.findContractForCustomer.mockResolvedValue(null);
      await expect(
        controller.liffEarlyPayoff(mockReq('U_line'), { contractId: 'con_other' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for non-active contract status', async () => {
      liffService.findCustomerByLineId.mockResolvedValue({ id: 'cust1' });
      liffService.findContractForCustomer.mockResolvedValue({ id: 'con1', status: 'COMPLETED' });
      await expect(
        controller.liffEarlyPayoff(mockReq('U_line'), { contractId: 'con1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getConsentStatus ───────────────────────────────

  describe('getConsentStatus', () => {
    it('returns consent status for valid customer', async () => {
      liffService.getConsentStatus.mockResolvedValue({ consent: true, consentAt: '2026-04-10' });
      const result = await controller.getConsentStatus(mockReq('U_line'));
      expect(result.consent).toBe(true);
    });

    it('throws NotFoundException when customer not found', async () => {
      liffService.getConsentStatus.mockResolvedValue(null);
      await expect(controller.getConsentStatus(mockReq('U_line')))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateConsent ──────────────────────────────────

  describe('updateConsent', () => {
    it('returns success on valid consent grant', async () => {
      liffService.updateConsent.mockResolvedValue({ success: true });
      const result = await controller.updateConsent(mockReq('U_line'), { consent: true });
      expect(result.success).toBe(true);
      expect(result.consent).toBe(true);
    });

    it('throws BadRequestException when update fails', async () => {
      liffService.updateConsent.mockResolvedValue({ success: false, error: 'ไม่พบ' });
      await expect(
        controller.updateConsent(mockReq('U_line'), { consent: true }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
