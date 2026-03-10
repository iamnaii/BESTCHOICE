import { Fragment } from 'react';
import { AVAILABLE_VARIABLES } from '@/constants/variables';

// Build a set of valid variable keys for quick lookup
const VALID_KEYS = new Set<string>();
for (const v of AVAILABLE_VARIABLES) {
  VALID_KEYS.add(v.key);
  // Also add root key for array item access (e.g., EMERGENCY_CONTACTS → CONTACT.NAME)
  VALID_KEYS.add(v.key.split('.')[0]);
}

function isValidVariable(token: string): boolean {
  // Extract variable key from {{= KEY }} or {{= KEY | format }}
  const match = token.match(/\{\{=\s*([^|}]+?)(?:\s*\|[^}]*)?\s*\}\}/);
  if (!match) return true; // not a variable token
  const key = match[1].trim();
  // Check direct match or root match
  if (VALID_KEYS.has(key)) return true;
  const root = key.split('.')[0];
  if (VALID_KEYS.has(root)) return true;
  // Check loop item variables like INSTALLMENT.NO — parent is INSTALLMENTS
  // Common patterns: CONTACT -> EMERGENCY_CONTACTS, INSTALLMENT -> INSTALLMENTS
  return false;
}

interface Props {
  text: string;
  previewMode: boolean;
  resolvedText?: string;
}

// Highlight template variables in content
export default function VariableHighlighter({ text, previewMode, resolvedText }: Props) {
  if (previewMode && resolvedText) {
    return <span>{renderBold(resolvedText)}</span>;
  }

  // Parse and colorize template syntax
  const parts: { text: string; type: 'text' | 'print' | 'loop' | 'condition' | 'signature' | 'invalid' }[] = [];

  const regex = /(\{\{=\s*[^}]*\}\}|\{\{for\s[^}]*\}\}|\{\{\/for\}\}|\{\{if\s[^}]*\}\}|\{\{elseif\s[^}]*\}\}|\{\{else\}\}|\{\{\/if\}\}|@sign_\w+|@index[01])/g;
  let match;
  let lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.substring(lastIndex, match.index), type: 'text' });
    }

    const token = match[0];
    let type: typeof parts[number]['type'] = 'text';

    if (token.startsWith('{{=')) {
      // Check if variable is valid
      type = isValidVariable(token) ? 'print' : 'invalid';
    } else if (token.startsWith('{{for') || token === '{{/for}}') {
      type = 'loop';
    } else if (token.startsWith('{{if') || token.startsWith('{{elseif') || token === '{{else}}' || token === '{{/if}}') {
      type = 'condition';
    } else if (token.startsWith('@sign_')) {
      type = 'signature';
    } else if (token.startsWith('@index')) {
      type = 'loop';
    }

    parts.push({ text: token, type });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.substring(lastIndex), type: 'text' });
  }

  const colorMap = {
    text: '',
    print: 'bg-primary-100 text-primary-700 px-1 rounded',
    loop: 'bg-primary-100 text-primary-700 px-1 rounded',
    condition: 'bg-amber-100 text-amber-700 px-1 rounded',
    signature: 'bg-emerald-100 text-emerald-700 px-1 rounded',
    invalid: 'bg-red-100 text-red-700 px-1 rounded line-through',
  };

  return (
    <span>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part.type === 'text' ? (
            renderBold(part.text)
          ) : (
            <span
              className={`${colorMap[part.type]} text-[11px] font-mono`}
              title={part.type === 'invalid' ? 'ตัวแปรไม่ถูกต้อง' : undefined}
            >
              {part.text}
            </span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

// Render **bold** markup
function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
