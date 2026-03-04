import * as iconv from 'iconv-lite';

// ─── Thai National ID Smart Card APDU Commands ──────────────────
// Reference: Thai Smart Card specification (MOI Thailand)
// Command format: [CLA=0x80] [INS=0xB0] [P1=offsetHi] [P2=offsetLo] [Lc=0x02] [LenHi] [LenLo]

function buildReadBinary(offsetHigh: number, offsetLow: number, lengthHigh: number, lengthLow: number): Buffer {
  return Buffer.from([0x80, 0xB0, offsetHigh, offsetLow, 0x02, lengthHigh, lengthLow]);
}

export const CMD = {
  SELECT: Buffer.from([0x00, 0xA4, 0x04, 0x00, 0x08, 0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01]),
  CID: buildReadBinary(0x00, 0x04, 0x00, 0x0D),
  THAI_NAME: buildReadBinary(0x00, 0x11, 0x00, 0x64),
  EN_NAME: buildReadBinary(0x00, 0x75, 0x00, 0x64),
  BIRTH_DATE: buildReadBinary(0x00, 0xD9, 0x00, 0x08),
  GENDER: buildReadBinary(0x00, 0xE1, 0x00, 0x01),
  ISSUER: buildReadBinary(0x00, 0xF6, 0x00, 0x64),
  ISSUE_DATE: buildReadBinary(0x01, 0x67, 0x00, 0x08),
  EXPIRE_DATE: buildReadBinary(0x01, 0x6F, 0x00, 0x08),
  ADDRESS: buildReadBinary(0x15, 0x79, 0x00, 0x64),
};

/** Status words indicating success */
const SW_SUCCESS = 0x9000;

export interface ThaiIdCardData {
  nationalId: string;
  prefix: string;
  firstName: string;
  lastName: string;
  prefixEn: string;
  firstNameEn: string;
  lastNameEn: string;
  birthDate: string;      // YYYY-MM-DD (Gregorian)
  gender: string;         // 'male' | 'female'
  issuer: string;
  issueDate: string;      // YYYY-MM-DD (Gregorian)
  expiryDate: string;     // YYYY-MM-DD (Gregorian)
  address: string;        // Full address text
  addressStructured: {
    houseNo: string;
    moo: string;
    village: string;
    soi: string;
    road: string;
    subdistrict: string;
    district: string;
    province: string;
  };
}

/** Decode TIS-620 (Thai encoding) buffer to string, strip trailing null bytes */
function decodeTIS620(buf: Buffer): string {
  return iconv.decode(buf, 'tis-620').replace(/\x00+$/g, '').trim();
}

/** Parse '#'-separated name: "prefix#firstName#middleName#lastName" */
function parseName(raw: string): { prefix: string; firstName: string; lastName: string } {
  const parts = raw.split('#').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    // prefix + firstName + [middleName] + lastName
    return {
      prefix: parts[0],
      firstName: parts[1],
      lastName: parts[parts.length - 1],
    };
  }
  if (parts.length === 2) {
    // Could be prefix + name, or firstName + lastName
    return { prefix: '', firstName: parts[0], lastName: parts[1] };
  }
  if (parts.length === 1) {
    return { prefix: '', firstName: parts[0], lastName: '' };
  }
  return { prefix: '', firstName: '', lastName: '' };
}

/** Convert Buddhist Era date (YYYYMMDD) to Gregorian YYYY-MM-DD */
function parseBEDate(raw: string): string {
  const cleaned = raw.replace(/\s/g, '').replace(/\x00/g, '');
  if (cleaned.length < 8) return '';
  const beYear = parseInt(cleaned.substring(0, 4), 10);
  const month = cleaned.substring(4, 6);
  const day = cleaned.substring(6, 8);
  const ceYear = beYear - 543;
  if (isNaN(ceYear) || ceYear < 1900 || ceYear > 2100) return '';
  return `${ceYear}-${month}-${day}`;
}

/**
 * Parse '#'-separated address from Thai Smart Card
 * Format: "houseNo#villageNo#lane(soi)#road#subdistrict#district#province"
 * Note: some cards use slightly different field ordering
 */
function parseAddress(raw: string): ThaiIdCardData['addressStructured'] & { fullAddress: string } {
  const parts = raw.split('#').map(s => s.trim()).filter(Boolean);
  // Thai Smart Card address has these fields in order:
  // [0] House number  [1] Village/Moo  [2] Village name
  // [3] Soi/Lane  [4] Road  [5] Sub-district (Tambon)
  // [6] District (Amphoe)  [7] Province

  const structured = {
    houseNo: parts[0] || '',
    moo: (parts[1] || '').replace(/^(หมู่ที่|หมู่|ม\.)\s*/g, ''),
    village: parts[2] || '',
    soi: (parts[3] || '').replace(/^(ซอย|ซ\.)\s*/g, ''),
    road: (parts[4] || '').replace(/^(ถนน|ถ\.)\s*/g, ''),
    subdistrict: (parts[5] || '').replace(/^(ตำบล|แขวง|ต\.)\s*/g, ''),
    district: (parts[6] || '').replace(/^(อำเภอ|เขต|อ\.)\s*/g, ''),
    province: (parts[7] || '').replace(/^(จังหวัด|จ\.)\s*/g, ''),
  };

  const fullAddress = parts.filter(Boolean).join(' ');

  return { ...structured, fullAddress };
}

/** Transmit a single APDU to the card (low-level, no GET RESPONSE handling) */
function transmitRaw(reader: any, protocol: number, cmd: Buffer, receiveLen: number = 256): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    reader.transmit(cmd, receiveLen, protocol, (err: Error | null, data: Buffer) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

/**
 * Transmit an APDU command to the card, automatically handling SW 61XX
 * (GET RESPONSE chaining) so the caller always gets the full response.
 */
async function transmit(reader: any, protocol: number, cmd: Buffer): Promise<Buffer> {
  let response = await transmitRaw(reader, protocol, cmd);

  // Handle SW 61XX: "XX bytes available — use GET RESPONSE to fetch"
  while (response.length >= 2) {
    const sw1 = response[response.length - 2];
    const sw2 = response[response.length - 1];

    if (sw1 !== 0x61) break;

    const getResponseCmd = Buffer.from([0x00, 0xC0, 0x00, 0x00, sw2]);
    const dataBeforeSW = response.subarray(0, response.length - 2);
    const nextResponse = await transmitRaw(reader, protocol, getResponseCmd, sw2 + 2);

    // Concatenate any data from the previous response with the GET RESPONSE data
    if (dataBeforeSW.length > 0) {
      response = Buffer.concat([dataBeforeSW, nextResponse]);
    } else {
      response = nextResponse;
    }
  }

  return response;
}

/** Get the 2-byte status word from a response */
function getStatusWord(response: Buffer): number {
  if (response.length < 2) return 0;
  return (response[response.length - 2] << 8) | response[response.length - 1];
}

/** Check if response ends with SW 90 00 (success) */
function isSuccess(response: Buffer): boolean {
  return getStatusWord(response) === SW_SUCCESS;
}

/** Extract data from response (strip trailing 2-byte status word) */
function getData(response: Buffer): Buffer {
  return response.subarray(0, response.length - 2);
}

/**
 * Read all data from a Thai National ID Smart Card
 * @param reader - pcsclite CardReader object with an active connection
 * @param protocol - connection protocol (T0 or T1)
 */
export async function readThaiIdCard(reader: any, protocol: number): Promise<ThaiIdCardData> {
  // 1. SELECT Thai ID Application
  const selectResp = await transmit(reader, protocol, CMD.SELECT);
  if (!isSuccess(selectResp)) {
    const sw = getStatusWord(selectResp).toString(16).toUpperCase().padStart(4, '0');
    throw new Error(`ไม่สามารถเลือก Application บนบัตรได้ (SW=${sw}) — อาจไม่ใช่บัตรประชาชนไทย`);
  }

  // 2. Read CID
  const cidResp = await transmit(reader, protocol, CMD.CID);
  if (!isSuccess(cidResp)) throw new Error('ไม่สามารถอ่านเลขบัตรประชาชนได้');
  const nationalId = getData(cidResp).toString('ascii').trim();

  // 3. Read Thai Name
  const thaiNameResp = await transmit(reader, protocol, CMD.THAI_NAME);
  const thaiNameRaw = isSuccess(thaiNameResp) ? decodeTIS620(getData(thaiNameResp)) : '';
  const thaiName = parseName(thaiNameRaw);

  // 4. Read English Name
  const enNameResp = await transmit(reader, protocol, CMD.EN_NAME);
  const enNameRaw = isSuccess(enNameResp) ? getData(enNameResp).toString('ascii').replace(/\x00+$/g, '').trim() : '';
  const enName = parseName(enNameRaw);

  // 5. Read Birth Date
  const birthResp = await transmit(reader, protocol, CMD.BIRTH_DATE);
  const birthDate = isSuccess(birthResp) ? parseBEDate(getData(birthResp).toString('ascii')) : '';

  // 6. Read Gender
  const genderResp = await transmit(reader, protocol, CMD.GENDER);
  let gender = '';
  if (isSuccess(genderResp)) {
    const g = getData(genderResp)[0];
    gender = g === 1 ? 'male' : g === 2 ? 'female' : '';
  }

  // 7. Read Card Issuer
  const issuerResp = await transmit(reader, protocol, CMD.ISSUER);
  const issuer = isSuccess(issuerResp) ? decodeTIS620(getData(issuerResp)) : '';

  // 8. Read Issue Date
  const issueDateResp = await transmit(reader, protocol, CMD.ISSUE_DATE);
  const issueDate = isSuccess(issueDateResp) ? parseBEDate(getData(issueDateResp).toString('ascii')) : '';

  // 9. Read Expire Date
  const expireDateResp = await transmit(reader, protocol, CMD.EXPIRE_DATE);
  const expiryDate = isSuccess(expireDateResp) ? parseBEDate(getData(expireDateResp).toString('ascii')) : '';

  // 10. Read Address
  const addressResp = await transmit(reader, protocol, CMD.ADDRESS);
  const addressRaw = isSuccess(addressResp) ? decodeTIS620(getData(addressResp)) : '';
  const addressParsed = parseAddress(addressRaw);

  return {
    nationalId,
    prefix: thaiName.prefix,
    firstName: thaiName.firstName,
    lastName: thaiName.lastName,
    prefixEn: enName.prefix,
    firstNameEn: enName.firstName,
    lastNameEn: enName.lastName,
    birthDate,
    gender,
    issuer,
    issueDate,
    expiryDate,
    address: addressParsed.fullAddress,
    addressStructured: {
      houseNo: addressParsed.houseNo,
      moo: addressParsed.moo,
      village: addressParsed.village,
      soi: addressParsed.soi,
      road: addressParsed.road,
      subdistrict: addressParsed.subdistrict,
      district: addressParsed.district,
      province: addressParsed.province,
    },
  };
}
