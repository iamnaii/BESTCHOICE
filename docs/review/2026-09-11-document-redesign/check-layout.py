"""Assert rendered pagination and closing content, independent of CSS implementation."""
from pathlib import Path
import re
import fitz

root = Path('.tmp/document-style')
def pages(name):
    with fitz.open(root / f'{name}.pdf') as doc:
        return [re.sub(r'\s+', '', page.get_text()) for page in doc]
def has(page, text):
    return re.sub(r'\s+', '', text) in page

single = ['trade-in-CASH-normal', 'trade-in-TRADE_IN_CREDIT-normal', 'e-tax-normal',
          'e-tax-long', 'letter-CONTRACT_TERMINATION_60D-normal',
          'letter-CONTRACT_TERMINATION_60D-long', 'browser-CONTRACT_TERMINATION_60D-normal',
          'browser-CONTRACT_TERMINATION_60D-long', 'expense-normal', 'asset-normal',
          'other-income-normal', 'print-voucher-PETTY_CASH_REIMBURSEMENT',
          'print-voucher-PAYROLL', 'print-expense-daily',
          'print-wht-annual-certificate', 'print-dividend-register-certificate']
single += [f'receipt-{kind}-normal' for kind in ['PAYMENT','DOWN_PAYMENT','CREDIT_NOTE','EARLY_PAYOFF','RESCHEDULE_FEE']]
for name in single:
    assert len(pages(name)) == 1, f'{name} must fit one page'

assert len(pages('print-voucher-EXPENSE')) == 3, 'Original, copy and withholding certificate each occupy one page'
assert len(pages('print-voucher-PAYROLL-custom')) == 2, 'One slip per employee, including custom pay items'
for page in pages('print-voucher-PAYROLL-custom'):
    assert has(page, 'สุทธิที่จ่าย') and has(page, 'ผู้รับเงิน')
custom = pages('print-voucher-PAYROLL-custom')[0]
for value in ['ค่าล่วงเวลา', 'ค่าเดินทางตามจริง', 'ม.42 ยกเว้นภาษี', 'เงินยืมพนักงาน', '21,550.00']:
    assert has(custom, value), value

for name, anchor, signature in [
    ('expense-long', 'จำนวนเงินจ่ายสุทธิ', 'ผู้รับเงิน'),
    ('other-income-long', 'จำนวนเงินที่ชำระ', 'ผู้ออกใบเสร็จรับเงิน'),
    ('asset-long', 'มูลค่าต้นทุนรวม', 'ผู้ส่งมอบ'),
    ('trade-in-CASH-long', 'จำนวนเงินเป็นตัวอักษร', 'ผู้รับเงิน (ผู้ขาย)'),
    ('trade-in-TRADE_IN_CREDIT-long', 'จำนวนเงินเป็นตัวอักษร', 'ผู้ส่งมอบเครื่อง'),
    ('receipt-PAYMENT-long', 'จำนวนเงินรับชำระทั้งสิ้น', 'ผู้รับเงิน / ผู้ออกเอกสาร'),
    ('receipt-CREDIT_NOTE-long', 'จำนวนเงิน', 'ผู้รับเงิน / ผู้ออกเอกสาร'),
    ('print-expense-daily-many-buckets', '25,680.00', 'ผู้อนุมัติ'),
]:
    final = pages(name)[-1]
    assert has(final, anchor) and has(final, signature), f'{name}: closing amount must accompany signature'

for name in ['print-voucher-EXPENSE', 'print-voucher-long']:
    for page in pages(name):
        if has(page, 'วันที่ __ / __ / ____'):
            assert has(page, 'ยอดสุทธิที่จ่าย') or has(page, 'ภาษีที่หักเป็นเงิน'), f'{name}: signature without amount'

letters = list(root.glob('letter-*.pdf')) + list(root.glob('browser-CONTRACT*.pdf')) + list(root.glob('browser-RETURN*.pdf')) + list(root.glob('browser-termination-boundary-*.pdf'))
for file in letters:
    final = pages(file.stem)[-1]
    assert has(final, 'ขอแสดงความนับถือ') and has(final, 'จึงเรียนมาเพื่อโปรดดำเนินการ'), file.name
assert any(len(pages(f'browser-termination-boundary-{n}-long')) > 1 for n in [8,12,16,20]), 'Boundary fixtures must actually cross a page'

certificate = pages('print-voucher-EXPENSE')[-1]
assert has(certificate, 'บริษัท เบสท์ช้อยส์โฟน จำกัด')
assert not has(certificate, 'บริษัท ร้านค้าทดสอบ จำกัด'), 'WHT issuer must match FINANCE tax ID'
assert has(certificate, '30.00') and has(certificate, '1,000.00')
long_daily = ''.join(pages('print-expense-daily-many-buckets'))
for i in range(1,25):
    assert has(long_daily, f'หมวดรายจ่าย {i}') and has(long_daily, f'บัญชีจ่าย {i}')
report = ''.join(pages('report'))
for value in ['80%', '7 / 2', '11 / 1', '12000', '34000', 'CT-202609-19', 'RETURN_DEVICE_45D']:
    assert has(report, value), value
print(f'PASS: {len(single)} one-page forms, copy/slip counts, long closings, boundary letters, financial display and issuer identity')
