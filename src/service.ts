/**
 * Host-side session-messaging service. It discovers live user-launched peers in
 * the same working directory, enforces opt-in plus rate limits, and relays a
 * message through the target agent's inbox as a durable `user/message` with the
 * plugin's `session-message` source. It never appends a new Session event kind,
 * so the session format and its readers stay unchanged.
 * @module dsh-session-messaging/service
 */

import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Config } from './config.ts'
import type { SessionMessagingConfig } from './config.ts'
import {
  MessagingError,
  SESSION_MESSAGE_KIND,
  SlidingWindowRateLimiter,
  buildRelayText,
  findScopeConflicts,
  isTopLevelSessionHeader,
  normalizeWriteScopes,
  sameDirectory,
  validateMessageText,
} from './protocol.ts'
import type { PeerView, SendReceipt, SendRequest } from './protocol.ts'
import type {} from './types.ts'

/** One session's receive consent and advisory write scopes. */
interface ConsentEntry {
  readonly enabled: boolean
  readonly writeScopes: readonly string[]
  readonly updatedAt: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-session messaging service provided by this plugin. */
    sessionMessaging: SessionMessagingService
  }
}

/**
 * Relay service shared by the model-facing tools. It exposes only same-process,
 * live, top-level sessions in the current MVP; cold-session delivery and
 * durable consent are follow-up work.
 */
export class SessionMessagingService extends Service {
  static inject = ['agents', 'sessions']
  /** Loader-read configuration schema; defaults apply when the row omits `config`. */
  static Config = Config

  private readonly config: SessionMessagingConfig
  private readonly limiter: SlidingWindowRateLimiter
  private readonly consent = new Map<string, ConsentEntry>()

  /**
   * @param ctx - Cordis context with `agents` and `sessions` ready.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, config: SessionMessagingConfig) {
    super(ctx, 'sessionMessaging')
    this.config = config
    this.limiter = new SlidingWindowRateLimiter(config.maxMessagesPerMinute)
  }

  /**
   * List live user-launched peers the caller may address.
   * @param caller - the agent whose tool call is inspecting peers.
   * @returns peer views ordered by session registration.
   */
  listPeers(caller: Agent): PeerView[] {
    this.assertTopLevelCaller(caller)
    const callerDirectory = caller.session.header.cwd
    const peers: PeerView[] = []
    for (const candidate of this.ctx.agents.roots()) {
      if (candidate.id === caller.id) continue
      if (!isTopLevelSessionHeader(candidate.session.header)) continue
      if (this.config.sameDirectoryOnly && !sameDirectory(callerDirectory, candidate.session.header.cwd)) {
        continue
      }
      const consent = this.consent.get(candidate.id)
      peers.push({
        sessionId: candidate.id,
        status: candidate.status,
        canReceive: this.config.requireTargetOptIn ? consent?.enabled === true : consent?.enabled !== false,
        writeScopes: consent?.writeScopes ?? [],
      })
    }
    return peers
  }

  /**
   * Set this session's reception state and advisory write scopes.
   * Sessions are mutually visible and can message each other by default; pass
   * `enabled: false` to pause reception explicitly.
   * @param caller - the session being configured.
   * @param enabled - whether peers may relay messages to this session.
   * @param writeScopes - advisory scopes this session is currently changing.
   * @returns the stored consent entry.
   */
  setConsent(caller: Agent, enabled: boolean, writeScopes?: readonly string[]): ConsentEntry {
    this.assertTopLevelCaller(caller)
    const entry: ConsentEntry = {
      enabled,
      writeScopes: enabled ? normalizeWriteScopes(writeScopes) : [],
      updatedAt: Date.now(),
    }
    this.consent.set(caller.id, entry)
    return entry
  }

  /**
   * Reject callers that are not user-launched top-level sessions.
   *
   * The peer channel is deliberately symmetric: a subagent is neither listed
   * nor allowed to relay. Subagent sessions keep using the existing
   * parent/child `send_message` channel instead of a one-way cross-session
   * side channel.
   * @param caller - the agent whose tool call is being validated.
   * @throws {MessagingError} with `caller-not-top-level` for a subagent session.
   */
  private assertTopLevelCaller(caller: Agent): void {
    if (isTopLevelSessionHeader(caller.session.header)) return
    throw new MessagingError(
      'caller-not-top-level',
      `session ${caller.id} is not a user-launched top-level session; subagent sessions use the parent/child channel`,
    )
  }

  /**
   * Relay one message to a live peer session.
   *
   * Success means the target agent accepted the message into its inbox and the
   * session flush acknowledged persistence. It does not mean the target model
   * has read or acted on it.
   * @param caller - sending agent, taken from the tool execution identity.
   * @param request - target, body, and optional advisory scopes.
   * @returns a receipt with the sender-minted message id.
   * @throws {MessagingError} for every refused or failed delivery.
   */
  async send(caller: Agent, request: SendRequest): Promise<SendReceipt> {
    if (typeof request.targetSessionId !== 'string' || request.targetSessionId.trim() === '') {
      throw new MessagingError('invalid-request', 'targetSessionId must be a non-empty string')
    }
    this.assertTopLevelCaller(caller)
    const targetId = SessionId(request.targetSessionId.trim())
    if (targetId === caller.id && !this.config.allowSelfSend) {
      throw new MessagingError('self-send', 'a session cannot relay a message to itself')
    }
    const body = validateMessageText(request.message, this.config.maxMessageChars)
    const writeScopes = normalizeWriteScopes(request.writeScopes)
    // Sending with scopes is itself a declaration; keep the caller's latest
    // declaration visible to peers and usable for advisory conflict detection.
    if (writeScopes.length > 0) {
      const previous = this.consent.get(caller.id)
      this.consent.set(caller.id, {
        enabled: previous?.enabled ?? true,
        writeScopes,
        updatedAt: Date.now(),
      })
    }
    const conflicts = findScopeConflicts(
      writeScopes,
      [...this.consent.entries()]
        .filter(([sessionId]) => sessionId !== caller.id)
        .map(([sessionId, entry]) => ({ sessionId, scopes: entry.writeScopes }))
        .filter(peer => peer.scopes.length > 0),
    )

    const target = this.ctx.agents.get(targetId)
    if (target === undefined) {
      throw new MessagingError(
        'target-not-live',
        `session ${targetId} is not live in this Harness process; cold-session delivery is not implemented yet`,
      )
    }
    if (!isTopLevelSessionHeader(target.session.header)) {
      throw new MessagingError('target-not-top-level', `session ${targetId} is not a user-launched top-level session`)
    }
    if (this.config.sameDirectoryOnly && !sameDirectory(caller.session.header.cwd, target.session.header.cwd)) {
      throw new MessagingError('cross-directory', 'the target session works in a different directory')
    }
    const consent = this.consent.get(targetId)
    if (this.config.requireTargetOptIn && consent?.enabled !== true) {
      throw new MessagingError('target-not-opted-in', `session ${targetId} has not opted in to peer messages`)
    }
    if (consent?.enabled === false) {
      throw new MessagingError('target-paused', `session ${targetId} has paused peer messages`)
    }

    const pairKey = `${caller.id}->${targetId}`
    if (!this.limiter.allow(pairKey, Date.now())) {
      throw new MessagingError(
        'rate-limited',
        `more than ${this.config.maxMessagesPerMinute} messages per minute were sent to this session`,
      )
    }

    const messageId = `session-message-${randomUUID()}`
    const text = buildRelayText({
      senderSessionId: caller.id,
      sentAt: new Date().toISOString(),
      message: body,
      writeScopes,
      conflicts,
      ...(request.replyTo === undefined ? {} : { replyTo: request.replyTo }),
    })
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: SESSION_MESSAGE_KIND,
        form: 'relay',
        senderSessionId: caller.id,
        messageId,
      },
    })
    // steer() consumes at the nearest step boundary for a running agent and
    // starts a turn for an idle one, so it is the single delivery primitive.
    target.steer(message)
    const flushed = await this.ctx.sessions.flush(target.session)
    if (!flushed) {
      throw new MessagingError('delivery-rejected', `session persistence did not acknowledge ${messageId}`)
    }
    return {
      accepted: true,
      messageId,
      targetSessionId: targetId,
      targetStatus: target.status,
      conflicts,
    }
  }
}

/** Loader configuration schema re-exported from this module for tooling that imports the class directly. */
export { Config }

export default SessionMessagingService
