/**
 * Deployment configuration for the session-messaging plugin. Every value that
 * two deployments may want to set differently is a schema field; the loader
 * validates it at load time and fails loudly on invalid input.
 * @module dsh-session-messaging/config
 */

import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_MAX_MESSAGE_CHARS, DEFAULT_MAX_MESSAGES_PER_MINUTE } from './protocol.ts'

/** Validated deployment configuration. */
export interface SessionMessagingConfig {
  /** Maximum relay body length in UTF-16 code units. */
  readonly maxMessageChars: number
  /** Maximum relays per sender→target pair per minute. */
  readonly maxMessagesPerMinute: number
  /** Require the target session to opt in before it can receive peer messages. Off by default: sessions are mutually visible and can message each other unless they pause reception. */
  readonly requireTargetOptIn: boolean
  /** Only allow peers whose working directory equals the sender's. */
  readonly sameDirectoryOnly: boolean
  /** Allow a session to relay to itself (diagnostics only; off by default). */
  readonly allowSelfSend: boolean
}

/** Schemastery schema for the plugin row's `config` block. */
export const Config: Schema<SessionMessagingConfig> = Schema.object({
  maxMessageChars: Schema.number().min(1).default(DEFAULT_MAX_MESSAGE_CHARS),
  maxMessagesPerMinute: Schema.number().min(1).default(DEFAULT_MAX_MESSAGES_PER_MINUTE),
  requireTargetOptIn: Schema.boolean().default(false),
  sameDirectoryOnly: Schema.boolean().default(true),
  allowSelfSend: Schema.boolean().default(false),
})
