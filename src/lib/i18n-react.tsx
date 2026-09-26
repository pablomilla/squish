import { Fragment, type ReactNode } from 'react';
import { t, plural } from './i18n';

/**
 * A sentence with markup or components inside it, translated whole.
 *
 * Translating "<b>£6.99</b> a month" as three pieces would give a translator
 * "a month" with no idea what comes before it, and fix the word order to
 * English. So the whole sentence is one string, with named tags and
 * placeholders the translation keeps:
 *
 *   rich('<b>{monthly}</b> a month', { monthly: price }, { b: (text) => <b>{text}</b> })
 *
 * A placeholder's value may itself be an element. Tags do not nest.
 */
export type Tags = Record<string, (children: ReactNode) => ReactNode>;
export type RichVars = Record<string, ReactNode>;

export function rich(english: string, vars: RichVars = {}, tags: Tags = {}): ReactNode {
  // Placeholders are kept as written through `t`, and filled here, where a value can be an element.
  return render(t(english), vars, tags);
}

/** The same for a counted sentence. */
export function richPlural(n: number, forms: { one: string; other: string }, vars: RichVars = {}, tags: Tags = {}): ReactNode {
  const marker = '\u0000n\u0000';
  const text = plural(n, forms, { n: marker }).split(marker).join('{n}');
  return render(text, { n: n.toLocaleString(), ...vars }, tags);
}

function render(text: string, vars: RichVars, tags: Tags): ReactNode {
  const out: ReactNode[] = [];
  const pattern = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(...placeholders(text.slice(last, match.index), vars, () => key++));
    const wrap = tags[match[1]];
    const inner = placeholders(match[2], vars, () => key++);
    out.push(<Fragment key={`t${key++}`}>{wrap ? wrap(inner) : inner}</Fragment>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(...placeholders(text.slice(last), vars, () => key++));
  return out;
}

function placeholders(text: string, vars: RichVars, next: () => number): ReactNode[] {
  return text.split(/(\{\w+\})/).map((part) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    if (name && name in vars) return <Fragment key={`v${next()}`}>{vars[name]}</Fragment>;
    return part;
  });
}
