import { AccessResource, Company } from '@installment/shared';
import { ContractJournalSources, JournalIdentity } from './access-contract-journal-sources';
import {
  ADVANCE_CONSUME_ON_ACCRUAL_FLOW,
  RESCHEDULE_PARK_CONSUME_FLOW,
} from '../journal/reconstruct-prior';
import { receiptAccrualReference } from '../journal/cpa-templates/installment-accrual-2a.template';
import {
  INSTALLMENT_INPUT_VAT_FLOW,
  INSTALLMENT_INPUT_VAT_TAG,
  installmentInputVatKey,
} from '../journal/cpa-templates/installment-input-vat.template';
import {
  LEGACY_OPENING_FLOW,
  LEGACY_PRIOR_RECEIPT_FLOW,
  LEGACY_VAT_CATCHUP_FLOW,
} from '../accounting/peak-export-exclusion';
import {
  LEGACY_OPENING_TAG,
  LEGACY_PRIOR_RECEIPT_TAG,
  LEGACY_VAT_CATCHUP_TAG,
  legacyOpeningReference,
  legacyPriorReceiptReference,
  legacyVatCatchUpReference,
} from '../journal/legacy-import-journal';

export interface ProvenContractJournal {
  entry: JournalIdentity;
  source: AccessResource;
  label: string;
  paymentId?: string;
  originalId?: string;
}
const uuid = (s: string | null | undefined) =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const money = (s: string | null | undefined) => !!s && /^\d{1,12}\.\d{2}$/.test(s);
const day = (s: string | null | undefined) =>
  !!s && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
const buckets = new Set(['CURRENT', '1-30', '31-60', '61-90', '91-180', '180+']);

/** Finite producer-specific source proofs; no monetary engine and no generic
 * interpretation of metadata as authorization. Every supporting row is locked. */
export class ContractJournalProof {
  private readonly byId: Map<string, JournalIdentity>;
  private readonly cache = new Map<string, ProvenContractJournal | null>();
  constructor(
    private readonly contractId: string,
    private readonly entries: JournalIdentity[],
    private readonly sources: ContractJournalSources,
    private readonly books: Map<string, Company>,
  ) {
    this.byId = new Map(entries.map((entry) => [entry.id, entry]));
  }
  private auto(e: JournalIdentity, reference: string) {
    return e.referenceType === 'AUTO' && e.referenceId === reference;
  }
  private markedPair(
    original: JournalIdentity,
    reversal: JournalIdentity,
    flow: string,
    suffix: string,
  ) {
    const m = reversal.meta;
    return (
      original.companyId === reversal.companyId &&
      original.meta.reversed === 'true' &&
      original.meta.reversedByEntryNumber === reversal.entryNumber &&
      m.tag === 'REVERSAL' &&
      m.flow === flow &&
      m.originalEntryId === original.id &&
      (!m.contractId || m.contractId === this.contractId) &&
      this.auto(reversal, `${original.id}:${suffix}`)
    );
  }
  /** Pair identity and current typed source only. Never calls prove(), so an
   * original with a cleared backlink and its reversal cannot authorize each
   * other recursively. Both admission paths apply this exact same validator. */
  private pairValid(original: JournalIdentity, reversal: JournalIdentity): boolean {
    const m = reversal.meta,
      id = this.contractId,
      s = this.sources;
    if (
      original.id === reversal.id ||
      original.companyId !== reversal.companyId ||
      original.meta.tag === 'REVERSAL' ||
      original.meta.flow === 'shop-down-payment-reversal'
    )
      return false;
    if (m.flow === 'shop-down-payment-reversal') {
      return (
        this.books.get(reversal.companyId) === 'SHOP' &&
        m.tag === 'SHOP_DOWN_PAYMENT_REVERSAL' &&
        m.contractId === id &&
        m.originalJournalEntryId === original.id &&
        this.auto(reversal, `contract:${id}:down-reversal`) &&
        original.meta.flow === 'shop-down-payment' &&
        !!m.idempotencyKey &&
        m.idempotencyKey === m.reversedByBatchId &&
        m.idempotencyKey === original.meta.reversedByIdempotencyKey
      );
    }
    if (m.flow === 'receipt-void' || m.flow === 'refund-reversal') {
      return (
        this.markedPair(original, reversal, m.flow, 'void') &&
        m.originalEntryNumber === original.entryNumber &&
        original.meta.flow === 'payment-receipt'
      );
    }
    if (m.flow === 'receipt-accrual-void') {
      return (
        this.markedPair(original, reversal, m.flow, 'accrual-void') &&
        m.originalEntryNumber === original.entryNumber &&
        original.meta.tag === '2A' &&
        m.idempotencyKey === `${m.flow}:${original.id}`
      );
    }
    if (m.flow === 'defect-exchange')
      return this.markedPair(original, reversal, m.flow, 'reversal') && this.defect();
    if (
      m.flow === 'exchange-cancel' ||
      m.flow === 'contract-cancellation' ||
      m.flow === 'shop-trade-in-credit-released'
    ) {
      return (
        this.markedPair(original, reversal, m.flow, m.flow) &&
        m.reversesEntryId === original.id &&
        m.idempotencyKey === `${m.flow === 'exchange-cancel' ? 'cancel' : m.flow}:${original.id}` &&
        (m.flow === 'exchange-cancel'
          ? s.exchanges.some((r) => r.reversalJeIds.includes(reversal.id) && this.exchangeValid(r))
          : m.flow === 'contract-cancellation'
            ? s.cancellations.some((r) => r.status === 'APPROVED')
            : original.meta.flow === 'shop-trade-in-credit-applied' &&
              s.redemptions.some(
                (r) => r.applicationJournalEntryId === original.id && r.releasedAt,
              ))
      );
    }
    return false;
  }
  private historyReversed(e: JournalIdentity) {
    return this.entries.some(
      (r) =>
        [
          'receipt-accrual-void',
          'contract-cancellation',
          'exchange-cancel',
          'defect-exchange',
        ].includes(r.meta.flow ?? '') && this.pairValid(e, r),
    );
  }
  private recallOrigin(e: JournalIdentity, depth: number) {
    return this.entries.some((reversal) => {
      const m = reversal.meta;
      if (
        reversal.companyId !== e.companyId ||
        m.contractId !== this.contractId ||
        m.shopReceivableType !== 'PAYOUT_RECALL' ||
        !['contract-cancellation', 'exchange-cancel'].includes(m.flow ?? '')
      )
        return false;
      const original = this.byId.get(m.originalEntryId ?? '');
      if (!original || !this.pairValid(original, reversal)) return false;
      if (
        m.flow === 'exchange-cancel' &&
        !this.sources.exchanges.some(
          (request) =>
            request.newContractId === this.contractId &&
            request.status === 'CANCELED' &&
            request.cancelWindow === 'AFTER_PAYOUT' &&
            request.reversalJeIds.includes(reversal.id) &&
            this.exchangeValid(request),
        )
      )
        return false;
      // Validate the original once; pairValid is nonrecursive. This keeps the
      // SHOP cash -> FINANCE SCS -> originating original dependency bounded,
      // independent of candidate ordering and without a reversal/original cycle.
      const proven = this.prove(original, depth + 1);
      return !!proven && !proven.originalId;
    });
  }
  private defect() {
    const old = this.sources.contracts.find((c) => c.id === this.contractId);
    return (
      !!old &&
      this.sources.defects.some((a) => {
        const m = a.newValue as Record<string, unknown> | null;
        const next = this.sources.contracts.find((c) => c.id === a.entityId);
        return (
          !!next &&
          next.parentContractId === old.id &&
          m?.oldContractId === old.id &&
          m.newContractId === next.id &&
          m.oldProductId === old.productId &&
          m.newProductId === next.productId
        );
      })
    );
  }
  prove(e: JournalIdentity, depth = 0): ProvenContractJournal | null {
    if (this.cache.has(e.id)) return this.cache.get(e.id)!;
    if (depth > 2) return null;
    const result = this.check(e, depth);
    if (depth === 0) this.cache.set(e.id, result);
    return result;
  }
  private check(e: JournalIdentity, depth: number): ProvenContractJournal | null {
    const s = this.sources,
      m = e.meta,
      id = this.contractId;
    const book = this.books.get(e.companyId);
    const contract = s.contracts.find((c) => c.id === id);
    if (
      !book ||
      !contract ||
      e.entryNumber.length === 0 ||
      e.entryNumber.length > 128 ||
      (e.referenceId?.length ?? 0) > 350
    )
      return null;
    const result = (
      label: string,
      extras: Partial<ProvenContractJournal> = {},
    ): ProvenContractJournal => ({ entry: e, source: { company: book }, label, ...extras });
    const auto = (ref: string) => this.auto(e, ref);
    const is = (tag: string | null, flow: string | null) => m.tag === tag && m.flow === flow;
    const original = this.byId.get(m.originalEntryId ?? m.originalJournalEntryId ?? '');
    if (m.tag === 'REVERSAL' || m.flow === 'shop-down-payment-reversal') {
      if (!original || original.id === e.id || original.companyId !== e.companyId) return null;
      const proven = this.prove(original, depth + 1);
      if (!proven || proven.originalId) return null;
      return this.pairValid(original, e)
        ? result('กลับรายการบัญชี', { source: proven.source, originalId: original.id })
        : null;
    }
    if (m.contractId !== id) return null;
    const schedule = s.schedules.find(
      (r) => r.id === m.installmentScheduleId && r.contractId === id,
    );
    const payment = s.payments.find((r) => r.id === m.paymentId && r.contractId === id);
    const repo = s.repos.find(
      (r) =>
        r.contractId === id &&
        r.productId === contract.productId &&
        s.products.some((p) => p.id === r.productId),
    );
    const deviceReturn = s.returns.find(
      (r) =>
        r.id === m.deviceReturnId &&
        r.contractId === id &&
        r.productId === contract.productId &&
        r.repossessionId === repo?.id,
    );
    const validDevice = !!repo && (!m.deviceReturnId || !!deviceReturn);
    const settlementKey = m.requestId || (money(m.amount) ? m.amount : null);
    const validSettlement = !!settlementKey && (m.requestId ? uuid(m.requestId) : true);
    if (book === 'FINANCE') {
      if (is('1A', null) && auto(id)) return result('เปิดสัญญา');
      if (m.tag === '2A' && !m.flow && schedule) {
        const ref = e.referenceId ?? '';
        const prefix = `${schedule.id}:receipt-accrual:`;
        const k = ref.startsWith(prefix) ? ref.slice(prefix.length) : '';
        if (
          m.portion === 'partial' &&
          /^[1-9]\d{0,8}$/.test(k) &&
          auto(receiptAccrualReference(schedule.id, Number(k)))
        )
          return result('ตั้งลูกหนี้งวดบางส่วน');
        const n = ref.startsWith(`${schedule.id}:re-accrual:`)
          ? ref.slice(`${schedule.id}:re-accrual:`.length)
          : '';
        if (
          (!m.portion || m.portion === 'remainder') &&
          (auto(schedule.id) ||
            (/^[1-9]\d{0,8}$/.test(n) && auto(`${schedule.id}:re-accrual:${n}`))) &&
          (schedule.accrualJournalEntryId === e.entryNumber || this.historyReversed(e))
        )
          return result('ตั้งลูกหนี้งวด');
      }
      if (
        m.tag === '2B' &&
        schedule &&
        [ADVANCE_CONSUME_ON_ACCRUAL_FLOW, RESCHEDULE_PARK_CONSUME_FLOW].includes(m.flow ?? '') &&
        auto(`${schedule.id}:${m.flow}`)
      )
        return result('ตัดเงินรับล่วงหน้า');
      // ตัวนำเข้าระบบเก่า (cli/legacy-backoffice/writer.ts) — สัญญาที่มีเลขสัญญาเดิมเท่านั้น · reference ผูกเลขเดิม/แถวงวดของสัญญานี้
      const legacyCode = contract.legacyContractCode;
      if (legacyCode) {
        if (
          is(LEGACY_OPENING_TAG, LEGACY_OPENING_FLOW) &&
          m.idempotencyKey === legacyCode &&
          auto(legacyOpeningReference(legacyCode))
        )
          return result('ยอดยกมาจากระบบเก่า');
        if (
          schedule &&
          is(LEGACY_PRIOR_RECEIPT_TAG, LEGACY_PRIOR_RECEIPT_FLOW) &&
          !m.paymentId &&
          auto(legacyPriorReceiptReference(schedule.id))
        )
          return result('ยอดรับก่อนวันตัดระบบ (ระบบเก่า)');
        if (
          is(LEGACY_VAT_CATCHUP_TAG, LEGACY_VAT_CATCHUP_FLOW) &&
          auto(legacyVatCatchUpReference(legacyCode))
        )
          return result('ไล่ภาษีขายงวดค้างก่อนวันตัดระบบ');
      }
      if (
        is('receipt', 'payment-receipt') &&
        e.referenceType === 'AUTO' &&
        uuid(e.referenceId) &&
        schedule &&
        payment &&
        payment.installmentNo === schedule.installmentNo &&
        s.receipts
          .filter((r) => r.sourceJournalEntryId === e.id)
          .every((r) => r.contractId === id && r.paymentId === payment.id)
      )
        return result('รับชำระค่างวด', { paymentId: payment.id });
      if (
        is('overpayment-credit', null) &&
        e.referenceType === 'AUTO' &&
        uuid(e.referenceId) &&
        (payment || m.paymentId === id)
      )
        return result('เงินเกินชำระ', payment ? { paymentId: payment.id } : {});
      if (
        is('reschedule-collect', 'reschedule-collect') &&
        e.referenceType === 'AUTO' &&
        uuid(e.referenceId) &&
        payment &&
        ['6a', '6b'].includes(m.variant ?? '') &&
        (!m.installmentScheduleId || (schedule && schedule.installmentNo === payment.installmentNo))
      )
        return result('รับชำระปรับดิว', { paymentId: payment.id });
      if (
        is('paysolutions-surplus-advance', null) &&
        m.refno &&
        auto(`${m.refno}-surplus`) &&
        s.links.some((l) => l.token === m.refno && l.contractId === id)
      )
        return result('เงินรับล่วงหน้า');
      if (
        is('JP4', 'early-payoff') &&
        auto(`${id}:early-payoff`) &&
        s.evidence.every(
          (v) =>
            v.financeCompanyId === e.companyId &&
            v.receiptId &&
            s.receipts.some((r) => r.id === v.receiptId && r.contractId === id) &&
            (!v.requestId || s.approvals.some((a) => a.id === v.requestId && a.contractId === id)),
        )
      )
        return result('ปิดยอดก่อนกำหนด');
      if (is('JP5', 'repossession') && auto(`${id}:repossession`) && validDevice)
        return result('รับเครื่องคืน');
      if (
        is('6a', 'reschedule-fee') &&
        e.referenceType === 'AUTO' &&
        e.referenceId?.startsWith(`${id}:reschedule-fee:`) &&
        /^\d{10,16}$/.test(e.referenceId.slice(`${id}:reschedule-fee:`.length))
      )
        return result('รับค่าธรรมเนียมปรับดิว');
      if (
        schedule &&
        ((is('6b', 'reschedule-bundled') && auto(`${schedule.id}:bundled`)) ||
          (is('6a', 'reschedule-final') && auto(`${schedule.id}:final-consumption`)))
      )
        return result('รับชำระปรับดิว');
      if (
        schedule &&
        is('VAT60-MANDATORY', 'mandatory') &&
        auto(`${schedule.id}:vat60-mandatory`) &&
        (schedule.vat60dayJournalEntryId === e.entryNumber ||
          this.entries.some(
            (r) =>
              r.companyId === e.companyId &&
              r.meta.tag === 'VAT60-REVERSAL' &&
              r.meta.flow === 'reversal' &&
              r.meta.contractId === id &&
              r.meta.installmentScheduleId === schedule.id &&
              r.meta.reversesEntry === e.entryNumber &&
              this.auto(r, `${schedule.id}:vat60-reversal`),
          ))
      )
        return result('ภาษีค้างชำระ 60 วัน');
      if (
        schedule &&
        is('VAT60-REVERSAL', 'reversal') &&
        auto(`${schedule.id}:vat60-reversal`) &&
        this.entries.some(
          (r) =>
            r.companyId === e.companyId &&
            r.entryNumber === m.reversesEntry &&
            r.meta.tag === 'VAT60-MANDATORY' &&
            r.meta.flow === 'mandatory' &&
            r.meta.contractId === id &&
            r.meta.installmentScheduleId === schedule.id &&
            this.auto(r, `${schedule.id}:vat60-mandatory`),
        )
      )
        return result('กลับภาษีค้างชำระ 60 วัน');
      if (
        is(INSTALLMENT_INPUT_VAT_TAG, INSTALLMENT_INPUT_VAT_FLOW) &&
        auto(installmentInputVatKey(id)) &&
        m.idempotencyKey === installmentInputVatKey(id) &&
        contract.inputVatJournalEntryId === e.id &&
        m.productId === contract.productId &&
        s.products.some((p) => p.id === m.productId) &&
        s.receivingItems.some(
          (i) =>
            i.productId === m.productId &&
            i.receivingId === m.receivingId &&
            s.receivings.some(
              (r) =>
                r.id === i.receivingId &&
                s.purchaseOrders.some(
                  (po) =>
                    po.id === r.poId &&
                    s.suppliers.some((supplier) => supplier.id === po.supplierId),
                ),
            ),
        )
      )
        return result('ภาษีซื้อสินค้าผ่อน');
      if (
        is('BAD-DEBT', 'provision') &&
        day(m.runDate) &&
        ['increase', 'release'].includes(m.direction ?? '') &&
        m.idempotencyKey === `${id}:${m.runDate}` &&
        auto(`${id}:bad-debt-provision:${m.runDate}`)
      )
        return result('สำรองหนี้สงสัยจะสูญ');
      if (
        is('BAD-DEBT', 'write-off') &&
        auto(`${id}:bad-debt-write-off`) &&
        m.idempotencyKey === id &&
        s.writeoffs.length
      )
        return result('ตัดหนี้สูญ');
      if (
        is('ECL-STAGE-REVERSE', 'stage-reverse') &&
        ((buckets.has(m.fromBucket ?? '') && buckets.has(m.toBucket ?? '')) ||
          (m.fromBucket === 'CANCEL' &&
            m.toBucket === 'CANCEL' &&
            s.cancellations.some((row) => row.status === 'APPROVED'))) &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(m.period ?? '')
      ) {
        const prefix = `${id}:ecl-stage-reverse:${m.period}:${m.fromBucket}-${m.toBucket}:`;
        if (
          e.referenceType === 'AUTO' &&
          e.referenceId?.startsWith(prefix) &&
          /^\d{10,16}$/.test(e.referenceId.slice(prefix.length))
        )
          return result('กลับสำรองหนี้สงสัยจะสูญ');
      }
      if (
        validSettlement &&
        repo &&
        (is('REFUND_PAYOUT', 'refund-payout') || is('REFUND_WAIVED', 'refund-waive')) &&
        m.idempotencyKey === `${id}:${settlementKey}` &&
        auto(`${id}:${m.flow}:${settlementKey}`)
      )
        return result('เงินคืนจากรับเครื่องคืน');
      if (
        validSettlement &&
        is('SCS', 'shop-collect-settlement') &&
        ['SHOP_COLLECT', 'PAYOUT_RECALL', 'DEVICE_RETURN'].includes(m.shopReceivableType ?? '') &&
        m.idempotencyKey === `${id}:${settlementKey}` &&
        auto(`${id}:shop-collect-settlement:${settlementKey}`) &&
        (m.shopReceivableType !== 'DEVICE_RETURN' ||
          (!!repo &&
            this.entries.some(
              (origin) =>
                origin.companyId === e.companyId &&
                origin.meta.contractId === id &&
                origin.meta.tag === 'JP5' &&
                origin.meta.shopReceivableType === 'DEVICE_RETURN' &&
                !!this.prove(origin, depth + 1),
            ))) &&
        (m.shopReceivableType !== 'PAYOUT_RECALL' || this.recallOrigin(e, depth))
      )
        return result('รับชำระจากหน้าร้าน');
    }
    const exchange = s.exchanges.find(
      (r) =>
        this.exchangeValid(r) &&
        [r.je1aId, r.je2Id, r.je3Id, r.je4Id, r.eclReversalJeId].includes(e.id),
    );
    if (exchange) {
      const old = exchange.oldContractId,
        next = exchange.newContractId!;
      if (book === 'FINANCE') {
        if (
          m.flow === 'exchange-new-contract-1a' &&
          !m.tag &&
          id === next &&
          m.newContractId === next &&
          m.idempotencyKey === next &&
          exchange.je1aId === e.id &&
          auto(next)
        )
          return result('เปิดสัญญาเปลี่ยนเครื่อง');
        if (e.referenceType === null && e.referenceId === null) {
          if (
            m.flow === 'exchange-close-old-21-1106' &&
            !m.tag &&
            id === old &&
            m.oldContractId === old &&
            m.idempotencyKey === `${old}:${exchange.id}` &&
            exchange.je2Id === e.id
          )
            return result('ปิดสัญญาเปลี่ยนเครื่อง');
          if (
            m.flow === 'exchange-buyback-receivable-11-2107' &&
            !m.tag &&
            id === next &&
            m.newContractId === next &&
            m.idempotencyKey === next &&
            exchange.je3Id === e.id
          )
            return result('ลูกหนี้เปลี่ยนเครื่อง');
          if (
            is('EXCHANGE-ECL-REVERSAL', 'exchange-ecl-reversal') &&
            id === old &&
            m.idempotencyKey === `${old}:${exchange.id}` &&
            exchange.eclReversalJeId === e.id
          )
            return result('กลับสำรองเปลี่ยนเครื่อง');
        }
      } else if (
        m.flow === 'shop-exchange-return' &&
        !m.tag &&
        exchange.je4Id === e.id &&
        id === old &&
        m.oldContractId === old &&
        m.newContractId === next &&
        m.oldProductId === exchange.oldProductId &&
        m.idempotencyKey === `${exchange.oldProductId}:${old}:${exchange.id}` &&
        auto(`contract:${old}:exchange-return:${exchange.id}`)
      )
        return result('รับคืนเครื่องแลกเปลี่ยน');
    }
    if (book === 'SHOP') {
      if (
        is('SHOP_DOWN_PAYMENT', 'shop-down-payment') &&
        auto(`contract:${id}:down`) &&
        !!m.idempotencyKey
      )
        return result('รับเงินดาวน์');
      if (
        ['shop-inventory-transfer-cogs', 'shop-inventory-transfer-revenue'].includes(
          m.flow ?? '',
        ) &&
        m.productId === contract.productId &&
        s.products.some((p) => p.id === m.productId) &&
        uuid(m.batchId)
      ) {
        const cogs = m.flow === 'shop-inventory-transfer-cogs';
        const counterpart = this.entries.find(
          (r) =>
            r.companyId === e.companyId &&
            r.meta.contractId === id &&
            r.meta.productId === m.productId &&
            r.meta.batchId === m.batchId &&
            r.meta.flow ===
              (cogs ? 'shop-inventory-transfer-revenue' : 'shop-inventory-transfer-cogs') &&
            r.meta.tag ===
              (cogs ? 'SHOP_INVENTORY_TRANSFER_REVENUE' : 'SHOP_INVENTORY_TRANSFER_COGS') &&
            this.auto(r, `contract:${id}:inventory-transfer:${cogs ? 'revenue' : 'cogs'}`) &&
            (cogs ? r.meta.cogsJournalEntryId === e.id : m.cogsJournalEntryId === r.id),
        );
        if (
          counterpart &&
          m.tag === (cogs ? 'SHOP_INVENTORY_TRANSFER_COGS' : 'SHOP_INVENTORY_TRANSFER_REVENUE') &&
          auto(`contract:${id}:inventory-transfer:${cogs ? 'cogs' : 'revenue'}`)
        )
          return result(cogs ? 'ต้นทุนขายสินค้า' : 'ขายสินค้าผ่อน');
      }
      if (
        m.flow === 'shop-repossession-intake' &&
        !m.tag &&
        auto(`contract:${id}:repossession-intake`) &&
        m.idempotencyKey === `shop-repossession-intake:${id}` &&
        m.productId === contract.productId &&
        validDevice
      ) {
        const branch =
          deviceReturn &&
          s.branches.find(
            (b) =>
              b.id === deviceReturn.receivingBranchId && b.companyId === e.companyId && b.isActive,
          );
        if (deviceReturn && !branch) return null;
        return result('รับเครื่องคืนเข้าสต็อก', {
          source: { company: book, branchId: branch?.id },
        });
      }
      if (
        validSettlement &&
        !m.tag &&
        [
          'shop-collect-settlement-shop',
          'interco-recall-cash-shop',
          'interco-device-return-cash-shop',
        ].includes(m.flow ?? '')
      ) {
        const flow = m.flow!;
        const type =
          flow === 'shop-collect-settlement-shop'
            ? 'SHOP_COLLECT'
            : flow === 'interco-recall-cash-shop'
              ? 'PAYOUT_RECALL'
              : 'DEVICE_RETURN';
        const pair = this.entries.find(
          (r) =>
            this.books.get(r.companyId) === 'FINANCE' &&
            r.meta.flow === 'shop-collect-settlement' &&
            r.meta.requestId === m.requestId &&
            r.meta.amount === m.amount &&
            r.meta.shopReceivableType === type &&
            this.prove(r, depth + 1),
        );
        if (
          pair &&
          m.shopReceivableType === type &&
          (flow === 'shop-collect-settlement-shop'
            ? auto(`contract:${id}:${flow}:${settlementKey}`) &&
              m.idempotencyKey === `${flow}:${id}:${settlementKey}`
            : !!m.requestId &&
              auto(`${id}:${flow}:${m.requestId}`) &&
              m.idempotencyKey === `${id}:${m.requestId}:SHOP`)
        )
          return result('ชำระเงินให้ไฟแนนซ์');
      }
      if (
        m.flow === 'shop-trade-in-credit-applied' &&
        !m.tag &&
        auto(`tradein-credit:${m.redemptionId}`)
      ) {
        const redemption = s.redemptions.find(
          (r) =>
            r.id === m.redemptionId &&
            r.tradeInId === m.tradeInId &&
            r.contractId === id &&
            r.saleId === null &&
            r.applicationJournalEntryId === e.id,
        );
        const trade = redemption && s.tradeIns.find((t) => t.id === redemption.tradeInId);
        const branch =
          trade &&
          s.branches.find(
            (b) => b.id === trade.branchId && b.companyId === e.companyId && b.isActive,
          );
        if (
          !m.saleId &&
          trade &&
          branch &&
          (trade.customerId
            ? trade.customerId === contract.customerId
            : !!trade.sellerContactId &&
              s.customers.some(
                (c) => c.id === contract.customerId && c.contactId === trade.sellerContactId,
              ))
        )
          return result('ใช้เครดิตเทิร์น', { source: { company: book, branchId: branch.id } });
      }
    }
    return null;
  }
  private exchangeValid(r: ContractJournalSources['exchanges'][number]) {
    const old = this.sources.contracts.find((c) => c.id === r.oldContractId);
    const next = this.sources.contracts.find((c) => c.id === r.newContractId);
    return (
      !!old &&
      !!next &&
      old.productId === r.oldProductId &&
      next.productId === r.newProductId &&
      old.customerId === next.customerId &&
      this.sources.products.some((p) => p.id === old.productId) &&
      this.sources.products.some((p) => p.id === next.productId)
    );
  }
}
