import type { ReferencePricingCatalog } from './reference-pricing.types';

export const referenceModelKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
export const referenceStorageKey = (value: string) => value.replace(/\s+/g, '').toUpperCase();

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const optionalText = (value: unknown) => value === undefined || value === null || typeof value === 'string';
const unique = (values: unknown[]) => new Set(values).size === values.length;

/** Parse the entire catalog before selecting a profile: broken references must never fall back to a different price policy. */
export function parseReferencePricingCatalog(raw: string): ReferencePricingCatalog {
  const invalid = () => { throw new Error('Invalid reference pricing catalog'); };
  if (typeof raw !== 'string' || raw.length > 8_000_000) invalid();
  const data: unknown = JSON.parse(raw);
  if (!object(data) || data.version !== 1 || !text(data.source) || !text(data.capturedAt)
    || !Number.isFinite(Date.parse(data.capturedAt)) || !object(data.profiles)
    || !Array.isArray(data.assignments) || !data.assignments.length || data.assignments.length > 10000) return invalid();
  const profiles = Object.values(data.profiles);
  if (!profiles.length || profiles.length > 1000) invalid();
  for (const profile of profiles) {
    if (!object(profile) || profile.pricingMode !== 'MAX_PERCENT_EXACT' || profile.eligibilityRequired !== true
      || !text(profile.eligibilityText) || !Array.isArray(profile.questions) || !profile.questions.length || profile.questions.length > 100) return invalid();
    const keys: string[] = [], ids: string[] = [], choiceIds: string[] = [];
    for (const question of profile.questions) {
      if (!object(question) || !text(question.id) || !text(question.key) || question.key === '__device_eligibility'
        || !text(question.title) || !optionalText(question.helpText) || !['SINGLE', 'MULTI'].includes(String(question.selectType))
        || !Array.isArray(question.choices) || !question.choices.length || question.choices.length > 100) return invalid();
      keys.push(question.key); ids.push(question.id);
      for (const choice of question.choices) {
        if (!object(choice) || !text(choice.id) || !text(choice.label) || !['FIXED', 'PERCENT'].includes(String(choice.deductType))
          || typeof choice.deductValue !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(choice.deductValue)
          || !Number.isFinite(Number(choice.deductValue)) || Number(choice.deductValue) > (choice.deductType === 'PERCENT' ? 100 : 9999999999)
          || !optionalText(choice.helpText) || (choice.isNoneChoice !== undefined && typeof choice.isNoneChoice !== 'boolean')) return invalid();
        choiceIds.push(choice.id);
      }
    }
    if (!unique(keys) || !unique(ids) || !unique(choiceIds)) invalid();
  }
  const assigned = new Set<string>();
  for (const assignment of data.assignments) {
    if (!object(assignment) || !text(assignment.model) || !/^iphone\b/i.test(assignment.model.trim())
      || !text(assignment.storage) || !/^\d+(GB|TB)$/.test(referenceStorageKey(assignment.storage))
      || !text(assignment.profileId) || !Object.prototype.hasOwnProperty.call(data.profiles, assignment.profileId)) return invalid();
    const key = `${referenceModelKey(assignment.model)}|${referenceStorageKey(assignment.storage)}`;
    if (assigned.has(key)) invalid();
    assigned.add(key);
  }
  return data as unknown as ReferencePricingCatalog;
}
