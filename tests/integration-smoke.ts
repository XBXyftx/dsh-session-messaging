/**
 * Keyless integration smoke for cross-session messaging. It boots the real
 * AgentLoop prerequisite services and two production Agents (no LLM adapter),
 * mounts this plugin, executes the model-facing tools through the real tool
 * pipeline, and asserts the durable session outcome.
 *
 * Run with the package's own dependencies:
 *   npm run test:integration
 */

import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionMessagingService from '../src/service.ts'
import * as Tools from '../src/tools.ts'

const CWD = '/tmp/dsh-session-messaging-smoke'
const OTHER_CWD = '/tmp/dsh-session-messaging-smoke-other'

/** Find one text block in a message's content. */
function textOf(message: { content: readonly { type: string; text?: string }[] }): string {
  return message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
}

const ctx = new Context()
try {
  await mountAgentLoopTestDependencies(ctx)
  // The deployment profile mounts the JSONL persistence provider; building its
  // native flock addon is out of scope for this keyless smoke. A participating
  // flush listener gives SessionStore.flush() the same "durability listener
  // participated" contract without on-disk durability.
  ctx.on('session/flush', () => {})
  await ctx.plugin(SessionMessagingService, {
    maxMessageChars: 4000,
    maxMessagesPerMinute: 100,
    requireTargetOptIn: false,
    sameDirectoryOnly: true,
    allowSelfSend: false,
  })
  await ctx.plugin(Tools)

  const harness = await mountAgentLoopTestHarness(ctx)
  const sender = await harness.create(SessionId('session-a'), { provider: 'test', model: 'test' }, { cwd: CWD })
  const target = await harness.create(SessionId('session-b'), { provider: 'test', model: 'test' }, { cwd: CWD })
  const neighbor = await harness.create(SessionId('session-c'), { provider: 'test', model: 'test' }, { cwd: OTHER_CWD })
  // A real live subagent-shaped session: subagent sessions must stay on the
  // parent/child channel and must not use the peer channel in either direction.
  const subagentHandle = await ctx.agents.create({
    sessionId: SessionId('session-sub'),
    meta: { cwd: CWD, parentSession: sender.id, origin: 'subagent', delegationDepth: 1 },
    agentOptions: { provider: 'test', model: 'test' },
  })
  const subagent = subagentHandle.agent

  // Discovery: only same-directory live top-level peers are addressable.
  const peers = ctx.sessionMessaging.listPeers(sender)
  assert.deepEqual(peers.map(peer => peer.sessionId), ['session-b'])
  assert.equal(peers[0]?.canReceive, true)

  // The tools are registered through the real registry.
  const names = ctx.tools.schemas().map(schema => schema.name)
  for (const expected of ['session_peers', 'session_send', 'session_reception']) {
    assert.equal(names.includes(expected), true, `missing tool ${expected}`)
  }

  // Declare overlapping write scopes on the target so the relay reports a conflict.
  ctx.sessionMessaging.setConsent(target, true, ['src/ui.ts', 'src/api.ts'])

  // Send through the real model-facing tool pipeline.
  const controller = new AbortController()
  const sent = await ctx.tools.execute({
    callId: ToolCallId('call-1'),
    name: 'session_send',
    arguments: {
      targetSessionId: 'session-b',
      message: 'I am editing src/ui.ts; please avoid it.',
      writeScopes: ['src/ui.ts'],
    },
    agent: sender,
    signal: controller.signal,
  })
  if (sent.isError) {
    console.error('SEND-ERROR:', JSON.stringify(sent.error), JSON.stringify(sent.content))
  }
  assert.equal(sent.isError, false)
  const receipt = sent.value as {
    accepted: boolean
    messageId: string
    targetSessionId: string
    conflicts: { sessionId: string; scopes: string[] }[]
  }
  assert.equal(receipt.accepted, true)
  assert.equal(receipt.targetSessionId, 'session-b')
  assert.match(receipt.messageId, /^session-message-/)
  assert.deepEqual(receipt.conflicts, [{ sessionId: 'session-b', scopes: ['src/ui.ts'] }])

  // An idle agent wakes its driver on steer, so the relay may already be claimed
  // by the time this returns; wait for quiescence and inspect model history.
  await target.whenIdle()
  const history = target.session.deriveMessages()
  const relay = history.find(message => (message.source as { kind?: string }).kind === 'session-message')
  assert.notEqual(relay, undefined)
  assert.equal(relay?.role, 'user')
  const relayText = textOf(relay as { content: readonly { type: string; text?: string }[] })
  assert.match(relayText, /from: session-a/)
  assert.match(relayText, /declared-write-scopes: src\/ui\.ts/)
  assert.match(relayText, /conflict-warning: session session-b also declared src\/ui\.ts/)
  assert.match(relayText, /I am editing src\/ui\.ts/)
  assert.match(relayText, /peer, not an authority/)

  // Symmetric boundary: a subagent is neither listed nor allowed to relay,
  // and a top-level session cannot target a subagent.
  assert.throws(
    () => ctx.sessionMessaging.listPeers(subagent),
    (error: unknown) => (error as { code?: string }).code === 'caller-not-top-level',
  )
  await assert.rejects(
    ctx.sessionMessaging.send(subagent, { targetSessionId: 'session-b', message: 'one-way' }),
    (error: unknown) => (error as { code?: string }).code === 'caller-not-top-level',
  )
  assert.throws(
    () => ctx.sessionMessaging.setConsent(subagent, true),
    (error: unknown) => (error as { code?: string }).code === 'caller-not-top-level',
  )
  assert.equal(target.status, 'idle', 'a rejected subagent send must not wake the target')
  await assert.rejects(
    ctx.sessionMessaging.send(sender, { targetSessionId: 'session-sub', message: 'to child' }),
    (error: unknown) => (error as { code?: string }).code === 'target-not-top-level',
  )

  // Refusals: self, cross-directory, non-live, and explicit pause.
  await assert.rejects(
    ctx.sessionMessaging.send(sender, { targetSessionId: 'session-a', message: 'self' }),
    (error: unknown) => (error as { code?: string }).code === 'self-send',
  )
  await assert.rejects(
    ctx.sessionMessaging.send(sender, { targetSessionId: 'session-c', message: 'other dir' }),
    (error: unknown) => (error as { code?: string }).code === 'cross-directory',
  )
  await assert.rejects(
    ctx.sessionMessaging.send(sender, { targetSessionId: 'session-missing', message: 'nobody' }),
    (error: unknown) => (error as { code?: string }).code === 'target-not-live',
  )
  ctx.sessionMessaging.setConsent(target, false)
  await assert.rejects(
    ctx.sessionMessaging.send(sender, { targetSessionId: 'session-b', message: 'paused' }),
    (error: unknown) => (error as { code?: string }).code === 'target-paused',
  )
  ctx.sessionMessaging.setConsent(target, true, ['src/api.ts'])
  ctx.sessionMessaging.setConsent(neighbor, true)

  console.log('INTEGRATION-SMOKE OK: peers=1, tool=session_send, receipt=%s, history=%d', receipt.messageId, history.length)
} finally {
  await ctx.fiber.dispose()
}
