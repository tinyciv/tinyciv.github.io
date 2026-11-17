// Adapter to the unified harness.
process.argv.splice(2, 0, 'compare');
const { main } = await import('../tools/simulation-harness/cli.mjs');
await main();
