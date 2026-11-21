import { createServer } from 'vite';

const viewerPage = 'world.html';
const server = await createServer({
  server: { host: '127.0.0.1', port: 5174, open: `/${viewerPage}` },
});
await server.listen();
console.log(`World viewer at ${new URL(viewerPage, server.resolvedUrls.local[0]).href}`);
console.log('Ctrl+C to stop.');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await server.close(); process.exit(0); });
}
