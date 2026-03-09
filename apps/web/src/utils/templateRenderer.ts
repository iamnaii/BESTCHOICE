// Template variable substitution engine
import { applyFormat } from './formatters';
import type { VariableDefinition } from '@/types/template';

interface RenderContext {
  [key: string]: any;
}

// Build flat context from variable definitions using sample values
export function buildSampleContext(variables: VariableDefinition[]): RenderContext {
  const ctx: RenderContext = {};
  for (const v of variables) {
    ctx[v.key] = v.sampleValue;
  }
  return ctx;
}

// Resolve a dotted key like "CONTRACT.NUMBER" from context
function resolveKey(ctx: RenderContext, key: string): any {
  // Try direct match first
  if (key in ctx) return ctx[key];
  // Try dotted path
  const parts = key.split('.');
  let current: any = ctx;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

// Replace {{= VAR }} and {{= VAR | format }} in a string
export function renderVariables(template: string, ctx: RenderContext): string {
  // Handle print expressions: {{= VAR }} or {{= VAR | format }}
  let result = template.replace(/\{\{=\s*([^|}]+?)(?:\s*\|\s*([^}]+?))?\s*\}\}/g, (_match, key: string, format: string) => {
    const val = resolveKey(ctx, key.trim());
    if (val === undefined) return _match; // leave unresolved
    if (format) {
      return applyFormat(val, format.trim());
    }
    return String(val ?? '');
  });

  // Handle for loops: {{for ITEM in ARRAY}} ... {{/for}}
  result = result.replace(/\{\{for\s+(\w+)\s+in\s+(\w+(?:\.\w+)*)\s*\}\}([\s\S]*?)\{\{\/for\}\}/g,
    (_match, itemVar: string, arrayKey: string, body: string) => {
      const arr = resolveKey(ctx, arrayKey.trim());
      if (!Array.isArray(arr)) return '';
      return arr.map((item, index) => {
        let rendered = body;
        // Replace {{= ITEM.PROP }} and {{= ITEM.PROP | format }}
        rendered = rendered.replace(/\{\{=\s*([^|}]+?)(?:\s*\|\s*([^}]+?))?\s*\}\}/g, (_m, k: string, fmt: string) => {
          const trimmedKey = k.trim();
          let val: any;
          if (trimmedKey.startsWith(itemVar + '.')) {
            const prop = trimmedKey.substring(itemVar.length + 1);
            val = item[prop];
          } else {
            val = resolveKey(ctx, trimmedKey);
          }
          if (val === undefined) return _m;
          if (fmt) return applyFormat(val, fmt.trim());
          return String(val ?? '');
        });
        // Replace @index0 and @index1
        rendered = rendered.replace(/@index0/g, String(index));
        rendered = rendered.replace(/@index1/g, String(index + 1));
        return rendered;
      }).join('');
    }
  );

  // Handle conditionals: {{if COND}} ... {{elseif COND}} ... {{else}} ... {{/if}}
  result = result.replace(/\{\{if\s+(.+?)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, condition: string, body: string) => {
      const parts = body.split(/\{\{(?:elseif\s+(.+?)|else)\s*\}\}/);
      const conditions = [condition.trim()];
      const bodies: string[] = [];
      let elseBody = '';

      // Parse if/elseif/else structure
      bodies.push(parts[0]);
      for (let i = 1; i < parts.length; i += 2) {
        if (parts[i]) {
          conditions.push(parts[i].trim());
          bodies.push(parts[i + 1] || '');
        } else {
          elseBody = parts[i + 1] || '';
        }
      }

      for (let i = 0; i < conditions.length; i++) {
        const val = resolveKey(ctx, conditions[i]);
        if (val) return bodies[i];
      }
      return elseBody;
    }
  );

  return result;
}

// Extract all variable keys from template text
export function extractVariableKeys(text: string): string[] {
  const keys = new Set<string>();
  // Match {{= KEY }} or {{= KEY | format }}
  const printMatches = text.matchAll(/\{\{=\s*([^|}]+?)(?:\s*\|[^}]*)?\s*\}\}/g);
  for (const m of printMatches) keys.add(m[1].trim());
  // Match {{for X in KEY}}
  const forMatches = text.matchAll(/\{\{for\s+\w+\s+in\s+(\w+(?:\.\w+)*)\s*\}\}/g);
  for (const m of forMatches) keys.add(m[1].trim());
  // Match {{if KEY}}
  const ifMatches = text.matchAll(/\{\{if\s+(.+?)\s*\}\}/g);
  for (const m of ifMatches) keys.add(m[1].trim());
  return [...keys];
}

// Validate variables against available list
export function validateVariables(text: string, available: VariableDefinition[]): { valid: string[]; invalid: string[] } {
  const keys = extractVariableKeys(text);
  const availableKeys = new Set(available.map(v => v.key));
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const key of keys) {
    // For loop item variables like CONTACT.NAME — check parent array
    const rootKey = key.split('.')[0];
    if (availableKeys.has(key) || availableKeys.has(rootKey)) {
      valid.push(key);
    } else {
      invalid.push(key);
    }
  }
  return { valid, invalid };
}
