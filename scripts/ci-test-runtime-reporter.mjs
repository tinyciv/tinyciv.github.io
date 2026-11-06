import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default class CiRuntimeReporter {
  onTestRunEnd(modules, errors, reason) {
    const directory = resolve(process.env.CI_TEST_OUTPUT ?? 'output/ci-tests');
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, 'runtime.json'), JSON.stringify({ completed: true, modules: modules.length, reason,
      errors: errors.map(error => ({ name: error.name, message: error.message, stack: error.stack })) }, null, 2) + '\n');
  }
}
