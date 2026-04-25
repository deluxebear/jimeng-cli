# Jimeng Image Parameter Notes

This document records parameters verified from the live Jimeng browser flow first, then cross-checked against public implementations.

## Browser-Captured Reference Flow

Captured from external Chrome/CDP, not the in-app browser.

Reference image generation uses this sequence:

1. `POST /mweb/v1/imagex/submit_audit_job`
2. `POST /mweb/v1/algo_proxy`
3. `POST /mweb/v1/aigc_draft/generate`
4. `POST /mweb/v1/get_history_by_ids`

The current browser request differs from the older open-source implementation in important places:

| Field | Current browser behavior |
| --- | --- |
| `extend` | `{ root_model, workspace_id: 0 }` |
| reference mode | `generate_type: "blend"` |
| `draft_content.min_version` | `3.0.2` |
| `draft_content.version` | `3.3.14` |
| `abilities.blend.core_param.prompt` | Prefixes prompt with `##` for one reference image |
| `abilities.blend.core_param.generate_type` | `0` |
| `metrics_extra.position` | `page_bottom_box` |
| `metrics_extra.isBoxSelect` | `false` |
| `metrics_extra.isCutout` | `false` |
| blob source origin | `blob:https://jimeng.jianying.com/<uuid>` |
| polling | Browser can poll by `submit_ids`; CLI also supports `history_ids` |

## Models

| CLI alias | Internal request key | Browser label seen |
| --- | --- | --- |
| `jimeng-5.0` | `high_aes_general_v50` | `图片5.0 Lite` |
| `jimeng-4.6` | `high_aes_general_v42` | `图片4.6` |
| `jimeng-4.5` | `high_aes_general_v40l` | not re-tested in browser capture |
| `jimeng-4.1` | `high_aes_general_v41` | not re-tested in browser capture |
| `jimeng-4.0` | `high_aes_general_v40` | not re-tested in browser capture |
| `jimeng-3.1` | `high_aes_general_v30l_art_fangzhou:general_v3.0_18b` | not re-tested in browser capture |
| `jimeng-3.0` | `high_aes_general_v30l:general_v3.0_18b` | not re-tested in browser capture |

Run:

```bash
node bin/jimeng.mjs params
```

to print the current model and size matrix.

## Size Parameters

The CLI exposes:

- `--resolution 1k|2k|4k`
- `--ratio 1:1|4:3|3:4|16:9|9:16|3:2|2:3|21:9`

For example:

```bash
node bin/jimeng.mjs generate-image \
  --profile default \
  --prompt "一台小机器人在绿色桌面旁，白色背景" \
  --model jimeng-4.6 \
  --ratio 16:9 \
  --resolution 1k
```

## Text-To-Image

Verified through CLI:

```bash
node bin/jimeng.mjs generate-image \
  --profile default \
  --prompt "测试用：一只小橙色机器人坐在蓝色书桌旁，干净白色背景，3D 渲染风格" \
  --model jimeng-5.0 \
  --ratio 1:1 \
  --resolution 2k
```

Confirmed result:

- `history_id=34567179802892`
- `status=50`
- 4 PNG images
- 2048x2048

## Reference Image By Browser URI

Stable current path: use a browser-observed or browser-created `tos-cn-i-*` image URI.

```bash
node bin/jimeng.mjs generate-image \
  --profile default \
  --prompt "参考图中的橙色机器人主体保持一致，换成绿色桌面，近景半身构图，干净白色背景，3D 渲染质感" \
  --model jimeng-4.6 \
  --ratio 1:1 \
  --resolution 2k \
  --sample-strength 0.5 \
  --reference-uri "<tos-cn-i-...>"
```

Confirmed result:

- `history_id=34557056230668`
- `status=50`
- model `图片4.6`
- 4 PNG images
- 2048x2048
- downloaded sample: `outputs/jimeng-reference-uri-0.png`

## Local Reference Image Upload

Current status: implemented but not stable.

The CLI can upload a local file through ImageX proof/token flows, but the generated URI currently fails Jimeng's browser-equivalent content check:

```text
ret=3020 errmsg="download file failed"
```

So local `--reference-image <path>` is still experimental. The stable flow is:

1. Use browser/CDP capture to get a site-accepted `tos-cn-i-*` URI.
2. Use `--reference-uri`.

## Capture Artifacts

Redacted captures:

- `captures/reference-auto-2.json`
- `captures/reference-auto-3-redacted.json`
- `captures/reference-manual-redacted.json`
- `captures/reference-regen-redacted.json`

Private local captures with non-auth URI details:

- `captures/private-reference-auto-3.json`
- `captures/private-reference-manual.json`
- `captures/private-reference-regen.json`

Do not commit private captures or auth files.
