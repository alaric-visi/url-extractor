import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

afterEach(async () => {
  // Unmount React trees between tests in browser-like files; Node-only files have no document.
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});
