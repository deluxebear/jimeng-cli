#!/usr/bin/env node
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

const VERSION_CODE = "8.4.0";
const PLATFORM_CODE = "7";
const WEB_VERSION = "7.5.0";
const DA_VERSION = "3.3.9";
const DRAFT_VERSION = "3.3.14";
const BASE_URL_CN = "https://jimeng.jianying.com";
const DEFAULT_ASSISTANT_ID_CN = 513695;
const DEFAULT_MODEL = "jimeng-4.5";

const IMAGE_MODEL_MAP = {
  "jimeng-5.0": "high_aes_general_v50",
  "jimeng-4.6": "high_aes_general_v42",
  "jimeng-4.5": "high_aes_general_v40l",
  "jimeng-4.1": "high_aes_general_v41",
  "jimeng-4.0": "high_aes_general_v40",
  "jimeng-3.1": "high_aes_general_v30l_art_fangzhou:general_v3.0_18b",
  "jimeng-3.0": "high_aes_general_v30l:general_v3.0_18b"
};

const RESOLUTION_OPTIONS = {
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

const IMAGE_INFO = {
  width: 2048,
  height: 2048,
  format: "webp",
  image_scene_list: [
    { scene: "smart_crop", width: 360, height: 360, uniq_key: "smart_crop-w:360-h:360", format: "webp" },
    { scene: "smart_crop", width: 480, height: 480, uniq_key: "smart_crop-w:480-h:480", format: "webp" },
    { scene: "smart_crop", width: 720, height: 720, uniq_key: "smart_crop-w:720-h:720", format: "webp" },
    { scene: "smart_crop", width: 720, height: 480, uniq_key: "smart_crop-w:720-h:480", format: "webp" },
    { scene: "normal", width: 2400, height: 2400, uniq_key: "2400", format: "webp" },
    { scene: "normal", width: 1080, height: 1080, uniq_key: "1080", format: "webp" },
    { scene: "normal", width: 720, height: 720, uniq_key: "720", format: "webp" },
    { scene: "normal", width: 480, height: 480, uniq_key: "480", format: "webp" },
    { scene: "normal", width: 360, height: 360, uniq_key: "360", format: "webp" }
  ]
};

function usage() {
  return `jimeng CLI

Usage:
  node bin/jimeng.mjs login --profile default [--port 9222]
  node bin/jimeng.mjs capture-auth --profile default [--port 9222]
  node bin/jimeng.mjs auth save --profile default --sessionid <sessionid>
  node bin/jimeng.mjs params
  node bin/jimeng.mjs session --profile default
  node bin/jimeng.mjs credits --profile default
  node bin/jimeng.mjs generate-image --profile default --prompt <text> [--model jimeng-4.5] [--ratio 1:1] [--resolution 2k] [--reference-image <path>] [--reference-uri <tos-uri>]
  node bin/jimeng.mjs upload-image --profile default --image <path>
  node bin/jimeng.mjs check-image --profile default --history-id <id>
  node bin/jimeng.mjs wait-image --profile default --history-id <id> [--interval-ms 10000] [--timeout-ms 1800000]
  node bin/jimeng.mjs download-image --profile default --history-id <id> --index 0 --output <path>
  node bin/jimeng.mjs download --url <url> --output <path>

Notes:
  generate-image may consume Jimeng credits.
  Auth is stored under ~/.jimeng-cli/profiles/<profile>/auth.json.
  login opens an external Chrome profile under ~/.jimeng-cli/browser-profiles/<profile>.
`;
}

function parseArgs(argv) {
  const [command, subcommand, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      opts._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i += 1;
    }
  }
  return { command, subcommand, opts };
}

function listParams() {
  return {
    ok: true,
    models: Object.entries(IMAGE_MODEL_MAP).map(([alias, req_key]) => ({ alias, req_key })),
    resolutions: Object.fromEntries(Object.entries(RESOLUTION_OPTIONS).map(([resolution, ratios]) => [
      resolution,
      Object.fromEntries(Object.entries(ratios).map(([ratio, config]) => [
        ratio,
        { width: config.width, height: config.height, image_ratio: config.ratio }
      ]))
    ])),
    flags: {
      model: Object.keys(IMAGE_MODEL_MAP),
      ratio: Object.keys(RESOLUTION_OPTIONS["2k"]),
      resolution: Object.keys(RESOLUTION_OPTIONS),
      sample_strength: "number, default 0.5",
      negative_prompt: "string",
      intelligent_ratio: "boolean, supported by jimeng-4.0/4.1/4.5/4.6/5.0",
      reference_image: "comma-separated local image paths; switches request to img2img/blend mode",
      reference_uri: "comma-separated Jimeng/ImageX tos URIs captured from the browser; preferred when reusing existing web assets"
    }
  };
}

function authPath(profile = "default") {
  return join(homedir(), ".jimeng-cli", "profiles", profile, "auth.json");
}

function browserProfilePath(profile = "default") {
  return join(homedir(), ".jimeng-cli", "browser-profiles", profile);
}

async function login(profile, port = 9222) {
  const userDataDir = browserProfilePath(profile);
  await mkdir(userDataDir, { recursive: true, mode: 0o700 });
  const chromeApp = "/Applications/Google Chrome.app";
  const args = [
    "-na",
    chromeApp,
    "--args",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0"
  ];
  const child = spawn("open", args, { detached: true, stdio: "ignore" });
  child.unref();
  return {
    ok: true,
    profile,
    port: Number(port),
    browser_profile: userDataDir,
    message: "Chrome launched. Log in there, then run capture-auth."
  };
}

async function saveAuth(profile, sessionid) {
  if (!sessionid || sessionid === true) throw new Error("--sessionid is required");
  const file = authPath(profile);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify({ sessionid }, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, profile, path: file, auth: { sessionid: redact(sessionid) } };
}

async function loadAuth(profile) {
  const file = authPath(profile);
  const auth = JSON.parse(await readFile(file, "utf8"));
  if (!auth.sessionid) throw new Error(`Missing sessionid in ${file}`);
  return auth;
}

async function captureAuth(profile, port = 9222) {
  const cookies = await readCdpCookies(Number(port));
  const session = cookies.find((cookie) =>
    cookie.name === "sessionid" &&
    (cookie.domain || "").includes("jianying.com")
  ) || cookies.find((cookie) => cookie.name === "sessionid");
  if (!session?.value) {
    return {
      ok: false,
      port: Number(port),
      error: "No Jimeng sessionid cookie found. Make sure external Chrome is logged in on jimeng.jianying.com.",
      cookie_names: [...new Set(cookies.map((cookie) => cookie.name))].slice(0, 30)
    };
  }
  return await saveAuth(profile, session.value);
}

async function readCdpCookies(port) {
  const listResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!listResponse.ok) throw new Error(`CDP list failed: ${listResponse.status}`);
  const pages = await listResponse.json();
  let page = pages.find((entry) => entry.url?.includes("jimeng.jianying.com"));
  if (!page) {
    const newResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0")}`, {
      method: "PUT"
    });
    if (!newResponse.ok) throw new Error(`CDP open page failed: ${newResponse.status}`);
    page = await newResponse.json();
  }
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.open();
  try {
    try {
      const result = await cdp.send("Network.getAllCookies");
      return result.cookies || [];
    } catch {
      const result = await cdp.send("Storage.getCookies", { browserContextId: undefined });
      return result.cookies || [];
    }
  } finally {
    cdp.close();
  }
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      this.ws.send(payload);
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function redact(value) {
  if (!value) return value;
  if (value.length <= 10) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function uuid(noDash = false) {
  const id = randomUUID();
  return noDash ? id.replaceAll("-", "") : id;
}

function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function md5(input) {
  return createHash("md5").update(input).digest("hex");
}

function sha256(input, encoding) {
  return createHash("sha256").update(input, encoding).digest("hex");
}

function hmac(key, input, encoding) {
  return createHmac("sha256", key).update(input, encoding).digest();
}

function generateCookie(sessionid) {
  const webId = Math.random() * 999999999999999999 + 7000000000000000000;
  const userId = uuid(true);
  return [
    `_tea_web_id=${webId}`,
    "is_staff_user=false",
    `sid_guard=${sessionid}%7C${unixTimestamp()}%7C5184000%7CMon%2C+03-Feb-2025+08%3A17%3A09+GMT`,
    `uid_tt=${userId}`,
    `uid_tt_ss=${userId}`,
    `sid_tt=${sessionid}`,
    `sessionid=${sessionid}`,
    `sessionid_ss=${sessionid}`
  ].join("; ");
}

function makeUrl(uri, params = {}, noDefaultParams = false) {
  const url = new URL(uri, BASE_URL_CN);
  const merged = noDefaultParams
    ? params
    : {
        aid: DEFAULT_ASSISTANT_ID_CN,
        device_platform: "web",
        region: "cn",
        webId: Math.random() * 999999999999999999 + 7000000000000000000,
        da_version: DA_VERSION,
        os: "windows",
        web_component_open_flag: 1,
        web_version: WEB_VERSION,
        aigc_features: "app_lip_sync",
        ...params
      };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

async function requestJson(auth, method, uri, { data = {}, params = {}, headers = {}, noDefaultParams = false, redact = true } = {}) {
  const deviceTime = unixTimestamp();
  const sign = md5(`9e2c|${uri.slice(-7)}|${PLATFORM_CODE}|${VERSION_CODE}|${deviceTime}||11ac`);
  const url = makeUrl(uri, params, noDefaultParams);
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "zh-CN,zh;q=0.9",
      "content-type": "application/json",
      appvr: VERSION_CODE,
      pf: PLATFORM_CODE,
      origin: BASE_URL_CN,
      referer: BASE_URL_CN,
      "app-sdk-version": "48.0.0",
      appid: String(DEFAULT_ASSISTANT_ID_CN),
      cookie: generateCookie(auth.sessionid),
      "device-time": String(deviceTime),
      lan: "zh-Hans",
      loc: "cn",
      sign,
      "sign-ver": "1",
      tdid: "",
      ...headers
    },
    body: method.toUpperCase() === "GET" ? undefined : JSON.stringify(data)
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, endpoint: uri, parsed: redact ? redactObject(parsed) : parsed };
  }
  if (parsed && typeof parsed === "object" && "ret" in parsed && parsed.ret !== "0") {
    return { ok: false, status: response.status, endpoint: uri, parsed: redact ? redactObject(parsed) : parsed };
  }
  const body = parsed.data ?? parsed;
  return { ok: true, status: response.status, endpoint: uri, parsed: redact ? redactObject(body) : body };
}

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

function buildGenerateRequest({ prompt, model = DEFAULT_MODEL, ratio = "1:1", resolution = "2k", negativePrompt = "", sampleStrength = 0.5, intelligentRatio = false, references = [] }) {
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

async function generateImage(auth, opts) {
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
  const result = await requestJson(auth, "POST", "/mweb/v1/aigc_draft/generate", {
    data: built.body,
    headers: { referer: "https://jimeng.jianying.com/ai-tool/generate?type=image" }
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
      credit_consuming: true
    },
    history_id: result.parsed?.aigc_data?.history_record_id
  };
}

function parseList(value) {
  if (!value || value === true) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

async function uploadImage(auth, imagePath) {
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

async function resolveImageUri(auth, uri) {
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

async function checkImage(auth, historyId) {
  if (!historyId || historyId === true) throw new Error("--history-id is required");
  const result = await requestJson(auth, "POST", "/mweb/v1/get_history_by_ids", {
    data: { history_ids: [historyId], image_info: IMAGE_INFO },
    redact: false
  });
  const record = result.parsed?.[historyId];
  const imageUrls = record ? extractImageUrls(record.item_list || []) : [];
  return {
    ok: result.ok,
    status: result.status,
    endpoint: result.endpoint,
    history_id: historyId,
    parsed: summarizeHistoryRecord(record),
    image_url_count: imageUrls.length,
    image_urls_sample: imageUrls.slice(0, 4).map(redactUrl)
  };
}

async function downloadImage(auth, opts) {
  const historyId = opts["history-id"];
  if (!historyId || historyId === true) throw new Error("--history-id is required");
  const index = Number(opts.index || 0);
  if (!Number.isInteger(index) || index < 0) throw new Error("--index must be a non-negative integer");
  const output = opts.output;
  if (!output || output === true) throw new Error("--output is required");

  const result = await requestJson(auth, "POST", "/mweb/v1/get_history_by_ids", {
    data: { history_ids: [historyId], image_info: IMAGE_INFO },
    redact: false
  });
  const record = result.parsed?.[historyId];
  const images = primaryImages(record);
  const image = images[index];
  if (!image) throw new Error(`No image at index ${index}; available count: ${images.length}`);

  const response = await fetch(image.url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes, { flag: "wx" });
  return {
    ok: true,
    history_id: historyId,
    index,
    output,
    bytes: bytes.length,
    image: {
      item_id: image.item_id,
      width: image.width,
      height: image.height,
      format: image.format,
      declared_size: image.size
    }
  };
}

function primaryImages(record) {
  if (!record?.item_list) return [];
  const images = [];
  for (const item of record.item_list) {
    const large = item.image?.large_images?.[0];
    if (!large?.image_url) continue;
    images.push({
      item_id: item.common_attr?.id,
      url: large.image_url,
      width: large.width,
      height: large.height,
      format: large.format,
      size: large.size
    });
  }
  return images;
}

function summarizeHistoryRecord(record) {
  if (!record) return null;
  return {
    status: record.status,
    fail_code: record.fail_code,
    fail_msg: record.fail_msg,
    model: record.model_info?.model_name,
    total_image_count: record.total_image_count,
    finished_image_count: record.finished_image_count,
    created_time: record.created_time,
    finish_time: record.finish_time || record.task?.finish_time,
    forecast_generate_cost: record.forecast_generate_cost,
    item_count: Array.isArray(record.item_list) ? record.item_list.length : 0,
    items: (record.item_list || []).map((item) => ({
      id: item.common_attr?.id,
      status: item.common_attr?.status,
      review_status: item.common_attr?.review_info?.review_status,
      width: item.image?.large_images?.[0]?.width,
      height: item.image?.large_images?.[0]?.height,
      format: item.image?.large_images?.[0]?.format,
      size: item.image?.large_images?.[0]?.size
    }))
  };
}

function extractImageUrls(items) {
  const urls = [];
  const visit = (value) => {
    if (!value) return;
    if (typeof value === "string" && /^https?:\/\//.test(value) && /\.(webp|png|jpe?g)(\?|$)/i.test(value)) {
      urls.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "object") {
      for (const nested of Object.values(value)) visit(nested);
    }
  };
  visit(items);
  return [...new Set(urls)];
}

async function waitImage(auth, opts) {
  const historyId = opts["history-id"];
  const intervalMs = Number(opts["interval-ms"] || 10000);
  const timeoutMs = Number(opts["timeout-ms"] || 1800000);
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() <= deadline) {
    latest = await checkImage(auth, historyId);
    if (latest.image_urls?.length > 0) return latest;
    const record = latest.parsed?.[historyId];
    if (latest.parsed?.status === 30 || latest.parsed?.fail_code) return latest;
    if (latest.parsed?.status === 50) return latest;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ok: false, status: "timeout", endpoint: "/mweb/v1/get_history_by_ids", history_id: historyId, latest };
}

async function download(url, output) {
  if (!url || url === true) throw new Error("--url is required");
  if (!output || output === true) throw new Error("--output is required");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes, { flag: "wx" });
  return { ok: true, output, bytes: bytes.length };
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/cookie|token|session|authorization|sid|signed|base64|b64|mobile|phone|email|uid|user_id|open_id|sec_user|avatar|img_url|image_url|url|uri/i.test(key)) {
      out[key] = typeof nested === "string" ? redact(nested) : "[redacted]";
    } else {
      out[key] = redactObject(nested);
    }
  }
  return out;
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.slice(0, 48)}...[redacted]`;
  } catch {
    return redact(value);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return;
  }
  const { command, subcommand, opts } = parseArgs(argv);
  const profile = opts.profile || "default";

  let result;
  if (command === "login") {
    result = await login(profile, opts.port || 9222);
  } else if (command === "capture-auth") {
    result = await captureAuth(profile, opts.port || 9222);
  } else if (command === "params") {
    result = listParams();
  } else if (command === "auth" && subcommand === "save") {
    result = await saveAuth(profile, opts.sessionid);
  } else if (command === "session") {
    const auth = await loadAuth(profile);
    result = await requestJson(auth, "POST", "/passport/account/info/v2", {
      params: { account_sdk_source: "web" }
    });
  } else if (command === "credits") {
    const auth = await loadAuth(profile);
    result = await requestJson(auth, "POST", "/commerce/v1/benefits/user_credit", {
      data: {},
      headers: { referer: "https://jimeng.jianying.com/ai-tool/image/generate" },
      noDefaultParams: true
    });
  } else if (command === "generate-image") {
    const auth = await loadAuth(profile);
    result = await generateImage(auth, opts);
  } else if (command === "upload-image") {
    const auth = await loadAuth(profile);
    if (!opts.image || opts.image === true) throw new Error("--image is required");
    const upload = await uploadImage(auth, opts.image);
    result = {
      ok: true,
      image: {
        uri: redact(upload.uri),
        width: upload.width,
        height: upload.height,
        format: upload.format,
        bytes: upload.bytes
      }
    };
  } else if (command === "check-image") {
    const auth = await loadAuth(profile);
    result = await checkImage(auth, opts["history-id"]);
  } else if (command === "wait-image") {
    const auth = await loadAuth(profile);
    result = await waitImage(auth, opts);
  } else if (command === "download-image") {
    const auth = await loadAuth(profile);
    result = await downloadImage(auth, opts);
  } else if (command === "download") {
    result = await download(opts.url, opts.output);
  } else {
    throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
