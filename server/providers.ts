/**
 * One way to ask any model.
 *
 * Every feature builds its request the way Claude takes it — a system prompt,
 * messages of text, images, tool calls and tool results, a JSON schema for the
 * answer — and reads the answer the way Claude gives it. That code is proven
 * and tuned, so rather than write each feature twice, a request for a Gemini
 * model is translated here into Google's shape, and Google's answer back into
 * Claude's. The feature never knows which one answered.
 *
 * What does not carry across is left behind on purpose: prompt caching and
 * Claude's effort setting (Gemini caches on its own and has its own thinking),
 * and Claude's thinking blocks, which only Claude can read.
 *
 * Which model a feature asks, and what it falls back to, is server/routing.ts.
 */
import Anthropic from '@anthropic-ai/sdk';
import { randomBytes } from 'node:crypto';
import { GeminiRunaway, geminiGenerate, isGeminiModel, toGeminiSchema, type GeminiPart, type GeminiResponse } from './gemini';

let client: Anthropic | null = null;
export const anthropic = (): Anthropic => (client ??= new Anthropic());

export { isGeminiModel };

/**
 * Claude models that always think: `thinking: {type: 'disabled'}` is a 400 on
 * them (Opus 5.5, Sonnet 5.5, Fable). There, effort is the only control, so a
 * call that wanted no thinking leaves it on and asks for low effort instead.
 */
export const alwaysThinks = (model: string): boolean => /^claude-(opus-5-5|sonnet-5-5|fable-|mythos-)/.test(model);

/** Thinking off where the model allows it; where it does not, nothing, and the caller's low effort keeps it short. */
export const thinkingOff = (model: string): { thinking?: { type: 'disabled' } } => (alwaysThinks(model) ? {} : { thinking: { type: 'disabled' } });

/**
 * Room for the answer, and for thinking where the model always thinks.
 * Thinking counts against `max_tokens` without being shown, so a limit sized
 * for a one-line nudge can run out before the nudge is written. Room that is
 * not used is not billed.
 */
export const THINKING_ROOM = 4000;
export const withThinkingRoom = (model: string, answer: number): number => (alwaysThinks(model) ? answer + THINKING_ROOM : answer);

/**
 * The model for the jobs that need the best reading and reasoning — photos,
 * labels, recipes, the nutritionist, meal plans — and the backup behind the
 * cheaper one. `SQUISH_MODEL` in Render chooses another without a deploy; the
 * dashboard's AI models card chooses per job.
 */
export const MAIN_MODEL = process.env.SQUISH_MODEL ?? 'claude-opus-5-5';

/**
 * Claude models whose thinking is bound to the conversation that produced it
 * ("preserved thinking"): change an earlier part of it — the system prompt,
 * the tools, an earlier turn — and the thinking after it no longer counts,
 * which for newer Anthropic accounts is a 400 unless the request asks for such
 * thinking to be dropped instead.
 */
export const bindsThinking = (model: string): boolean => /^claude-(opus-5-5|sonnet-5-5|fable-5-1)/.test(model);
export const providerOf = (model: string): 'google' | 'anthropic' => (isGeminiModel(model) ? 'google' : 'anthropic');

type Params = Anthropic.MessageCreateParamsNonStreaming | Anthropic.Beta.MessageCreateParamsNonStreaming;

/** Ask, and wait for the whole answer. A request naming betas goes to the beta endpoint. */
export async function createMessage(params: Anthropic.MessageCreateParamsNonStreaming | Anthropic.Beta.MessageCreateParamsNonStreaming, signal?: AbortSignal): Promise<Anthropic.Message> {
  if (isGeminiModel(params.model)) return askGemini(params, signal);
  if ('betas' in params && params.betas?.length) return (await anthropic().beta.messages.create(params, { signal })) as unknown as Anthropic.Message;
  return anthropic().messages.create(params as Anthropic.MessageCreateParamsNonStreaming, { signal });
}

/**
 * Ask for something long. Claude streams, because a long non-streamed request
 * risks a timeout; Gemini is asked in one call with a long timeout of its own.
 */
export async function streamMessage(params: Anthropic.Beta.MessageCreateParamsNonStreaming, signal?: AbortSignal): Promise<Anthropic.Message> {
  if (isGeminiModel(params.model)) return askGemini(params, signal);
  const message = await anthropic().beta.messages.stream(params, { signal }).finalMessage();
  return message as unknown as Anthropic.Message;
}

/* ---------------- Claude's shape → Gemini's ---------------- */

/**
 * Gemini 3 signs the reasoning behind a tool call and wants the signature back
 * with it on the next round. The browser carries the conversation, in Claude's
 * shape, which has nowhere to put it — so it is kept here by the call's id for
 * a while. A call it has lost (another instance, a restart) goes back with the
 * placeholder Google documents for history it did not write itself.
 */
const signatures = new Map<string, string>();
const NO_SIGNATURE = 'skip_thought_signature_validator';
function keepSignature(id: string, signature: string | undefined): void {
  if (!signature) return;
  signatures.set(id, signature);
  if (signatures.size > 2000) signatures.delete(signatures.keys().next().value!);
}

type Block = Anthropic.ContentBlockParam | Anthropic.Beta.BetaContentBlockParam;

function toParts(content: string | Block[], names: Map<string, string>): GeminiPart[] {
  if (typeof content === 'string') return content.trim() ? [{ text: content }] : [];
  const parts: GeminiPart[] = [];
  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text.trim()) parts.push({ text: block.text });
        break;
      case 'image':
        if (block.source.type === 'base64') parts.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } });
        break;
      case 'tool_use':
        names.set(block.id, block.name);
        parts.push({
          functionCall: { id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> },
          thoughtSignature: signatures.get(block.id) ?? NO_SIGNATURE,
        });
        break;
      case 'tool_result': {
        const text =
          typeof block.content === 'string'
            ? block.content
            : (block.content ?? []).map((inner) => (inner.type === 'text' ? inner.text : '')).join('');
        parts.push({
          functionResponse: {
            id: block.tool_use_id,
            name: names.get(block.tool_use_id) ?? 'tool',
            response: block.is_error ? { error: text } : { result: text },
          },
        });
        break;
      }
      // Thinking is Claude's own, signed for Claude: nothing Gemini can use.
      default:
        break;
    }
  }
  return parts;
}

const systemText = (system: Params['system']): string =>
  typeof system === 'string' ? system : (system ?? []).map((block) => block.text).join('\n\n');

/** The request, in Google's shape. Exported for the tests, which check the translation without a network. */
export function geminiRequest(params: Params): Record<string, unknown> {
  const names = new Map<string, string>();
  const contents = params.messages
    .map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: toParts(message.content as string | Block[], names) }))
    .filter((message) => message.parts.length > 0);

  const schema = (params as { output_config?: { format?: { schema?: unknown } } }).output_config?.format?.schema;
  const tools = (params.tools ?? []).filter((tool): tool is Anthropic.Tool => 'input_schema' in tool);

  // Gemini's structured answers now and then get stuck repeating whitespace or a
  // character until they run out of room; asking for compact JSON makes that rarer.
  const compact = schema && !tools.length ? '\n\nWrite the JSON compactly: no indentation, blank lines or runs of spaces, and no number longer than it needs to be.' : '';
  return {
    systemInstruction: { parts: [{ text: systemText(params.system) + compact }] },
    contents,
    ...(tools.length
      ? {
          tools: [
            {
              functionDeclarations: tools.map((tool) => ({
                name: tool.name,
                description: tool.description ?? '',
                parameters: toGeminiSchema(tool.input_schema),
              })),
            },
          ],
        }
      : {}),
    generationConfig: {
      ...(schema && !tools.length ? { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) } : {}),
      // Gemini's thinking is counted against its answer's allowance, so it gets more room than Claude's.
      maxOutputTokens: Math.min(65_536, Math.max(16_000, params.max_tokens * 2)),
    },
  };
}

/* ---------------- Gemini's answer → Claude's ---------------- */

const REFUSED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY', 'RECITATION']);

/** The answer, in Claude's shape. Exported for the tests. */
export function fromGemini(model: string, payload: GeminiResponse): Anthropic.Message {
  const candidate = payload.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const content: Anthropic.ContentBlock[] = [];
  const text = parts
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('');
  if (text) content.push({ type: 'text', text, citations: null } as Anthropic.TextBlock);
  for (const part of parts) {
    if (!part.functionCall) continue;
    const id = part.functionCall.id && /^[A-Za-z0-9_-]{1,64}$/.test(part.functionCall.id) ? part.functionCall.id : `gm_${randomBytes(9).toString('hex')}`;
    keepSignature(id, part.thoughtSignature);
    content.push({ type: 'tool_use', id, name: part.functionCall.name, input: part.functionCall.args ?? {} } as Anthropic.ToolUseBlock);
  }

  let stop: Anthropic.StopReason;
  if (payload.promptFeedback?.blockReason) stop = 'refusal';
  else if (!candidate) throw new Error('Gemini returned no answer.');
  else if (content.some((block) => block.type === 'tool_use')) stop = 'tool_use';
  else if (!candidate.finishReason || candidate.finishReason === 'STOP') stop = 'end_turn';
  else if (candidate.finishReason === 'MAX_TOKENS') stop = 'max_tokens';
  else if (REFUSED.has(candidate.finishReason)) stop = 'refusal';
  else throw new Error(`Gemini stopped early (${candidate.finishReason}).`);

  const usage = payload.usageMetadata ?? {};
  const thinking = usage.thoughtsTokenCount ?? 0;
  return {
    id: `gm_${randomBytes(9).toString('hex')}`,
    type: 'message',
    role: 'assistant',
    // Priced and recorded under the name it was asked by, which is the name its price is kept under.
    model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: usage.promptTokenCount ?? 0,
      output_tokens: (usage.candidatesTokenCount ?? 0) + thinking,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens_details: { thinking_tokens: thinking },
    },
  } as unknown as Anthropic.Message;
}

/**
 * Ask Gemini, and once more if it gets stuck repeating itself — caught early,
 * so the second try costs about what the first would have. Stuck twice, it is
 * a failure like any other and the route's backup is asked.
 */
async function askGemini(params: Params, signal?: AbortSignal): Promise<Anthropic.Message> {
  const request = geminiRequest(params);
  try {
    return fromGemini(params.model, await geminiGenerate(params.model, request, signal));
  } catch (error) {
    if (!(error instanceof GeminiRunaway) || signal?.aborted) throw error;
    console.warn(`[squish] ${params.model}: ${error.message} — stopped early, asking once more`);
    try {
      return fromGemini(params.model, await geminiGenerate(params.model, request, signal));
    } catch (again) {
      if (again instanceof GeminiRunaway) throw new Error(`${again.message}, twice`);
      throw again;
    }
  }
}
