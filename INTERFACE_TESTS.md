# Jimeng Interface Test Report

Date: 2026-04-26

This report records real calls made against the logged-in Jimeng web session. Secrets, cookies, `msToken`, `a_bogus`, signed image URLs, and full private captures are intentionally excluded from Git. Full captures remain under ignored `captures/private-*.json`; generated/downloaded images remain under ignored `outputs/`.

## Git Baseline

- Initial source snapshot committed before testing: `bbccbff Initial Jimeng CLI research scaffold`

## Tested CLI Surface

| CLI command | Backing interface | Real result |
| --- | --- | --- |
| `params` | Local model/ratio/resolution matrix | Pass |
| `capture-auth --profile default --port 9222` | Chrome DevTools Protocol cookie read | Pass, saved `sessionid` to `~/.jimeng-cli/profiles/default/auth.json` |
| `session --profile default` | `POST /passport/account/info/v2?account_sdk_source=web` | Pass, returned logged-in account info |
| `credits --profile default` | `POST /commerce/v1/benefits/user_credit` | Pass, returned VIP/gift credit balances |
| `generate-image` text-to-image | `POST /mweb/v1/aigc_draft/generate` | Pass, `history_id=34561091771148` |
| `check-image` | `POST /mweb/v1/get_history_by_ids` | Pass, status `50`, 4 finished PNGs |
| `wait-image` | `POST /mweb/v1/get_history_by_ids` polling | Pass |
| `download-image` | `POST /mweb/v1/get_history_by_ids` + signed image download | Pass, wrote `outputs/interface-text-16x9-1k.png` |
| `download --url` | Generic URL download | Pass after parser fix, wrote `outputs/interface-raw-download.png` |
| `upload-image` | Jimeng upload proof/token + ImageX upload + content audit | Fails at Jimeng audit with `ret=3020`, `errmsg=download file failed` |
| `generate-image --reference-uri` | `get_image_by_uri` + `submit_audit_job` + `algo_proxy` + `aigc_draft/generate` | Pass, `history_id=34558314205708` |
| `scripts/capture-browser-flow.mjs --mode regen` | Browser traffic capture through CDP/Playwright | Pass, wrote redacted `captures/interface-regen-redacted.json` |

## Real Generation Tests

| Mode | Model | Ratio | Resolution | History ID | Server result |
| --- | --- | --- | --- | --- | --- |
| Text-to-image | `jimeng-4.6` / `high_aes_general_v42` | `16:9` | `1k` | `34561091771148` | 4 PNGs, actual output `1280x720` |
| Reference URI + prompt | `jimeng-4.6` / `high_aes_general_v42` | `1:1` | `1k` | `34558314205708` | 4 PNGs, actual output `1024x1024` |
| Previous verified text-to-image | `jimeng-5.0` / `high_aes_general_v50` | `1:1` | `2k` | `34567179802892` | 4 PNGs, actual output `2048x2048` |
| Previous verified reference URI | `jimeng-4.6` / `high_aes_general_v42` | `1:1` | `2k` | `34557056230668` | 4 PNGs, actual output `2048x2048` |

Note: for the `16:9` `1k` request, the submitted payload predicted `1024x576`, while the completed item metadata reported `1280x720`. The `image_ratio` and aspect ratio were honored, but the final pixel dimensions were normalized by the service.

## Current API Calls

### Account

```http
POST https://jimeng.jianying.com/passport/account/info/v2
```

Query:

```json
{
  "account_sdk_source": "web"
}
```

### Credits

```http
POST https://jimeng.jianying.com/commerce/v1/benefits/user_credit
```

Body:

```json
{}
```

### Text-To-Image Generate

```http
POST https://jimeng.jianying.com/mweb/v1/aigc_draft/generate
```

Important body fields:

```json
{
  "extend": {
    "root_model": "high_aes_general_v42",
    "workspace_id": 0
  },
  "submit_id": "<uuid>",
  "metrics_extra": "{\"promptSource\":\"custom\",\"generateCount\":1,\"enterFrom\":\"click\",...}",
  "draft_content": {
    "type": "draft",
    "min_version": "3.0.2",
    "version": "3.0.2",
    "component_list": [
      {
        "type": "image_base_component",
        "aigc_mode": "workbench",
        "gen_type": 1,
        "generate_type": "generate",
        "abilities": {
          "generate": {
            "core_param": {
              "model": "high_aes_general_v42",
              "prompt": "<prompt>",
              "negative_prompt": "<negative prompt>",
              "seed": "<number>",
              "sample_strength": 0.5,
              "image_ratio": 3,
              "large_image_info": {
                "width": 1024,
                "height": 576,
                "resolution_type": "1k"
              },
              "intelligent_ratio": false
            },
            "gen_option": {
              "generate_all": false
            }
          }
        }
      }
    ]
  }
}
```

### Reference URI Generate

Before generation:

```http
POST /mweb/v1/get_image_by_uri
POST /mweb/v1/imagex/submit_audit_job
POST /mweb/v1/algo_proxy?babi_param=<json>
```

Generation body differences:

```json
{
  "extend": {
    "root_model": "high_aes_general_v42",
    "workspace_id": 0
  },
  "draft_content": {
    "version": "3.0.2",
    "component_list": [
      {
        "gen_type": 12,
        "generate_type": "blend",
        "abilities": {
          "blend": {
            "core_param": {
              "model": "high_aes_general_v42",
              "prompt": "##<prompt>",
              "sample_strength": 0.5,
              "image_ratio": 1,
              "large_image_info": {
                "width": 1024,
                "height": 1024,
                "resolution_type": "1k"
              },
              "intelligent_ratio": false,
              "generate_type": 0
            },
            "ability_list": [
              {
                "name": "byte_edit",
                "image_uri_list": ["tos-cn-i-tb4s082cfz/<object>"],
                "image_list": [
                  {
                    "type": "image",
                    "source_from": "upload",
                    "platform_type": 1,
                    "image_uri": "tos-cn-i-tb4s082cfz/<object>",
                    "uri": "tos-cn-i-tb4s082cfz/<object>"
                  }
                ],
                "strength": 0.5
              }
            ],
            "prompt_placeholder_info_list": [
              {
                "ability_index": 0
              }
            ],
            "postedit_param": {
              "generate_type": 0
            }
          }
        }
      }
    ]
  },
  "metrics_extra": "{\"position\":\"page_bottom_box\",\"isBoxSelect\":false,\"isCutout\":false,...}"
}
```

Browser capture confirms the current web UI uses the same key reference-image shape, with two notable differences from older/open examples:

- `extend.workspace_id` is present.
- `draft_content.version` is `3.3.14` in browser reference/regenerate captures, while the current CLI payload still succeeds with `3.0.2`.

### History Polling

```http
POST https://jimeng.jianying.com/mweb/v1/get_history_by_ids
```

CLI body:

```json
{
  "history_ids": ["<history_id>"],
  "image_info": {
    "width": 2048,
    "height": 2048,
    "format": "webp",
    "image_scene_list": ["smart_crop variants", "normal variants"]
  }
}
```

Browser body during regeneration:

```json
{
  "submit_ids": ["<submit_id>"]
}
```

Both forms worked in testing.

### Local Upload Path

The CLI currently attempts:

```http
POST /mweb/v1/get_upload_image_proof
POST https://imagex.bytedanceapi.com/?<proof query params>
POST /mweb/v1/imagex/submit_audit_job
POST /mweb/v1/algo_proxy?babi_param=<json>
```

Then falls back to:

```http
POST /mweb/v1/get_upload_token
GET  https://imagex.bytedanceapi.com/?Action=ApplyImageUpload&Version=2018-08-01&...
PUT  <ImageX upload host/store uri>
POST https://imagex.bytedanceapi.com/?Action=CommitImageUpload&Version=2018-08-01&...
POST /mweb/v1/imagex/submit_audit_job
POST /mweb/v1/algo_proxy?babi_param=<json>
```

Current result:

```json
{
  "ret": "3020",
  "errmsg": "download file failed"
}
```

The ImageX object can be created, but Jimeng's later audit/content-check service cannot download it. Reusing a browser-captured `tos-cn-i-tb4s082cfz/...` URI is currently the stable reference-image path.

## Browser-Captured Interfaces

Latest redacted browser regenerate capture: `captures/interface-regen-redacted.json`.

Observed endpoints:

| Count | Method | Path |
| --- | --- | --- |
| 1 | `POST` | `/mweb/v1/workspace/update` |
| 1 | `POST` | `/mweb/v1/aigc_draft/generate` |
| 2 | `POST` | `/mweb/v1/get_history_by_ids` |
| 2 | `POST` | `/commerce/v1/benefits/user_credit_history` |
| 1 | `POST` | `/mweb/v1/get_unread_count` |
| 1 | `POST` | `/mweb/v1/workspace/list` |
| multiple | `GET` | signed `p*-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/...` image assets |

## Known Gaps

- Local `--reference-image` upload is not yet production-ready because Jimeng audit returns `3020 download file failed`.
- Browser generation uses `draft_content.version=3.3.14` for reference/regenerate flows. The CLI should be updated to mirror that version everywhere if stricter validation appears later.
- The CLI does not yet expose workspace list, unread count, or credit history commands, although their browser endpoints are captured.
