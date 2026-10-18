/**
 * Policy smoke for the `sameDirectoryOnly` configuration: the schema default is
 * cross-directory, and an explicit `true` restores the path restriction.
 *
 *   npm run test:integration
 */

import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionMessagingService from '../src/service.ts'
import { Config } from '../src/config.ts'
import * as Tools from '../src/tools.ts'

const CWD = '/tmp/dsh-session-messaging-policy'
const OTHER_CWD = '/tmp/dsh-session-messaging-policy-other'

// Schema default: cross-directory peers are allowed.
const defaults = (Config as unknown as { ['~standard']: { validate: (value: unknown) => { value?: unknown } } })['~standard'].validate({})
const parsed = defaults.value as { sameDirectoryOnly: boolean, requireTargetOptIn: boolean }
assert.equal(parsed.sameDirectoryOnly, false)
assert.equal(parsed.requireTargetOptIn, false)

const ctx = new Context()
try {
  await mountAgentLoopTestDependencies(ctx)
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
  const sender = await harness.create(SessionId('policy-a'), { provider: 'test', model: 'test' }, { cwd: CWD })
  const target = await harness.create(SessionId('policy-b'), { provider: 'test', model: 'test' }, { cwd: CWD })
  const neighbor = await harness.create(SessionId('policy-c'), { provider: 'test', model: 'test' }, { cwd: OTHER_CWD })

  assert.deepEqual(ctx.sessionMessaging.listPeers(sender).map(peer => peer.sessionId), ['policy-b'])
  await assert.rejects(
    ctx.sessionMessaging.send(sender, { targetSessionId: 'policy-c', message: 'blocked by policy' }),
    (error: unknown) => (error as { code?: string }).code === 'cross-directory',
  )
  assert.equal(target.status, 'idle')
  assert.equal(neighbor.status, 'idle')
  console.log('DIRECTORY-POLICY OK: default=cross-directory, restricted=cross-directory rejected')
} finally {
  await ctx.fiber.dispose()
}
