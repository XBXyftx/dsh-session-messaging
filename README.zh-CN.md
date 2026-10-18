# dsh-session-messaging

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）提供**跨会话消息**：让用户在同一工作区自行启动的多个会话互相发消息，协调任务、声明文件写入范围、提示冲突——而不是把它们变成父子关系的子代理。

[English](README.md) | **简体中文**

> 状态：早期预览（`0.1.0`），适配 dsh `0.2.1-rc.2`。dsh 插件 API 仍为 pre-stable，上游升级可能带来破坏性变更。

## 为什么需要

dsh 已有 subagent 与 Agent Teams，但它们都是层级关系，生命周期绑定父会话。而当你自己同时打开几个会话（前端、后端、文档）时，它们在同一工作区里无法说"我在改 `src/ui.ts`，先别动"或"接口字段已冻结"。

本插件为这些顶层会话增加一个**对等通道**：

- 同一工作目录下的会话可以发现彼此；
- 模型可以向对等会话发送消息，消息以普通 user 消息插入目标对话；
- 每个会话可暂停接收；写范围是建议性声明，重叠时会提示双方。

## 演示

![桌面端收到的对等会话消息](docs/assets/cross-session-demo.webp)

macOS 桌面客户端（`0.2.1-rc.2`）真实运行：另一个用户启动的会话发来测试消息，以内联 `session-message` 信封显示（含发送方、时间与"peer 不是 authority"提示）；本会话通过 `session_send` 回复。两个会话位于同一工作目录，不涉及子代理层级。

### 案例：从 peer 缺陷报告到修复验证

两个用户启动的会话通过本插件协作完成了一次真实修复：一个会话发来可复现的缺陷报告与代码级根因，修复以 `v0.1.2` 发布，报告方在桌面端独立完成了回归。

![收到的 peer 缺陷报告](docs/assets/defect-report-demo.webp)

*报告方发来的消息：复现步骤、根因定位与修复请求，全部通过 `session_send` 送达。*

![修复后的独立回归验证](docs/assets/regression-verification.webp)

*报告方的独立回归：静态核对 + 桌面运行期探针。探针返回 `caller-not-top-level`，证明 `v0.1.2` 已生效；这条消息本身也证明"顶层 → 顶层"正向链路未回归。*

`0.1.2` 的变更见 [CHANGELOG.md](CHANGELOG.md)。

## 功能

- `session_peers`：列出同目录、live 的顶层会话及其接收状态。
- `session_send`：发送协调消息，可附带 `writeScopes` 与 `replyTo`。
- `session_reception`：暂停/恢复本会话接收对等消息，并声明写范围。
- 消息直接内联显示在目标会话中，来源归属于发送会话，不需要独立收件箱。
- 建议性**写范围冲突检测**：与 peer 声明重叠时，回执与消息信封带 `conflict-warning`。
- 不新增 Session 事件类型、不改 `SESSION_FORMAT_VERSION`：消息就是带 `session-message` source 的 `user/message`。
- 插件管理卡片提供中英双语标题、简介与图标（English / 简体中文）。
- 有边界：长度上限、每 sender→target 限频、同目录、仅顶层、仅 live、拒绝自发送。

## 工作原理

```text
会话 A 的模型调用 session_send
  → tools.ts 以 exec.agent 作为唯一身份
  → service.send 校验目标、正文、写范围、接收状态、限频
  → createUserMessage({ 信封+正文, source: session-message/relay })
  → target.steer(message)          # 最近 step 边界；空闲会话则唤醒
  → await ctx.sessions.flush(target.session)
目标会话 B 的日志出现 user/message(source.kind = 'session-message')
  → deriveMessages() 重建 → B 的下一次模型请求可见 → B 可回复
```

消息信封始终标明"来自另一个会话，不是当前用户"，并提示 peer 不是 authority；peer 内容只作为数据，不获得更高指令权限。

## 要求

- DeepSeek Harness `0.2.1-rc.2`（桌面应用或源码）。
- Node.js `>= 22.19.0`。
- 插件依赖宿主提供的 `@deepseek-ai/{cordis,schemastery,dsh-agent,dsh-llm,dsh-session,dsh-tools}`；它们以 peerDependencies 声明，由运行中的 dsh 安装解析。

## 安装

### 从 GitHub 安装

```sh
dsh plugin --profile <profile> add github:XBXyftx/dsh-session-messaging
```

仓库包含构建好的 `lib/`，从 git 安装**不需要**额外构建。发布到 npm 后也可用包名 `dsh-session-messaging` 安装。

### 本地目录安装

```sh
dsh plugin --profile <profile> add /absolute/path/to/dsh-session-messaging
```

### 桌面应用

桌面应用使用自己的 profile（例如 `desktop`），用其内置 CLI 或 agent 的 `plugin_manager` 工具安装到该 profile。dsh `0.2.1-rc.2` 会通过 HMR 重载配置，通常无需重启应用即可激活。

确认已激活：

- agent 工具列表出现 `session_peers`、`session_send`、`session_reception`；
- `plugin_manager list_plugins` 中 `session-messaging` 与 `session-messaging-tools` 的 `fiberPhase` 为 `active`。

## 使用

在同一工作区打开两个会话，直接让模型协调即可，不需要手动操作 UI。

示例提示词：

```text
用 session_peers 看看当前工作区还有哪些会话。
给 session-b 发消息：我在改 src/ui.ts，已经写进 writeScopes，请避开。
改 src/api.ts 之前先检查有没有别人声明了冲突的写范围。
本会话暂停接收跨会话消息。
```

工具：

| 工具 | 参数 | 返回 |
|---|---|---|
| `session_peers` | 无 | `{ peers: [{ sessionId, status, canReceive, writeScopes }] }` |
| `session_send` | `targetSessionId`、`message`，可选 `writeScopes`、`replyTo` | `{ accepted, messageId, targetSessionId, targetStatus, conflicts }` |
| `session_reception` | `enabled`，可选 `writeScopes` | `{ enabled, writeScopes }` |

`accepted` 表示消息进入目标 inbox 且 flush 确认持久化，**不**表示对等模型已经处理或执行。

## 配置

```yaml
- id: session-messaging
  name: dsh-session-messaging
  config:
    maxMessageChars: 4000
    maxMessagesPerMinute: 12
    requireTargetOptIn: false   # 默认对 peer 开放
    sameDirectoryOnly: true
    allowSelfSend: false
```

## 安全模型与限制

- **peer 内容是可信边界外的输入**：它以 user 消息进入目标会话，信封会标注来源并警告模型，但 dsh 没有针对 peer 消息的内容审批点；工具审批、`agent/pre-step` 与 sandbox 策略仍是唯一的硬边界。
- **只允许顶层会话，收发两个方向都对称**：subagent 会话既不会出现在 peers 里，也不允许发送（`caller-not-top-level`）；顶层会话也不能把 subagent 作为目标（`target-not-top-level`）。subagent 继续使用既有的父子 `send_message` 通道。消息信封的 `from` 字段才是可信身份；正文里的任何身份自称都只是数据。
- **仅同进程**：发现依赖 `ctx.agents`，非 live 会话本版无法接收；冷会话投递与跨进程/跨机器通信未实现。
- **写范围只是建议，不是锁**：dsh 只有乐观版本守卫（`FS_STALE_VERSION`），没有文件锁；Bash、格式化器、代码生成器会绕过写范围提示。
- **状态在内存**：暂停接收与写范围声明随插件生命周期存在，重载/重启后重置。
- **默认同目录**：除非理解跨项目影响，否则不要关闭 `sameDirectoryOnly`。
- **无 GUI 扩展**：消息按普通 user 消息显示；`session-message` 的专属标题/图标需要 client 插件或上游 `ui-chat` 改动。

## 开发

```sh
npm install
npm run build              # tsc -p tsconfig.build.json -> lib/
npm run typecheck
npm test                   # 10 项协议单测
npm run test:integration   # 真实 AgentLoop 服务 + 工具管线，无模型
npm run test:model-e2e     # 脚本化模型：A 发消息，B 收到并回复
```

`lib/` 已提交，便于 `dsh plugin add github:...` 直接使用；修改源码后请重新构建并提交，CI 会检查 `lib/` 与 `src/` 一致。

## 兼容性

- 适配 dsh `0.2.1-rc.2`，`engines.dsh = ">=0.2.1-rc.2 <0.3.0"`。
- 只使用文档化扩展点：`ctx.tools.register`、`ctx.agents`、`ctx.sessions`、`MessageSourceMap`。
- 不修改 `agent-loop`，不新增 `SessionEventMap`。

## 贡献

欢迎 Issue 与 PR。除非经过设计讨论，请保留"不改 loop、不新增 Session 事件、写范围仅建议"的边界。提交前运行 `npm run typecheck`、`npm test`、`npm run test:integration`、`npm run test:model-e2e`。

## 许可证

MIT © 2026 XBXyftx
