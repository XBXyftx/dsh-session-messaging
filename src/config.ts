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
  /**
   * Restrict peers to the sender's working directory. Off by default:
   * cross-directory peers are allowed. Declared volatile so the sidebar panel
   * can edit it through the dsh settings form.
   */
  readonly sameDirectoryOnly: boolean
  /** Allow a session to relay to itself (diagnostics only; off by default). */
  readonly allowSelfSend: boolean
  /** Resume a persisted, non-live session through sessionController before delivery. */
  readonly allowColdDelivery: boolean
}

/** Schemastery schema for the plugin row's `config` block. */
export const Config = Schema.object({
  maxMessageChars: Schema.number().min(1).default(DEFAULT_MAX_MESSAGE_CHARS),
  maxMessagesPerMinute: Schema.number().min(1).default(DEFAULT_MAX_MESSAGES_PER_MINUTE),
  requireTargetOptIn: Schema.boolean().default(false),
  sameDirectoryOnly: Schema.boolean().default(false).volatile(),
  allowSelfSend: Schema.boolean().default(false),
  allowColdDelivery: Schema.boolean().default(true),
})


/** Plugin runtime config: volatile fields arrive as stable references. */
export interface ResolvedSessionMessagingConfig extends Omit<SessionMessagingConfig, 'sameDirectoryOnly'> {
  readonly sameDirectoryOnly: { get(): boolean }
}
