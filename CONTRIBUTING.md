# 参与开发

开发工具使用 Node.js 24 和 Windows PowerShell 5.1 / PowerShell 7；插件运行时使用 Antigravity 内置 Node 与 Sidecar SDK，无需 npm 依赖。

```powershell
node scripts/check-publish.mjs
node --test test/*.test.mjs
```

SDK 集成测试在未安装宿主 SDK 时会明确跳过。不要将跳过解释为该环境的实机集成通过。

视觉验证使用独立 Edge 用户目录与模拟会话：

```powershell
node test/visual-check.mjs
```

如 Edge 不在默认位置，设置 `CONTEXT_GLANCE_EDGE` 为实际浏览器可执行文件。浏览器测试输出只在 `.verification/` 内，不能加入发布包。

## 修改约束

- 保持只读，不添加对话消息、模型推理、技能、规则、MCP 或对话钩子。
- 保持当前会话隔离；没有会话 ID 时不能猜测其他活跃会话。
- 使用宿主返回的预算，不按模型名字硬编码容量。
- 模型数据必须标明实际来源，不能将全局默认模型当作当前对话模型。
- 使用模拟数据制作截图；排查问题时不要提交 CSRF 凭据、对话正文、完整生成元数据或宿主数据库。
- 不修改其他插件或全局宿主配置。

提交 PR 时写明行为变化、验证结果和宿主版本；涉及界面时附窄屏与浅深色截图，涉及协议时附经过删减的字段结构。

打包命令及正式发布步骤见 [发布说明](docs/PUBLISHING.md)。
