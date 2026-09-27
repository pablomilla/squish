/** Names for AI models, for the admin screens: a model's id as people say it. */

/** Google's models; everything else priced is Anthropic's. */
export const isGemini = (model: string): boolean => model.startsWith('gemini-');

/**
 * claude-opus-5 → Claude Opus 5, claude-haiku-4-5 → Claude Haiku 4.5,
 * gemini-2.5-flash-lite → Gemini 2.5 Flash Lite. "claude" alone is the cost
 * kept before models were recorded.
 */
export function modelLabel(model: string): string {
  if (model === 'claude') return 'Claude (model not recorded)';
  const words: string[] = [];
  for (const part of model.replace(/-\d{8}$/, '').split('-')) {
    const last = words.length - 1;
    if (/^\d+$/.test(part) && last >= 0 && /^[\d.]+$/.test(words[last])) words[last] += `.${part}`;
    else words.push(/^[\d.]+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1));
  }
  return words.join(' ');
}
