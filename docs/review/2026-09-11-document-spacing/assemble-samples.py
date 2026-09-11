"""Combine actual synthetic outputs with Thai bookmarks for owner review."""
from pathlib import Path
import fitz

root = Path('.tmp/document-style')
examples = [
    ('trade-in-TRADE_IN_CREDIT-normal', '01 ใบรับเครื่องเทิร์น'),
    ('e-tax-normal', '02 ใบกำกับภาษี'),
    ('report', '03 BESTCHOICE Collections Report'),
    ('letter-CONTRACT_TERMINATION_60D-normal', '04 หนังสือบอกเลิกสัญญา — API'),
    ('browser-CONTRACT_TERMINATION_60D-normal', '04 หนังสือบอกเลิกสัญญา — หน้าจอ'),
    ('print-voucher-EXPENSE', '05–06 ใบสำคัญจ่าย ต้นฉบับ สำเนา และใบหักภาษี'),
    ('print-voucher-PETTY_CASH_REIMBURSEMENT', '07 ใบเบิกชดเชยเงินสดย่อย'),
    ('print-voucher-PAYROLL-custom', '08 ใบจ่ายเงินเดือน — รายได้เพิ่มเติมและไม่มีรายการหัก'),
    ('print-expense-daily', '09 ใบสรุปรายจ่ายประจำวัน — 16 รายการ'),
    ('print-wht-annual-certificate', '10 หนังสือรับรอง 50 ทวิ — เงินเดือน'),
    ('print-dividend-register-certificate', '10 หนังสือรับรอง 50 ทวิ — เงินปันผล'),
    ('receipt-PAYMENT-normal', 'ใบเสร็จรับเงินค่างวด'),
    ('receipt-CREDIT_NOTE-normal', 'ใบลดหนี้'),
    ('receipt-DOWN_PAYMENT-normal', 'ใบเสร็จรับเงินดาวน์'),
    ('receipt-EARLY_PAYOFF-normal', 'ใบเสร็จปิดยอดก่อนกำหนด'),
    ('receipt-RESCHEDULE_FEE-normal', 'ใบเสร็จค่าธรรมเนียมปรับดิว'),
    ('other-income-normal', 'ใบเสร็จรับเงินรายได้อื่น'),
    ('expense-normal', 'ใบสำคัญจ่าย — PDF จาก API'),
    ('asset-normal', 'ใบสำคัญรับเงิน — สินทรัพย์'),
    ('trade-in-CASH-normal', 'ใบสำคัญจ่าย — รับซื้อเครื่องเงินสด'),
]
out = fitz.open()
toc = []
for name, title in examples:
    with fitz.open(root / f'{name}.pdf') as source:
        toc.append([1, title, len(out) + 1])
        out.insert_pdf(source)
out.set_toc(toc)
out.set_metadata({'title': 'BESTCHOICE — Document redesign samples',
                  'subject': 'Synthetic test data only; TH Sarabun PSK 16 pt body, 18 pt headings, 12 pt footer.',
                  'author': 'BESTCHOICE local QA'})
destination = Path('output/pdf/BESTCHOICE-document-spacing.pdf')
destination.parent.mkdir(parents=True, exist_ok=True)
out.save(destination, garbage=4, deflate=True)
print(f'{destination}: {len(examples)} examples, {len(out)} pages')
