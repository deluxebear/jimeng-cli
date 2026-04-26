# Jimeng CLI

This workspace contains a Node.js CLI for replaying authenticated Jimeng web workflows. It supports image, video, audio, and status/download flows, with pure Node VM signing for Jimeng's current `bdms` request protection.

Target page:

```text
https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0
```

## Findings

The image browser workflow is:

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
| Agent conversation | `POST` | `/mweb/v1/creation_agent/v2/conversation` | May create conversation state |
| Start audio generation | `POST` | `/mweb/v1/aigc_draft/generate` | Consumes credits |
| Start video generation | `POST` | `/mweb/v1/aigc_draft/generate` | Consumes credits |

Authentication is cookie/session based. This CLI stores the Jimeng `sessionid` plus browser security values needed for local signing in:

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

Install shell completion after linking:

```bash
jimeng completion zsh > "${fpath[1]}/_jimeng"
exec zsh
```

For bash or fish:

```bash
jimeng completion bash > ~/.jimeng-completion.bash
echo 'source ~/.jimeng-completion.bash' >> ~/.bashrc

jimeng completion fish > ~/.config/fish/completions/jimeng.fish
```

Build a local single-file executable for the current platform with Node 22+:

```bash
npm install
npm run build:binary
./dist/jimeng-$(node -p "process.platform + '-' + process.arch") --help
```

The binary embeds the current Node runtime and the CLI bundle. It still reads auth/config from `~/.jimeng-cli`, downloads the `bdms` runtime cache when needed, and builds only for the current platform/architecture.

The machine-readable command registry is available with:

```bash
jimeng commands list
```

## Structure

- `bin/jimeng.mjs`: CLI parsing, auth capture, and command routing.
- `lib/client.mjs`: shared Jimeng HTTP client, default query params, cookie construction, JSON response handling.
- `lib/config.mjs`: user-level CLI config for output paths, retry count, and retry delay.
- `lib/signer.mjs`: browser signer, headless local signer, pure Node `bdms` VM signer, signed request replay.
- `lib/image.mjs`: image model map, ratio/resolution table, image generation, reference URI handling, ImageX upload.
- `lib/video.mjs`: video model map, Seedance request builder, and video generation flow.
- `lib/audio.mjs`: TTS voice map, audio request builder, and audio generation flow.
- `lib/media.mjs`: history/status/queue, media extraction, downloads, jobs list/sync/status, run workflow.

## Auth

Recommended external-browser flow:

```bash
jimeng auth login --profile default --port 9222
```

Log in to Jimeng in the Chrome window that opens, then capture the first-party session cookie:

```bash
jimeng auth capture --profile default --port 9222
```

Check the stored auth summary:

```bash
jimeng auth status --profile default
```

Check local configuration and environment:

```bash
jimeng config list
jimeng config set output_dir outputs
jimeng config set retry_count 1
jimeng doctor --profile default
```

Save a `sessionid` from the Jimeng browser cookie:

```bash
node bin/jimeng.mjs auth save --profile default --sessionid "YOUR_SESSIONID"
```

The CLI redacts saved credentials in output.

## Product Commands

New commands default to pure Node VM signing (`--node-sign`), so generation does not require an open browser after auth capture.

Create a video job:

```bash
jimeng video create \
  --profile default \
  --prompt "一只小猫在窗边睡觉，电影感，柔和光线" \
  --model seedance-2.0-vip \
  --duration 5 \
  --ratio 16:9
```

Check, wait, and download:

```bash
jimeng video status --profile default --history-id "<history_id>"
jimeng video queue --profile default --history-id "<history_id>"
jimeng video wait --profile default --history-id "<history_id>" --interval-ms 30000
jimeng video download --profile default --history-id "<history_id>" --index 0
```

Create, wait, and download in one command:

```bash
jimeng video run \
  --profile default \
  --prompt "一只小猫在窗边睡觉，电影感，柔和光线" \
  --model seedance-2.0-vip \
  --duration 5 \
  --ratio 16:9 \
  --output outputs/cat.mp4
```

Image and audio use the same shape:

```bash
jimeng image create --profile default --prompt "一张电影感的未来城市夜景" --ratio 16:9 --resolution 2k
jimeng audio create --profile default --text "接口回归测试。"
```

List recent submitted jobs:

```bash
jimeng models list
jimeng history list --limit 20
jimeng history list --limit 20 --type audio
jimeng jobs list --limit 20
jimeng jobs sync --limit 20 --pages 2
jimeng jobs add --history-id "<history_id>" --type video
jimeng jobs status --limit 20
```

## Compatibility Commands

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

Send a prompt to Agent mode:

```bash
node bin/jimeng.mjs agent-chat \
  --profile default \
  --prompt "给我一个一句话图片创意"
```

Start text-to-audio generation with the verified preset voice `直爽女大`:

```bash
node bin/jimeng.mjs generate-audio \
  --profile default \
  --text "欢迎来到即梦接口测试。" \
  --voice zhishuang-nvda
```

Check or wait for image/video/audio history records:

```bash
node bin/jimeng.mjs check-media --profile default --history-id "<history_id>"
node bin/jimeng.mjs wait-media --profile default --history-id "<history_id>"
```

Download a generated media result without printing its signed URL:

```bash
node bin/jimeng.mjs download-media \
  --profile default \
  --history-id "<history_id>" \
  --index 0 \
  --output outputs/media-0.mp3
```

Video generation payload is implemented from browser capture. Use `--node-sign` for the current pure Node signer:

```bash
node bin/jimeng.mjs generate-video \
  --profile default \
  --prompt "蓝色玻璃立方体在白色背景中缓慢旋转" \
  --model seedance-2.0-fast \
  --ratio 16:9 \
  --duration 5 \
  --node-sign
```

`--node-sign` runs Jimeng's current `bdms-1.0.1.20.js` in a pure Node `vm` browser shim and appends current `msToken` / `a_bogus` query parameters before replaying from Node. Run `capture-auth` from a logged-in Chrome session first; it saves the `xmst` value required for `msToken`.

`--local-sign` remains available as a fallback. It runs the same official `bdms` script in a headless local Chromium page instead of the Node VM shim.

`--browser-sign --port 9222` remains available as a fallback. It uses the live Jimeng page to generate current `msToken` / `a_bogus` query parameters, intercepts that signed request locally, then replays it from Node.

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
- External Chrome CDP capture succeeded after login and saved a redacted `sessionid` profile plus `xmst_len=184` for local `msToken` signing.
- `session` read-only check returned HTTP 200.
- `credits` read-only check returned HTTP 200.
- Real CLI `generate-image` succeeded with `history_id=34567179802892`.
- `check-image` confirmed `status=50`, `fail_msg=Success`, and 4 generated PNG items at 2048x2048.
- `download-image` was added to download generated images by `history_id` and item index without exposing signed URLs.
- `download-image --history-id 34567179802892 --index 0` saved `outputs/jimeng-cli-download-0.png`; `file` confirmed it is a 2048x2048 PNG.
- Browser-operated `视频生成` succeeded in submitting a `Seedance 2.0 Fast` job with `history_id=34554355869452`, but the queue was very long.
- Direct CLI `generate-video` without browser signing returns Jimeng `ret=4013` risk-control rejection.
- `generate-video --browser-sign --port 9222` now reaches Jimeng business validation with current browser-generated `msToken` and 192-character `a_bogus`; the latest real test returned `ret=1310` / `exceed_model_parallel_max` because the account already had too many queued video tasks.
- `generate-video --local-sign` now reaches the same Jimeng business validation using locally executed `bdms-1.0.1.20.js`; the latest real test returned `ret=1310` with `msToken_len=184` and `a_bogus_len=192`.
- `generate-video --node-sign` now submits successfully using pure Node VM signing; the latest real test returned `history_id=34581829134860`, `msToken_len=184`, and `a_bogus_len=176`.
- `video status --history-id 34581829134860` confirmed `status=50`, `model=Seedance 2.0 VIP`, and one 1280x720 MP4 result.
- `video queue --history-id 34581829134860` confirmed the queue endpoint and returned `queue_status=3`, `queue_length=0`.
- `video download --history-id 34581829134860 --index 0` saved `outputs/video-node-sign-34581829134860.mp4`; `file` confirmed it is an MP4.
- `jobs add` and `jobs status` were verified against `history_id=34581829134860`.
- `history list --limit 3` was verified against `/mweb/v1/get_history`; it returned recent Seedance 2.0 VIP jobs and `next_offset`.
- `history list --type audio` was verified and returned completed MP3 records.
- `jobs sync --limit 3` imported website history into the local job store and is idempotent on repeated runs. `--pages N` follows `next_offset` for multi-page sync.
- Browser-operated `配音生成` with voice `直爽女大` succeeded.
- CLI `generate-audio --text "接口回归测试。"` succeeded with `history_id=34564885937676`.
- `wait-media --history-id 34564885937676` confirmed two MP3 results.
- `download-media --history-id 34558310019596 --index 0` saved `outputs/interface-audio-0.mp3`.
- CLI `agent-chat` reached `/mweb/v1/creation_agent/v2/conversation` and returned the site SSE stream.

Verified in the logged-in in-app browser after explicit approval for a real test:

- Prompt: `测试用：一只小橙色机器人坐在蓝色书桌旁，干净白色背景，3D 渲染风格`
- UI mode: `图片生成`
- Model shown by the site: `图片5.0 Lite`
- Ratio/resolution shown by the site: `智能比例 / 2K`
- Result: page reached `1/1 生成完成` and displayed two generated robot-at-desk images.
- Screenshot evidence: `outputs/jimeng-real-test-browser.png`

Known gaps:

- Local `--reference-image` upload creates ImageX objects, but Jimeng audit returns `ret=3020 download file failed`.
- Unsigned direct video replay returns `ret=4013`; use `--node-sign`, `--local-sign`, or `--browser-sign`.
- Digital-human and action-copy generation require media/template selection. Their config endpoints are captured but generation commands are not implemented yet.
- `jobs sync --pages N` imports multiple website history pages by following `next_offset`.
- Normal status output intentionally redacts signed URLs; use `download-image` or `download-media` for file export.

## Sources

- Live page: `https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0`
- Public reference implementation: `https://github.com/iptag/jimeng-api`
- Public DeepWiki notes on `jimeng-free-api` image flow.

## Parameter Research

See `PARAMS.md` for the browser-captured parameter matrix covering image models, ratios, resolutions, reference-image requests, and the current local-upload limitation.

See `INTERFACE_TESTS.md` for the full creation-type interface report covering Agent, image, video, digital human, audio, and action-copy captures.

See `SIGNATURE.md` for the `msToken` / `a_bogus` validation and open-source signer comparison.
