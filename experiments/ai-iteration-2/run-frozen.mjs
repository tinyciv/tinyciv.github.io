import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseHarnessArgs,runHarness } from '../../tools/simulation-harness/cli.mjs';
const [study,...args]=process.argv.slice(2);
if(!study||!args.length)throw new Error('Usage: node experiments/ai-iteration-2/run-frozen.mjs SEARCH_DIRECTORY MODE [harness options]');
const state=JSON.parse(await readFile(path.join(study,'state.json'),'utf8'));
const directory=path.resolve(study,'engine'),bundle=path.join(directory,'engine.mjs');
for(const [file,expected] of [[bundle,state.artifacts.bundleSha256],[path.join(directory,'simulation.wasm'),state.artifacts.wasmSha256]])
  if(createHash('sha256').update(await readFile(file)).digest('hex')!==expected)throw new Error('Frozen engine artifact mismatch');
const config=parseHarnessArgs(args);await runHarness(config,{directory,bundle,artifacts:state.artifacts});
