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
import { geminiGenerate, isGeminiModel, toGeminiSchema, type GeminiPart, type GeminiResponse } from './gemini';

let client: Anthropic | null = null;
export const anthropic = (): Anthropic => (client ??= new Anthropic());

export { isGeminiModel };
export const providerOf = (model: string): 'google' | 'anthropic' => (isGeminiModel(model) ? 'google' : 'anthropic');

type Params = Anthropic.MessageCreateParamsNonStreaming | Anthropic.Beta.MessageCreateParamsNonStreaming;

/** Ask, and wait for the whole answer. */
export async function createMessage(params: Anthropic.MessageCreateParamsNonStreaming, signal?: AbortSignal): Promise<Anthropic.Message> {
  if (isGeminiModel(params.model)) return askGemini(params, signal);
  return anthropic().messages.create(params, { signal });
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

  return {
    systemInstruction: { parts: [{ text: systemText(params.system) }] },
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

async function askGemini(params: Params, signal?: AbortSignal): Promise<Anthropic.Message> {
  return fromGemini(params.model, await geminiGenerate(params.model, geminiRequest(params), signal));
}
