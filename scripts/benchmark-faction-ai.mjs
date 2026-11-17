// Adapter to the unified harness.
process.argv.splice(2, 0, 'ai');
const { main } = await import('../tools/simulation-harness/cli.mjs');
await main();
