/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useRef } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { checkCardReaderStatus, readSmartCard } from '@/lib/cardReader';
import { AddressData } from '@/components/ui/AddressForm';
import { toast } from 'sonner';
import type { Customer, OcrResult, PendingDoc } from '../types';

interface UseOcrFlowParams {
  setSelectedCustomer: (c: Customer | null) => void;
  setPendingDocs: (updater: PendingDoc[] | ((prev: PendingDoc[]) => PendingDoc[])) => void;
  setCustForm: (updater: any) => void;
  setCustAddrIdCard: (updater: AddressData | ((prev: AddressData) => AddressData)) => void;
}

export function useOcrFlow({
  setSelectedCustomer,
  setPendingDocs,
  setCustForm,
  setCustAddrIdCard,
}: UseOcrFlowParams) {
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [cardReaderLoading, setCardReaderLoading] = useState(false);
  const [showOcrPanel, setShowOcrPanel] = useState(false);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [ocrScannedFile, setOcrScannedFile] = useState<File | null>(null);

  // Helper: build structured address JSON from OCR result
  const buildOcrAddressJson = (ocrData: OcrResult): string | undefined => {
    if (ocrData.addressStructured) {
      const a = ocrData.addressStructured;
      const hasData = Object.values(a).some((v) => v !== '');
      if (hasData) return JSON.stringify(a);
    }
    if (ocrData.address) {
      const raw = ocrData.address;
      const addr: Record<string, string> = {
        houseNo: '', moo: '', village: '', soi: '', road: '',
        province: '', district: '', subdistrict: '', postalCode: '',
      };
      const zipMatch = raw.match(/(\d{5})\s*$/);
      if (zipMatch) addr.postalCode = zipMatch[1];
      const houseMatch = raw.match(/^(\d+(?:\/\d+)?)\s/);
      if (houseMatch) addr.houseNo = houseMatch[1];
      const mooMatch = raw.match(/(?:หมู่(?:ที่)?|ม\.)\s*(\d+)/);
      if (mooMatch) addr.moo = mooMatch[1];
      const soiMatch = raw.match(/(?:ซอย|ซ\.)\s*([^\s,]+)/);
      if (soiMatch) addr.soi = soiMatch[1];
      const roadMatch = raw.match(/(?:ถนน|ถ\.)\s*([^\s,]+)/);
      if (roadMatch) addr.road = roadMatch[1];
      const villageMatch = raw.match(/(?:หมู่บ้าน|ม\.บ\.|คอนโด)\s*([^\s,]+)/);
      if (villageMatch) addr.village = villageMatch[1];
      const subdistrictMatch = raw.match(/((?:ตำบล|ต\.|แขวง)\s*[^\s,]+)/);
      if (subdistrictMatch) addr.subdistrict = subdistrictMatch[1];
      const districtMatch = raw.match(/((?:อำเภอ|อ\.|เขต)\s*[^\s,]+)/);
      if (districtMatch) addr.district = districtMatch[1];
      const provinceMatch = raw.match(/(?:จังหวัด|จ\.)\s*([^\s,\d]+)/);
      if (provinceMatch) addr.province = provinceMatch[1];
      const hasStructured = Object.values(addr).some((v) => v !== '');
      if (hasStructured) return JSON.stringify(addr);
      return raw;
    }
    return undefined;
  };

  // Smart Card: read ID card (Step 2)
  const handleSmartCardRead = async () => {
    setCardReaderLoading(true);
    setOcrResult(null);
    setShowOcrPanel(false);
    setShowCreateCustomer(false);
    setSelectedCustomer(null);

    const status = await checkCardReaderStatus();
    if (!status || status.status === 'no_pcsc') {
      toast.error('ไม่พบเครื่องอ่านบัตร — กรุณาติดตั้ง BESTCHOICE Card Reader Service');
      setCardReaderLoading(false);
      return;
    }
    if (status.status === 'no_reader') {
      toast.error('ไม่พบเครื่องอ่านบัตร — กรุณาเสียบเครื่องอ่านบัตร USB');
      setCardReaderLoading(false);
      return;
    }
    if (status.status === 'waiting') {
      toast.error('กรุณาเสียบบัตรประชาชนเข้าเครื่องอ่านบัตร');
      setCardReaderLoading(false);
      return;
    }

    try {
      const card = await readSmartCard();

      const data: OcrResult = {
        nationalId: card.nationalId,
        nationalIdValid: true,
        prefix: card.prefix,
        firstName: card.firstName,
        lastName: card.lastName,
        fullName: `${card.firstName} ${card.lastName}`.trim(),
        birthDate: card.birthDate,
        address: card.address,
        addressStructured: { ...card.addressStructured, postalCode: '' },
        issueDate: card.issueDate,
        expiryDate: card.expiryDate,
        confidence: 1.0,
      };

      setOcrResult(data);
      setShowOcrPanel(true);
      toast.success('อ่านบัตรสำเร็จ (Smart Card — ข้อมูลแม่นยำ 100%)');

      if (card.nationalId && /^\d{13}$/.test(card.nationalId)) {
        try {
          const searchRes = await api.get(`/customers?search=${card.nationalId}`);
          const found = (searchRes.data.data || []) as Customer[];
          if (found.length > 0) {
            setSelectedCustomer(found[0]);
            toast.success(`พบลูกค้าในระบบ: ${found[0].name}`);
          } else {
            setShowCreateCustomer(true);
            toast.success('ไม่พบลูกค้าในระบบ สามารถสร้างลูกค้าใหม่ได้');
          }
        } catch {
          setShowCreateCustomer(true);
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'ไม่สามารถอ่านบัตรได้');
    } finally {
      setCardReaderLoading(false);
    }
  };

  // Smart Card: read ID card for customer modal (pre-fill form)
  const handleSmartCardForModal = async () => {
    setCardReaderLoading(true);

    const status = await checkCardReaderStatus();
    if (!status || status.status === 'no_pcsc') {
      toast.error('ไม่พบเครื่องอ่านบัตร — กรุณาติดตั้ง BESTCHOICE Card Reader Service');
      setCardReaderLoading(false);
      return;
    }
    if (status.status === 'no_reader') {
      toast.error('ไม่พบเครื่องอ่านบัตร — กรุณาเสียบเครื่องอ่านบัตร USB');
      setCardReaderLoading(false);
      return;
    }
    if (status.status === 'waiting') {
      toast.error('กรุณาเสียบบัตรประชาชนเข้าเครื่องอ่านบัตร');
      setCardReaderLoading(false);
      return;
    }

    try {
      const card = await readSmartCard();
      setCustForm((prev: any) => ({
        ...prev,
        prefix: card.prefix || prev.prefix,
        firstName: card.firstName || prev.firstName,
        lastName: card.lastName || prev.lastName,
        nationalId: card.nationalId || prev.nationalId,
        birthDate: card.birthDate ? card.birthDate.split('T')[0] : prev.birthDate,
      }));
      if (card.addressStructured) {
        setCustAddrIdCard({
          houseNo: card.addressStructured.houseNo || '',
          moo: card.addressStructured.moo || '',
          village: card.addressStructured.village || '',
          soi: card.addressStructured.soi || '',
          road: card.addressStructured.road || '',
          subdistrict: card.addressStructured.subdistrict || '',
          district: card.addressStructured.district || '',
          province: card.addressStructured.province || '',
          postalCode: '',
        });
      }
      toast.success('อ่านบัตรสำเร็จ — กรอกข้อมูลให้อัตโนมัติแล้ว');
    } catch (err: any) {
      toast.error(err.message || 'ไม่สามารถอ่านบัตรได้');
    } finally {
      setCardReaderLoading(false);
    }
  };

  // OCR: scan ID card (Step 2)
  const handleOcrScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (ocrFileRef.current) ocrFileRef.current.value = '';
    if (ocrLoading) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพ');
      return;
    }

    setOcrLoading(true);
    setOcrResult(null);
    setShowOcrPanel(false);
    setShowCreateCustomer(false);
    setSelectedCustomer(null);
    setOcrScannedFile(file);

    try {
      const imageBase64 = await compressImageForOcr(file);
      const { data } = await api.post('/ocr/id-card', { imageBase64 }, { timeout: 90000 });
      setOcrResult(data);
      setShowOcrPanel(true);

      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.5) {
        toast.error(`อ่านบัตรได้ แต่ความมั่นใจต่ำมาก (${pct}%) กรุณาตรวจสอบข้อมูลทุกช่อง`);
      } else if (data.confidence < 0.7) {
        toast.warning(`อ่านบัตรสำเร็จ แต่ความมั่นใจค่อนข้างต่ำ (${pct}%) กรุณาตรวจสอบข้อมูล`);
      }

      if (data.nationalId && !data.nationalIdValid) {
        toast.error('เลขบัตรประชาชนที่อ่านได้ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
      }

      if (data.nationalId && /^\d{13}$/.test(data.nationalId)) {
        try {
          const searchRes = await api.get(`/customers?search=${data.nationalId}`);
          const found = (searchRes.data.data || []) as Customer[];
          if (found.length > 0) {
            setSelectedCustomer(found[0]);
            toast.success(`พบลูกค้าในระบบ: ${found[0].name}`);
          } else {
            setShowCreateCustomer(true);
            if (data.confidence >= 0.5) {
              toast.success('อ่านบัตรสำเร็จ - ไม่พบลูกค้าในระบบ สามารถสร้างลูกค้าใหม่ได้');
            }
          }
        } catch {
          setShowCreateCustomer(true);
        }
      } else {
        if (data.confidence >= 0.7) {
          toast.success('อ่านบัตรสำเร็จ');
        }
      }
    } catch (err: any) {
      if (err.code === 'ECONNABORTED' || !err.response) {
        toast.error('OCR ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setOcrLoading(false);
    }
  };

  // OCR: create new customer from scanned data
  const createCustomerFromOcr = async () => {
    if (!ocrResult) return;
    if (!newCustomerPhone.trim()) {
      toast.error('กรุณากรอกเบอร์โทร');
      return;
    }
    setCreatingCustomer(true);
    try {
      const body: Record<string, unknown> = {
        phone: newCustomerPhone.trim(),
      };
      if (ocrResult.nationalId && /^\d{13}$/.test(ocrResult.nationalId)) {
        body.nationalId = ocrResult.nationalId;
      }
      if (ocrResult.prefix) body.prefix = ocrResult.prefix;
      const name = [ocrResult.firstName, ocrResult.lastName].filter(Boolean).join(' ') || ocrResult.fullName;
      if (name) body.name = name.trim();
      if (ocrResult.birthDate) body.birthDate = ocrResult.birthDate;
      const addrJson = buildOcrAddressJson(ocrResult);
      if (addrJson) body.addressIdCard = addrJson;

      const { data } = await api.post('/customers', body);
      setSelectedCustomer(data);
      setShowCreateCustomer(false);
      setShowOcrPanel(false);
      setNewCustomerPhone('');
      toast.success(`สร้างลูกค้าใหม่สำเร็จ: ${data.name}`);

      if (ocrScannedFile) {
        const preview = URL.createObjectURL(ocrScannedFile);
        setPendingDocs((prev) => [...prev, { id: crypto.randomUUID(), type: 'ID_CARD_COPY', file: ocrScannedFile, preview }]);
      }
    } catch (err: any) {
      const existing = err.response?.data?.existingCustomer;
      if (existing && err.response?.status === 409) {
        try {
          const { data: fullCustomer } = await api.get(`/customers/${existing.id}`);
          setSelectedCustomer(fullCustomer);
          setShowCreateCustomer(false);
          setShowOcrPanel(false);
          setNewCustomerPhone('');
          toast.success(`ลูกค้ามีอยู่แล้ว: ${existing.name} - เลือกให้อัตโนมัติ`);
          if (ocrScannedFile) {
            const preview = URL.createObjectURL(ocrScannedFile);
            setPendingDocs((prev) => [...prev, { id: crypto.randomUUID(), type: 'ID_CARD_COPY', file: ocrScannedFile, preview }]);
          }
        } catch {
          toast.error('ลูกค้ามีอยู่แล้วแต่โหลดข้อมูลไม่สำเร็จ กรุณาค้นหาด้วยตนเอง');
        }
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setCreatingCustomer(false);
    }
  };

  // OCR: update existing customer info from scanned data (Step 4)
  const updateCustomerFromOcr = async (selectedCustomer: Customer | null) => {
    if (!ocrResult || !selectedCustomer) return;
    try {
      const updateData: Record<string, unknown> = {};
      if (ocrResult.prefix) updateData.prefix = ocrResult.prefix;
      const name = [ocrResult.firstName, ocrResult.lastName].filter(Boolean).join(' ') || ocrResult.fullName;
      if (name) updateData.name = name.trim();
      if (ocrResult.birthDate) updateData.birthDate = ocrResult.birthDate;
      const addrJson = buildOcrAddressJson(ocrResult);
      if (addrJson) updateData.addressIdCard = addrJson;

      await api.patch(`/customers/${selectedCustomer.id}`, updateData);
      toast.success('อัปเดตข้อมูลลูกค้าสำเร็จ');
      setShowOcrPanel(false);
    } catch (err: any) {
      toast.error(getErrorMessage(err));
    }
  };

  // When selecting existing customer from OCR results, also auto-add ID card to pending docs
  const selectCustomerFromOcr = () => {
    if (ocrScannedFile) {
      setPendingDocs((prev) => {
        if (prev.some((d) => d.type === 'ID_CARD_COPY' && d.file.name === ocrScannedFile.name)) return prev;
        const preview = URL.createObjectURL(ocrScannedFile);
        return [...prev, { id: crypto.randomUUID(), type: 'ID_CARD_COPY', file: ocrScannedFile, preview }];
      });
    }
    setShowOcrPanel(false);
    setShowCreateCustomer(false);
    setNewCustomerPhone('');
  };

  return {
    ocrFileRef,
    ocrResult,
    setOcrResult,
    ocrLoading,
    setOcrLoading,
    cardReaderLoading,
    showOcrPanel,
    setShowOcrPanel,
    showCreateCustomer,
    setShowCreateCustomer,
    newCustomerPhone,
    setNewCustomerPhone,
    creatingCustomer,
    ocrScannedFile,
    setOcrScannedFile,
    handleSmartCardRead,
    handleSmartCardForModal,
    handleOcrScan,
    createCustomerFromOcr,
    updateCustomerFromOcr,
    selectCustomerFromOcr,
    buildOcrAddressJson,
  };
}
