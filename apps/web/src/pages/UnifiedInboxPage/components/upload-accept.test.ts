import { describe, it, expect } from 'vitest';
import { isAcceptedFile } from './upload-accept';

describe('isAcceptedFile', () => {
  it('accepts any image type', () => {
    expect(isAcceptedFile({ type: 'image/png' })).toBe(true);
    expect(isAcceptedFile({ type: 'image/jpeg' })).toBe(true);
    expect(isAcceptedFile({ type: 'image/webp' })).toBe(true);
  });
  it('accepts pdf and word docs', () => {
    expect(isAcceptedFile({ type: 'application/pdf' })).toBe(true);
    expect(isAcceptedFile({ type: 'application/msword' })).toBe(true);
    expect(
      isAcceptedFile({
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toBe(true);
  });
  it('rejects other types', () => {
    expect(isAcceptedFile({ type: 'application/zip' })).toBe(false);
    expect(isAcceptedFile({ type: 'video/mp4' })).toBe(false);
    expect(isAcceptedFile({ type: '' })).toBe(false);
  });
});
