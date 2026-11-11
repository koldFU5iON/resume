import { streamText, stepCountIs, convertToModelMessages, type LanguageModel, type UIMessage } from 'ai'
import { after } from 'next/server'
import { requireProfile } from '@/lib/session'
import { prisma } from '@/lib/db'
import { resolveModelForChat } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { buildSystemPrompt } from '@/modules/chat/context'
import { createChatTools } from '@/modules/chat/tools'
import { PageContextSchema } from '@/modules/chat/schema'

export const maxDuration = 120

export async function POST(request: Request) {
  let profileId: string
  try {
    const { profile } = await requireProfile()
    profileId = profile.id
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const messages = body.messages as UIMessage[]
  const pageContext = body.pageContext ?? null

  const ctxParsed = PageContextSchema.nullable().safeParse(pageContext)
  if (!ctxParsed.success) {
    return Response.json({ error: ctxParsed.error.flatten() }, { status: 400 })
  }

  let resolvedChat: { languageModel: LanguageModel; provider: string; model: string }
  try {
    resolvedChat = await resolveModelForChat(profileId)
  } catch (err) {
    const llmErr = err instanceof LLMError ? err : null
    if (llmErr?.kind === 'not_configured') {
      return Response.json({ error: 'not_configured' }, { status: 412 })
    }
    return Response.json(
      { error: llmErr?.message ?? (err instanceof Error ? err.message : 'LLM error') },
      { status: 503 },
    )
  }

  const systemPrompt = await buildSystemPrompt(profileId, ctxParsed.data)

  const allModelMessages = await convertToModelMessages(messages)
  // Cap history sent to the model. Long-term context is preserved via ChatMemory
  // summaries already injected into the system prompt by buildSystemPrompt.
  const HISTORY_WINDOW = 20
  const modelMessages = allModelMessages.slice(-HISTORY_WINDOW)

  const result = streamText({
    model: resolvedChat.languageModel,
    system: systemPrompt,
    messages: modelMessages,
    tools: createChatTools(profileId),
    stopWhen: stepCountIs(5),
    maxOutputTokens: 4096,
    // Anthropic-specific cost optimisations: cache the system prompt (~10% cost
    // on repeated turns) and auto-compact the conversation when it grows large,
    // keeping a synthesised brief instead of raw tool results.
    providerOptions: resolvedChat.provider === 'anthropic'
      ? {
          anthropic: {
            cacheControl: { type: 'ephemeral' },
            contextManagement: {
              edits: [
                {
                  type: 'compact_20260112' as const,
                  trigger: { type: 'input_tokens' as const, value: 50000 },
                  instructions:
                    'Compress the conversation into a concise working brief. ' +
                    'Preserve: key facts about the user\'s background, ' +
                    'any CV or job description content already discussed, ' +
                    'decisions or feedback given, and outstanding action items. ' +
                    'Drop raw document blobs — keep only the synthesised insights.',
                },
              ],
            },
          },
        }
      : undefined,
    onFinish: ({ totalUsage }) => {
      after(async () => {
        await prisma.llmUsageLog
          .create({
            data: {
              profileId,
              provider: resolvedChat.provider,
              model: resolvedChat.model,
              feature: 'chat-turn',
              role: 'default',
              promptTokens: totalUsage.inputTokens ?? 0,
              completionTokens: totalUsage.outputTokens ?? 0,
              totalTokens: totalUsage.totalTokens ?? 0,
              latencyMs: 0,
            },
          })
          .catch(() => {})
      })
    },
  })

  return result.toUIMessageStreamResponse()
}
