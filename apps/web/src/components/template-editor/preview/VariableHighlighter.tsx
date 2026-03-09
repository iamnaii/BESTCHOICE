import { Fragment } from 'react';

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
  let remaining = text;

  const regex = /(\{\{=\s*[^}]*\}\}|\{\{for\s[^}]*\}\}|\{\{\/for\}\}|\{\{if\s[^}]*\}\}|\{\{elseif\s[^}]*\}\}|\{\{else\}\}|\{\{\/if\}\}|@sign_\w+|@index[01])/g;
  let match;
  let lastIndex = 0;

  const fullText = remaining;
  while ((match = regex.exec(fullText)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: fullText.substring(lastIndex, match.index), type: 'text' });
    }

    const token = match[0];
    let type: typeof parts[number]['type'] = 'text';
    if (token.startsWith('{{=')) type = 'print';
    else if (token.startsWith('{{for') || token === '{{/for}}') type = 'loop';
    else if (token.startsWith('{{if') || token.startsWith('{{elseif') || token === '{{else}}' || token === '{{/if}}') type = 'condition';
    else if (token.startsWith('@sign_')) type = 'signature';
    else if (token.startsWith('@index')) type = 'loop';

    parts.push({ text: token, type });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < fullText.length) {
    parts.push({ text: fullText.substring(lastIndex), type: 'text' });
  }

  const colorMap = {
    text: '',
    print: 'bg-violet-100 text-violet-700 px-1 rounded',
    loop: 'bg-blue-100 text-blue-700 px-1 rounded',
    condition: 'bg-amber-100 text-amber-700 px-1 rounded',
    signature: 'bg-emerald-100 text-emerald-700 px-1 rounded',
    invalid: 'bg-red-100 text-red-700 px-1 rounded',
  };

  return (
    <span>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part.type === 'text' ? (
            renderBold(part.text)
          ) : (
            <span className={`${colorMap[part.type]} text-[11px] font-mono`}>
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
