import { create } from 'xmlbuilder2';
import { Prisma } from '@prisma/client';

/**
 * UBL 2.1 e-Tax Invoice builder per ขมธอ.21-2562 (ETDA standard).
 *
 * Reference standards:
 *   - ขมธอ.21-2562 — Thailand UBL 2.1 e-Tax Invoice profile
 *   - ETDA Recommendation 3-2560 — XML structure
 *   - ป.รัษฎากร ม.86/4 + ประกาศอธิบดี ฉ.48 — mandatory fields
 *
 * This emits the unsigned XML body. PKCS#7 signing is handled separately by
 * the Pkcs7Signer (ขมธอ.21-2562 specifies enveloped XAdES BES detached
 * signature for transmission to RD).
 *
 * The builder is data-transport only — it does NOT touch the DB, the
 * filesystem, or the network. All input must be pre-loaded by the caller.
 */

/** Money utility: format a Decimal as fixed 2-decimal string for UBL */
function money(value: Prisma.Decimal | number | string): string {
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (typeof value === 'number') return value.toFixed(2);
  return new Prisma.Decimal(value).toFixed(2);
}

/** ISO 8601 date for UBL `<cbc:IssueDate>` (YYYY-MM-DD, Asia/Bangkok day) */
function isoDateBkk(d: Date): string {
  // toLocaleDateString with sv-SE locale produces YYYY-MM-DD reliably
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

export interface SupplierInfo {
  /** Tax registration ID (13 digits for Thai juristic person) */
  taxId: string;
  /** Branch code — 5 digits ('00000' = head office) */
  branchCode: string;
  nameTh: string;
  nameEn?: string | null;
  address: string;
}

export interface CustomerInfo {
  /** Customer's tax ID (13 digits). Null/empty when N/A for non-juristic individuals */
  taxId: string | null;
  /** Branch code — 5 digits ('00000' = head office / individual). Optional, default '00000'. */
  branchCode?: string;
  name: string;
  /** Customer address (may contain Thai). Optional. */
  address?: string | null;
}

export interface InvoiceLine {
  id: string;
  description: string;
  /** Quantity, defaults to 1 for HP installment receipts */
  quantity: number;
  /** Unit price = line subtotal before VAT */
  unitPrice: Prisma.Decimal;
  /** Line subtotal (qty × unit, before VAT) */
  lineExtension: Prisma.Decimal;
}

export interface EtaxInvoiceInput {
  /** Document/invoice number — must be unique within the supplier per
   * ขมธอ.21-2562 (used as <cbc:ID>). */
  invoiceNumber: string;
  /** Invoice issue date (Asia/Bangkok day) */
  issueDate: Date;
  /** Invoice currency, defaults THB */
  currency?: string;
  /** "388" = ใบกำกับภาษี per UN/CEFACT */
  invoiceTypeCode?: string;
  /** Reference back to the original receipt/document */
  buyerReference?: string;
  supplier: SupplierInfo;
  customer: CustomerInfo;
  lines: InvoiceLine[];
  /** Subtotal before VAT (= sum of line extensions) */
  lineExtensionAmount: Prisma.Decimal;
  /** Tax base (= taxable amount for VAT calc, typically same as lineExtensionAmount) */
  taxExclusiveAmount: Prisma.Decimal;
  /** VAT amount */
  vatAmount: Prisma.Decimal;
  /** VAT rate as percentage (7 for 7%) */
  vatPercent: number;
  /** Tax-inclusive total (lineExtension + VAT) */
  taxInclusiveAmount: Prisma.Decimal;
  /** Final amount payable (after rounding/discounts; usually = taxInclusiveAmount) */
  payableAmount: Prisma.Decimal;
}

export class EtaxUblBuilder {
  static readonly NS = {
    cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
    invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  } as const;

  /**
   * Build a UBL 2.1 Invoice XML string per ขมธอ.21-2562.
   * @returns Pretty-printed XML string (UTF-8, with XML declaration).
   */
  build(input: EtaxInvoiceInput): string {
    const currency = input.currency ?? 'THB';
    const typeCode = input.invoiceTypeCode ?? '388';

    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('Invoice', {
        xmlns: EtaxUblBuilder.NS.invoice,
        'xmlns:cbc': EtaxUblBuilder.NS.cbc,
        'xmlns:cac': EtaxUblBuilder.NS.cac,
        'xmlns:ext': EtaxUblBuilder.NS.ext,
      });

    // UBL header — placeholder for ext:UBLExtensions (PKCS#7 sig slot).
    // C8 — Signer fills `<ext:ExtensionContent><ds:Signature>...</ds:Signature></ext:ExtensionContent>`
    // post-hoc (see Pkcs7Signer.embedInUblExtension). We emit the empty
    // shell here so the signer only has to swap the inner text.
    root
      .ele('ext:UBLExtensions')
      .ele('ext:UBLExtension')
      .ele('ext:ExtensionContent')
      .txt('') // signer replaces this with <ds:Signature>...</ds:Signature>
      .up()
      .up()
      .up();

    root.ele('cbc:UBLVersionID').txt('2.1');
    root.ele('cbc:CustomizationID').txt('urn:etda:eTaxInvoice:2.0');
    root.ele('cbc:ProfileID').txt('urn:etda:eTaxInvoice:profile:billing:2.0');
    root.ele('cbc:ID').txt(input.invoiceNumber);
    root.ele('cbc:IssueDate').txt(isoDateBkk(input.issueDate));
    root.ele('cbc:InvoiceTypeCode').txt(typeCode);
    root.ele('cbc:DocumentCurrencyCode').txt(currency);
    if (input.buyerReference) {
      root.ele('cbc:BuyerReference').txt(input.buyerReference);
    }

    // ─── Supplier (FINANCE company) ───────────────────────────────
    // C5 — ขมธอ.21-2562 + Thailand RD profile use `cbc:CompanyID schemeID="TXID"`
    // under `cac:PartyTaxScheme` with the format `{13-digit-taxId}-{5-digit-branchCode}`.
    // The previously emitted `<cbc:TaxLevelCode>` element is NOT part of UBL 2.1 +
    // does not exist in the RD profile — schema-invalid and would 100% reject.
    const supplierTxid = `${input.supplier.taxId}-${input.supplier.branchCode}`;

    const supplierParty = root.ele('cac:AccountingSupplierParty').ele('cac:Party');
    supplierParty
      .ele('cac:PartyIdentification')
      .ele('cbc:ID', { schemeID: 'TXID' })
      .txt(supplierTxid);

    supplierParty
      .ele('cac:PartyName')
      .ele('cbc:Name')
      .txt(input.supplier.nameTh);

    if (input.supplier.nameEn) {
      supplierParty
        .ele('cac:PartyName')
        .ele('cbc:Name')
        .txt(input.supplier.nameEn);
    }

    supplierParty
      .ele('cac:PostalAddress')
      .ele('cbc:StreetName')
      .txt(input.supplier.address)
      .up()
      .ele('cac:Country')
      .ele('cbc:IdentificationCode')
      .txt('TH')
      .up()
      .up();

    supplierParty
      .ele('cac:PartyTaxScheme')
      .ele('cbc:CompanyID', { schemeID: 'TXID' })
      .txt(supplierTxid)
      .up()
      .ele('cac:TaxScheme')
      .ele('cbc:ID')
      .txt('VAT')
      .up()
      .up();

    // ─── Customer ─────────────────────────────────────────────────
    // C5 — Buyer TXID also follows `{taxId}-{branchCode}` format. For an
    // individual buyer without a juristic branch, default branchCode '00000'
    // is universally accepted by RD.
    const customerParty = root.ele('cac:AccountingCustomerParty').ele('cac:Party');
    const customerTxid = input.customer.taxId
      ? `${input.customer.taxId}-${input.customer.branchCode ?? '00000'}`
      : null;
    if (customerTxid) {
      customerParty
        .ele('cac:PartyIdentification')
        .ele('cbc:ID', { schemeID: 'TXID' })
        .txt(customerTxid);
    }

    customerParty
      .ele('cac:PartyName')
      .ele('cbc:Name')
      .txt(input.customer.name);

    if (input.customer.address) {
      customerParty
        .ele('cac:PostalAddress')
        .ele('cbc:StreetName')
        .txt(input.customer.address)
        .up()
        .ele('cac:Country')
        .ele('cbc:IdentificationCode')
        .txt('TH')
        .up()
        .up();
    }

    if (customerTxid) {
      customerParty
        .ele('cac:PartyTaxScheme')
        .ele('cbc:CompanyID', { schemeID: 'TXID' })
        .txt(customerTxid)
        .up()
        .ele('cac:TaxScheme')
        .ele('cbc:ID')
        .txt('VAT')
        .up()
        .up();
    }

    // ─── TaxTotal ─────────────────────────────────────────────────
    const taxTotal = root.ele('cac:TaxTotal');
    taxTotal
      .ele('cbc:TaxAmount', { currencyID: currency })
      .txt(money(input.vatAmount));

    const taxSubtotal = taxTotal.ele('cac:TaxSubtotal');
    taxSubtotal
      .ele('cbc:TaxableAmount', { currencyID: currency })
      .txt(money(input.taxExclusiveAmount));
    taxSubtotal
      .ele('cbc:TaxAmount', { currencyID: currency })
      .txt(money(input.vatAmount));
    taxSubtotal
      .ele('cac:TaxCategory')
      .ele('cbc:ID', { schemeID: 'UN/ECE 5305' })
      .txt('VAT')
      .up()
      .ele('cbc:Percent')
      .txt(String(input.vatPercent))
      .up()
      .ele('cac:TaxScheme')
      .ele('cbc:ID')
      .txt('VAT')
      .up();

    // ─── LegalMonetaryTotal ───────────────────────────────────────
    const lmt = root.ele('cac:LegalMonetaryTotal');
    lmt
      .ele('cbc:LineExtensionAmount', { currencyID: currency })
      .txt(money(input.lineExtensionAmount));
    lmt
      .ele('cbc:TaxExclusiveAmount', { currencyID: currency })
      .txt(money(input.taxExclusiveAmount));
    lmt
      .ele('cbc:TaxInclusiveAmount', { currencyID: currency })
      .txt(money(input.taxInclusiveAmount));
    lmt
      .ele('cbc:PayableAmount', { currencyID: currency })
      .txt(money(input.payableAmount));

    // ─── InvoiceLine[] ───────────────────────────────────────────
    for (const line of input.lines) {
      const il = root.ele('cac:InvoiceLine');
      il.ele('cbc:ID').txt(line.id);
      il
        .ele('cbc:InvoicedQuantity', { unitCode: 'C62' })
        .txt(String(line.quantity));
      il
        .ele('cbc:LineExtensionAmount', { currencyID: currency })
        .txt(money(line.lineExtension));
      il.ele('cac:Item').ele('cbc:Name').txt(line.description);
      il
        .ele('cac:Price')
        .ele('cbc:PriceAmount', { currencyID: currency })
        .txt(money(line.unitPrice));
    }

    return root.end({ prettyPrint: true });
  }
}
