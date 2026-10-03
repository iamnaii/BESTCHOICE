export function extractTemplateVariables(template: string): string[] {
  const regex = /\$\{([^}]+)\}/g;
  const seen = new Set<string>();
  const order: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const varName = match[1].trim();
    if (!seen.has(varName)) {
      seen.add(varName);
      order.push(varName);
    }
  }
  return order;
}
