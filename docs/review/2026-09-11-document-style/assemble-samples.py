"""Combine the actual synthetic render outputs; preserve each page's physical size."""
from pathlib import Path
import fitz

root = Path('.tmp/document-style')
names = [
    'preview-CONTRACT', 'preview-PDPA_CONSENT',
    'receipt-PAYMENT-normal', 'receipt-DOWN_PAYMENT-normal',
    'receipt-CREDIT_NOTE-normal', 'receipt-EARLY_PAYOFF-normal',
    'receipt-RESCHEDULE_FEE-normal', 'other-income-normal', 'expense-normal',
    'asset-normal', 'trade-in-CASH-normal', 'trade-in-TRADE_IN_CREDIT-normal',
    'e-tax-normal', 'report', 'letter-RETURN_DEVICE_45D-normal',
    'letter-CONTRACT_TERMINATION_60D-normal', 'browser-template-normal',
    'browser-RETURN_DEVICE_45D-normal', 'browser-CONTRACT_TERMINATION_60D-normal',
    'print-voucher-EXPENSE', 'print-voucher-PETTY_CASH_REIMBURSEMENT',
    'print-voucher-PAYROLL', 'print-goods-receipt', 'print-expense-daily',
    'print-other-income-daily', 'print-asset-register', 'print-wht-annual',
    'print-wht-annual-certificate', 'print-dividend-register',
    'print-dividend-register-certificate', 'print-sticker',
]
out = fitz.open()
toc = []
for name in names:
    with fitz.open(root / f'{name}.pdf') as source:
        toc.append([1, name, len(out) + 1])
        out.insert_pdf(source)
out.set_toc(toc)
out.set_metadata({'title': 'BESTCHOICE — Synthetic document layout samples',
                  'subject': 'Local test data only. TH Sarabun PSK document typography and pagination.',
                  'author': 'BESTCHOICE local QA'})
destination = Path('output/pdf/BESTCHOICE-document-samples.pdf')
destination.parent.mkdir(parents=True, exist_ok=True)
out.save(destination, garbage=4, deflate=True)
print(f'{destination}: {len(names)} examples, {len(out)} pages')
