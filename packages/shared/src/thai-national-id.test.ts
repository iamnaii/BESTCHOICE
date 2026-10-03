import { describe, expect, it } from 'vitest';
import { isValidThaiNationalId } from './thai-national-id';

describe('Thai national ID checksum shared by API and forms', () => {
  it('accepts a 13-digit ID with the expected checksum', () => {
    expect(isValidThaiNationalId('1100700418391')).toBe(true);
  });

  it.each(['1100700418390', '', '12345', '12345678901234', '110070041839a', ' 1100700418391', '๑๑๐๐๗๐๐๔๑๘๓๙๑'])('rejects malformed or invalid ID %s', (value) => {
    expect(isValidThaiNationalId(value)).toBe(false);
  });
});
