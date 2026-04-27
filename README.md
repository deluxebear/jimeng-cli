# jimeng-cli

`jimeng-cli` 是一个本地命令行工具，用来把即梦 / 剪映 Web 端的已登录工作流转换成可复用的 CLI。它基于真实浏览器流量研究接口，复用你自己的登录态，支持图片生成、视频生成、配音生成、数字人 / Agent 工作流、任务轮询、历史记录和媒体下载。

这个项目不是即梦或剪映官方工具。接口来自授权登录后的浏览器行为分析，页面或接口变更后可能需要重新捕获并更新实现。

## 安装

直接用 `npx` 运行：

```bash
npx @deluxebear/jimeng-cli --help
```

全局安装后使用 `jimeng` 命令：

```bash
npm install -g @deluxebear/jimeng-cli
jimeng --help
```

本地开发：

```bash
npm install
npm link
jimeng --help
```

从本地 tarball 安装：

```bash
npm pack
npm install -g ./deluxebear-jimeng-cli-0.1.0.tgz
```

安装配套的 Agent Skill：

```bash
npx skills add deluxebear/jimeng-cli --skill jimeng-cli
```

全局安装到 Agent：

```bash
npx skills add deluxebear/jimeng-cli --skill jimeng-cli -g -y
```

GitHub 仓库名为 `deluxebear/jimeng-cli`。

## 登录与本地凭据

先用真实浏览器完成登录：

```bash
jimeng auth login --profile default
```

检查登录态和环境：

```bash
jimeng auth status --profile default
jimeng doctor --profile default
jimeng commands list
```

默认数据目录：

- 登录态：`~/.jimeng-cli/profiles/<profile>/auth.json`
- 浏览器用户目录：`~/.jimeng-cli/browser-profiles/<profile>/`
- 签名脚本缓存：`~/.jimeng-cli/sdk/`
- 下载输出：当前工作目录的 `outputs/`，除非命令显式指定路径

`~/.jimeng-cli` 包含你的 Cookie、token 和会话信息。不要提交到 Git，不要贴给别人，也不要让 Agent 在回答里打印完整内容。

## 签名方式

即梦接口依赖 `msToken` 和 `a_bogus` 等浏览器侧签名。当前 CLI 的默认目标是本地复现浏览器签名逻辑：

- `--algorithm-sign`：纯 JS 复刻 `bdms/fn150` 签名算法，当前已经可用于真实请求。
- `--local-sign` / node-sign：在 Node 中加载官方浏览器运行时脚本，让它产出签名 URL。
- `--browser-sign`：通过浏览器环境兜底签名。

建议优先使用 `--algorithm-sign` 做测试；如果即梦更新了风控脚本，再用 node-sign 或 browser-sign 对比差异。

签名健康检查：

```bash
jimeng signer compare --profile default
```

## 图片生成

文字生成图片：

```bash
jimeng image create \
  --profile default \
  --prompt "一只小猫在窗边睡觉，电影感，柔和光线" \
  --model image-3.0 \
  --ratio 1:1 \
  --algorithm-sign
```

等待并下载结果：

```bash
jimeng image wait --profile default --history-id <history-id>
jimeng image download --profile default --history-id <history-id> --index 0 --output-dir outputs
```

参考图生成图片：

```bash
jimeng image create \
  --profile default \
  --prompt "保留主体姿态，改成赛博朋克夜景" \
  --reference-image ./input.png \
  --model image-3.0 \
  --ratio 16:9 \
  --algorithm-sign
```

## 视频生成

创建视频任务：

```bash
jimeng video create \
  --profile default \
  --prompt "一只小猫在窗边睡觉，电影感，柔和光线" \
  --model seedance-2.0-vip \
  --duration 5 \
  --ratio 16:9 \
  --algorithm-sign
```

查询状态：

```bash
jimeng video status --profile default --history-id <history-id>
```

等待完成：

```bash
jimeng video wait --profile default --history-id <history-id> --interval-ms 5000 --timeout-ms 600000
```

下载视频：

```bash
jimeng video download --profile default --history-id <history-id> --index 0 --output-dir outputs
```

一条命令完成创建、等待、下载：

```bash
jimeng video run \
  --profile default \
  --prompt "一只小猫在窗边睡觉，电影感，柔和光线" \
  --model seedance-2.0-vip \
  --duration 5 \
  --ratio 16:9 \
  --algorithm-sign \
  --output outputs/cat.mp4
```

已经真实验证过的参数组合：

```text
model: seedance-2.0-vip
duration: 5
ratio: 16:9
signer: pure JS --algorithm-sign
result: 1280x720 MP4, about 5 seconds
```

## 配音、Agent 与历史记录

查看可用命令：

```bash
jimeng commands list
```

常用入口：

```bash
jimeng audio create --profile default --text "你好，欢迎使用即梦 CLI"
jimeng audio wait --profile default --history-id <history-id>
jimeng audio download --profile default --history-id <history-id> --index 0 --output-dir outputs
jimeng history list --profile default --limit 20
jimeng download --url "<media-url>" --output outputs/media.bin
```

如果页面新增了模型、尺寸、时长或参考图参数，优先通过浏览器捕获真实请求，再把字段落到 CLI 参数里。

## 重新捕获接口

当页面改版、模型列表变化、任务失败，或需要研究新创作类型时，先启动复用登录态的真实浏览器：

```bash
jimeng auth login --profile default --port 9222
```

然后在源码仓库里运行开发用抓包脚本，完成一次真实页面操作后保存 redacted 摘要：

```bash
node scripts/capture-browser-flow.mjs \
  --port 9222 \
  --mode manual \
  --output captures/browser-flow-redacted.json
```

摘要会写入：

```text
captures/browser-flow-redacted.json
```

后续实现时应把新捕获的接口与 `lib/client.mjs`、`lib/image.mjs`、`lib/video.mjs`、`lib/audio.mjs`、`lib/signer.mjs` 和 `lib/bdms-algorithm.mjs` 对比，而不是只参考旧开源项目。

## 打包与验证

这个项目按 npm CLI 交付，不默认构建单文件 binary。

语法检查：

```bash
npm run check
```

查看将发布到 npm 包里的文件：

```bash
npm run pack:dry
```

本地 tarball 验证：

```bash
tmpdir="$(mktemp -d)"
npm pack --pack-destination "$tmpdir"
npm install --prefix "$tmpdir/global" -g "$tmpdir"/deluxebear-jimeng-cli-0.1.0.tgz
"$tmpdir/global/bin/jimeng" --help
```

## 安全边界

- 只在你拥有授权的账号和工作区中使用。
- 不要提交 `auth.json`、`captures/`、`outputs/`、签名 URL、Cookie、token 或完整请求头。
- 生成、删除、下载和发布类命令会消耗远端资源或改变远端状态，自动化前应确认意图。
- 如果接口返回风控或授权错误，先检查登录态和签名对比，不要盲目重试。
