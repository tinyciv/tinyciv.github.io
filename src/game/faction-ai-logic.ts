import schema from './faction-ai-logic-schema.json';
import policySchema from './faction-ai-policy-schema.json';

export type LogicExpression = number | boolean | { fact: string } | { parameter: string }
  | { op: keyof typeof schema.operators; args: LogicExpression[] };
export type LogicDecision = keyof typeof schema.decisions;
export type PolicyLogic = Partial<Record<LogicDecision, LogicExpression>>;
export const logicSchema = schema;
const arity = (op: string) => op === 'if' ? 3 : ['not', 'ceil', 'floor'].includes(op) ? 1 : 2;

/** Serializes configuration; all execution and authoritative validation is native. */
export function compileLogic(decision: string, expression: LogicExpression): number[] {
  if (!Object.hasOwn(schema.decisions, decision)) throw new Error(`Unknown logic decision: ${decision}`);
  const facts = (schema.decisions[decision as LogicDecision].facts as readonly string[]);
  const words: number[] = [];
  let nodes = 0, depth = 0;
  const emit = (node: LogicExpression, nesting: number): void => {
    if (++nodes > schema.maxInstructions || nesting > schema.maxInstructions) throw new Error('AI logic exceeds instruction budget');
    let op: number, value = 0, consumed = 0;
    if (typeof node === 'number' || typeof node === 'boolean') {
      op = 0; value = Number(node); if (!Number.isFinite(value) || Math.abs(value) > 1e6) throw new Error('Invalid AI logic literal');
    } else if (node && typeof node === 'object' && !Array.isArray(node)) {
      const keys = Object.keys(node);
      if ('fact' in node && keys.length === 1) {
        op = 1; value = facts.indexOf(node.fact); if (value < 0) throw new Error(`Unknown ${decision} fact: ${node.fact}`);
      } else if ('parameter' in node && keys.length === 1) {
        op = 2; value = policySchema.parameters.indexOf(node.parameter); if (value < 0) throw new Error(`Unknown parameter: ${node.parameter}`);
      } else if ('op' in node && keys.length === 2 && keys.includes('args') && Object.hasOwn(schema.operators, node.op)) {
        op = schema.operators[node.op]; consumed = arity(node.op);
        if (!Array.isArray(node.args) || node.args.length !== consumed) throw new Error(`Invalid arguments for ${node.op}`);
        for (const arg of node.args) emit(arg, nesting + 1);
      } else throw new Error('Invalid AI logic expression');
    } else throw new Error('Invalid AI logic expression');
    depth += 1 - consumed; if (depth > schema.maxStack) throw new Error('AI logic exceeds stack budget');
    words.push(op, value);
  };
  emit(expression, 0); return words;
}
export function decodeLogic(mode: number, words: readonly number[]): [LogicDecision, LogicExpression] {
  const entry = Object.entries(schema.decisions).find(([, value]) => value.mode === mode);
  if (!entry) throw new Error('Unknown native AI logic mode');
  const [name, config] = entry, stack: LogicExpression[] = [];
  for (let i = 0; i < words.length; i += 2) {
    const op = words[i], value = words[i + 1];
    if (op === 0) stack.push(value);
    else if (op === 1) stack.push({ fact: config.facts[value] });
    else if (op === 2) stack.push({ parameter: policySchema.parameters[value] });
    else {
      const operation = Object.entries(schema.operators).find(([, code]) => code === op)![0] as keyof typeof schema.operators;
      stack.push({ op: operation, args: stack.splice(-arity(operation)) });
    }
  }
  return [name as LogicDecision, stack[0]];
}
