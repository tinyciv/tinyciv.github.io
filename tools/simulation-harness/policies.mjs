import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const POLICY_SCHEMA = JSON.parse(readFileSync(new URL('../../src/game/faction-ai-policy-schema.json', import.meta.url), 'utf8'));

// Read configuration once in the parent. Workers receive this exact snapshot,
// so editing the file during an experiment cannot change later trials.
export function loadPolicyCatalog(file, root) {
  if (!file) return { available: POLICY_SCHEMA.builtins, definitions: [], source: null };
  const filename = path.resolve(root, file), raw = readFileSync(filename, 'utf8');
  const document = JSON.parse(raw);
  if (!document || document.version !== POLICY_SCHEMA.version || !Array.isArray(document.policies)
    || Object.keys(document).some(key => !['version', 'policies'].includes(key)))
    throw new Error('Policy file must contain { "version": 1, "policies": [...] }');
  const ids = new Set(POLICY_SCHEMA.builtins);
  for (const definition of document.policies) {
    if (!definition || typeof definition.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(definition.id)
      || ids.has(definition.id) || Object.keys(definition).some(key => !['id', 'extends', 'parameters', 'features', 'logic'].includes(key)))
      throw new Error(`Invalid or duplicate AI policy: ${definition?.id}`);
    ids.add(definition.id);
    for (const [field, keys, type] of [['parameters', POLICY_SCHEMA.parameters, 'number'], ['features', POLICY_SCHEMA.features, 'boolean']]) {
      const values = definition[field];
      if (values === undefined) continue;
      if (!values || typeof values !== 'object' || Array.isArray(values)
        || Object.entries(values).some(([key, value]) => !keys.includes(key) || typeof value !== type || type === 'number' && !Number.isFinite(value)))
        throw new Error(`Invalid ${field} in AI policy ${definition.id}`);
    }
  }
  const definitions = new Map(document.policies.map(definition => [definition.id, definition]));
  const visited = new Set(POLICY_SCHEMA.builtins), visiting = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (!definitions.has(id)) throw new Error(`Unknown parent AI policy: ${id}`);
    if (visiting.has(id)) throw new Error(`AI policy inheritance cycle at ${id}`);
    visiting.add(id); visit(definitions.get(id).extends ?? POLICY_SCHEMA.default);
    visiting.delete(id); visited.add(id);
  }
  for (const id of definitions.keys()) visit(id);
  return { available: [...ids], definitions: document.policies,
    source: { path: filename, sha256: createHash('sha256').update(raw).digest('hex') } };
}
