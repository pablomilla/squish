/**
 * Turning an email's wording into what is actually sent: a branded HTML
 * version and a plain-text one beside it.
 *
 * Email HTML is its own dialect, and most of what looks odd here is it. Layout
 * is tables because Outlook renders with Word. Styles are inline because Gmail
 * strips style blocks. The button is a padded table cell rather than a styled
 * link alone, so it keeps its shape where padding on links is ignored. And
 * nothing depends on the image: mail apps block images by default, so the
 * header carries the name in text beside the mascot, and every link also
 * exists as a link.
 *
 * Everything that came from outside — the wording edited in the dashboard, a
 * device name, an address — is escaped before it goes anywhere near the HTML.
 * The person editing is trusted, but escaping is what makes a wording with an
 * ampersand in it come out right, and what keeps a user-agent string from
 * becoming markup.
 */
import type { EmailDefinition, Wording } from './emails';

/** Squish's colours, from src/styles/tokens.css. */
const INK = '#2b2340';
const INK_2 = '#6b6480';
const INK_3 = '#8a839b';
const PAGE = '#fdf6ec';
const CARD = '#fffdfa';
const LINE = '#ece0d0';
const BRAND = '#6b5fe0';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** The same everywhere, and not editable: who is writing, and where to read how. */
const COMPANY = 'Industry Logic Limited, 38a Bowes Street, Blyth, Northumberland, NE24 1BE';

export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const PLACEHOLDER = /\{([a-zA-Z_]+)\}/g;

/** Fill placeholders in plain text. Unknown ones are left as typed. */
const fill = (text: string, values: Record<string, string>): string =>
  text.replace(PLACEHOLDER, (whole, name: string) => values[name] ?? whole);

export function renderEmail(
  definition: EmailDefinition,
  wording: Wording,
  values: Record<string, string>,
  origin: string,
): Rendered {
  const urls = new Set(definition.placeholders.filter((p) => p.url).map((p) => p.name));
  const privacy = `${origin}/privacy`;
  const body = wording.body.replace(/\r\n/g, '\n').replace(/\s+$/, '');

  /* ---------------- plain text ---------------- */

  const text = [
    fill(body, values),
    '',
    '—',
    `Squish · ${COMPANY}`,
    `You are getting this because of activity on a Squish account using this address. Privacy: ${privacy}`,
  ].join('\n');

  /* ---------------- HTML ---------------- */

  /** Escape the wording, then put the values in, escaped too, links as links. */
  const inline = (raw: string): string =>
    escape(raw).replace(PLACEHOLDER, (whole, name: string) => {
      const value = values[name];
      if (value === undefined) return whole;
      return urls.has(name)
        ? `<a href="${escape(value)}" style="color:${BRAND};text-decoration:underline;word-break:break-all">${escape(value)}</a>`
        : escape(value);
    });

  const blocks = body.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const button = definition.button;

  const parts = blocks.map((block) => {
    if (button && block === `{${button.placeholder}}` && values[button.placeholder]) {
      const href = escape(values[button.placeholder]);
      const label = escape(wording.buttonLabel || button.label);
      const fallback = button.fallback
        ? `<p style="margin:14px 0 22px;font-size:13px;line-height:1.5;color:${INK_3}">If the button doesn't work, copy this into your browser:<br><a href="${href}" style="color:${BRAND};word-break:break-all">${href}</a></p>`
        : '';
      return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:${button.fallback ? '6px 0 0' : '6px 0 22px'}"><tr><td style="border-radius:999px;background:${BRAND}"><a href="${href}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px">${label}</a></td></tr></table>${fallback}`;
    }
    return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK}">${inline(block).replace(/\n/g, '<br>')}</p>`;
  });

  // The line an inbox shows after the subject. Without it, most show the
  // first text they find, which is "Squish" from the header.
  const preheader = escape(fill(blocks[0] ?? '', values).replace(/\s+/g, ' ').slice(0, 140));
  const subject = fill(wording.subject, values);

  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE}">${preheader}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${PAGE}">
<tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;font-family:${FONT}">
<tr><td style="padding:0 6px 18px">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td style="padding-right:12px"><img src="${escape(origin)}/icon-192.png" width="44" height="44" alt="Squish" style="display:block;border:0;border-radius:12px"></td>
<td style="font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${INK}">Squish</td>
</tr></table>
</td></tr>
<tr><td style="background:${CARD};border:1px solid ${LINE};border-radius:20px;padding:30px 28px 14px">
${parts.join('\n')}
</td></tr>
<tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:${INK_2}">
Squish · ${escape(COMPANY)}<br>
You are getting this because of activity on a Squish account using this address. <a href="${escape(privacy)}" style="color:${INK_2};text-decoration:underline">Privacy policy</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
