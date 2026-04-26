import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BASE_URL_CN, DEFAULT_ASSISTANT_ID_CN, DRAFT_VERSION, makeUrl, requestJson, uuid } from "./client.mjs";

const DEFAULT_MODEL = "jimeng-4.5";

function redact(value) {
  if (!value) return value;
  if (value.length <= 10) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function sha256(input, encoding) {
  return createHash("sha256").update(input, encoding).digest("hex");
}

function hmac(key, input, encoding) {
  return createHmac("sha256", key).update(input, encoding).digest();
}

export const IMAGE_MODEL_MAP = {
  "jimeng-5.0": "high_aes_general_v50",
  "jimeng-4.6": "high_aes_general_v42",
  "jimeng-4.5": "high_aes_general_v40l",
  "jimeng-4.1": "high_aes_general_v41",
  "jimeng-4.0": "high_aes_general_v40",
  "jimeng-3.1": "high_aes_general_v30l_art_fangzhou:general_v3.0_18b",
  "jimeng-3.0": "high_aes_general_v30l:general_v3.0_18b"
};

export const RESOLUTION_OPTIONS = {
  "1k": {
    "1:1": { width: 1024, height: 1024, ratio: 1 },
    "4:3": { width: 768, height: 1024, ratio: 4 },
    "3:4": { width: 1024, height: 768, ratio: 2 },
    "16:9": { width: 1024, height: 576, ratio: 3 },
    "9:16": { width: 576, height: 1024, ratio: 5 },
    "3:2": { width: 1024, height: 682, ratio: 7 },
    "2:3": { width: 682, height: 1024, ratio: 6 },
    "21:9": { width: 1195, height: 512, ratio: 8 }
  },
  "2k": {
    "1:1": { width: 2048, height: 2048, ratio: 1 },
    "4:3": { width: 2304, height: 1728, ratio: 4 },
    "3:4": { width: 1728, height: 2304, ratio: 2 },
    "16:9": { width: 2560, height: 1440, ratio: 3 },
    "9:16": { width: 1440, height: 2560, ratio: 5 },
    "3:2": { width: 2496, height: 1664, ratio: 7 },
    "2:3": { width: 1664, height: 2496, ratio: 6 },
    "21:9": { width: 3024, height: 1296, ratio: 8 }
  },
  "4k": {
    "1:1": { width: 4096, height: 4096, ratio: 101 },
    "4:3": { width: 4608, height: 3456, ratio: 104 },
    "3:4": { width: 3456, height: 4608, ratio: 102 },
    "16:9": { width: 5120, height: 2880, ratio: 103 },
    "9:16": { width: 2880, height: 5120, ratio: 105 },
    "3:2": { width: 4992, height: 3328, ratio: 107 },
    "2:3": { width: 3328, height: 4992, ratio: 106 },
    "21:9": { width: 6048, height: 2592, ratio: 108 }
  }
};

function modelKey(userModel) {
  const key = IMAGE_MODEL_MAP[userModel];
  if (!key) throw new Error(`Unsupported model "${userModel}". Supported: ${Object.keys(IMAGE_MODEL_MAP).join(", ")}`);
  return key;
}

function resolutionConfig(resolution, ratio) {
  const group = RESOLUTION_OPTIONS[resolution];
  if (!group) throw new Error(`Unsupported resolution "${resolution}". Supported: ${Object.keys(RESOLUTION_OPTIONS).join(", ")}`);
  const config = group[ratio];
  if (!config) throw new Error(`Unsupported ratio "${ratio}" for ${resolution}. Supported: ${Object.keys(group).join(", ")}`);
  return { ...config, resolution_type: resolution };
}

function buildCoreParam({ prompt, model, internalModel, ratio, resolution, negativePrompt, sampleStrength, intelligentRatio, mode = "text2img", imageCount = 0 }) {
  const res = resolutionConfig(resolution, ratio);
  const effectiveIntelligentRatio = ["jimeng-4.0", "jimeng-4.1", "jimeng-4.5", "jimeng-4.6", "jimeng-5.0"].includes(model) && (mode === "img2img" ? intelligentRatio !== false : intelligentRatio);
  const promptPrefix = mode === "img2img" ? "#".repeat(imageCount * 2) : "";
  const coreParam = {
    type: "",
    id: uuid(),
    model: internalModel,
    prompt: `${promptPrefix}${prompt}`,
    sample_strength: Number(sampleStrength),
    large_image_info: {
      type: "",
      id: uuid(),
      height: res.height,
      width: res.width,
      resolution_type: resolution
    },
    intelligent_ratio: effectiveIntelligentRatio
  };
  if (mode !== "img2img") coreParam.large_image_info.min_version = "3.0.2";
  if (negativePrompt) coreParam.negative_prompt = negativePrompt;
  if (mode === "img2img" || !effectiveIntelligentRatio) coreParam.image_ratio = res.ratio;
  if (mode === "img2img") coreParam.generate_type = 0;
  if (mode !== "img2img") coreParam.seed = Math.floor(Math.random() * 100000000) + 2500000000;
  return coreParam;
}

export function buildGenerateRequest({ prompt, model = DEFAULT_MODEL, ratio = "1:1", resolution = "2k", negativePrompt = "", sampleStrength = 0.5, intelligentRatio = false, references = [] }) {
  const internalModel = modelKey(model);
  const submitId = uuid();
  const componentId = uuid();
  const isReference = references.length > 0;
  const referenceUris = references.map((reference) => reference.uri);
  const coreParam = buildCoreParam({
    prompt,
    model,
    internalModel,
    ratio,
    resolution,
    negativePrompt,
    sampleStrength,
    intelligentRatio,
    mode: isReference ? "img2img" : "text2img",
    imageCount: referenceUris.length
  });
  const abilityList = isReference ? buildBlendAbilityList(references, Number(sampleStrength)) : [];
  const metricsAbilityList = isReference ? references.map(() => ({
    abilityName: "byte_edit",
    strength: Number(sampleStrength),
    source: { imageUrl: `blob:https://jimeng.jianying.com/${uuid()}` }
  })) : [];

  const metricsExtra = {
    promptSource: "custom",
    generateCount: 1,
    enterFrom: "click",
    ...(isReference ? { position: "page_bottom_box" } : {}),
    sceneOptions: JSON.stringify([
      {
        type: "image",
        scene: "ImageBasicGenerate",
        modelReqKey: internalModel,
        resolutionType: resolution,
        abilityList: metricsAbilityList,
        reportParams: {
          enterSource: "generate",
          vipSource: "generate",
          extraVipFunctionKey: `${internalModel}-${resolution}`,
          useVipFunctionDetailsReporterHoc: true
        },
        benefitCount: 4
      }
    ]),
    generateId: submitId,
    isRegenerate: false
  };
  if (isReference) {
    metricsExtra.isBoxSelect = false;
    metricsExtra.isCutout = false;
  }

  const draftContent = JSON.stringify({
    type: "draft",
    id: uuid(),
    min_version: "3.0.2",
    min_features: [],
    is_from_tsn: true,
    version: DRAFT_VERSION,
    main_component_id: componentId,
    component_list: [
      {
        type: "image_base_component",
        id: componentId,
        min_version: "3.0.2",
        aigc_mode: "workbench",
        metadata: {
          type: "",
          id: uuid(),
          created_platform: 3,
          created_platform_version: "",
          created_time_in_ms: Date.now().toString(),
          created_did: ""
        },
        generate_type: isReference ? "blend" : "generate",
        abilities: isReference ? {
          type: "",
          id: uuid(),
          blend: {
            type: "",
            id: uuid(),
            min_features: [],
            core_param: coreParam,
            ability_list: abilityList,
            prompt_placeholder_info_list: buildPromptPlaceholderList(referenceUris.length),
            postedit_param: { type: "", id: uuid(), generate_type: 0 }
          },
          gen_option: { type: "", id: uuid(), generate_all: false }
        } : {
          type: "",
          id: uuid(),
          generate: {
            type: "",
            id: uuid(),
            core_param: coreParam,
            gen_option: { type: "", id: uuid(), generate_all: false }
          }
        }
      }
    ]
  });

  return {
    submitId,
    body: {
      extend: { root_model: internalModel, workspace_id: 0 },
      submit_id: submitId,
      metrics_extra: JSON.stringify(metricsExtra),
      draft_content: draftContent,
      http_common_info: { aid: DEFAULT_ASSISTANT_ID_CN }
    },
    internalModel,
    mode: isReference ? "img2img" : "text2img",
    reference_count: referenceUris.length
  };
}

function buildBlendAbilityList(references, strength) {
  return references.map((reference) => ({
    type: "",
    id: uuid(),
    name: "byte_edit",
    image_uri_list: [reference.uri],
    image_list: [
      {
        type: "image",
        id: uuid(),
        source_from: "upload",
        platform_type: 1,
        name: "",
        image_uri: reference.uri,
        width: reference.width || 0,
        height: reference.height || 0,
        format: reference.format || "",
        uri: reference.uri
      }
    ],
    strength
  }));
}

function buildPromptPlaceholderList(count) {
  return Array.from({ length: count }, (_, index) => ({
    type: "",
    id: uuid(),
    ability_index: index
  }));
}

export async function generateImage(auth, opts, deps) {
  if (!opts.prompt || opts.prompt === true) throw new Error("--prompt is required");
  const referencePaths = parseList(opts["reference-image"]);
  const referenceUris = parseList(opts["reference-uri"]);
  const referenceUploads = [];
  for (const uri of referenceUris) {
    const info = await resolveImageUri(auth, uri);
    await auditReferenceUri(auth, uri);
    referenceUploads.push(info);
  }
  for (const imagePath of referencePaths) {
    referenceUploads.push(await uploadImage(auth, imagePath));
  }
  const built = buildGenerateRequest({
    prompt: opts.prompt,
    model: opts.model || DEFAULT_MODEL,
    ratio: opts.ratio || "1:1",
    resolution: opts.resolution || "2k",
    negativePrompt: opts["negative-prompt"] || "",
    sampleStrength: opts["sample-strength"] || 0.5,
    intelligentRatio: opts["intelligent-ratio"] === undefined ? undefined : (opts["intelligent-ratio"] === true || opts["intelligent-ratio"] === "true"),
    references: referenceUploads
  });
  const referer = "https://jimeng.jianying.com/ai-tool/generate?type=image";
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
        model: opts.model || DEFAULT_MODEL,
        ratio: opts.ratio || "1:1",
        resolution: opts.resolution || "2k",
        mode: built.mode,
        reference_count: built.reference_count,
        uploaded_references: referenceUploads.map((upload) => ({
          uri: redact(upload.uri),
          width: upload.width,
          height: upload.height,
          format: upload.format,
          bytes: upload.bytes
        })),
        submit_id: built.submitId,
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
        model: opts.model || DEFAULT_MODEL,
        ratio: opts.ratio || "1:1",
        resolution: opts.resolution || "2k",
        mode: built.mode,
        reference_count: built.reference_count,
        uploaded_references: referenceUploads.map((upload) => ({
          uri: redact(upload.uri),
          width: upload.width,
          height: upload.height,
          format: upload.format,
          bytes: upload.bytes
        })),
        submit_id: built.submitId,
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
        model: opts.model || DEFAULT_MODEL,
        ratio: opts.ratio || "1:1",
        resolution: opts.resolution || "2k",
        mode: built.mode,
        reference_count: built.reference_count,
        uploaded_references: referenceUploads.map((upload) => ({
          uri: redact(upload.uri),
          width: upload.width,
          height: upload.height,
          format: upload.format,
          bytes: upload.bytes
        })),
        submit_id: built.submitId,
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
    request: {
      model: opts.model || DEFAULT_MODEL,
      ratio: opts.ratio || "1:1",
      resolution: opts.resolution || "2k",
      mode: built.mode,
      reference_count: built.reference_count,
      uploaded_references: referenceUploads.map((upload) => ({
        uri: redact(upload.uri),
        width: upload.width,
        height: upload.height,
        format: upload.format,
        bytes: upload.bytes
      })),
      submit_id: built.submitId,
      credit_consuming: true,
      node_sign: false,
      local_sign: false
    },
    history_id: result.parsed?.aigc_data?.history_record_id
  };
}

function parseList(value) {
  if (!value || value === true) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

export async function uploadImage(auth, imagePath) {
  const bytes = await readFile(imagePath);
  const fileName = imagePath.split("/").pop() || `${uuid()}.png`;
  try {
    const upload = await uploadImageWithProof(auth, imagePath, fileName, bytes);
    await checkUploadedImageContent(auth, upload.uri);
    return upload;
  } catch (error) {
    const tokenUpload = await uploadImageWithToken(auth, fileName, bytes);
    await checkUploadedImageContent(auth, tokenUpload.uri);
    return { ...tokenUpload, fallback_reason: error.message };
  }
}

export async function resolveImageUri(auth, uri) {
  const result = await requestJson(auth, "POST", "/mweb/v1/get_image_by_uri", {
    data: { uris: [uri] },
    redact: false
  });
  const image = result.parsed?.uri2image?.[uri] || {};
  return {
    uri,
    width: image.width || 0,
    height: image.height || 0,
    format: image.format || "",
    bytes: 0,
    upload_method: "uri"
  };
}

async function auditReferenceUri(auth, uri) {
  await requestJson(auth, "POST", "/mweb/v1/imagex/submit_audit_job", {
    data: { uri_list: [uri] }
  });
  return await checkUploadedImageContent(auth, uri);
}

async function checkUploadedImageContent(auth, imageUri) {
  await requestJson(auth, "POST", "/mweb/v1/imagex/submit_audit_job", {
    data: { uri_list: [imageUri] }
  });
  const babiParam = JSON.stringify({
    scenario: "image_video_generation",
    feature_key: "aigc_to_image",
    feature_entrance: "to-generate",
    feature_entrance_detail: "to-generate-algo_proxy"
  });
  const result = await requestJson(auth, "POST", "/mweb/v1/algo_proxy", {
    params: { babi_param: babiParam },
    data: {
      scene: "image_face_ip",
      options: { ip_check: true },
      req_key: "benchmark_test_user_upload_image_input",
      file_list: [{ file_uri: imageUri }],
      req_params: {}
    }
  });
  if (!result.ok) {
    throw new Error(`uploaded image content check failed: ${JSON.stringify(result.parsed).slice(0, 300)}`);
  }
  return result;
}

async function uploadImageWithProof(auth, imagePath, fileName, bytes) {
  const proofResult = await requestJson(auth, "POST", "/mweb/v1/get_upload_image_proof", {
    data: {
      scene: "aigc_image",
      file_name: fileName,
      file_size: bytes.length
    },
    redact: false
  });
  if (!proofResult.ok || !proofResult.parsed?.proof_info) {
    throw new Error(`get_upload_image_proof failed: ${JSON.stringify(proofResult.parsed).slice(0, 300)}`);
  }
  const proof = proofResult.parsed.proof_info;
  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type: mimeFromPath(imagePath) }), fileName);
  const uploadUrl = new URL("https://imagex.bytedanceapi.com/");
  for (const [key, value] of Object.entries(proof.query_params || {})) {
    uploadUrl.searchParams.set(key, String(value));
  }
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: proof.headers || {},
    body: formData
  });
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`proof upload failed: ${uploadResponse.status} ${errorText.slice(0, 300)}`);
  }
  const uploadText = await uploadResponse.text();
  let uploadJson = null;
  try {
    uploadJson = uploadText ? JSON.parse(uploadText) : null;
  } catch {}
  const responseUri = uploadJson?.Result?.Uri || uploadJson?.Result?.Results?.[0]?.Uri || uploadJson?.data?.uri || uploadJson?.uri;
  return {
    uri: responseUri || proof.image_uri,
    width: 0,
    height: 0,
    format: fileName.split(".").pop() || "",
    bytes: bytes.length,
    upload_method: "proof",
    upload_response_keys: uploadJson ? Object.keys(uploadJson) : []
  };
}

function mimeFromPath(filePath) {
  const ext = filePath.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

async function uploadImageWithToken(auth, fileName, bytes) {
  const tokenResult = await requestJson(auth, "POST", "/mweb/v1/get_upload_token", {
    data: { scene: 2 },
    redact: false
  });
  if (!tokenResult.ok) throw new Error(`get_upload_token failed: ${JSON.stringify(tokenResult.parsed)}`);
  const token = tokenResult.parsed;
  const serviceId = token.service_id || "tb4s082cfz";
  const imagexUrl = "https://imagex.bytedanceapi.com";
  const awsRegion = "cn-north-1";
  const timestamp = awsTimestamp();
  const randomStr = Math.random().toString(36).slice(2, 12);
  const applyUrl = `${imagexUrl}/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${encodeURIComponent(serviceId)}&FileSize=${bytes.length}&s=${randomStr}`;
  const applyHeadersToSign = {
    "x-amz-date": timestamp,
    "x-amz-security-token": token.session_token
  };
  const applyAuthorization = createAwsSignature("GET", applyUrl, applyHeadersToSign, token.access_key_id, token.secret_access_key, token.session_token, "", awsRegion);
  const applyResponse = await fetch(applyUrl, {
    headers: {
      accept: "*/*",
      origin: BASE_URL_CN,
      referer: `${BASE_URL_CN}/ai-tool/generate`,
      authorization: applyAuthorization,
      "x-amz-date": timestamp,
      "x-amz-security-token": token.session_token
    }
  });
  const applyJson = await applyResponse.json();
  if (!applyResponse.ok || applyJson.ResponseMetadata?.Error) {
    throw new Error(`ApplyImageUpload failed: ${applyResponse.status} ${JSON.stringify(applyJson.ResponseMetadata?.Error || applyJson).slice(0, 300)}`);
  }
  const uploadAddress = applyJson.Result?.UploadAddress;
  const storeInfo = uploadAddress?.StoreInfos?.[0];
  const uploadHost = uploadAddress?.UploadHosts?.[0];
  if (!storeInfo || !uploadHost) throw new Error(`ApplyImageUpload missing upload address`);
  const uploadUrl = `https://${uploadHost}/upload/v1/${storeInfo.StoreUri}`;
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      accept: "*/*",
      authorization: storeInfo.Auth,
      "content-crc32": String(crc32(bytes)),
      "content-disposition": `attachment; filename="${fileName}"`,
      "content-type": "application/octet-stream",
      origin: BASE_URL_CN,
      referer: `${BASE_URL_CN}/ai-tool/generate`
    },
    body: bytes
  });
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Image upload failed: ${uploadResponse.status} ${errorText.slice(0, 300)}`);
  }
  const commitPayload = JSON.stringify({ SessionKey: uploadAddress.SessionKey });
  const commitTimestamp = awsTimestamp();
  const commitUrl = `${imagexUrl}/?Action=CommitImageUpload&Version=2018-08-01&ServiceId=${encodeURIComponent(serviceId)}`;
  const commitHeadersToSign = {
    "x-amz-date": commitTimestamp,
    "x-amz-security-token": token.session_token,
    "x-amz-content-sha256": sha256(commitPayload, "utf8")
  };
  const commitAuthorization = createAwsSignature("POST", commitUrl, commitHeadersToSign, token.access_key_id, token.secret_access_key, token.session_token, commitPayload, awsRegion);
  const commitResponse = await fetch(commitUrl, {
    method: "POST",
    headers: {
      accept: "*/*",
      authorization: commitAuthorization,
      "content-type": "application/json",
      origin: BASE_URL_CN,
      referer: `${BASE_URL_CN}/ai-tool/generate`,
      "x-amz-date": commitTimestamp,
      "x-amz-security-token": token.session_token,
      "x-amz-content-sha256": sha256(commitPayload, "utf8")
    },
    body: commitPayload
  });
  const commitJson = await commitResponse.json();
  if (!commitResponse.ok || commitJson.ResponseMetadata?.Error) {
    throw new Error(`CommitImageUpload failed: ${commitResponse.status} ${JSON.stringify(commitJson.ResponseMetadata?.Error || commitJson).slice(0, 300)}`);
  }
  const uploadResult = commitJson.Result?.Results?.[0];
  if (!uploadResult?.Uri || ![2000, 2001].includes(uploadResult.UriStatus)) {
    throw new Error(`Unexpected upload commit result: ${JSON.stringify({
      result_keys: Object.keys(commitJson.Result || {}),
      first_result: uploadResult ? {
        uri: redact(uploadResult.Uri || ""),
        uri_status: uploadResult.UriStatus,
        uri_status_code: uploadResult.UriStatusCode,
        keys: Object.keys(uploadResult)
      } : null,
      plugin: commitJson.Result?.PluginResult?.[0] ? Object.keys(commitJson.Result.PluginResult[0]) : null
    })}`);
  }
  const plugin = commitJson.Result?.PluginResult?.[0] || {};
  return {
    uri: plugin.ImageUri || uploadResult.Uri,
    width: plugin.ImageWidth || 0,
    height: plugin.ImageHeight || 0,
    format: plugin.ImageFormat || fileName.split(".").pop() || "",
    bytes: bytes.length,
    upload_method: "token"
  };
}

function awsTimestamp() {
  return new Date().toISOString().replace(/[:-]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function createAwsSignature(method, url, headers, accessKeyId, secretAccessKey, sessionToken, payload = "", region = "cn-north-1", service = "imagex") {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname || "/";
  const search = urlObj.search;
  const queryParams = [];
  const searchParams = new URLSearchParams(search);
  searchParams.forEach((value, key) => {
    queryParams.push([key, value]);
  });
  queryParams.sort(([a], [b]) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  const canonicalQueryString = queryParams.map(([key, value]) => `${key}=${value}`).join("&");
  const headersToSign = { "x-amz-date": headers["x-amz-date"] };
  if (sessionToken) headersToSign["x-amz-security-token"] = sessionToken;
  let payloadHash = sha256("");
  if (method.toUpperCase() === "POST" && payload) {
    payloadHash = sha256(payload, "utf8");
    headersToSign["x-amz-content-sha256"] = payloadHash;
  }
  const signedHeaders = Object.keys(headersToSign).map((key) => key.toLowerCase()).sort().join(";");
  const canonicalHeaders = Object.keys(headersToSign)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((key) => `${key.toLowerCase()}:${String(headersToSign[key]).trim()}\n`)
    .join("");
  const canonicalRequest = [
    method.toUpperCase(),
    pathname,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const timestamp = headersToSign["x-amz-date"];
  const date = timestamp.slice(0, 8);
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    credentialScope,
    sha256(canonicalRequest, "utf8")
  ].join("\n");
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();
