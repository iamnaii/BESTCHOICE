// Convert number to Thai Baht text (bahttext function)

const THAI_DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_POSITIONS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

function convertGroup(n: number): string {
  if (n === 0) return '';
  const str = String(Math.floor(n));
  let result = '';
  const len = str.length;

  for (let i = 0; i < len; i++) {
    const digit = parseInt(str[i], 10);
    const pos = len - i - 1;

    if (digit === 0) continue;

    if (pos === 0 && digit === 1 && len > 1) {
      result += 'เอ็ด';
    } else if (pos === 1 && digit === 1) {
      result += 'สิบ';
    } else if (pos === 1 && digit === 2) {
      result += 'ยี่สิบ';
    } else {
      result += THAI_DIGITS[digit] + THAI_POSITIONS[pos];
    }
  }
  return result;
}

export function bahtText(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '';
  if (num === 0) return 'ศูนย์บาทถ้วน';

  const isNegative = num < 0;
  const absNum = Math.abs(num);
  let intPart = Math.floor(absNum);
  let decPart = Math.round((absNum - intPart) * 100);
  // Handle rounding overflow: e.g. bahtText(1.999) → decPart=100
  if (decPart >= 100) {
    intPart += 1;
    decPart = 0;
  }

  let result = '';

  if (intPart === 0) {
    result = '';
  } else {
    // Handle millions
    const millions = Math.floor(intPart / 1000000);
    const remainder = intPart % 1000000;

    if (millions > 0) {
      if (millions > 999999) {
        // Recursive for very large numbers
        result += bahtText(millions).replace('บาทถ้วน', '').replace('บาท', '') + 'ล้าน';
      } else {
        result += convertGroup(millions) + 'ล้าน';
      }
    }
    if (remainder > 0) {
      result += convertGroup(remainder);
    }
  }

  if (isNegative) result = 'ลบ' + result;

  if (intPart > 0 && decPart > 0) {
    result += 'บาท' + convertGroup(decPart) + 'สตางค์';
  } else if (intPart > 0) {
    result += 'บาทถ้วน';
  } else if (decPart > 0) {
    result += convertGroup(decPart) + 'สตางค์';
  }

  return result;
}
