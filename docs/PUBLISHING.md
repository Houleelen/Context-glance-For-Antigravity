# 上传 GitHub 与发布

本项目的目标地址为 `https://github.com/Houleelen/Context-glance-For-Antigravity`，与当前 Git 的 origin 一致。是否已上传以远端实际内容为准。如果实际账号或仓库名不同，先修改 `plugin/plugin.json` 中的 `repository`、`homepage` 与 README 安装链接。

作者为 houleelen，采用 MIT 许可证；根目录与插件目录均包含完整授权文本。运行文件保留在 `plugin/`，不要添加第二份根 manifest；GitHub 安装链接应指向 `tree/main/plugin`。

## 上传前检查

```powershell
node scripts/check-publish.mjs
node --test test/*.test.mjs
.\scripts\Build-Release.ps1
```

`check-publish.mjs` 是本项目的离线发布检查，不等同于官方 CLI strict 校验。若已安装 Antigravity CLI，另外运行：

```powershell
agy plugin validate --strict ./plugin
```

发布准备环境没有安装 `agy` 时，此项应记为未执行，不能写成通过。官方 CLI 不是插件运行依赖。只有获得 GitHub 上的实际 CI 结果后，才能声称在线 CI 已通过。

## 建立仓库并上传源码

在 GitHub 创建空仓库 `Context-glance-For-Antigravity`，不要预先生成 README 或 LICENSE，本地已经包含这些文件和 MIT 授权。然后在本项目目录执行以下命令（若已经初始化仓库，省略 `git init`；若已有提交，按实际修改提交）：

```powershell
git init -b main
git add .
git status --short
git diff --cached --stat
git commit -m "Release Context Glance 1.3.1"
git remote add origin https://github.com/Houleelen/Context-glance-For-Antigravity.git
git push -u origin main
```

`git init` 只创建仓库，不会创建第一次提交；没有提交时 `main` 还不是可推送的分支，直接 push 常见报错为 `src refspec main does not match any`。先执行 `git add` 和 `git commit`。

如果 `origin` 已存在，跳过 `git remote add`。确需更正地址时使用 `git remote set-url origin <实际地址>`。远端若已有独立提交，应先核对并合并，不使用强制推送覆盖。

提交前检查暂存列表：应只有本项目源码、文档、模拟截图、测试与工作流。`.verification/`、浏览器配置目录、`dist/`、日志、凭据与宿主配置不应出现。没有授权时不上传、发布或提交收录申请。

也可以使用 GitHub 的 Upload files 上传本项目的源码文件；不要只上传 ZIP，也不要上传整个上一级脚本目录。保留 `.github/` 工作流与 `plugin/` 的目录层级。

## Release 附件

`Build-Release.ps1` 只按 `scripts/release-files.json` 白名单复制文件，生成带项目根目录的 ZIP 和 SHA256 校验文件。ZIP 解压后进入 `context-glance` 目录即可运行 `Install.ps1`。内部 `SHA256SUMS.txt` 可核对文件内容。

在 GitHub 新建 `v1.3.1` Release，说明可取自 CHANGELOG；附件选择 `dist/context-glance-v1.3.1.zip` 和对应的 `.sha256`。浏览器测试目录不会被打包。

## 官方 Marketplace

GitHub 发布不会自动进入官方市场。后续若申请收录，按 [官方发布指南](https://antigravity.google/docs/build-plugins#publish-to-the-antigravity-marketplace) 补齐市场专用字段并通过官方 strict 校验，再提交官方表单。当前 Sidecar-only 版本没有为了收录加入对话技能或 starter prompts。
