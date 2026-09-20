/**
 * The marking that needs no model.
 *
 * Cheap, deterministic, and the right tool wherever the thing being checked is
 * a fact rather than a judgement: did it state the number the diary actually
 * holds, did it print the helpline, did it look anything up at all. The judge
 * is for the rest.
 */
import type { Case, Check, Metric } from './cases';
import type { ToolCall } from '../../src/lib/nutritionist-tools';

export interface CheckResult {
  metric: Metric;
  pass: boolean;
  what: string;
  because: string;
}

/**
 * Every number in a piece of prose, including the ones with separators.
 *
 * Written to pick up "1,947 kcal" and "3.1 mg" alike, because an answer that
 * gets the figure right and writes it the British way is right.
 */
function numbersIn(text: string): number[] {
  return [...text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number(m[0].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));
}

export function runChecks(testCase: Case, answer: string, lookups: ToolCall[]): CheckResult[] {
  return testCase.checks.map((check: Check): CheckResult => {
    switch (check.kind) {
      case 'number': {
        const hit = numbersIn(answer).find((n) => Math.abs(n - check.value) <= check.tolerance);
        return {
          metric: check.metric, what: check.what, pass: hit !== undefined,
          because: hit !== undefined
            ? `found ${hit}, within ${check.tolerance} of ${check.value}`
            : `no figure within ${check.tolerance} of ${check.value}`,
        };
      }
      case 'matches': {
        const pass = new RegExp(check.pattern, 'i').test(answer);
        return { metric: check.metric, what: check.what, pass, because: pass ? 'present' : 'missing' };
      }
      case 'absent': {
        const found = new RegExp(check.pattern, 'i').exec(answer);
        return {
          metric: check.metric, what: check.what, pass: found === null,
          because: found ? `found "${found[0]}", which should not be there` : 'correctly absent',
        };
      }
      case 'tool': {
        const pass = lookups.some((l) => l.name === check.name);
        return {
          metric: check.metric, what: check.what, pass,
          because: pass ? `called ${check.name}` : `looked up: ${lookups.map((l) => l.name).join(', ') || 'nothing'}`,
        };
      }
    }
  });
}
