/**
 * Keyless model-driven end-to-end smoke: a real AgentLoop runs a scripted LLM
 * adapter, session A's model calls the `session_send` tool, the message wakes
 * session B, and B's next model request actually contains the relayed message.
 *
 *   npm run test:model-e2e
 */

import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionMessagingService from '../src/service.ts'
import * as Tools from '../src/tools.ts'

const CWD = '/tmp/dsh-session-messaging-model-e2e'

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(rawCallId: string, name: string, args: object): StreamChunk[] {
  const callId = ToolCallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index: 0, id: callId, argumentsDelta: argumentsJson.slice(5) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** Scripted model: coordinate once, then answer whichever session was woken. */
class CrossSessionAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const text = options.messages
      .flatMap(message => message.content)
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join('\n')
    if (text.includes('[session-message]')) {
      yield* textResponse('Acknowledged the peer message; session B will not touch src/ui.ts.')
      return
    }
    if (options.messages.some(message => message.role === 'tool')) {
      yield* textResponse('Sent the coordination message and received the receipt.')
      return
    }
    yield* toolCallResponse('call-send', 'session_send', {
      targetSessionId: 'session-b',
      message: 'I am editing src/ui.ts; please avoid it.',
      writeScopes: ['src/ui.ts'],
    })
  }
}

const adapter = new CrossSessionAdapter()
const ctx = new Context()
try {
  await mountAgentLoopTestDependencies(ctx)
  ctx.on('session/flush', () => {})
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(SessionMessagingService, {
    maxMessageChars: 4000,
    maxMessagesPerMinute: 100,
    requireTargetOptIn: false,
    sameDirectoryOnly: true,
    allowSelfSend: false,
  })
  await ctx.plugin(Tools)

  const harness = await mountAgentLoopTestHarness(ctx)
  const sender = await harness.create(SessionId('session-a'), { provider: 'mock', model: 'mock' }, { cwd: CWD })
  const target = await harness.create(SessionId('session-b'), { provider: 'mock', model: 'mock' }, { cwd: CWD })
  // Target already declared the same path, so the relay must carry a conflict warning.
  ctx.sessionMessaging.setConsent(target, true, ['src/ui.ts'])

  sender.followup(createUserMessage({
    content: [{ type: 'text', text: 'Coordinate with the other session about src/ui.ts.' }],
    source: { kind: 'user' },
  }))
  await sender.whenIdle()
  await target.whenIdle()

  // A ran a real model request and a real tool call.
  assert.equal(adapter.requests.length >= 3, true, `expected >=3 model requests, got ${adapter.requests.length}`)

  // B's model request contains the relayed message with source and conflict warning.
  const relayedRequest = adapter.requests.find(request =>
    request.messages.some(message =>
      message.role === 'user'
      && message.content.some(block => block.type === 'text' && block.text.includes('[session-message]')),
    ),
  )
  assert.notEqual(relayedRequest, undefined)
  assert.equal(relayedRequest?.provider, 'mock')
  const relayText = relayedRequest?.messages
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('\n') ?? ''
  assert.match(relayText, /from: session-a/)
  assert.match(relayText, /declared-write-scopes: src\/ui\.ts/)
  assert.match(relayText, /conflict-warning: session session-b also declared src\/ui\.ts/)

  // B's durable history contains the relay and its own answer.
  const targetHistory = target.session.deriveMessages()
  const relayMessage = targetHistory.find(message => (message.source as { kind?: string }).kind === 'session-message')
  assert.notEqual(relayMessage, undefined)
  assert.match(
    (relayMessage as { content: readonly { type: string; text?: string }[] }).content
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join('\n'),
    /\[session-message\]/,
  )
  assert.equal(
    targetHistory.some(message => message.role === 'assistant'
      && message.content.some(block => block.type === 'text' && block.text.includes('Acknowledged the peer message'))),
    true,
  )

  // A's history records the tool result for the send.
  const senderText = sender.session.deriveMessages()
    .flatMap(message => message.content)
    .map(block => block.type === 'text' ? block.text ?? '' : '')
    .join('\n')
  assert.match(senderText, /accepted by session session-b/)

  console.log('MODEL-E2E OK: requests=%d, relay-in-request, receiver-replied', adapter.requests.length)
} finally {
  await ctx.fiber.dispose()
}
