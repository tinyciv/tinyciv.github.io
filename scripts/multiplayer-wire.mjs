import { build } from 'esbuild';

// The socket checks consume the same protocol and replica as the browser.
const result = await build({ stdin: { contents: "export { ClientStateReplica } from './src/multiplayer/client-state'; export { PROTOCOL_VERSION } from './src/multiplayer/protocol';",
  resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false' } });
const wire = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
export const { ClientStateReplica, PROTOCOL_VERSION } = wire;
