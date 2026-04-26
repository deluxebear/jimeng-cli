# Jimeng Signature Notes

Date: 2026-04-26

This records the current `msToken` / `a_bogus` findings for Jimeng web API replay. Private captures with live tokens are intentionally kept under ignored `captures/`.

## Current Browser Behavior

The live Jimeng page loads these signature-related scripts:

| Asset | Observed role |
| --- | --- |
| `common/scripts/bdms-1.0.1.20.js` | Current Jimeng/Douyin-style request signing hook |
| `common/scripts/sdk-glue-1.0.0.66.js` | Initializes `bdms` with page config and protected path list |
| `common/scripts/security-secsdk-runtime-v1.0.0.js` | Browser security runtime and request hook framework |
| `upload/side-code/cdn-security.CBNL5bno.min.js` | CDN/security side code |

For `POST /mweb/v1/aigc_draft/generate` in video mode, the browser appends:

```text
msToken: 184 characters
a_bogus: 192 characters
```

The CLI can now use the logged-in Chrome page as a signing oracle without sending the request from the page:

```bash
node bin/jimeng.mjs generate-video \
  --profile default \
  --prompt "蓝色玻璃立方体在白色背景中缓慢旋转" \
  --browser-sign \
  --port 9222
```

Implementation detail: the CLI connects to Chrome over CDP, runs `fetch()` inside the Jimeng page, intercepts the signed `/mweb/v1/aigc_draft/generate` request before it reaches the network, then replays that signed URL/body from Node with the saved `sessionid`.

The CLI can also sign locally without an already-open Jimeng page:

```bash
node bin/jimeng.mjs generate-video \
  --profile default \
  --prompt "蓝色玻璃立方体在白色背景中缓慢旋转" \
  --local-sign
```

Implementation detail: `capture-auth` saves `xmst` from Jimeng localStorage. `--local-sign` loads the official `bdms-1.0.1.20.js` in a headless local Chromium page on the Jimeng origin, initializes it with the live `_SdkGlueInit` config observed from the page (`aid=513695`, `pageId=28324`, protected path list including `/mweb/v1/aigc_draft/generate`), intercepts the signed request, then replays it from Node with the saved `sessionid`.

## Open-Source Comparison

| Source | Output | Result |
| --- | --- | --- |
| `xbogus@1.0.2` | TikTok `X-Bogus`, 28 characters | Not compatible with Jimeng `a_bogus` |
| `tiktok-signature@4.2.0` | TikTok `X-Bogus` / `X-Gnarly` service | Not the Jimeng/Douyin `a_bogus` shape |
| `xinlingqudongX/TSDK` Douyin `sign_datail` | Older 164-character `a_bogus` | Does not match Jimeng current 192-character `bdms-1.0.1.20` signature |

The current Jimeng page should be treated as the source of truth. Open-source Douyin/TikTok signers are useful references, but the tested public implementations do not reproduce the live Jimeng signature.

## Validation Results

Direct Node video replay without browser signing returned:

```text
ret=4013
```

Browser-signed Node replay returned:

```text
ret=1310
fail_code=exceed_model_parallel_max
errmsg=因目前处于使用高峰期，暂时无法提交更多任务，请等待其他任务完成后再尝试提交～
```

That change is important: `1310` is a business/account concurrency limit after request validation, while `4013` is the previous anti-abuse rejection. This validates that current browser-generated `msToken` / `a_bogus` are accepted by the server.

Local `bdms` signing returned the same validation class:

```text
ret=1310
fail_code=exceed_model_parallel_max
msToken_len=184
a_bogus_len=192
```

This validates that the locally executed official `bdms` script reproduces the live Jimeng request signature shape. The remaining `1310` result is an account/task concurrency limit, not an anti-abuse signature failure.
