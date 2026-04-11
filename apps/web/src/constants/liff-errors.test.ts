import { describe, it, expect } from 'vitest';
import {
  LIFF_ERRORS,
  SLIP_MAX_SIZE_BYTES,
  validateSlipFile,
} from './liff-errors';

/**
 * Tests for validateSlipFile — mirrors backend validators in
 * apps/api/src/modules/line-oa/line-oa-payment.controller.ts so that
 * client-side failures match what the server would reject.
 */

function makeFile(opts: {
  name?: string;
  size?: number;
  type?: string;
}): File {
  const { name = 'slip.jpg', size = 1024, type = 'image/jpeg' } = opts;
  // A blob of the requested size; contents don't matter for validation.
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe('validateSlipFile', () => {
  describe('size limit', () => {
    it('accepts a file exactly at the 5MB limit', () => {
      const f = makeFile({ size: SLIP_MAX_SIZE_BYTES, type: 'image/jpeg' });
      expect(validateSlipFile(f)).toBeNull();
    });

    it('rejects a file that exceeds the 5MB limit by a single byte', () => {
      const f = makeFile({ size: SLIP_MAX_SIZE_BYTES + 1, type: 'image/jpeg' });
      expect(validateSlipFile(f)).toBe(LIFF_ERRORS.SLIP_TOO_LARGE);
    });
  });

  describe('mime-type allow-list', () => {
    it.each([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ])('accepts %s', (type) => {
      expect(validateSlipFile(makeFile({ type }))).toBeNull();
    });

    it('rejects PDF (server would also 400)', () => {
      const f = makeFile({ name: 'slip.pdf', type: 'application/pdf' });
      expect(validateSlipFile(f)).toBe(LIFF_ERRORS.SLIP_WRONG_FORMAT);
    });

    it('rejects image/gif (not in backend regex)', () => {
      expect(validateSlipFile(makeFile({ type: 'image/gif' }))).toBe(
        LIFF_ERRORS.SLIP_WRONG_FORMAT,
      );
    });
  });

  describe('empty mime fallback to extension check', () => {
    // Some Android browsers / LINE in-app browser report empty `file.type`
    // for HEIC — we fall back to filename extension so the user isn't
    // blocked on a technically-valid file.
    it('accepts .heic with empty mime', () => {
      const f = makeFile({ name: 'IMG_0001.HEIC', type: '' });
      expect(validateSlipFile(f)).toBeNull();
    });

    it('accepts .jpg with empty mime', () => {
      const f = makeFile({ name: 'photo.jpg', type: '' });
      expect(validateSlipFile(f)).toBeNull();
    });

    it('rejects .txt with empty mime', () => {
      const f = makeFile({ name: 'notes.txt', type: '' });
      expect(validateSlipFile(f)).toBe(LIFF_ERRORS.SLIP_WRONG_FORMAT);
    });

    it('rejects filename with no extension and empty mime', () => {
      const f = makeFile({ name: 'screenshot', type: '' });
      expect(validateSlipFile(f)).toBe(LIFF_ERRORS.SLIP_WRONG_FORMAT);
    });
  });

  describe('size check runs before type check', () => {
    // A 6MB PDF should report "too large" first — size is cheaper to show
    // ("compress your photo") than type ("use a different format").
    it('reports SLIP_TOO_LARGE even when type is also invalid', () => {
      const f = makeFile({
        name: 'huge.pdf',
        size: SLIP_MAX_SIZE_BYTES + 1,
        type: 'application/pdf',
      });
      expect(validateSlipFile(f)).toBe(LIFF_ERRORS.SLIP_TOO_LARGE);
    });
  });
});
