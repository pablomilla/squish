/**
 * The privacy policy, served as a page.
 *
 * It lives in `docs/privacy.md` and is rendered here rather than duplicated,
 * because a policy that exists twice is a policy that will disagree with
 * itself. The markdown file stays the thing you edit.
 *
 * Served by the server rather than the app on purpose. Both app stores need a
 * URL that opens the policy for somebody who has not installed anything, and
 * this Squish may be behind a passcode — a privacy policy nobody can read
 * without the password is not a published policy. So this route sits outside
 * the lock, outside the app shell, and needs no JavaScript to read.
 *
 * The renderer covers the markdown the policy actually uses and nothing else.
 * A dependency for six constructs would be a dependency to keep patched for
 * the life of the app.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SOURCE = resolve(process.cwd(), 'docs/privacy.md');

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Bold, code and links, after the text is already escaped. */
function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Only http(s) and mailto, and only into the href — a link is the one
    // place this renderer puts text somewhere a browser will act on. Anything
    // else, javascript: above all, stays as the characters somebody typed.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
}

const cells = (row: string): string[] =>
  row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

const isDivider = (row: string): boolean => /^\s*\|?[\s:-]*\|[\s|:-]*$/.test(row) && row.includes('-');

/**
 * Markdown to HTML, for the subset the policy uses.
 *
 * HTML comments go first and go entirely. The policy carries notes to whoever
 * maintains it — including, at the time of writing, an unfilled contact
 * address — and those are not for the page.
 */
export function render(markdown: string): string {
  const lines = escape(markdown.replace(/<!--[\s\S]*?-->/g, '')).split('\n');
  const out: string[] = [];
  let list: string[] | null = null;
  let table: string[][] | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list?.length) out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
    list = null;
  };
  const flushTable = () => {
    if (table?.length) {
      const [head, ...body] = table;
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${body.map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
    }
    table = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushAll();
      continue;
    }

    // A divider belongs to the table above it and says nothing itself.
    if (table && isDivider(trimmed)) continue;

    if (trimmed.startsWith('|')) {
      flushParagraph();
      flushList();
      (table ??= []).push(cells(trimmed));
      continue;
    }
    flushTable();

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (trimmed === '---') {
      flushAll();
      out.push('<hr>');
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      (list ??= []).push(bullet[1]);
      continue;
    }

    // A wrapped line inside a bullet belongs to that bullet, not to a new
    // paragraph — the policy is hard-wrapped and most of its bullets run on.
    if (list) {
      list[list.length - 1] += ` ${trimmed}`;
      continue;
    }

    paragraph.push(trimmed);
  }

  flushAll();
  return out.join('\n');
}

/** Squish's colours, inlined: one request, no JavaScript, works offline. */
const STYLE = `
:root { color-scheme: light dark; --ink: #241c3b; --ink-2: #5b5375; --line: #e7ded5; --bg: #fdf6ef; --card: #fff; --accent: #6c4ef0; }
@media (prefers-color-scheme: dark) {
  :root { --ink: #f2eef8; --ink-2: #b5adc9; --line: #3a3350; --bg: #161226; --card: #1f1a33; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 48px 20px 96px; background: var(--bg); color: var(--ink);
  font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 46rem; margin: 0 auto; }
h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 8px; }
h2 { font-size: 1.3rem; margin: 40px 0 10px; }
h3 { font-size: 1.05rem; margin: 28px 0 6px; }
p, li { color: var(--ink-2); }
strong { color: var(--ink); }
a { color: var(--accent); }
hr { border: 0; border-top: 1px solid var(--line); margin: 36px 0; }
ul { padding-left: 1.2em; }
li { margin: 6px 0; }
code { background: var(--card); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px; font-size: 0.9em; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.94rem; }
th, td { text-align: left; vertical-align: top; padding: 9px 12px; border-bottom: 1px solid var(--line); color: var(--ink-2); }
th { color: var(--ink); font-weight: 600; }
.back { display: inline-block; margin-top: 48px; color: var(--ink-2); }
@media (max-width: 480px) { body { padding: 28px 16px 72px; } table { font-size: 0.86rem; } th, td { padding: 8px; } }
`;

const page = (body: string): string => `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy — Squish</title>
<meta name="description" content="What Squish keeps, where it goes, and how to get rid of it.">
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
<a class="back" href="/">← Back to Squish</a>
</main>
</body>
</html>`;

let cached: string | null = null;

/**
 * The rendered page.
 *
 * Cached after the first read, because the file cannot change without a
 * deploy. Null where the file is missing, which the route turns into an
 * honest 404 rather than a blank page claiming to be a policy.
 */
export async function privacyPage(): Promise<string | null> {
  if (cached) return cached;
  try {
    cached = page(render(await readFile(SOURCE, 'utf8')));
    return cached;
  } catch {
    return null;
  }
}
