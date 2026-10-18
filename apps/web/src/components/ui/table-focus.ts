import type { FocusEvent } from 'react';

/** Keep keyboard-focused table controls clear of fixed app navigation. */
export function revealTableControl(event: FocusEvent<HTMLElement>) {
  const control = event.target;
  // Pointer targets must stay stationary between pointer-down and click.
  if (!control.matches('button:focus-visible, input:focus-visible')) return;
  const bounds = control.getBoundingClientRect();
  const style = getComputedStyle(control);
  if (
    bounds.top < parseFloat(style.scrollMarginTop) ||
    bounds.bottom > window.innerHeight - parseFloat(style.scrollMarginBottom)
  ) {
    control.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
}
