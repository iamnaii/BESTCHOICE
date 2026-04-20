import { useRef } from 'react';
import { ArrowLeft, User, FileText, Clock, BarChart3 } from 'lucide-react';
import {
  type Customer,
  type CustomerHistory,
  type OcrSalarySlipResult,
  type OcrBankStatementResult,
  type RiskScoreResult,
  BANK_OPTIONS,
} from './types';

interface SalarySlipEditable {
  netSalary: string;
  employerName: string;
  payDay: string;
  bankName: string;
}

interface CreditCheckCreateModalProps {
  // Visibility
  onClose: () => void;

  // Customer search
  customerSearch: string;
  onCustomerSearchChange: (v: string) => void;
  customers: Customer[];
  selectedCustomer: Customer | null;
  onSelectCustomer: (c: Customer) => void;
  onClearCustomer: () => void;
  customerHistory: CustomerHistory | null;

  // Book bank
  bookBankLoading: boolean;
  bookBankFileRef: React.RefObject<HTMLInputElement | null>;
  onBookBankScan: (e: React.ChangeEvent<HTMLInputElement>) => void;

  // Salary slip
  salarySlipFileRef: React.RefObject<HTMLInputElement | null>;
  salarySlipFiles: File[];
  onSalarySlipFilesChange: (files: File[]) => void;
  salarySlipLoading: boolean;
  onSalarySlipOcr: () => void;
  salarySlipResult: OcrSalarySlipResult | null;
  salarySlipEditable: SalarySlipEditable;
  onSalarySlipEditableChange: (v: SalarySlipEditable) => void;

  // Statement
  statementBankName: string;
  onStatementBankNameChange: (v: string) => void;
  statementFileRef: React.RefObject<HTMLInputElement | null>;
  statementFiles: File[];
  onStatementFilesChange: (files: File[]) => void;
  statementLoading: boolean;
  onStatementOcr: () => void;
  statementResult: OcrBankStatementResult | null;

  // Risk
  riskScore: RiskScoreResult | null;
  riskLoading: boolean;
  onCalculateRisk: (customerId: string) => void;
  reviewNotesDraft: string;
  onReviewNotesDraftChange: (v: string) => void;

  // Footer actions
  bankName: string;
  fileRef: React.RefObject<HTMLInputElement | null>;
  isUploadPending: boolean;
  onSave: () => void;
  onApprove: () => void;
  onReject: () => void;
}

export default function CreditCheckCreateModal({
  onClose,
  customerSearch,
  onCustomerSearchChange,
  customers,
  selectedCustomer,
  onSelectCustomer,
  onClearCustomer,
  customerHistory,
  bookBankLoading,
  bookBankFileRef,
  onBookBankScan,
  salarySlipFileRef,
  salarySlipFiles,
  onSalarySlipFilesChange,
  salarySlipLoading,
  onSalarySlipOcr,
  salarySlipResult,
  salarySlipEditable,
  onSalarySlipEditableChange,
  statementBankName,
  onStatementBankNameChange,
  statementFileRef,
  statementFiles,
  onStatementFilesChange,
  statementLoading,
  onStatementOcr,
  statementResult,
  riskScore,
  riskLoading,
  onCalculateRisk,
  reviewNotesDraft,
  onReviewNotesDraftChange,
  isUploadPending,
  onSave,
  onApprove,
  onReject,
}: CreditCheckCreateModalProps) {
  // Keep a local ref for the hidden book-bank input (passed via prop)
  const _bookBankRef = bookBankFileRef;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8">
      <div className="w-full max-w-4xl bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" /> กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">ตรวจเครดิตใหม่</h2>
          <div className="w-16" />
        </div>

        <div className="p-6 space-y-5">
          {/* ─── Section 1: ข้อมูลลูกค้า ─── */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <User className="size-4" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลลูกค้า</h3>
                <p className="text-xs text-muted-foreground">เลือกลูกค้าที่ต้องการตรวจเครดิต</p>
              </div>
            </div>

            {!selectedCustomer ? (
              <div>
                <input
                  type="text"
                  placeholder="ค้นหาชื่อ, เบอร์โทร, เลขบัตร..."
                  value={customerSearch}
                  onChange={(e) => onCustomerSearchChange(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm mb-3"
                />
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {customers.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => onSelectCustomer(c)}
                      className="p-3 rounded-lg border cursor-pointer hover:border-primary/40 hover:bg-primary/5 dark:hover:bg-primary/10 transition-colors"
                    >
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.phone}{' '}
                        {c.salary
                          ? `| เงินเดือน ${parseFloat(c.salary).toLocaleString()} ฿`
                          : ''}
                      </div>
                    </div>
                  ))}
                  {customers.length === 0 && customerSearch && (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      ไม่พบลูกค้า
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <div className="bg-primary/5 dark:bg-primary/10 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-primary">
                        {selectedCustomer.name}
                      </span>
                      {customerHistory ? (
                        customerHistory.isReturning ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success">
                            ลูกค้าเก่า
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning">
                            ลูกค้าใหม่
                          </span>
                        )
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                      <div>
                        <div className="text-2xs text-muted-foreground">เบอร์โทร</div>
                        <div className="text-xs font-medium">{selectedCustomer.phone}</div>
                      </div>
                      <div>
                        <div className="text-2xs text-muted-foreground">อาชีพ</div>
                        <div className="text-xs font-medium">
                          {selectedCustomer.occupation || '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-2xs text-muted-foreground">เงินเดือน</div>
                        <div className="text-xs font-medium">
                          {selectedCustomer.salary
                            ? `${parseFloat(selectedCustomer.salary).toLocaleString()} ฿`
                            : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-2xs text-muted-foreground">ประเภทที่อยู่</div>
                        <div className="text-xs font-medium">
                          {selectedCustomer.addressCurrentType || '-'}
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={onClearCustomer}
                    className="text-xs text-primary hover:text-primary/80 ml-4"
                  >
                    เปลี่ยน
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ─── Section 2: เอกสารประกอบ ─── */}
          {selectedCustomer && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
                  <FileText className="size-4" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">เอกสารประกอบ</h3>
                  <p className="text-xs text-muted-foreground">สลิปเงินเดือนและ Statement ธนาคาร</p>
                </div>
              </div>

              {/* Part A: สลิปเงินเดือน */}
              <div className="mb-5 p-4 bg-muted/30 rounded-lg border border-border">
                <h4 className="text-xs font-semibold text-foreground mb-3 uppercase tracking-wider">
                  A. สลิปเงินเดือน
                </h4>
                <div className="flex items-center gap-3 mb-3">
                  <input
                    ref={salarySlipFileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      if (e.target.files) {
                        const files = Array.from(e.target.files).slice(0, 3);
                        onSalarySlipFilesChange(files);
                      }
                    }}
                    className="flex-1 text-sm text-muted-foreground file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-success/10 file:text-success"
                  />
                  <button
                    onClick={onSalarySlipOcr}
                    disabled={salarySlipLoading || salarySlipFiles.length === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-success text-success-foreground rounded-lg text-xs font-medium hover:bg-success/90 disabled:opacity-50"
                  >
                    {salarySlipLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
                        กำลังวิเคราะห์...
                      </>
                    ) : (
                      'AI วิเคราะห์'
                    )}
                  </button>
                </div>
                <div className="text-2xs text-muted-foreground mb-2">รองรับสูงสุด 3 รูป</div>

                {salarySlipResult && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                    <div>
                      <label className="block text-2xs text-muted-foreground mb-1">
                        เงินเดือนสุทธิ
                      </label>
                      <input
                        type="text"
                        value={salarySlipEditable.netSalary}
                        onChange={(e) =>
                          onSalarySlipEditableChange({
                            ...salarySlipEditable,
                            netSalary: e.target.value,
                          })
                        }
                        className="w-full px-2 py-1.5 border border-input rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-2xs text-muted-foreground mb-1">ชื่อบริษัท</label>
                      <input
                        type="text"
                        value={salarySlipEditable.employerName}
                        onChange={(e) =>
                          onSalarySlipEditableChange({
                            ...salarySlipEditable,
                            employerName: e.target.value,
                          })
                        }
                        className="w-full px-2 py-1.5 border border-input rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-2xs text-muted-foreground mb-1">
                        วันเงินเดือนออก
                      </label>
                      <input
                        type="text"
                        value={salarySlipEditable.payDay}
                        onChange={(e) =>
                          onSalarySlipEditableChange({
                            ...salarySlipEditable,
                            payDay: e.target.value,
                          })
                        }
                        className="w-full px-2 py-1.5 border border-input rounded-lg text-sm"
                        placeholder="เช่น 25"
                      />
                    </div>
                    <div>
                      <label className="block text-2xs text-muted-foreground mb-1">ธนาคาร</label>
                      <input
                        type="text"
                        value={salarySlipEditable.bankName}
                        onChange={(e) =>
                          onSalarySlipEditableChange({
                            ...salarySlipEditable,
                            bankName: e.target.value,
                          })
                        }
                        className="w-full px-2 py-1.5 border border-input rounded-lg text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Part B: Statement ธนาคาร */}
              <div className="p-4 bg-muted/30 rounded-lg border border-border">
                <h4 className="text-xs font-semibold text-foreground mb-3 uppercase tracking-wider">
                  B. Statement ธนาคาร
                </h4>
                <div className="mb-3">
                  <label className="block text-2xs text-muted-foreground mb-1">เลือกธนาคาร</label>
                  <select
                    value={statementBankName}
                    onChange={(e) => onStatementBankNameChange(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                  >
                    <option value="">-- เลือกธนาคาร --</option>
                    {BANK_OPTIONS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <input
                    ref={statementFileRef}
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    onChange={(e) => {
                      if (e.target.files) onStatementFilesChange(Array.from(e.target.files));
                    }}
                    className="flex-1 text-sm text-muted-foreground file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-success/10 file:text-success"
                  />
                  <button
                    onClick={onStatementOcr}
                    disabled={statementLoading || statementFiles.length === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-success text-success-foreground rounded-lg text-xs font-medium hover:bg-success/90 disabled:opacity-50"
                  >
                    {statementLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
                        กำลังวิเคราะห์...
                      </>
                    ) : (
                      'AI วิเคราะห์'
                    )}
                  </button>
                </div>

                {statementResult && (
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div className="bg-card rounded border p-3">
                      <div className="text-2xs text-muted-foreground">ยอดเข้าเฉลี่ย</div>
                      <div className="text-sm font-bold text-success">
                        {statementResult.totalIncome != null
                          ? `${statementResult.totalIncome.toLocaleString()} ฿`
                          : '-'}
                      </div>
                    </div>
                    <div className="bg-card rounded border p-3">
                      <div className="text-2xs text-muted-foreground">ยอดออกเฉลี่ย</div>
                      <div className="text-sm font-bold text-destructive">
                        {statementResult.totalExpense != null
                          ? `${statementResult.totalExpense.toLocaleString()} ฿`
                          : '-'}
                      </div>
                    </div>
                    <div className="bg-card rounded border p-3">
                      <div className="text-2xs text-muted-foreground">ยอดคงเหลือ</div>
                      <div className="text-sm font-bold">
                        {statementResult.balance != null
                          ? `${statementResult.balance.toLocaleString()} ฿`
                          : '-'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Section 3: ประวัติในระบบ ─── */}
          {selectedCustomer && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                  <Clock className="size-4" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">ประวัติในระบบ</h3>
                  <p className="text-xs text-muted-foreground">
                    ข้อมูลสัญญาและประวัติชำระเงินจากระบบ
                  </p>
                </div>
                {customerHistory && (
                  <div className="ml-auto">
                    {customerHistory.isReturning ? (
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-success/10 text-success">
                        ลูกค้าเก่า
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-warning/10 text-warning">
                        ลูกค้าใหม่
                      </span>
                    )}
                  </div>
                )}
              </div>

              {customerHistory ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-muted/50 rounded-lg border p-3">
                    <div className="text-2xs text-muted-foreground">สัญญาทั้งหมด</div>
                    <div className="text-lg font-bold">
                      {customerHistory.totalContracts}{' '}
                      <span className="text-xs font-normal text-muted-foreground">สัญญา</span>
                    </div>
                  </div>
                  <div className="bg-muted/50 rounded-lg border p-3">
                    <div className="text-2xs text-muted-foreground">ปิดแล้ว / ค้างอยู่</div>
                    <div className="text-lg font-bold">
                      <span className="text-success">{customerHistory.closedContracts}</span>
                      <span className="text-xs font-normal text-muted-foreground"> / </span>
                      <span className="text-warning">{customerHistory.activeContracts}</span>
                    </div>
                  </div>
                  <div className="bg-muted/50 rounded-lg border p-3">
                    <div className="text-2xs text-muted-foreground">ชำระตรงเวลา</div>
                    <div
                      className={`text-lg font-bold ${
                        (customerHistory.onTimePaymentPct ?? 0) >= 80
                          ? 'text-success'
                          : (customerHistory.onTimePaymentPct ?? 0) >= 50
                            ? 'text-warning'
                            : 'text-destructive'
                      }`}
                    >
                      {(customerHistory.onTimePaymentPct ?? 0).toFixed(0)}%
                    </div>
                  </div>
                  <div className="bg-muted/50 rounded-lg border p-3">
                    <div className="text-2xs text-muted-foreground">ยอดค้างปัจจุบัน</div>
                    <div className="text-lg font-bold">
                      {customerHistory.currentOutstanding.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-muted-foreground">฿</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-4">
                  กำลังโหลดข้อมูล...
                </div>
              )}
            </div>
          )}

          {/* ─── Section 4: สรุปวิเคราะห์ ─── */}
          {selectedCustomer && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                  <BarChart3 className="size-4" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">สรุปวิเคราะห์</h3>
                  <p className="text-xs text-muted-foreground">คำนวณ Risk Score และคำแนะนำ</p>
                </div>
              </div>

              {!riskScore ? (
                <div className="text-center py-4">
                  <button
                    onClick={() => onCalculateRisk(selectedCustomer.id)}
                    disabled={riskLoading}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-warning text-warning-foreground rounded-lg text-sm font-medium hover:bg-warning/90 disabled:opacity-50"
                  >
                    {riskLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        กำลังคำนวณ...
                      </>
                    ) : (
                      'คำนวณ Risk Score'
                    )}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="bg-muted/50 rounded-lg border p-3">
                      <div className="text-2xs text-muted-foreground mb-1">Risk Score</div>
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-bold ${
                          riskScore.riskLevel === 'LOW'
                            ? 'bg-success/10 text-success'
                            : riskScore.riskLevel === 'MEDIUM'
                              ? 'bg-warning/10 text-warning'
                              : 'bg-destructive/10 text-destructive'
                        }`}
                      >
                        {riskScore.riskLevel === 'LOW'
                          ? 'ต่ำ'
                          : riskScore.riskLevel === 'MEDIUM'
                            ? 'ปานกลาง'
                            : 'สูง'}{' '}
                        ({riskScore.score})
                      </span>
                    </div>
                    <div className="bg-muted/50 rounded-lg border p-3">
                      <div className="text-2xs text-muted-foreground mb-1">Debt-to-Income</div>
                      <div
                        className={`text-lg font-bold ${
                          (riskScore.debtToIncome ?? 0) <= 40
                            ? 'text-success'
                            : (riskScore.debtToIncome ?? 0) <= 60
                              ? 'text-warning'
                              : 'text-destructive'
                        }`}
                      >
                        {(riskScore.debtToIncome ?? 0).toFixed(1)}%
                      </div>
                      <div className="text-2xs text-muted-foreground">ค่างวด / เงินเดือน</div>
                    </div>
                    {riskScore.recommendedPayDay && (
                      <div className="bg-muted/50 rounded-lg border p-3">
                        <div className="text-2xs text-muted-foreground mb-1">แนะนำกำหนดชำระ</div>
                        <div className="text-lg font-bold text-primary">
                          วันที่ {riskScore.recommendedPayDay}
                        </div>
                        <div className="text-2xs text-muted-foreground">= วันเงินเดือนออก</div>
                      </div>
                    )}
                  </div>

                  {riskScore.recommendation && (
                    <div className="bg-muted/30 rounded-lg border p-3">
                      <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                        คำแนะนำ AI
                      </div>
                      <div className="text-sm">{riskScore.recommendation}</div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4">
                <label className="block text-xs font-medium text-foreground mb-1.5">หมายเหตุ</label>
                <textarea
                  value={reviewNotesDraft}
                  onChange={(e) => onReviewNotesDraftChange(e.target.value)}
                  rows={2}
                  placeholder="ระบุหมายเหตุเพิ่มเติม (ถ้ามี)..."
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {selectedCustomer && (
          <div className="sticky bottom-0 z-10 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex items-center justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-input rounded-lg hover:bg-muted"
            >
              ยกเลิก
            </button>
            <div className="flex gap-2">
              <button
                onClick={onSave}
                disabled={isUploadPending}
                className="px-4 py-2 text-sm border border-input rounded-lg hover:bg-muted"
              >
                บันทึก
              </button>
              <button
                onClick={onApprove}
                className="px-4 py-2 text-sm bg-success text-success-foreground rounded-lg hover:bg-success/90"
              >
                อนุมัติ
              </button>
              <button
                onClick={onReject}
                className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90"
              >
                ไม่อนุมัติ
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
