/**
 * Translating a page of HTML: the website, the privacy policy, the page an
 * email confirmation link lands on.
 *
 * The pages are written by hand in English and stay that way — there is no
 * second copy per language to keep in step. Instead the server reads the
 * page, finds each piece of text a person reads, and swaps in its
 * translation from the same store as the app's interface.
 *
 * A "piece" is the whole of a paragraph, a heading, a list item, a link or
 * a button, with any markup inside it kept as tags a translator can move:
 * `Open <a1>app.squish.online</a1> in any browser`. Tags with attributes are
 * numbered, and their attributes are put back from the original afterwards,
 * so a translation can reorder a link but never change where it goes. Text
 * people read in attributes — alt text, aria-labels, the page's description —
 * is translated too.
 *
 * Written for the HTML in this repository, not the web at large: no
 * dependency for a job this narrow. What it does not understand, it leaves
 * exactly as it was, which is to say in English.
 */

/** Elements whose content is read as one piece. */
const PIECES = new Set(['title', 'h1', 'h2', 'h3', 'h4', 'p', 'li', 'summary', 'figcaption', 'button', 'a', 'th', 'td', 'label', 'dt', 'dd', 'option']);
/** Elements that make a would-be piece a container instead: its pieces are further in. */
const BLOCKS = new Set([
  'p', 'li', 'ul', 'ol', 'div', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'figure', 'table',
  'details', 'h1', 'h2', 'h3', 'h4', 'picture', 'template', 'form',
]);
const VOID = new Set(['br', 'img', 'source', 'wbr', 'input', 'meta', 'link', 'hr']);
/** Attributes people read. */
const READ_ATTRIBUTES = ['alt', 'aria-label', 'title', 'placeholder'];
/** Names that stay as they are in every language. */
const KEEP = new Set(['Squish', 'Plus', 'Squish Plus']);

const TOKEN = /<!--[\s\S]*?-->|<![^>]*>|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[a-zA-Z][^>]*>|[^<]+|</g;

const hasLetters = (text: string): boolean => /\p{L}/u.test(text);

interface Tag {
  name: string;
  closing: boolean;
  /** `<b>` or `</b>`, nothing more. */
  bare: boolean;
  selfClosing: boolean;
}

function tagOf(token: string): Tag | null {
  const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>$/.exec(token);
  if (!match) return null;
  const rest = match[3];
  return {
    name: match[2].toLowerCase(),
    closing: match[1] === '/',
    bare: rest.trim() === '' || rest.trim() === '/',
    selfClosing: /\/\s*$/.test(rest),
  };
}

const decode = (text: string): string =>
  text.replace(/&nbsp;/g, '\u00a0').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const escapeAttribute = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Text from a translation, made safe to put back into a page: its own tags only. */
const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Looks up an English string; undefined leaves it in English. */
export type Lookup = (english: string) => string | undefined;

/**
 * A piece's inner tokens as the English a translator sees, and how to turn
 * a translation of it back into HTML.
 */
function pieceOf(inner: string[]): { english: string; rebuild: (translated: string) => string } | null {
  const originals = new Map<string, string>();
  const open: { name: string; numbered: string }[] = [];
  const counts = new Map<string, number>();
  let english = '';
  for (const token of inner) {
    if (token.startsWith('<!--')) continue;
    const tag = token.startsWith('<') ? tagOf(token) : null;
    if (!tag) {
      // Characters, not entities: a translator should see "health buddy", not "&nbsp;".
      english += decode(token.replace(/[ \t\r\n]+/g, ' '));
      continue;
    }
    if (tag.name === 'br') {
      english += '<br>';
      continue;
    }
    if (tag.closing) {
      const top = open.pop();
      if (!top || top.name !== tag.name) return null; // not HTML this understands
      english += `</${top.numbered}>`;
      continue;
    }
    let numbered = tag.name;
    if (!tag.bare) {
      const n = (counts.get(tag.name) ?? 0) + 1;
      counts.set(tag.name, n);
      numbered = `${tag.name}${n}`;
      originals.set(numbered, token);
    }
    english += `<${numbered}>`;
    if (!VOID.has(tag.name) && !tag.selfClosing) open.push({ name: tag.name, numbered });
  }
  if (open.length) return null;
  english = english.trim();
  if (!hasLetters(english.replace(/<[^>]+>/g, '')) || KEEP.has(english)) return null;

  const rebuild = (translated: string): string =>
    translated
      .split(/(<\/?\w+>)/)
      .map((part, i) => {
        if (i % 2 === 0) return escapeText(part);
        const closing = part.startsWith('</');
        const name = part.slice(closing ? 2 : 1, -1);
        if (closing) return `</${name.replace(/\d+$/, '')}>`;
        return originals.get(name) ?? `<${name}>`;
      })
      .join('');
  return { english, rebuild };
}

/** A tag with the attributes people read translated. */
function translateAttributes(token: string, tag: Tag, lookup: Lookup | null, found: string[]): string {
  if (tag.closing) return token;
  const names = [...READ_ATTRIBUTES];
  // A page's description and what a link preview shows.
  if (tag.name === 'meta' && /\b(name="description"|property="og:(title|description)")/.test(token)) names.push('content');
  let out = token;
  for (const name of names) {
    out = out.replace(new RegExp(`(\\s${name}=")([^"]*)(")`), (whole, before: string, value: string, after: string) => {
      const english = decode(value).trim();
      if (!hasLetters(english) || KEEP.has(english)) return whole;
      found.push(english);
      const translated = lookup?.(english);
      return translated === undefined ? whole : `${before}${escapeAttribute(translated)}${after}`;
    });
  }
  return out;
}

/**
 * Walk a page: every string people read goes into `found`, and with a
 * lookup, comes back translated wherever there is a translation.
 */
function walk(html: string, lookup: Lookup | null): { html: string; found: string[] } {
  const tokens = html.match(TOKEN) ?? [];
  const found: string[] = [];
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith('<!') || /^<(script|style)\b/i.test(token)) {
      out.push(token);
      continue;
    }
    const tag = token.startsWith('<') ? tagOf(token) : null;

    if (!tag) {
      // Text between pieces: a word or two in a <span>, say. Whitespace is kept round it.
      const english = decode(token.replace(/[ \t\r\n]+/g, ' ').trim());
      if (!hasLetters(english) || KEEP.has(english)) {
        out.push(token);
        continue;
      }
      found.push(english);
      const translated = lookup?.(english);
      out.push(translated === undefined ? token : token.replace(token.trim(), escapeText(translated)));
      continue;
    }

    if (!tag.closing && PIECES.has(tag.name) && !tag.selfClosing) {
      // Find where it ends, counting any of the same element inside it.
      let depth = 0;
      let end = -1;
      let container = false;
      for (let j = i + 1; j < tokens.length; j++) {
        const inner = tokens[j].startsWith('<') ? tagOf(tokens[j]) : null;
        if (!inner) continue;
        if (inner.name === tag.name) {
          if (!inner.closing) depth++;
          else if (depth === 0) {
            end = j;
            break;
          } else depth--;
        }
        if (BLOCKS.has(inner.name)) container = true;
      }
      if (end > 0 && !container) {
        const inner = tokens.slice(i + 1, end);
        const piece = pieceOf(inner);
        if (piece) {
          found.push(piece.english);
          const translated = lookup?.(piece.english);
          const opening = translateAttributes(token, tag, lookup, found);
          if (translated === undefined) {
            out.push(opening, ...inner, tokens[end]);
          } else {
            // Keep the whitespace the English had either side, for tidy source.
            const text = inner.join('');
            const lead = /^\s*/.exec(text)![0];
            const trail = /\s*$/.exec(text)![0];
            out.push(opening, lead, piece.rebuild(translated), trail, tokens[end]);
          }
          i = end;
          continue;
        }
      }
    }

    out.push(translateAttributes(token, tag, lookup, found));
  }

  return { html: out.join(''), found };
}

/** Every string in a page that a person reads, in order, once each. */
export const stringsOf = (html: string): string[] => [...new Set(walk(html, null).found)];

/** The page with every string that has a translation translated. */
export const translateHtml = (html: string, lookup: Lookup): string => walk(html, lookup).html;
