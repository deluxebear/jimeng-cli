---
name: jimeng-cli
description: Use this skill when operating or installing the jimeng-cli Jimeng/Jianying CLI, including authenticated browser login, request capture, image generation, video generation, audio generation, agent workflows, local bdms signing, job polling, history lookup, and media download through Jimeng web APIs.
---

# jimeng-cli

Use this skill to run the `jimeng-cli` npm CLI for authenticated Jimeng/Jianying web workflows. The skill can be installed from GitHub with:

```bash
npx skills add deluxebear/jimeng-cli --skill jimeng-cli
```

For global agent-level installation:

```bash
npx skills add deluxebear/jimeng-cli --skill jimeng-cli -g -y
```

The GitHub repository is `deluxebear/jimeng-cli`.

## Command Runner

Prefer an installed global command when available:

```bash
jimeng <command> --profile default
```

If `jimeng` is not installed, run the published npm package without installing it globally:

```bash
npx -y @deluxebear/jimeng-cli <command> --profile default
```

Inside this repository during development, this is also valid:

```bash
node bin/jimeng.mjs <command> --profile default
```

Do not assume users of the installed skill have the source repository checked out.

## Safety

- Auth lives outside the repo at `~/.jimeng-cli/profiles/<profile>/auth.json`.
- Browser profiles live at `~/.jimeng-cli/browser-profiles/<profile>/`.
- Signer runtime cache lives at `~/.jimeng-cli/sdk/`.
- Never print, copy, commit, or summarize cookies, tokens, `msToken`, signed media URLs, full request headers, captures, or files under `~/.jimeng-cli`.
- `image create`, `video create`, `video run`, `audio create`, agent creation, downloads, and history mutation commands may consume remote quota or change remote state.
- Confirm intent before starting long video jobs, batch generation, or any command that spends account credits.

## First Checks

Run these before generation:

```bash
jimeng auth status --profile default
jimeng doctor --profile default
jimeng commands list
```

If auth is missing or expired:

```bash
jimeng auth login --profile default
```

The command opens a real browser. Log in to Jimeng/Jianying, then follow the terminal prompt so cookies are saved locally.

## Signing

Jimeng requests use browser-side signing, including `msToken` and `a_bogus`. Prefer the pure JS algorithm signer first:

```bash
jimeng signer compare --profile default
```

Use `--algorithm-sign` for normal generation when comparison is healthy. If Jimeng updates the browser runtime, use `--local-sign` or `--browser-sign` as a fallback while recapturing and comparing requests.

## Image Workflow

Create an image task:

```bash
jimeng image create \
  --profile default \
  --prompt "一只小猫在窗边睡觉，电影感，柔和光线" \
  --model image-3.0 \
  --ratio 1:1 \
  --algorithm-sign
```

Use a reference image:

```bash
jimeng image create \
  --profile default \
  --prompt "保留主体姿态，改成赛博朋克夜景" \
  --reference-image ./input.png \
  --model image-3.0 \
  --ratio 16:9 \
  --algorithm-sign
```

Poll and download:

```bash
jimeng image wait --profile default --history-id <history-id>
jimeng image download --profile default --history-id <history-id> --index 0 --output-dir outputs
```

## Video Workflow

Create a video task:

```bash
jimeng video create \
  --profile default \
  --prompt "一只小猫在窗边睡觉，电影感，柔和光线" \
  --model seedance-2.0-vip \
  --duration 5 \
  --ratio 16:9 \
  --algorithm-sign
```

Check status:

```bash
jimeng video status --profile default --history-id <history-id>
```

Wait and download:

```bash
jimeng video wait --profile default --history-id <history-id> --interval-ms 5000 --timeout-ms 600000
jimeng video download --profile default --history-id <history-id> --index 0 --output-dir outputs
```

Run end to end:

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

Known verified combination:

```text
model=seedance-2.0-vip
duration=5
ratio=16:9
signer=--algorithm-sign
output=1280x720 MP4, about 5 seconds
```

## Audio, History, and Media

Use command discovery for the exact current surface:

```bash
jimeng commands list
```

Common commands:

```bash
jimeng audio create --profile default --text "你好，欢迎使用即梦 CLI"
jimeng audio wait --profile default --history-id <history-id>
jimeng audio download --profile default --history-id <history-id> --index 0 --output-dir outputs
jimeng history list --profile default --limit 20
jimeng download --url "<media-url>" --output outputs/media.bin
```

## When Jimeng Changes

Capture the real browser workflow before changing API code. Start the authenticated browser first:

```bash
jimeng auth login --profile default --port 9222
```

In the source repository, run the development capture helper and perform the target action in the browser:

```bash
node scripts/capture-browser-flow.mjs \
  --port 9222 \
  --mode manual \
  --output captures/browser-flow-redacted.json
```

Compare the redacted capture against the source modules:

- `lib/client.mjs`
- `lib/image.mjs`
- `lib/video.mjs`
- `lib/audio.mjs`
- `lib/signer.mjs`
- `lib/bdms-algorithm.mjs`

Do not rely only on older open-source implementations when the live browser capture disagrees.
