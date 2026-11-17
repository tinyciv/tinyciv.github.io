import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = resolve(root, 'scratch/rust-toolchain');
const localCargo = resolve(local, 'cargo/bin/cargo');
const useLocal = !process.env.CARGO && existsSync(localCargo);
const cargo = process.env.CARGO || (useLocal ? localCargo : 'cargo');
const env = useLocal ? { ...process.env, CARGO_HOME: resolve(local, 'cargo'), RUSTUP_HOME: resolve(local, 'rustup') } : process.env;
const run = args => {
  const result = spawnSync(cargo, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw new Error(`Rust is required: install rustup and add the wasm32-unknown-unknown target. ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const mode = process.argv[2] || 'build';
if (mode === 'test') run(['test', '--locked', '--manifest-path', 'rust/Cargo.toml', ...process.argv.slice(3)]);
else {
  run(['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--manifest-path', 'rust/Cargo.toml']);
  mkdirSync(resolve(root, 'public/wasm'), { recursive: true });
  copyFileSync(resolve(root, 'rust/target/wasm32-unknown-unknown/release/tinyciv_simulation.wasm'), resolve(root, 'public/wasm/simulation.wasm'));
  chmodSync(resolve(root, 'public/wasm/simulation.wasm'), 0o644);
  console.log('Built Rust/bevy_ecs simulation and navigation.');
}
