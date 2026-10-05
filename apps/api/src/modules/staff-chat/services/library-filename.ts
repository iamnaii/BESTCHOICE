/** Browsers send UTF-8 multipart filenames; busboy's default exposes those bytes as latin1. */
export function libraryFilename(raw: string, extension: string): string {
  let decoded = raw;
  if (Array.from(raw).every(character => character.charCodeAt(0) <= 255)) {
    const bytes = Buffer.from(raw, 'latin1');
    const utf8 = bytes.toString('utf8');
    if (Buffer.from(utf8, 'utf8').equals(bytes)) decoded = utf8;
  }
  const safe = Array.from(decoded, character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 || character === '/' || character === '\\' ? '_' : character;
  }).join('').trim().slice(0, 180);
  return safe || `ไฟล์.${extension}`;
}
