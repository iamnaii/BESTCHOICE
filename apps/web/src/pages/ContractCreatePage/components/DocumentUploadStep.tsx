import React from 'react';
import type { PendingDoc, OcrResult, Customer } from '../types';
import { DOCUMENT_TYPES } from '../constants';
import { formatDateShort } from '@/utils/formatters';

export interface DocumentUploadStepProps {
  pendingDocs: PendingDoc[];
  dragOverType: string | null;
  setDragOverType: (v: string | null) => void;
  fileInputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  handleDropForType: (e: React.DragEvent, docType: string) => void;
  handleFileInputForType: (e: React.ChangeEvent<HTMLInputElement>, docType: string) => void;
  handleRemoveDoc: (id: string) => void;
  ocrLoading: boolean;
  showOcrPanel: boolean;
  ocrResult: OcrResult | null;
  setShowOcrPanel: (v: boolean) => void;
  updateCustomerFromOcr: (selectedCustomer: Customer | null) => void;
  selectedCustomer: Customer | null;
}

function DocTypeSection({
  dt,
  docs,
  isOver,
  isRequired,
  dragOverType,
  setDragOverType,
  fileInputRefs,
  handleDropForType,
  handleFileInputForType,
  handleRemoveDoc,
}: {
  dt: { value: string; label: string; required: boolean };
  docs: PendingDoc[];
  isOver: boolean;
  isRequired: boolean;
  dragOverType: string | null;
  setDragOverType: (v: string | null) => void;
  fileInputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  handleDropForType: (e: React.DragEvent, docType: string) => void;
  handleFileInputForType: (e: React.ChangeEvent<HTMLInputElement>, docType: string) => void;
  handleRemoveDoc: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border/50 overflow-hidden bg-card shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/40">
        {docs.length > 0 ? (
          <span className="text-green-500 text-sm font-bold">&#10003;</span>
        ) : (
          <span className={`${isRequired ? 'text-red-400' : 'text-muted-foreground/50'} text-sm`}>&#9675;</span>
        )}
        <span className={`text-sm font-medium ${isRequired ? 'text-foreground' : 'text-muted-foreground'}`}>
          {dt.label} {isRequired && <span className="text-red-500">*</span>}
        </span>
        {docs.length > 0 && <span className="text-xs text-muted-foreground ml-auto">{docs.length} ไฟล์</span>}
      </div>
      <div className="p-3">
        {/* Attached files */}
        {docs.length > 0 && (
          <div className="mb-2 space-y-1">
            {docs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-2 bg-muted rounded px-3 py-1.5">
                {doc.file.type.startsWith('image/') ? (
                  <img src={doc.preview} alt="ตัวอย่างเอกสาร" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded bg-red-100 flex items-center justify-center text-2xs font-bold text-destructive flex-shrink-0">PDF</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground truncate">{doc.file.name}</div>
                  <div className="text-2xs text-muted-foreground">{(doc.file.size / 1024).toFixed(0)} KB</div>
                </div>
                <button onClick={() => handleRemoveDoc(doc.id)} className="text-2xs text-red-500 hover:text-red-700 flex-shrink-0">ลบ</button>
              </div>
            ))}
          </div>
        )}
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverType(dt.value); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverType(null); }}
          onDrop={(e) => handleDropForType(e, dt.value)}
          onClick={() => fileInputRefs.current[dt.value]?.click()}
          className={`border-2 border-dashed rounded-lg py-3 px-4 text-center cursor-pointer transition-colors ${
            isOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-muted'
          }`}
        >
          <input
            ref={(el) => { fileInputRefs.current[dt.value] = el; }}
            type="file"
            accept="image/*,.pdf"
            onChange={(e) => handleFileInputForType(e, dt.value)}
            className="hidden"
          />
          <div className="flex items-center justify-center gap-2">
            <svg className={`w-5 h-5 ${isOver ? 'text-primary' : 'text-muted-foreground/50'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span className={`text-xs ${isOver ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
              {isOver ? 'ปล่อยไฟล์ที่นี่' : 'ลากไฟล์มาวาง หรือคลิก'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DocumentUploadStep({
  pendingDocs,
  dragOverType,
  setDragOverType,
  fileInputRefs,
  handleDropForType,
  handleFileInputForType,
  handleRemoveDoc,
  ocrLoading,
  showOcrPanel,
  ocrResult,
  setShowOcrPanel,
  updateCustomerFromOcr,
  selectedCustomer,
}: DocumentUploadStepProps) {
  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm space-y-2">
        <h3 className="text-sm font-semibold text-foreground">แนบเอกสาร</h3>
        <p className="text-xs text-muted-foreground">ลากไฟล์มาวางในช่องของเอกสารแต่ละประเภท หรือคลิกเพื่อเลือกไฟล์ (สามารถแนบภายหลังได้)</p>
      </div>

      {/* Per-type drop zones — required first */}
      <div className="space-y-3">
        {DOCUMENT_TYPES.filter((dt) => dt.required).map((dt) => {
          const docs = pendingDocs.filter((d) => d.type === dt.value);
          const isOver = dragOverType === dt.value;
          return (
            <DocTypeSection
              key={dt.value}
              dt={dt}
              docs={docs}
              isOver={isOver}
              isRequired={true}
              dragOverType={dragOverType}
              setDragOverType={setDragOverType}
              fileInputRefs={fileInputRefs}
              handleDropForType={handleDropForType}
              handleFileInputForType={handleFileInputForType}
              handleRemoveDoc={handleRemoveDoc}
            />
          );
        })}
      </div>

      {/* Optional documents */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">เอกสารเพิ่มเติม (ไม่บังคับ)</h4>
        {DOCUMENT_TYPES.filter((dt) => !dt.required).map((dt) => {
          const docs = pendingDocs.filter((d) => d.type === dt.value);
          const isOver = dragOverType === dt.value;
          return (
            <DocTypeSection
              key={dt.value}
              dt={dt}
              docs={docs}
              isOver={isOver}
              isRequired={false}
              dragOverType={dragOverType}
              setDragOverType={setDragOverType}
              fileInputRefs={fileInputRefs}
              handleDropForType={handleDropForType}
              handleFileInputForType={handleFileInputForType}
              handleRemoveDoc={handleRemoveDoc}
            />
          );
        })}
      </div>

      {/* OCR Loading */}
      {ocrLoading && (
        <div className="bg-primary/5 border border-primary/30 rounded-lg p-4 flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
          <div>
            <div className="text-sm font-medium text-primary">กำลังอ่านข้อมูลจากบัตรประชาชน...</div>
            <div className="text-xs text-primary">ระบบ AI กำลังประมวลผลรูปภาพ</div>
          </div>
        </div>
      )}

      {/* OCR Results Panel */}
      {showOcrPanel && ocrResult && (
        <div className="bg-success/5 dark:bg-success/10 border border-success/20 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-success">ข้อมูลที่อ่านจากบัตรประชาชน</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-success">ความมั่นใจ: {(ocrResult.confidence * 100).toFixed(0)}%</span>
              <button onClick={() => setShowOcrPanel(false)} className="text-xs text-muted-foreground hover:text-foreground">ปิด</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {ocrResult.nationalId && (
              <div>
                <div className="text-xs text-muted-foreground">เลขบัตรประชาชน</div>
                <div className="text-sm font-mono font-medium text-foreground">
                  {ocrResult.nationalId.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}
                </div>
              </div>
            )}
            {ocrResult.prefix && (
              <div>
                <div className="text-xs text-muted-foreground">คำนำหน้า</div>
                <div className="text-sm font-medium text-foreground">{ocrResult.prefix}</div>
              </div>
            )}
            {ocrResult.fullName && (
              <div>
                <div className="text-xs text-muted-foreground">ชื่อ-นามสกุล</div>
                <div className="text-sm font-medium text-foreground">{ocrResult.fullName}</div>
              </div>
            )}
            {ocrResult.birthDate && (
              <div>
                <div className="text-xs text-muted-foreground">วันเกิด</div>
                <div className="text-sm font-medium text-foreground">{formatDateShort(ocrResult.birthDate)}</div>
              </div>
            )}
            {ocrResult.address && (
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">ที่อยู่ตามบัตร</div>
                <div className="text-sm font-medium text-foreground">{ocrResult.address}</div>
              </div>
            )}
            {ocrResult.issueDate && (
              <div>
                <div className="text-xs text-muted-foreground">วันออกบัตร</div>
                <div className="text-sm text-foreground">{formatDateShort(ocrResult.issueDate)}</div>
              </div>
            )}
            {ocrResult.expiryDate && (
              <div>
                <div className="text-xs text-muted-foreground">วันหมดอายุ</div>
                <div className="text-sm text-foreground">{formatDateShort(ocrResult.expiryDate)}</div>
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-2 border-t border-green-200">
            <button
              onClick={() => updateCustomerFromOcr(selectedCustomer)}
              className="px-4 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              อัปเดตข้อมูลลูกค้า
            </button>
            <button
              onClick={() => setShowOcrPanel(false)}
              className="px-4 py-1.5 text-xs border border-input text-muted-foreground rounded-lg hover:bg-muted"
            >
              ข้าม
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
