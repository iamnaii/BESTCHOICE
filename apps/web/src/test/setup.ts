import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Ensure React Testing Library unmounts components between tests so
// timers/effects from one test don't leak into the next.
afterEach(() => {
  cleanup();
});
