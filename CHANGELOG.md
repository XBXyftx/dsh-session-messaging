# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-11-05

### Fixed

- **A sidebar fork is now a top-level peer.** The top-level test treated a
  durable `parentSession` as a subagent marker, but dsh writes that field for
  fork **seed lineage** as well: a sidebar fork records `parentSession` and
  `isSeeded` with no `origin` and a depth of 0. A forked session therefore
  failed every peer call with `caller-not-top-level`, and the sessions that
  forked from it could not see it in `session_peers` either — the channel was
  broken in both directions. Classification now matches the host: only
  `origin: 'subagent'` and a non-zero `delegationDepth` mark a delegated child,
  which is exactly how `ctx.agents.roots()` and the subagent factory classify
  sessions. Subagent refusal is unchanged.
- The error message no longer claims every rejected caller is a subagent.

### Tests

- Unit: a fork header (`parentSession` with `isSeeded`, no `origin`) is
  top-level; `origin: 'subagent'` and any non-zero depth still are not.
- Integration: a real seeded fork Agent lists peers, receives from its source
  session, and relays back to it; the subagent boundary still refuses both
  directions.

## [0.4.0] - 2026-10-18

### Added

- Cold-session delivery: when a target session is not live, the plugin resumes
  it through the deployment's `sessionController` before delivering. Enable or
  disable it with the new `allowColdDelivery` config field (on by default).
- `session_send` receipts now report `delivery: 'live' | 'resumed'`.
- New `cold-delivery-failed` error code for a refused or failed resume.

### Changed

- Profiles without a session controller keep the previous `target-not-live`
  refusal; archived/subagent-owned sessions are refused by the controller.

## [0.3.0] - 2026-10-18

### Added

- A client-side sidebar panel, “Session Messaging”, with:
  - a cross-directory toggle persisted through the dsh settings form
    (`sameDirectoryOnly` is now a volatile config field);
  - an npm update check against the published package;
  - links to npm, GitHub, and the author's blog.

### Changed

- The `sameDirectoryOnly` config field is volatile, so the panel can edit it
  at runtime without editing the profile patch by hand.

## [0.2.0] - 2026-10-18

### Changed

- **Cross-directory peers are allowed by default.** `session_peers` and
  `session_send` now accept sessions whose working directory differs from the
  sender's. Set `sameDirectoryOnly: true` in the plugin configuration to
  restore the previous path restriction.
- The change is a minor release because it changes default delivery behavior:
  review the peer-content trust boundary before enabling it in shared hosts.

### Tests

- Integration coverage now exercises default cross-directory discovery and
  delivery, plus an explicit `sameDirectoryOnly: true` policy test.

## [0.1.2] - 2026-10-18

### Fixed

- Enforce the top-level boundary symmetrically. `session_send`, `session_peers`,
  and `session_reception` now reject subagent callers with
  `caller-not-top-level`; previously a subagent could send one-way messages to
  top-level sessions while top-level sessions could not reply. Subagents keep
  using the existing parent/child `send_message` channel.
- Targeting a subagent from a top-level session remains explicitly refused with
  `target-not-top-level`.

### Changed

- README (English and Chinese) now states that the envelope `from` field is the
  trusted identity; any identity claim in the message body is data only.

### Tests

- Added integration coverage: a subagent caller is rejected without waking the
  target, a top-level session cannot target a subagent, and all previous
  refusals (self-send, cross-directory, non-live target, paused reception)
  still pass.

## [0.1.1] - 2026-10-18

### Added

- Bilingual plugin-manager metadata (English / 简体中文) for the bundle and its
  tools row, plus SVG icons.
- Desktop demo screenshot in the README.

## [0.1.0] - 2026-10-18

### Added

- Initial release: `session_peers`, `session_send`, and `session_reception`
  tools; peer delivery through `Agent.steer` as a durable `user/message` with a
  `session-message` source; advisory write-scope conflict warnings.
