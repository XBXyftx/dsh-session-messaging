/**
 * Cold-session delivery: when the target is not live, the service resumes it
 * through the deployment's session controller before delivering. A profile
 * without that controller keeps the `target-not-live` refusal.
 *
 *   npm run test:integration
 */

import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionMessagingService from '../src/service.ts'
import * as Tools from '../src/tools.ts'

const CWD = '/tmp/dsh-session-messaging-cold'

async function run(allowColdDelivery: boolean): Promise<void> {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    ctx.on('session/flush', () => {})
    await ctx.plugin(SessionMessagingService, {
      maxMessageChars: 4000,
      maxMessagesPerMinute: 100,
      requireTargetOptIn: false,
      sameDirectoryOnly: false,
      allowSelfSend: false,
      allowColdDelivery,
    })
    await ctx.plugin(Tools)

    const harness = await mountAgentLoopTestHarness(ctx)
    const sender = await harness.create(SessionId('cold-sender'), { provider: 'test', model: 'test' }, { cwd: CWD })
    // A persisted session with no live Agent: sessions.create registers only
    // the Session; the fake controller supplies the resumed Agent that must
    // receive the relayed message.
    const coldSession = ctx.sessions.create(SessionId('cold-target'), { meta: { cwd: CWD } })
    const delivered: UserMessage[] = []
    const coldAgent = {
      id: coldSession.id,
      session: coldSession,
      status: 'idle',
      steer: (message: UserMessage) => { delivered.push(message) },
    } as unknown as Agent
    ctx.provide('sessionController', {
      resolveAgent: async (id: SessionId) =>
        id === coldSession.id
          ? { agent: coldAgent }
          : { error: { code: 'session/not-found', message: 'missing' } },
    } as never)

    if (allowColdDelivery) {
      const receipt = await ctx.sessionMessaging.send(sender, { targetSessionId: 'cold-target', message: 'cold hello' })
      assert.equal(receipt.delivery, 'resumed')
      assert.equal(delivered.length, 1)
      assert.equal((delivered[0]?.source as { kind?: string }).kind, 'session-message')
      console.log('COLD-DELIVERY OK: persisted target resumed and received the relay')
    } else {
      await assert.rejects(
        ctx.sessionMessaging.send(sender, { targetSessionId: 'cold-target', message: 'cold hello' }),
        (error: unknown) => (error as { code?: string }).code === 'target-not-live',
      )
      assert.equal(delivered.length, 0)
      console.log('COLD-DISABLED OK: cold delivery refused without waking the session')
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

await run(true)
await run(false)
