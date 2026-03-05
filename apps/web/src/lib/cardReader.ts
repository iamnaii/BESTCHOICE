/**
 * Card Reader Service client
 * Communicates with the local BESTCHOICE Card Reader Service
 * running on localhost:3457 (installed on the shop's Windows PC)
 */

const CARD_READER_URL = 'http://localhost:3457';
const TIMEOUT = 5000;

export interface CardReaderStatus {
  service: string;
  version: string;
  status: 'no_pcsc' | 'no_reader' | 'waiting' | 'card_inserted' | 'reading' | 'error';
  readerName: string | null;
  error: string | null;
  hasCardData: boolean;
  statusText: string;
}

export interface SmartCardAddress {
  houseNo: string;
  moo: string;
  village: string;
  soi: string;
  road: string;
  subdistrict: string;
  district: string;
  province: string;
}

export interface SmartCardData {
  nationalId: string;
  prefix: string;
  firstName: string;
  lastName: string;
  prefixEn: string;
  firstNameEn: string;
  lastNameEn: string;
  birthDate: string;
  gender: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  address: string;
  addressStructured: SmartCardAddress;
}

interface CardReaderResponse {
  success: boolean;
  data: SmartCardData;
}

/** Check if the card reader service is running */
export async function checkCardReaderStatus(): Promise<CardReaderStatus | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const resp = await fetch(`${CARD_READER_URL}/api/status`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    clearTimeout(timeoutId);
    return null; // Service not running
  }
}

/** Read card data from the local card reader service */
export async function readSmartCard(): Promise<SmartCardData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT * 2);

  try {
    const resp = await fetch(`${CARD_READER_URL}/api/read-card`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      let message = 'อ่านบัตรไม่สำเร็จ';
      try {
        const errBody = await resp.json();
        if (errBody.message) message = errBody.message;
      } catch {
        // Response body is not JSON
      }
      throw new Error(message);
    }

    const body = await resp.json();
    return (body as CardReaderResponse).data;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Card reader service ไม่ตอบสนอง (timeout)');
    }
    throw err;
  }
}