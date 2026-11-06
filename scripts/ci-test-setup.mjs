import { setImmediate } from 'node:timers';
import { afterEach } from 'vitest';

// Some simulation files spend over a minute in successive synchronous tests.
// Let the worker receive reporter replies between tests, avoiding Vitest's
// 60-second RPC timeout without suppressing errors or reducing coverage.
// Capture the native timer before a test can install fake timers.
const queueImmediate = setImmediate;
afterEach(() => new Promise(resolve => queueImmediate(resolve)));
