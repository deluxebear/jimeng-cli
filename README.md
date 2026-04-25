# Jimeng Website To CLI Research

This workspace contains a small dependency-free Node.js CLI for replaying the Jimeng image-generation web workflow.

Target page:

```text
https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0
```

## Findings

The browser workflow is:

1. Open the image generator page.
2. Enter an image prompt.
3. Choose model/ratio/resolution options.
4. Start an async image-generation job.
5. Poll the history record until generated image items appear.
6. Download image URLs from the returned item list.

Public reverse-engineered implementations and the live page agree on these key endpoints for the China site:

| Purpose | Method | Endpoint | Side effect |
| --- | --- | --- | --- |
| Account smoke test | `POST` | `/passport/account/info/v2` | Read-only |
| Credit check | `POST` | `/commerce/v1/benefits/user_credit` | Read-only |
| Start image generation | `POST` | `/mweb/v1/aigc_draft/generate` | Consumes credits |
| Poll image result | `POST` | `/mweb/v1/get_history_by_ids` | Read-only |

Authentication is cookie/session based. This CLI stores only the Jimeng `sessionid` value in:

```text
~/.jimeng-cli/profiles/<profile>/auth.json
```

Do not commit auth files, cookies, captures, generated signed URLs, or downloaded private outputs.

## Install

No package install is required for basic use.

```bash
node bin/jimeng.mjs --help
```

Optionally link it in a local shell:

```bash
npm link
jimeng --help
```

## Auth

Recommended external-browser flow:

```bash
node bin/jimeng.mjs login --profile default --port 9222
```

Log in to Jimeng in the Chrome window that opens, then capture the first-party session cookie:

```bash
node bin/jimeng.mjs capture-auth --profile default --port 9222
```

Save a `sessionid` from the Jimeng browser cookie:

```bash
node bin/jimeng.mjs auth save --profile default --sessionid "YOUR_SESSIONID"
```

The CLI redacts saved credentials in output.

## Commands

Read-only account check:

```bash
node bin/jimeng.mjs session --profile default
```

Read-only credit check:

```bash
node bin/jimeng.mjs credits --profile default
```

Start image generation. This is state-changing and can consume Jimeng credits:

```bash
node bin/jimeng.mjs generate-image \
  --profile default \
  --prompt "一张电影感的未来城市夜景" \
  --model jimeng-4.5 \
  --ratio 16:9 \
  --resolution 2k
```

Poll a returned history id:

```bash
node bin/jimeng.mjs check-image --profile default --history-id "<history_id>"
```

Wait until completion:

```bash
node bin/jimeng.mjs wait-image \
  --profile default \
  --history-id "<history_id>" \
  --interval-ms 10000 \
  --timeout-ms 1800000
```

Download one generated image from a history record without printing its signed URL:

```bash
node bin/jimeng.mjs download-image \
  --profile default \
  --history-id "<history_id>" \
  --index 0 \
  --output outputs/image-0.png
```

Download a returned image URL:

```bash
node bin/jimeng.mjs download --url "https://..." --output outputs/image.webp
```

## Confirmed Limits

Verified locally:

- CLI syntax with `node --check`.
- Help/usage output.
- Auth save path and redacted output with a fake session value.
- External Chrome login/capture commands were added for CDP-based auth capture without the in-app browser.
- External Chrome CDP capture succeeded after login and saved a redacted `sessionid` profile.
- `session` read-only check returned HTTP 200.
- `credits` read-only check returned HTTP 200.
- Real CLI `generate-image` succeeded with `history_id=34567179802892`.
- `check-image` confirmed `status=50`, `fail_msg=Success`, and 4 generated PNG items at 2048x2048.
- `download-image` was added to download generated images by `history_id` and item index without exposing signed URLs.
- `download-image --history-id 34567179802892 --index 0` saved `outputs/jimeng-cli-download-0.png`; `file` confirmed it is a 2048x2048 PNG.

Verified in the logged-in in-app browser after explicit approval for a real test:

- Prompt: `测试用：一只小橙色机器人坐在蓝色书桌旁，干净白色背景，3D 渲染风格`
- UI mode: `图片生成`
- Model shown by the site: `图片5.0 Lite`
- Ratio/resolution shown by the site: `智能比例 / 2K`
- Result: page reached `1/1 生成完成` and displayed two generated robot-at-desk images.
- Screenshot evidence: `outputs/jimeng-real-test-browser.png`

Not yet verified through the local CLI:

- Direct binary download through raw `download --url` was not verified in this pass.
- Normal status output intentionally redacts signed image URLs; use `download-image` for file export.

## Sources

- Live page: `https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0`
- Public reference implementation: `https://github.com/iptag/jimeng-api`
- Public DeepWiki notes on `jimeng-free-api` image flow.

## Parameter Research

See `PARAMS.md` for the browser-captured parameter matrix covering models, ratios, resolutions, reference-image requests, and the current local-upload limitation.
