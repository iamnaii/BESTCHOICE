/** Store buyback policy; these regional suffixes are not proof of the original sale country.
 * Sources and verified Thai retail examples: docs/reference/sell-thai-part-numbers-2026-11-21.md.
 * Do not suggest suffixes for unknown generations until their Thai retail codes have been checked.
 */
export function sellThaiPartSuffix(model: string): 'TH/A' | 'ZP/A' | null {
  if (/^iphone\s+air$/i.test(model.trim())) return 'ZP/A';
  const match = /^iphone\s+(12|13|14|15|16|17)(?:\s+(?:mini|plus|pro(?:\s+max)?))?$/i.exec(model.trim());
  if (!match) return null;
  return Number(match[1]) <= 13 ? 'TH/A' : 'ZP/A';
}
