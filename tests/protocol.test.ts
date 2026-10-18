import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MessagingError,
  SlidingWindowRateLimiter,
  buildRelayText,
  findScopeConflicts,
  isTopLevelSessionHeader,
  normalizeScope,
  normalizeWriteScopes,
  sameDirectory,
  scopesOverlap,
  validateMessageText,
} from '../src/protocol.ts'

test('validateMessageText trims and returns the body', () => {
  assert.equal(validateMessageText('  hello peer  ', 100), 'hello peer')
})

test('validateMessageText rejects empty, oversized, and NUL bodies', () => {
  assert.throws(() => validateMessageText('   ', 100), (error: unknown) => error instanceof MessagingError && error.code === 'invalid-request')
  assert.throws(() => validateMessageText('x'.repeat(101), 100), (error: unknown) => error instanceof MessagingError && error.code === 'invalid-request')
  assert.throws(() => validateMessageText('a\u0000b', 100), (error: unknown) => error instanceof MessagingError && error.code === 'invalid-request')
})

test('normalizeWriteScopes normalizes separators, trims, and deduplicates', () => {
  assert.deepEqual(normalizeWriteScopes(undefined), [])
  assert.deepEqual(
    normalizeWriteScopes([' src/a.ts ', 'src\\a.ts', 'src/b.ts']),
    ['src/a.ts', 'src/b.ts'],
  )
  assert.throws(() => normalizeWriteScopes(['   ']), (error: unknown) => error instanceof MessagingError)
  assert.throws(() => normalizeWriteScopes(Array.from({ length: 33 }, (_, index) => `f${index}`)), (error: unknown) => error instanceof MessagingError)
})

test('isTopLevelSessionHeader accepts only user-launched sessions', () => {
  assert.equal(isTopLevelSessionHeader({}), true)
  assert.equal(isTopLevelSessionHeader({ parentSession: 's', origin: 'subagent' }), false)
  assert.equal(isTopLevelSessionHeader({ parentSession: 's' }), false)
  assert.equal(isTopLevelSessionHeader({ delegationDepth: 1 }), false)
})

test('sameDirectory compares normalized paths and rejects missing values', () => {
  assert.equal(sameDirectory('/work/a', '/work/a/'), true)
  assert.equal(sameDirectory('/work/a', '/work/b'), false)
  assert.equal(sameDirectory(undefined, '/work/a'), false)
})

test('buildRelayText marks the sender as a peer and carries scopes', () => {
  const text = buildRelayText({
    senderSessionId: 'session-a',
    senderTitle: 'frontend',
    sentAt: '2026-10-18T00:00:00.000Z',
    message: 'I am editing src/ui.ts; please avoid it.',
    writeScopes: ['src/ui.ts'],
    replyTo: 'session-message-1',
  })
  assert.match(text, /session-message/)
  assert.match(text, /from: frontend \(session-a\)/)
  assert.match(text, /declared-write-scopes: src\/ui\.ts/)
  assert.match(text, /reply-to: session-message-1/)
  assert.match(text, /peer, not an authority/)
  assert.match(text, /I am editing src\/ui\.ts/)
})

test('SlidingWindowRateLimiter enforces a limit and recovers after the window', () => {
  const limiter = new SlidingWindowRateLimiter(2, 1000)
  assert.equal(limiter.allow('a->b', 0), true)
  assert.equal(limiter.allow('a->b', 10), true)
  assert.equal(limiter.allow('a->b', 20), false)
  assert.equal(limiter.allow('a->c', 20), true)
  assert.equal(limiter.allow('a->b', 1100), true)
})


test('normalizeScope unifies separators and drops leading ./ and trailing /', () => {
  assert.equal(normalizeScope('./src\\ui/'), 'src/ui')
  assert.equal(normalizeScope('src//ui///'), 'src/ui')
})

test('scopesOverlap detects equality and ancestor/descendant paths', () => {
  assert.equal(scopesOverlap('src/ui.ts', 'src/ui.ts'), true)
  assert.equal(scopesOverlap('src', 'src/ui.ts'), true)
  assert.equal(scopesOverlap('src/ui.ts', 'src/api.ts'), false)
  assert.equal(scopesOverlap('src/ui', 'src/ui2'), false)
})

test('findScopeConflicts reports peers with overlapping declared scopes', () => {
  const conflicts = findScopeConflicts(['src/ui.ts', 'docs/a.md'], [
    { sessionId: 'b', scopes: ['src/ui.ts'] },
    { sessionId: 'c', scopes: ['src/api.ts'] },
    { sessionId: 'd', scopes: ['docs'] },
  ])
  assert.deepEqual(conflicts, [
    { sessionId: 'b', scopes: ['src/ui.ts'] },
    { sessionId: 'd', scopes: ['docs'] },
  ])
})
