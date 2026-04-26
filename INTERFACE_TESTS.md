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
| `agent-chat` | `POST /mweb/v1/creation_agent/v2/conversation` | Pass, returns SSE stream as raw text |
| `generate-audio` | `POST /mweb/v1/aigc_draft/generate` with `audio_base_component` | Pass, `history_id=34564885937676` |
| `check-media` / `wait-media` / `download-media` | `POST /mweb/v1/get_history_by_ids` + signed media download | Pass for audio, wrote `outputs/interface-audio-0.mp3` |
| `generate-video` direct replay | `POST /mweb/v1/aigc_draft/generate` with `video_base_component` | Fails with `ret=4013` without browser signing |
| `generate-video --browser-sign` | Browser-generated `msToken` / `a_bogus`, then Node replay | Reaches business validation; latest test returned `ret=1310` / `exceed_model_parallel_max` |
| `scripts/capture-browser-flow.mjs --mode regen` | Browser traffic capture through CDP/Playwright | Pass, wrote redacted `captures/interface-regen-redacted.json` |

## Real Generation Tests

| Mode | Model | Ratio | Resolution | History ID | Server result |
| --- | --- | --- | --- | --- | --- |
| Text-to-image | `jimeng-4.6` / `high_aes_general_v42` | `16:9` | `1k` | `34561091771148` | 4 PNGs, actual output `1280x720` |
| Reference URI + prompt | `jimeng-4.6` / `high_aes_general_v42` | `1:1` | `1k` | `34558314205708` | 4 PNGs, actual output `1024x1024` |
| Previous verified text-to-image | `jimeng-5.0` / `high_aes_general_v50` | `1:1` | `2k` | `34567179802892` | 4 PNGs, actual output `2048x2048` |
| Previous verified reference URI | `jimeng-4.6` / `high_aes_general_v42` | `1:1` | `2k` | `34557056230668` | 4 PNGs, actual output `2048x2048` |
| Browser video submit | `Seedance 2.0 Fast` / `dreamina_seedance_40` | `16:9` | `5s` | `34554355869452` | Submitted, queued with `status=20` |
| Browser-signed CLI video submit | `Seedance 2.0 Fast` / `dreamina_seedance_40` | `16:9` | `5s` | n/a | Request accepted past anti-abuse signing, then blocked by concurrency limit `ret=1310` |
| CLI audio submit | `直爽女大` / `7597003459665072686` | n/a | mp3 | `34564885937676` | 2 MP3 results, finished with `status=50` |

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

### Agent Mode

```http
POST /mweb/v1/creation_agent/v2/conversation
```

Important body fields:

```json
{
  "conversation_id": "<uuid>",
  "messages": [
    {
      "author": { "role": "user" },
      "metadata": {
        "conversation_id": "<uuid>",
        "parent_message_id": "",
        "metrics_extra": "{\"userMessageId\":\"<uuid>\",\"prompt\":\"<prompt>\",\"referenceCnt\":0,\"position\":\"page_bottom_box\"}",
        "system_hints": ["dreamina_creative_consultant"]
      },
      "id": "<uuid>",
      "content": {
        "content_type": "",
        "content_parts": [
          {
            "text": "<prompt>",
            "is_referenced": false
          }
        ]
      },
      "create_time": 1777139859196,
      "tools": []
    }
  ],
  "version": "3.0.0",
  "workspace_id": 0
}
```

The response is server-sent events (`event: message`, `event: delta`, `event: system`) returned over the same HTTP request. The current CLI preserves it as `parsed.raw`.

### Text-To-Video Generate

Browser UI submitted successfully through:

```http
POST /mweb/v1/aigc_draft/generate
```

Important body fields:

```json
{
  "extend": {
    "root_model": "dreamina_seedance_40",
    "m_video_commerce_info": {
      "benefit_type": "dreamina_seedance_20_fast",
      "resource_id": "generate_video",
      "resource_id_type": "str",
      "resource_sub_type": "aigc"
    },
    "workspace_id": 0,
    "m_video_commerce_info_list": [
      {
        "benefit_type": "dreamina_seedance_20_fast",
        "resource_id": "generate_video",
        "resource_id_type": "str",
        "resource_sub_type": "aigc"
      }
    ]
  },
  "submit_id": "<uuid>",
  "metrics_extra": "{\"functionMode\":\"omni_reference\",\"sceneOptions\":\"[{\\\"type\\\":\\\"video\\\",\\\"scene\\\":\\\"BasicVideoGenerateButton\\\",\\\"resolution\\\":\\\"720p\\\",\\\"modelReqKey\\\":\\\"dreamina_seedance_40\\\",\\\"videoDuration\\\":5}]\"}",
  "draft_content": {
    "type": "draft",
    "min_version": "3.0.5",
    "version": "3.3.14",
    "component_list": [
      {
        "type": "video_base_component",
        "gen_type": 10,
        "generate_type": "gen_video",
        "abilities": {
          "gen_video": {
            "text_to_video_params": {
              "video_gen_inputs": [
                {
                  "prompt": "<prompt>",
                  "video_mode": 2,
                  "fps": 24,
                  "duration_ms": 5000,
                  "idip_meta_list": []
                }
              ],
              "video_aspect_ratio": "16:9",
              "seed": 3344935544,
              "model_req_key": "dreamina_seedance_40",
              "priority": 0
            },
            "video_task_extra": "<same metrics_extra json>"
          }
        },
        "process_type": 1
      }
    ]
  },
  "http_common_info": {
    "aid": 513695
  }
}
```

Direct Node replay with the same body shape and browser-matched query parameters currently returns:

```json
{
  "ret": "4013",
  "errmsg": "生成失败，疑似存在异常行为，请重新尝试",
  "fail_starling_key": "web_risk_control_message_reject_generation"
}
```

This means video generation needs either browser-assisted submission or the browser-generated anti-abuse query parameters (`msToken`, `a_bogus`) reproduced before it can be considered a pure API replay.

### Text-To-Audio Generate

The UI first loads voices:

```http
POST /mweb/v1/feed
```

Body:

```json
{
  "panel": "dreamina_tone",
  "count": 50,
  "offset": 0,
  "category_key": "all",
  "panel_source": "loki",
  "app_id": 1775,
  "pack_item_opt": {
    "need_favorite_info": true
  }
}
```

Generation uses:

```http
POST /mweb/v1/aigc_draft/generate
```

Important body fields:

```json
{
  "extend": {
    "m_video_commerce_info_list": [
      {
        "amount": 1,
        "benefit_type": "audio_tts_generate",
        "resource_id": "generate_audio",
        "resource_id_type": "str",
        "resource_sub_type": "aigc"
      }
    ],
    "workspace_id": 0
  },
  "submit_id": "<uuid>",
  "metrics_extra": "{\"type\":\"audio\",\"scene\":\"AudioTTSGenerate\",\"audioDuration\":1}",
  "draft_content": {
    "type": "draft",
    "min_version": "3.2.3",
    "version": "3.3.14",
    "component_list": [
      {
        "type": "audio_base_component",
        "gen_type": 44,
        "generate_type": "generate_tts",
        "abilities": {
          "text_to_speech": {
            "text": "<text>",
            "id_info": {
              "id": "7597003459665072686",
              "item_platform": 1
            },
            "audio_config": {
              "format": "mp3",
              "sample_rate": 24000,
              "speech_rate": 0,
              "pitch_rate": 0
            },
            "voice_name": "直爽女大"
          }
        }
      }
    ]
  }
}
```

Completed audio results expose media URLs at:

- `item_list[].audio.origin_audio.url`
- `item_list[].common_attr.file.file_url`
- `item_list[].common_attr.item_urls[]`

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

Additional creation-type endpoints captured by switching the menu:

| Creation type | URL type | Important endpoints |
| --- | --- | --- |
| Agent 模式 | `type=agentic` | `/mweb/v1/creation_agent/v2/get_agent_config`, `/mweb/v1/creation_agent/v2/conversation` |
| 图片生成 | `type=image` | `/mweb/v1/get_common_config`, `/mweb/v1/aigc_draft/generate` |
| 视频生成 | `type=video` | `/mweb/v1/video_generate/get_common_config`, `/mweb/v1/aigc_draft/generate`, `/mweb/v1/get_history_queue_info` |
| 数字人 | `type=digitalHuman` | `/mweb/v1/video_generate/get_common_config` with `lip_sync_image_generate_video` and `lip_sync_video_generate_video`, `/mweb/v1/feed` for voice assets |
| 配音生成 | `type=audio` | `/mweb/v1/feed` with `panel=dreamina_tone`, `/mweb/v1/tts_generate` for voice preview, `/mweb/v1/aigc_draft/generate` |
| 动作模仿 | `type=actionCopy` | `/mweb/v1/video_generate/get_common_config`, `/mweb/v1/dreamina_subject/get`, upload/material endpoints |

## Known Gaps

- Local `--reference-image` upload is not yet production-ready because Jimeng audit returns `3020 download file failed`.
- Unsigned direct video replay returns `4013`; use `--local-sign` or `--browser-sign` for `/mweb/v1/aigc_draft/generate` flows that require `msToken` / `a_bogus`.
- The latest `generate-video --local-sign` test reached business validation (`ret=1310`, `exceed_model_parallel_max`) with `msToken_len=184` and `a_bogus_len=192`, so signing is no longer the blocker for that path.
- The latest `generate-video --node-sign` test submitted successfully with pure Node VM signing (`history_id=34581829134860`, `msToken_len=184`, `a_bogus_len=176`).
- Digital-human and action-copy generation need media/template selection before a real generation payload can be submitted. Their config and material-loading endpoints are captured, but not yet converted into generation commands.
- Browser generation uses `draft_content.version=3.3.14` for several flows. The server sometimes returns older versions in stored history, but submit payloads should prefer `3.3.14`.
- The CLI does not yet expose workspace list, unread count, or credit history commands, although their browser endpoints are captured.
