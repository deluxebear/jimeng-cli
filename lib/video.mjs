import { randomUUID } from "node:crypto";

export const VIDEO_MODEL_MAP = {
  "seedance-2.0-fast": {
    req_key: "dreamina_seedance_40",
    name: "Seedance 2.0 Fast",
    benefit_type: "dreamina_seedance_20_fast",
    resolution: "720p"
  },
  "seedance-2.0-vip": {
    req_key: "dreamina_seedance_40_pro_vision",
    name: "Seedance 2.0 VIP",
    benefit_type: "seedance_20_pro_720p_output",
    resolution: "720p"
  }
};

function uuid() {
  return randomUUID();
}

export function buildVideoRequest({
  prompt,
  model = "seedance-2.0-fast",
  ratio = "16:9",
  duration = 5,
  draftVersion,
  assistantId
}) {
  if (!prompt || prompt === true) throw new Error("--prompt is required");
  const config = VIDEO_MODEL_MAP[model];
  if (!config) throw new Error(`Unsupported video model "${model}". Supported: ${Object.keys(VIDEO_MODEL_MAP).join(", ")}`);
  if (ratio !== "16:9") throw new Error('Only --ratio 16:9 is verified for video generation right now');
  const seconds = Number(duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("--duration must be a positive number of seconds");
  const submitId = uuid();
  const componentId = uuid();
  const sceneOption = {
    type: "video",
    scene: "BasicVideoGenerateButton",
    resolution: config.resolution,
    modelReqKey: config.req_key,
    videoDuration: seconds,
    reportParams: {
      enterSource: "generate",
      vipSource: "generate",
      extraVipFunctionKey: `${config.req_key}-${config.resolution}`,
      useVipFunctionDetailsReporterHoc: true
    },
    materialTypes: []
  };
  const metricsExtra = {
    isDefaultSeed: 1,
    originSubmitId: submitId,
    isRegenerate: false,
    enterFrom: "click",
    position: "page_bottom_box",
    functionMode: "omni_reference",
    sceneOptions: JSON.stringify([sceneOption])
  };
  const draftContent = JSON.stringify({
    type: "draft",
    id: uuid(),
    min_version: "3.0.5",
    min_features: [],
    is_from_tsn: true,
    version: draftVersion,
    main_component_id: componentId,
    component_list: [
      {
        type: "video_base_component",
        id: componentId,
        min_version: "1.0.0",
        aigc_mode: "workbench",
        gen_type: 10,
        metadata: {
          type: "",
          id: uuid(),
          created_platform: 3,
          created_platform_version: "",
          created_time_in_ms: Date.now().toString(),
          created_did: ""
        },
        generate_type: "gen_video",
        abilities: {
          type: "",
          id: uuid(),
          gen_video: {
            type: "",
            id: uuid(),
            text_to_video_params: {
              type: "",
              id: uuid(),
              video_gen_inputs: [
                {
                  type: "",
                  id: uuid(),
                  min_version: "3.0.5",
                  prompt,
                  video_mode: 2,
                  fps: 24,
                  duration_ms: Math.round(seconds * 1000),
                  idip_meta_list: []
                }
              ],
              video_aspect_ratio: ratio,
              seed: Math.floor(Math.random() * 1000000000) + 3000000000,
              model_req_key: config.req_key,
              priority: 0
            },
            video_task_extra: JSON.stringify(metricsExtra)
          }
        },
        process_type: 1
      }
    ]
  });
  const commerce = {
    benefit_type: config.benefit_type,
    resource_id: "generate_video",
    resource_id_type: "str",
    resource_sub_type: "aigc"
  };
  return {
    submitId,
    body: {
      extend: {
        root_model: config.req_key,
        m_video_commerce_info: commerce,
        workspace_id: 0,
        m_video_commerce_info_list: [commerce]
      },
      submit_id: submitId,
      metrics_extra: JSON.stringify(metricsExtra),
      draft_content: draftContent,
      http_common_info: { aid: assistantId }
    },
    request: { mode: "text2video", model, req_key: config.req_key, ratio, duration: seconds, submit_id: submitId }
  };
}

export async function generateVideo(auth, opts, deps) {
  const built = buildVideoRequest({
    prompt: opts.prompt,
    model: opts.model || "seedance-2.0-fast",
    ratio: opts.ratio || "16:9",
    duration: opts.duration || 5,
    draftVersion: deps.draftVersion,
    assistantId: deps.assistantId
  });
  const params = { commerce_with_input_video: 1, da_version: deps.draftVersion, os: "mac" };
  const referer = "https://jimeng.jianying.com/ai-tool/generate?type=video&workspace=0";
  if (opts["node-sign"]) {
    const signedRequest = await deps.nodeSignRequest({
      auth,
      url: deps.makeUrl("/mweb/v1/aigc_draft/generate", params),
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
      url: deps.makeUrl("/mweb/v1/aigc_draft/generate", params),
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
  if (opts["browser-sign"]) {
    const signedRequest = await deps.browserSignRequest({
      port: opts.port || 9222,
      url: deps.makeUrl("/mweb/v1/aigc_draft/generate", params),
      body: built.body,
      referer
    });
    const signedUrl = new URL(signedRequest.url);
    const result = await deps.requestSignedJson(auth, "/mweb/v1/aigc_draft/generate", signedRequest, { referer });
    return {
      ...result,
      request: {
        ...built.request,
        credit_consuming: true,
        node_sign: false,
        local_sign: false,
        browser_sign: true,
        msToken_len: (signedUrl.searchParams.get("msToken") || "").length,
        a_bogus_len: (signedUrl.searchParams.get("a_bogus") || "").length
      },
      history_id: result.parsed?.aigc_data?.history_record_id
    };
  }
  const result = await deps.requestJson(auth, "POST", "/mweb/v1/aigc_draft/generate", {
    data: built.body,
    params,
    headers: { referer }
  });
  return {
    ...result,
    request: { ...built.request, credit_consuming: true, node_sign: false, local_sign: false, browser_sign: false },
    history_id: result.parsed?.aigc_data?.history_record_id
  };
}
