let counter = 0;
export function uid(): string {
  return `blk_${Date.now().toString(36)}_${(counter++).toString(36)}`;
}
