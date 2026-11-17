import { createServer } from 'vite';

const server = await createServer({
  server: { host: '127.0.0.1', port: 5174, open: '/world.html' },
});
await server.listen();
server.printUrls();
console.log('World viewer: /world.html · Ctrl+C to stop.');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await server.close(); process.exit(0); });
}
