import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NATIVE_FIELD_BRIDGE_ALLOWLIST, NATIVE_OWNED_FIELDS } from '../src/game/native-owned-fields';

/** Rust-owned fields may only be written by the bridge (outbox mirror applier,
 * fixture/editor bridges). Every other TypeScript write to a registered
 * Unit/Building/Faction/GameState/Tile field is a second authority. */

const root = path.resolve(__dirname, '..');
const SCANNED = ['src', 'server'];
const REGISTRY_FILE = 'src/game/native-owned-fields.ts';

function sourceFiles(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mts)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Blank comments while keeping offsets, so reported line numbers stay exact.
 * String literals are kept: a quoted `.field =` is rare and errs on the safe side. */
function stripComments(source: string): string {
  let out = '', i = 0, quote: string | undefined;
  while (i < source.length) {
    const char = source[i], next = source[i + 1];
    if (quote) {
      out += char;
      if (char === '\\') { out += next ?? ''; i += 2; continue; }
      if (char === quote) quote = undefined;
      i++; continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; out += char; i++; continue; }
    if (char === '/' && next === '/') { while (i < source.length && source[i] !== '\n') { out += ' '; i++; } continue; }
    if (char === '/' && next === '*') {
      out += '  '; i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) { out += source[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    out += char; i++;
  }
  return out;
}

const escape = (name: string) => name.replace(/[$]/g, '\\$');
function writePatterns(field: string): RegExp[] {
  const name = escape(field);
  return [
    // a.field = …, a.field += …, a.field ??= … (not ==, ===, =>)
    new RegExp(`\\.${name}\\s*(?:\\*\\*|<<|>>>|>>|&&|\\|\\||\\?\\?|[-+*/%&|^])?=(?![=>])`, 'g'),
    new RegExp(`\\.${name}\\s*(?:\\+\\+|--)`, 'g'),
    new RegExp(`(?:\\+\\+|--)\\s*[\\w$.\\]\\[)]*\\.${name}\\b`, 'g'),
    new RegExp(`\\bdelete\\s+[\\w$.?\\]\\[()]*\\.${name}\\b`, 'g'),
    new RegExp(`\\[\\s*['"\`]${name}['"\`]\\s*\\]\\s*(?:[-+*/%&|^]|\\?\\?|&&|\\|\\|)?=(?![=>])`, 'g'),
    // Object.assign(target, { field: … }) on a single line.
    new RegExp(`Object\\.assign\\([^,()]+,\\s*\\{[^}]*?(?:^|[\\s{,])${name}\\s*[:,}]`, 'g'),
  ];
}

export interface FieldWrite { file: string; line: number; field: string; text: string }
export function findNativeFieldWrites(file: string, source: string, fields: readonly string[]): FieldWrite[] {
  const code = stripComments(source), writes: FieldWrite[] = [];
  for (const field of fields) for (const pattern of writePatterns(field)) {
    for (const match of code.matchAll(pattern)) {
      const line = code.slice(0, match.index).split('\n').length;
      writes.push({ file, line, field, text: source.split('\n')[line - 1].trim() });
    }
  }
  return writes.sort((a, b) => a.line - b.line || a.field.localeCompare(b.field));
}

describe('native field ownership', () => {
  const registered = [...new Set(Object.values(NATIVE_OWNED_FIELDS).flat())].sort();

  it('registers each field once per owner type and allowlists only existing bridge files', () => {
    for (const [owner, fields] of Object.entries(NATIVE_OWNED_FIELDS)) {
      expect(new Set(fields).size, owner).toBe(fields.length);
    }
    for (const file of NATIVE_FIELD_BRIDGE_ALLOWLIST) {
      expect(file, 'allowlist paths are repository-relative posix paths').not.toMatch(/\\|^\//);
      expect(existsSync(path.join(root, file)), file).toBe(true);
    }
  });

  it('detects assignment, compound, increment, delete, bracket and Object.assign writes', () => {
    const sample = [
      'unit.morale = 3;', 'unit.morale += 1;', 'unit.morale ??= 2;', 'unit.morale++;', '--state.units[0].morale;',
      'delete unit.morale;', "unit['morale'] = 4;", 'Object.assign(unit, { hp: 1, morale: 2 });',
      'if (unit.morale === 3 || unit.morale == 2) read(unit.morale);', 'const f = (u) => u.morale;',
      'const morale = unit.morale; // unit.morale = 9', '/* unit.morale = 9 */ unit.moraleBoost = 1;',
    ].join('\n');
    expect(findNativeFieldWrites('sample.ts', sample, ['morale']).map(write => write.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('finds no write to a Rust-owned field outside the bridge allowlist', () => {
    const allow = new Set([...NATIVE_FIELD_BRIDGE_ALLOWLIST, REGISTRY_FILE]);
    const violations: FieldWrite[] = [];
    if (registered.length) for (const directory of SCANNED) for (const full of sourceFiles(path.join(root, directory))) {
      const file = path.relative(root, full).split(path.sep).join('/');
      if (allow.has(file)) continue;
      violations.push(...findNativeFieldWrites(file, readFileSync(full, 'utf8'), registered));
    }
    expect(violations.map(write => `${write.file}:${write.line} ${write.field}: ${write.text}`)).toEqual([]);
  });

  it('keeps the simulation free of host wall-clock reads', () => {
    const offenders: string[] = [];
    for (const full of sourceFiles(path.join(root, 'src/game'))) {
      const code = stripComments(readFileSync(full, 'utf8'));
      if (/\bDate\.now\s*\(|\bnew\s+Date\s*\(/.test(code)) offenders.push(path.relative(root, full));
    }
    expect(offenders).toEqual([]);
  });
});
