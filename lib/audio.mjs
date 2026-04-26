import { DEFAULT_ASSISTANT_ID_CN, DRAFT_VERSION, makeUrl, requestJson, uuid } from "./client.mjs";

export const VOICE_MAP = {
  "zhishuang-nvda": {
    id: "7597003459665072686",
    name: "直爽女大",
    item_platform: 1,
    sample_rate: 24000
  }
};

export function buildAudioRequest({ text, voice = "zhishuang-nvda" }) {
  if (!text || text === true) throw new Error("--text is required");
  const voiceConfig = VOICE_MAP[voice];
  if (!voiceConfig) throw new Error(`Unsupported voice "${voice}". Supported: ${Object.keys(VOICE_MAP).join(", ")}`);
  const submitId = uuid();
  const componentId = uuid();
  const metricsExtra = {
    isAiLyric: false,
    lyricCnt: 0,
    isRandomInspiration: false,
    promptSource: "custom",
    enterFrom: "click",
    position: "page_bottom_box",
    sceneOptions: JSON.stringify([{ type: "audio", scene: "AudioTTSGenerate", audioDuration: 1 }]),
    isRegenerate: false
  };
  const audioConfig = {
    type: "",
    id: uuid(),
    format: "mp3",
    sample_rate: voiceConfig.sample_rate,
    speech_rate: 0,
    pitch_rate: 0
  };
  const draftContent = JSON.stringify({
    type: "draft",
    id: uuid(),
    min_version: "3.2.3",
    min_features: [],
    is_from_tsn: true,
    version: DRAFT_VERSION,
    main_component_id: componentId,
    component_list: [
      {
        type: "audio_base_component",
        id: componentId,
        min_version: "3.2.3",
        aigc_mode: "workbench",
        gen_type: 44,
        metadata: {
          type: "",
          id: uuid(),
          created_platform: 3,
          created_platform_version: "",
          created_time_in_ms: new Date().toISOString(),
          created_did: ""
        },
        generate_type: "generate_tts",
        abilities: {
          type: "",
          id: uuid(),
          text_to_speech: {
            type: "",
            id: uuid(),
            text,
            id_info: { id: voiceConfig.id, item_platform: voiceConfig.item_platform },
            audio_config: audioConfig,
            voice_name: voiceConfig.name
          }
        }
      }
    ]
  });
  return {
    submitId,
    body: {
      extend: {
        m_video_commerce_info_list: [
          {
            amount: 1,
            benefit_type: "audio_tts_generate",
            resource_id: "generate_audio",
            resource_id_type: "str",
            resource_sub_type: "aigc"
          }
        ],
        workspace_id: 0
      },
      submit_id: submitId,
      metrics_extra: JSON.stringify(metricsExtra),
      draft_content: draftContent,
      http_common_info: { aid: DEFAULT_ASSISTANT_ID_CN }
    },
    request: { mode: "text2audio", voice, voice_id: voiceConfig.id, voice_name: voiceConfig.name, submit_id: submitId }
  };
}

export async function generateAudio(auth, opts, deps) {
  const built = buildAudioRequest({ text: opts.text, voice: opts.voice || "zhishuang-nvda" });
  const referer = "https://jimeng.jianying.com/ai-tool/generate?type=audio&workspace=0";
  if (opts["algorithm-sign"]) {
    const signedRequest = await deps.algorithmSignRequest({
      auth,
      url: makeUrl("/mweb/v1/aigc_draft/generate"),
      body: built.body
    });
    const signedUrl = new URL(signedRequest.url);
    const result = await deps.requestSignedJson(auth, "/mweb/v1/aigc_draft/generate", signedRequest, { referer });
    return {
      ...result,
      request: {
        ...built.request,
        credit_consuming: true,
        algorithm_sign: !signedRequest.algorithm,
        algorithm_fallback: signedRequest.algorithm?.fallback,
        msToken_len: (signedUrl.searchParams.get("msToken") || "").length,
        a_bogus_len: (signedUrl.searchParams.get("a_bogus") || "").length
      },
      history_id: result.parsed?.aigc_data?.history_record_id
    };
  }
  if (opts["node-sign"]) {
    const signedRequest = await deps.nodeSignRequest({
      auth,
      url: makeUrl("/mweb/v1/aigc_draft/generate"),
      body: built.body
    });
    const signedUrl = new URL(signedRequest.url);
    const result = await deps.requestSignedJson(auth, "/mweb/v1/aigc_draft/generate", signedRequest, { referer });
    return {
      ...result,
      request: {
        ...built.request,
        credit_consuming: true,
        node_sign: true,
        msToken_len: (signedUrl.searchParams.get("msToken") || "").length,
        a_bogus_len: (signedUrl.searchParams.get("a_bogus") || "").length
      },
      history_id: result.parsed?.aigc_data?.history_record_id
    };
  }
  if (opts["local-sign"]) {
    const signedRequest = await deps.localSignRequest({
      auth,
      url: makeUrl("/mweb/v1/aigc_draft/generate"),
      body: built.body
    });
    const signedUrl = new URL(signedRequest.url);
    const result = await deps.requestSignedJson(auth, "/mweb/v1/aigc_draft/generate", signedRequest, { referer });
    return {
      ...result,
      request: {
        ...built.request,
        credit_consuming: true,
        node_sign: false,
        local_sign: true,
        msToken_len: (signedUrl.searchParams.get("msToken") || "").length,
        a_bogus_len: (signedUrl.searchParams.get("a_bogus") || "").length
      },
      history_id: result.parsed?.aigc_data?.history_record_id
    };
  }
  const result = await requestJson(auth, "POST", "/mweb/v1/aigc_draft/generate", {
    data: built.body,
    headers: { referer }
  });
  return {
    ...result,
    request: { ...built.request, credit_consuming: true, node_sign: false, local_sign: false },
    history_id: result.parsed?.aigc_data?.history_record_id
  };
}
