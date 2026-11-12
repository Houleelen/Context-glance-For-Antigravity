# 兼容性与数据说明

## 支持范围

| 项目 | 当前验证情况 |
| --- | --- |
| Antigravity App | Windows，2.31.2 实机验证 |
| Sidecar WebUI | 需要宿主支持 UI Extensions；2.22 是该 UI 能力的起点，不代表本插件已在所有后续版本测试 |
| 安装脚本 | Windows PowerShell 5.1、PowerShell 7 |
| macOS / Linux 桌面 | 未做实机验证，不能视为已支持 |
| 插件运行依赖 | 宿主内置 Node、Sidecar SDK；没有 npm 安装步骤 |
| 开发与核心测试 | Node.js 22 / 24；视觉验证使用 Node.js 24 与 Windows Edge |

这是 Antigravity App 的 Sidecar 插件，不是 VSIX 扩展，也不是 Gemini API 客户端。

## 上下文压缩预算

通过本机 Connect RPC `StreamAgentStateUpdates` 读取当前会话的 `contextWindowUsage.estimatedTokensUsed` 与 `maxContextTokens`。初始步骤、生成记录、执行记录的详情页范围均为零；只保留预算数值，其他状态字段丢弃。

`maxContextTokens` 在本机验证中为 256,000，代表宿主当前工作上下文的压缩预算，不能解释为模型标称窗口只有 256k。Gemini 3.8 Flash 的官方输入窗口为 1,048,576。示例用量 142,903 按两种基准计算，分别约为 55.82% 与 13.63%。

- [官方模型规格](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
- [维护者对压缩阈值的说明](https://github.com/google-antigravity/antigravity-cli/issues/1432)

维护者的回复针对 CLI；本机 App 的同值另由只读状态与 checkpoint 配置核对。插件不会修改阈值，不承诺未来版本或所有模型均为 256,000。

## 模型信息

以当前会话的 `generatorMetadataIndex` 调用只读 `GetCascadeTrajectoryGeneratorMetadata`，提取该请求的 `chatModel.modelDisplayName` 与 `responseModel`。仅在索引变化时刷新；接口不可用时不猜测模型。

这些字段代表最近实际请求，不保证反映尚未发出请求的模型选择变更。元数据接口可能附带其他本机字段，插件在内存中丢弃它们，不保存或向模型发送。

## 降级与隐私

私有读取协议可能随宿主更新而变化，或被 Sidecar 权限拒绝。插件不会绕过权限，而是降级为当前会话的 `brain/<conversationId>/.system_generated/logs/transcript.jsonl`。

日志用量为最近一次有效请求的 `input_tokens + cache_read_tokens`；输出单列，不累计所有轮次。未知分母时显示 `--`。手动基准只影响显示，不改变模型窗口、压缩预算或宿主设置。

面板约每 1.5 秒刷新；隐藏时停止轮询，约 12 秒无面板请求后关闭状态订阅。空闲回收前仍可能短暂保持一个只读本机订阅。

隐藏面板只回收订阅，不表示 Sidecar 进程退出。1.3.1 每约 5 秒只读检查宿主回环健康端点，连续连接失败后自行退出；退出处理有超时兜底，只作用于本插件。Windows 上宿主可能没有转发退出信号，故不能只依赖 SIGTERM。该改进不处理内置 Swarm 或其他插件的进程。

服务只绑定 `127.0.0.1`，端口由宿主分配。插件不注册 Skills、Rules、MCP、Agents 或 Hooks，不启动推理、不发聊天消息、不写宿主数据库、不读取其他插件状态。SDK 自带的发送和新建会话接口被置为拒绝。

运行诊断日志由宿主管理，位于其独立的 `sidecar_data/context-glance/context_glance/logs/`。提交问题时仅提供版本、错误类型和必要数值，勿附完整原始日志或凭据。
