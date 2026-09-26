/**
 * Collects every string marked for translation into src/i18n/catalog.json.
 *
 *   npm run i18n
 *
 * Reads the source with the TypeScript parser rather than a regular
 * expression, so a call split over lines or a string with an apostrophe in
 * it is found all the same. What it collects:
 *
 *   t('…')                       a string
 *   rich('…')                    a string with <tags> and {placeholders}
 *   msg('…')                     a string translated later, by `t(value)`
 *   plural(n, { one, other })    a counted string, both English forms
 *   pluralForms({ one, other })  the same, kept in a table and used with plural(n, forms)
 *   richPlural(n, { one, other })
 *
 * A template literal with `${…}` in it is refused: the text a translator sees
 * has to be the whole sentence, with named placeholders, never pieces glued
 * together at run time. test/i18n.test.ts fails if the catalog is out of date,
 * so a new string cannot ship without the server knowing to translate it.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { idOf, pluralKey } from '../src/lib/i18n';

export interface CatalogEntry {
  id: string;
  /** A plain or rich string. */
  text?: string;
  /** A counted string. */
  one?: string;
  other?: string;
  /** Where it is used, to give a translator context. */
  where: string[];
}

export interface Catalog {
  version: string;
  entries: CatalogEntry[];
}

const ROOT = join(import.meta.dirname, '..');
const SOURCES = ['src', 'server'];
/** The owner's dashboard and the partner portal are for the business, in English. */
const SKIP = /(^|\/)(admin\/|Admin\.tsx$|Partners\.tsx$|i18n\.ts$|i18n-react\.tsx$)|\.d\.ts$|\.test\.ts$/;

const STRING_CALLS = new Set(['t', 'rich', 'msg']);
const PLURAL_CALLS = new Set(['plural', 'richPlural']);
/** `pluralForms({ one, other })`: a counted string kept in a table, used later with `plural(n, forms)`. */
const FORMS_CALLS = new Set(['pluralForms']);

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.tsx?$/.test(name) && !SKIP.test(relative(ROOT, path))) out.push(path);
  }
  return out;
}

const literal = (node: ts.Node | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

/** A literal, or every literal a `cond ? 'a' : 'b'` could give. */
function literals(node: ts.Node | undefined): string[] | null {
  if (!node) return null;
  if (ts.isParenthesizedExpression(node)) return literals(node.expression);
  if (ts.isConditionalExpression(node)) {
    const a = literals(node.whenTrue);
    const b = literals(node.whenFalse);
    return a && b ? [...a, ...b] : null;
  }
  const one = literal(node);
  return one === null ? null : [one];
}

const hasTemplate = (node: ts.Node | undefined): boolean =>
  !!node && (ts.isTemplateExpression(node) || (ts.isConditionalExpression(node) && (hasTemplate(node.whenTrue) || hasTemplate(node.whenFalse))) || (ts.isParenthesizedExpression(node) && hasTemplate(node.expression)));

export function extract(): { catalog: Catalog; problems: string[] } {
  const found = new Map<string, CatalogEntry>();
  const problems: string[] = [];
  const add = (entry: Omit<CatalogEntry, 'where' | 'id'>, key: string, where: string) => {
    const id = idOf(key);
    const known = found.get(id);
    if (known) {
      if (!known.where.includes(where)) known.where.push(where);
    } else found.set(id, { id, ...entry, where: [where] });
  };

  for (const path of SOURCES.flatMap((dir) => files(join(ROOT, dir)))) {
    const file = relative(ROOT, path);
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        const line = `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        if (STRING_CALLS.has(name)) {
          const arg = node.arguments[0];
          const texts = literals(arg);
          if (texts !== null) {
            for (const text of texts) if (text.trim()) add({ text }, text, file);
          } else if (hasTemplate(arg)) {
            problems.push(`${line}: ${name}() with \${…} inside — use {placeholders}`);
          }
        } else if (PLURAL_CALLS.has(name) || FORMS_CALLS.has(name)) {
          const forms = node.arguments[FORMS_CALLS.has(name) ? 0 : 1];
          if (forms && ts.isObjectLiteralExpression(forms)) {
            const get = (key: string) => {
              const prop = forms.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(source) === key) as ts.PropertyAssignment | undefined;
              return literal(prop?.initializer);
            };
            const one = get('one');
            const other = get('other');
            if (one !== null && other !== null) add({ one, other }, pluralKey({ one, other }), file);
            else problems.push(`${line}: ${name}() needs literal one and other forms`);
          }
          // Anything else is a table's forms, collected where pluralForms() wrote them.
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const entries = [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
  const version = idOf(entries.map((e) => e.id).join(','));
  return { catalog: { version, entries }, problems };
}

export const CATALOG_PATH = join(ROOT, 'src/i18n/catalog.json');
export const VERSION_PATH = join(ROOT, 'src/i18n/version.ts');

export const versionModule = (version: string) =>
  `// Written by scripts/i18n-extract.ts — do not edit. The app asks the server for this version of the catalog.\nexport const CATALOG_VERSION = '${version}';\n`;

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const { catalog, problems } = extract();
  for (const problem of problems) console.error(problem);
  writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 1)}\n`);
  writeFileSync(VERSION_PATH, versionModule(catalog.version));
  console.log(`${catalog.entries.length} strings, version ${catalog.version}${problems.length ? `, ${problems.length} problems` : ''}`);
  if (problems.length) process.exitCode = 1;
}
