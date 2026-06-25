const ACCEPTED_DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** Mirrors the composer file input's accept="image/*,.pdf,.doc,.docx". */
export function isAcceptedFile(file: { type: string }): boolean {
  return file.type.startsWith('image/') || ACCEPTED_DOC_TYPES.includes(file.type);
}
