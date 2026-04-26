#!/usr/bin/env node
import { createHash, createHmac } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { BASE_URL_CN, DEFAULT_ASSISTANT_ID_CN, DRAFT_VERSION, makeUrl, requestJson, uuid } from "../lib/client.mjs";
import { browserSignRequest, localSignRequest, nodeSignRequest, requestSignedJson } from "../lib/signer.mjs";
import { VIDEO_MODEL_MAP, generateVideo as generateVideoRequest } from "../lib/video.mjs";

const DEFAULT_MODEL = "jimeng-4.5";

const VOICE_MAP = {
  "zhishuang-nvda": {
    id: "7597003459665072686",
    name: "直爽女大",
    item_platform: 1,
    sample_rate: 24000
  }
};

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
  jimeng auth login [--profile default] [--port 9222]
  jimeng auth capture [--profile default] [--port 9222]
  jimeng auth status [--profile default]

  jimeng video create --prompt <text> [--model seedance-2.0-vip] [--ratio 16:9] [--duration 5]
  jimeng video status --history-id <id>
  jimeng video queue --history-id <id>
  jimeng video wait --history-id <id> [--interval-ms 30000] [--timeout-ms 86400000]
  jimeng video download --history-id <id> --index 0 --output <path>
  jimeng video run --prompt <text> --output <path> [--model seedance-2.0-vip]

  jimeng image create --prompt <text> [--model jimeng-4.5] [--ratio 1:1] [--resolution 2k] [--reference-image <path>] [--reference-uri <tos-uri>]
  jimeng image status --history-id <id>
  jimeng image queue --history-id <id>
  jimeng image wait --history-id <id>
  jimeng image download --history-id <id> --index 0 --output <path>

  jimeng audio create --text <text> [--voice zhishuang-nvda]
  jimeng audio status --history-id <id>
  jimeng audio queue --history-id <id>
  jimeng audio wait --history-id <id>
  jimeng audio download --history-id <id> --index 0 --output <path>

  jimeng models list
  jimeng history list [--limit 20] [--offset <next_offset>] [--type image|video|audio]
  jimeng jobs list
  jimeng jobs sync [--limit 20] [--pages 1] [--type image|video|audio]
  jimeng jobs add --history-id <id> --type video|image|audio
  jimeng jobs status [--limit 20]

Compatibility commands:
  node bin/jimeng.mjs login --profile default [--port 9222]
  node bin/jimeng.mjs capture-auth --profile default [--port 9222]
  node bin/jimeng.mjs auth save --profile default --sessionid <sessionid>
  node bin/jimeng.mjs params
  node bin/jimeng.mjs session --profile default
  node bin/jimeng.mjs credits --profile default
  node bin/jimeng.mjs agent-chat --profile default --prompt <text>
  node bin/jimeng.mjs generate-image --profile default --prompt <text> [--model jimeng-4.5] [--ratio 1:1] [--resolution 2k] [--reference-image <path>] [--reference-uri <tos-uri>] [--node-sign | --local-sign]
  node bin/jimeng.mjs generate-video --profile default --prompt <text> [--model seedance-2.0-fast] [--ratio 16:9] [--duration 5] [--node-sign | --local-sign | --browser-sign --port 9222]
  node bin/jimeng.mjs generate-audio --profile default --text <text> [--voice zhishuang-nvda] [--node-sign | --local-sign]
  node bin/jimeng.mjs upload-image --profile default --image <path>
  node bin/jimeng.mjs check-image --profile default --history-id <id>
  node bin/jimeng.mjs wait-image --profile default --history-id <id> [--interval-ms 10000] [--timeout-ms 1800000]
  node bin/jimeng.mjs download-image --profile default --history-id <id> --index 0 --output <path>
  node bin/jimeng.mjs check-media --profile default --history-id <id>
  node bin/jimeng.mjs queue-media --profile default --history-id <id>
  node bin/jimeng.mjs wait-media --profile default --history-id <id> [--interval-ms 10000] [--timeout-ms 1800000]
  node bin/jimeng.mjs download-media --profile default --history-id <id> --index 0 --output <path>
  node bin/jimeng.mjs download --url <url> --output <path>

Notes:
  generate-image may consume Jimeng credits.
  New create/run commands use --node-sign by default.
  --node-sign runs the official bdms VM in a pure Node vm browser shim to create msToken/a_bogus.
  --local-sign uses the official bdms script in a headless local Chromium page to create current msToken/a_bogus query params.
  generate-video --browser-sign uses the logged-in Chrome page as a fallback signer.
  Auth is stored under ~/.jimeng-cli/profiles/<profile>/auth.json.
  login opens an external Chrome profile under ~/.jimeng-cli/browser-profiles/<profile>.
`;
}

function parseArgs(argv) {
  const [command, maybeSubcommand, ...tail] = argv;
  const hasSubcommand = Boolean(maybeSubcommand && !maybeSubcommand.startsWith("--"));
  const subcommand = hasSubcommand ? maybeSubcommand : undefined;
  const rest = hasSubcommand ? tail : argv.slice(1);
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
    image_models: Object.entries(IMAGE_MODEL_MAP).map(([alias, req_key]) => ({ alias, req_key })),
    video_models: Object.entries(VIDEO_MODEL_MAP).map(([alias, config]) => ({ alias, ...config })),
    voices: Object.entries(VOICE_MAP).map(([alias, voice]) => ({ alias, id: voice.id, name: voice.name, sample_rate: voice.sample_rate })),
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
      reference_uri: "comma-separated Jimeng/ImageX tos URIs captured from the browser; preferred when reusing existing web assets",
      video_model: Object.keys(VIDEO_MODEL_MAP),
      video_ratio: ["16:9"],
      video_duration: "seconds, default 5",
      voice: Object.keys(VOICE_MAP)
    }
  };
}

function authPath(profile = "default") {
  return join(homedir(), ".jimeng-cli", "profiles", profile, "auth.json");
}

function browserProfilePath(profile = "default") {
  return join(homedir(), ".jimeng-cli", "browser-profiles", profile);
}

function jobsPath() {
  return join(homedir(), ".jimeng-cli", "jobs.jsonl");
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

async function saveCapturedAuth(profile, auth) {
  if (!auth.sessionid) throw new Error("Missing sessionid");
  const file = authPath(profile);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  return {
    ok: true,
    profile,
    path: file,
    auth: {
      sessionid: redact(auth.sessionid),
      xmst_len: auth.xmst?.length || 0,
      web_runtime_security_uid: auth.web_runtime_security_uid ? redact(auth.web_runtime_security_uid) : undefined,
      msuuid: auth.msuuid ? redact(auth.msuuid) : undefined
    }
  };
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
  const browserState = await readBrowserSecurityStorage(Number(port)).catch(() => ({}));
  return await saveCapturedAuth(profile, {
    sessionid: session.value,
    ...browserState,
    captured_at: new Date().toISOString()
  });
}

async function readBrowserSecurityStorage(port) {
  const { chromium } = requirePlaywright();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const context = browser.contexts()[0];
    const page = context?.pages().find((candidate) => candidate.url().includes("jimeng.jianying.com")) || context?.pages()[0];
    if (!page) return {};
    return await page.evaluate(() => ({
      xmst: localStorage.getItem("xmst") || undefined,
      web_runtime_security_uid: localStorage.getItem("web_runtime_security_uid") || undefined,
      msuuid: localStorage.getItem("__msuuid__") || undefined
    }));
  } finally {
    await browser.close().catch(() => {});
  }
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

function sha256(input, encoding) {
  return createHash("sha256").update(input, encoding).digest("hex");
}

function hmac(key, input, encoding) {
  return createHmac("sha256", key).update(input, encoding).digest();
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
  const referer = "https://jimeng.jianying.com/ai-tool/generate?type=image";
  if (opts["node-sign"]) {
    const signedRequest = await nodeSignRequest({
      auth,
      url: makeUrl("/mweb/v1/aigc_draft/generate"),
      body: built.body
    });
    const signedUrl = new URL(signedRequest.url);
    const result = await requestSignedJson(auth, "/mweb/v1/aigc_draft/generate", signedRequest, { referer });
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
    const signedRequest = await localSignRequest({
      auth,
      url: makeUrl("/mweb/v1/aigc_draft/generate"),
      body: built.body
    });
    const signedUrl = new URL(signedRequest.url);
    const result = await requestSignedJson(auth, "/mweb/v1/aigc_draft/generate", signedRequest, { referer });
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

async function generateVideo(auth, opts) {
  return generateVideoRequest(auth, opts, {
    assistantId: DEFAULT_ASSISTANT_ID_CN,
    draftVersion: DRAFT_VERSION,
    makeUrl,
    requestJson,
    requestSignedJson,
    nodeSignRequest,
    localSignRequest,
    browserSignRequest
  });
}

function buildAudioRequest({ text, voice = "zhishuang-nvda" }) {
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

async function generateAudio(auth, opts) {
  const built = buildAudioRequest({ text: opts.text, voice: opts.voice || "zhishuang-nvda" });
  const referer = "https://jimeng.jianying.com/ai-tool/generate?type=audio&workspace=0";
  if (opts["node-sign"]) {
    const signedRequest = await nodeSignRequest({
      auth,
      url: makeUrl("/mweb/v1/aigc_draft/generate"),
      body: built.body
    });
    const signedUrl = new URL(signedRequest.url);
    const result = await requestSignedJson(auth, "/mweb/v1/aigc_draft/generate", signedRequest, { referer });
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
    const signedRequest = await localSignRequest({
      auth,
      url: makeUrl("/mweb/v1/aigc_draft/generate"),
      body: built.body
    });
    const signedUrl = new URL(signedRequest.url);
    const result = await requestSignedJson(auth, "/mweb/v1/aigc_draft/generate", signedRequest, { referer });
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

async function agentChat(auth, opts) {
  if (!opts.prompt || opts.prompt === true) throw new Error("--prompt is required");
  const conversationId = opts["conversation-id"] || uuid();
  const messageId = uuid();
  const metricsExtra = {
    userMessageId: messageId,
    prompt: opts.prompt,
    isAddImage: 0,
    conversationId,
    enterFrom: "click",
    referenceCnt: 0,
    position: "page_bottom_box"
  };
  const result = await requestJson(auth, "POST", "/mweb/v1/creation_agent/v2/conversation", {
    data: {
      conversation_id: conversationId,
      messages: [
        {
          author: { role: "user" },
          metadata: {
            is_visually_hidden_from_conversation: false,
            conversation_id: conversationId,
            parent_message_id: opts["parent-message-id"] || "",
            metrics_extra: JSON.stringify(metricsExtra),
            system_hints: ["dreamina_creative_consultant"]
          },
          id: messageId,
          content: {
            content_type: "",
            content_parts: [{ text: opts.prompt, is_referenced: false }]
          },
          create_time: Date.now(),
          tools: []
        }
      ],
      version: "3.0.0",
      workspace_id: 0
    },
    headers: { referer: "https://jimeng.jianying.com/ai-tool/generate?type=agentic&workspace=0" }
  });
  return { ...result, request: { conversation_id: conversationId, message_id: messageId } };
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

async function checkMedia(auth, historyId) {
  if (!historyId || historyId === true) throw new Error("--history-id is required");
  const result = await requestJson(auth, "POST", "/mweb/v1/get_history_by_ids", {
    data: { history_ids: [historyId], image_info: IMAGE_INFO },
    redact: false
  });
  const record = result.parsed?.[historyId];
  const media = primaryMedia(record);
  return {
    ok: result.ok,
    status: result.status,
    endpoint: result.endpoint,
    history_id: historyId,
    parsed: summarizeHistoryRecord(record),
    media_count: media.length,
    media: media.map((item) => ({
      type: item.type,
      item_id: item.item_id,
      width: item.width,
      height: item.height,
      format: item.format,
      duration: item.duration,
      size: item.size,
      url_sample: redactUrl(item.url)
    }))
  };
}

async function checkQueue(auth, historyId) {
  if (!historyId || historyId === true) throw new Error("--history-id is required");
  const result = await requestJson(auth, "POST", "/mweb/v1/get_history_queue_info", {
    data: { history_ids: [historyId] },
    params: { da_version: DRAFT_VERSION },
    redact: false
  });
  const queue = result.parsed?.[historyId];
  return {
    ok: result.ok,
    status: result.status,
    endpoint: result.endpoint,
    history_id: historyId,
    queue: queue ? {
      status: queue.status,
      queue_idx: queue.queue_info?.queue_idx,
      queue_status: queue.queue_info?.queue_status,
      queue_length: queue.queue_info?.queue_length,
      priority: queue.queue_info?.priority,
      interval_seconds: queue.queue_info?.polling_config?.interval_seconds,
      timeout_seconds: queue.queue_info?.polling_config?.timeout_seconds,
      forecast_generate_cost: queue.forecast_cost_time?.forecast_generate_cost,
      forecast_queue_cost: queue.forecast_cost_time?.forecast_queue_cost
    } : null
  };
}

function historyRequestBody(opts = {}) {
  const type = opts.type;
  const body = {
    count: Number(opts.limit || opts.count || 20),
    history_type_list: type === "audio" ? [7] : [1, 2, 4, 3, 5, 6, 7, 8, 10],
    mode: "workbench",
    history_option: {
      story_id: "",
      multi_size_image_config: [
        { height: 100, width: 100, format: "webp" },
        { height: 360, width: 360, format: "webp" },
        { height: 720, width: 720, format: "webp" }
      ],
      only_favorited: false,
      workspace_id: Number(opts.workspace || 0)
    },
    image_info: IMAGE_INFO,
    origin_image_info: { ...IMAGE_INFO, width: 96 },
    is_pack_origin: true
  };
  if (opts.offset && opts.offset !== true && Number(opts.offset) > 0) body.offset = Number(opts.offset);
  if (type === "audio") {
    body.history_option.with_task_status = [50];
  }
  return body;
}

function inferHistoryType(record) {
  if ((record.item_list || []).some((item) => item.video)) return "video";
  if ((record.item_list || []).some((item) => item.audio)) return "audio";
  if ((record.item_list || []).some((item) => item.image)) return "image";
  if (record.generate_type === 10) return "video";
  if (record.generate_type === 44 || record.generate_type === 7) return "audio";
  return "media";
}

function summarizeHistoryListRecord(record) {
  const type = inferHistoryType(record);
  const media = primaryMedia(record);
  return {
    history_id: String(record.history_record_id || record.id || ""),
    type,
    status: record.status,
    model: record.model_info?.model_name,
    generate_type: record.generate_type,
    created_time: record.created_time,
    finish_time: record.finish_time || record.task?.finish_time,
    item_count: Array.isArray(record.item_list) ? record.item_list.length : 0,
    media_count: media.length,
    media: media.slice(0, 4).map((item) => ({
      type: item.type,
      item_id: item.item_id,
      width: item.width,
      height: item.height,
      format: item.format,
      duration: item.duration,
      size: item.size,
      url_sample: redactUrl(item.url)
    }))
  };
}

async function listHistory(auth, opts = {}) {
  const result = await requestJson(auth, "POST", "/mweb/v1/get_history", {
    data: historyRequestBody(opts),
    redact: false
  });
  const records = result.parsed?.records_list || [];
  const type = opts.type;
  const filtered = type ? records.filter((record) => inferHistoryType(record) === type) : records;
  return {
    ok: result.ok,
    status: result.status,
    endpoint: result.endpoint,
    has_more: Boolean(result.parsed?.has_more),
    next_offset: result.parsed?.next_offset,
    count: filtered.length,
    records: filtered.map(summarizeHistoryListRecord)
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

async function downloadMedia(auth, opts) {
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
  const media = primaryMedia(record);
  const item = media[index];
  if (!item) throw new Error(`No media at index ${index}; available count: ${media.length}`);
  const response = await fetch(item.url);
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
    media: {
      type: item.type,
      item_id: item.item_id,
      width: item.width,
      height: item.height,
      format: item.format,
      duration: item.duration,
      declared_size: item.size
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

function primaryMedia(record) {
  if (!record?.item_list) return [];
  const media = [];
  for (const item of record.item_list) {
    const common = item.common_attr || {};
    const large = item.image?.large_images?.[0];
    if (large?.image_url) {
      media.push({
        type: "image",
        item_id: common.id,
        url: large.image_url,
        width: large.width,
        height: large.height,
        format: large.format,
        size: large.size
      });
      continue;
    }
    const audioUrl = item.audio?.origin_audio?.url || common.file?.file_url || common.item_urls?.find((url) => /^https?:\/\//.test(url));
    if (audioUrl) {
      media.push({
        type: "audio",
        item_id: common.id,
        url: audioUrl,
        duration: item.audio?.origin_audio?.duration || item.audio?.duration,
        format: item.audio?.origin_audio?.format || "audio",
        size: item.audio?.origin_audio?.size
      });
      continue;
    }
    const transcoded = item.video?.transcoded_video;
    const transcodedVideo =
      transcoded?.origin ||
      transcoded?.["720p"] ||
      transcoded?.["480p"] ||
      transcoded?.["360p"] ||
      Object.values(transcoded || {}).find((candidate) => candidate?.video_url);
    const videoUrl =
      transcodedVideo?.video_url ||
      item.video?.play_addr?.url_list?.[0] ||
      item.video?.origin_video?.url ||
      common.item_urls?.find((url) => /^https?:\/\//.test(url));
    if (videoUrl) {
      media.push({
        type: "video",
        item_id: common.id,
        url: videoUrl,
        width: transcodedVideo?.width || item.video?.width,
        height: transcodedVideo?.height || item.video?.height,
        duration: item.video?.duration_ms || transcodedVideo?.duration || item.video?.duration,
        format: transcodedVideo?.format || item.video?.format || "video",
        size: transcodedVideo?.size || item.video?.size,
        definition: transcodedVideo?.definition
      });
    }
  }
  return media;
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
      size: item.image?.large_images?.[0]?.size,
      effect_type: item.common_attr?.effect_type,
      has_audio: Boolean(item.audio),
      has_video: Boolean(item.video)
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
    if (latest.image_url_count > 0 && latest.parsed?.status === 50) return latest;
    if (latest.parsed?.status === 30 || latest.parsed?.fail_code) return latest;
    if (latest.parsed?.status === 50) return latest;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ok: false, status: "timeout", endpoint: "/mweb/v1/get_history_by_ids", history_id: historyId, latest };
}

async function waitMedia(auth, opts) {
  const historyId = opts["history-id"];
  const intervalMs = Number(opts["interval-ms"] || 10000);
  const timeoutMs = Number(opts["timeout-ms"] || 1800000);
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() <= deadline) {
    latest = await checkMedia(auth, historyId);
    if (latest.media_count > 0 && latest.parsed?.status === 50) return latest;
    if (latest.parsed?.status === 30 || latest.parsed?.fail_code) return latest;
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

function withDefaultSigner(opts) {
  if (opts["node-sign"] || opts["local-sign"] || opts["browser-sign"] || opts["no-sign"]) return opts;
  return { ...opts, "node-sign": true };
}

async function appendJob({ type, result, opts, profile }) {
  if (!result?.history_id) return;
  const file = jobsPath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const job = {
    ts: new Date().toISOString(),
    profile,
    type,
    history_id: result.history_id,
    prompt: opts.prompt || opts.text,
    model: result.request?.model || opts.model,
    status: result.parsed?.aigc_data?.status || result.parsed?.status,
    request: result.request ? redactObject(result.request) : undefined
  };
  await appendFile(file, `${JSON.stringify(job)}\n`, { mode: 0o600 });
}

async function readJobs(limit = 20) {
  let text = "";
  try {
    text = await readFile(jobsPath(), "utf8");
  } catch {
    return [];
  }
  const jobs = text.split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
  return jobs.slice(-limit).reverse();
}

async function listJobs(opts = {}) {
  return { ok: true, jobs: await readJobs(Number(opts.limit || 20)) };
}

async function addJob(opts, profile) {
  const historyId = opts["history-id"];
  if (!historyId || historyId === true) throw new Error("--history-id is required");
  const type = opts.type || "media";
  if (!["video", "image", "audio", "media"].includes(type)) throw new Error("--type must be video, image, audio, or media");
  const file = jobsPath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const job = {
    ts: new Date().toISOString(),
    profile,
    type,
    history_id: historyId,
    prompt: opts.prompt,
    model: opts.model,
    manual: true
  };
  await appendFile(file, `${JSON.stringify(job)}\n`, { mode: 0o600 });
  return { ok: true, job };
}

async function syncJobs(auth, opts, profile) {
  const pages = Math.max(1, Number(opts.pages || 1));
  const existing = new Set((await readJobs(10000)).map((job) => String(job.history_id)));
  const file = jobsPath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const added = [];
  const pageResults = [];
  let offset = opts.offset;
  for (let page = 0; page < pages; page += 1) {
    const history = await listHistory(auth, { ...opts, offset });
    pageResults.push({
      page: page + 1,
      scanned_count: history.count,
      has_more: history.has_more,
      next_offset: history.next_offset
    });
    for (const record of history.records) {
      if (!record.history_id || existing.has(record.history_id)) continue;
      const job = {
        ts: new Date().toISOString(),
        profile,
        type: record.type,
        history_id: record.history_id,
        model: record.model,
        status: record.status,
        synced: true
      };
      await appendFile(file, `${JSON.stringify(job)}\n`, { mode: 0o600 });
      existing.add(record.history_id);
      added.push(job);
    }
    if (!history.has_more || !history.next_offset) {
      offset = undefined;
      break;
    }
    offset = history.next_offset;
  }
  return {
    ok: true,
    endpoint: "/mweb/v1/get_history",
    pages_scanned: pageResults.length,
    pages: pageResults,
    has_more: pageResults.at(-1)?.has_more || false,
    next_offset: pageResults.at(-1)?.next_offset,
    scanned_count: pageResults.reduce((sum, page) => sum + page.scanned_count, 0),
    added_count: added.length,
    added
  };
}

async function statusJobs(auth, opts = {}) {
  const jobs = await readJobs(Number(opts.limit || 20));
  const statuses = [];
  for (const job of jobs) {
    try {
      const status = job.type === "image"
        ? await checkImage(auth, job.history_id)
        : await checkMedia(auth, job.history_id);
      statuses.push({
        ...job,
        ok: status.ok,
        status: status.parsed?.status,
        model: status.parsed?.model,
        media_count: status.media_count,
        image_url_count: status.image_url_count,
        item_count: status.parsed?.item_count,
        fail_code: status.parsed?.fail_code,
        fail_msg: status.parsed?.fail_msg
      });
    } catch (error) {
      statuses.push({ ...job, ok: false, error: error.message });
    }
  }
  return { ok: true, jobs: statuses };
}

async function runMediaWorkflow(auth, opts, createFn, waitFn, downloadFn) {
  const createResult = await createFn(auth, withDefaultSigner(opts));
  if (!createResult.ok || !createResult.history_id) return createResult;
  const waitResult = await waitFn(auth, {
    ...opts,
    "history-id": createResult.history_id,
    "interval-ms": opts["interval-ms"] || 30000,
    "timeout-ms": opts["timeout-ms"] || 86400000
  });
  let downloadResult;
  if (opts.output && waitResult.ok) {
    downloadResult = await downloadFn(auth, {
      ...opts,
      "history-id": createResult.history_id,
      index: opts.index || 0
    });
  }
  return {
    ok: waitResult.ok,
    history_id: createResult.history_id,
    create: createResult,
    wait: waitResult,
    download: downloadResult
  };
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
  let recordJobType;
  let recordJobOpts = opts;
  if (command === "login") {
    result = await login(profile, opts.port || 9222);
  } else if (command === "capture-auth") {
    result = await captureAuth(profile, opts.port || 9222);
  } else if (command === "auth" && subcommand === "login") {
    result = await login(profile, opts.port || 9222);
  } else if (command === "auth" && subcommand === "capture") {
    result = await captureAuth(profile, opts.port || 9222);
  } else if (command === "auth" && subcommand === "status") {
    const auth = await loadAuth(profile);
    result = {
      ok: true,
      profile,
      auth: {
        sessionid: redact(auth.sessionid),
        xmst_len: auth.xmst?.length || 0,
        captured_at: auth.captured_at
      }
    };
  } else if (command === "params") {
    result = listParams();
  } else if (command === "models" && subcommand === "list") {
    result = listParams();
  } else if (command === "history" && subcommand === "list") {
    const auth = await loadAuth(profile);
    result = await listHistory(auth, opts);
  } else if (command === "auth" && subcommand === "save") {
    result = await saveAuth(profile, opts.sessionid);
  } else if (command === "jobs" && subcommand === "list") {
    result = await listJobs(opts);
  } else if (command === "jobs" && subcommand === "sync") {
    const auth = await loadAuth(profile);
    result = await syncJobs(auth, opts, profile);
  } else if (command === "jobs" && subcommand === "add") {
    result = await addJob(opts, profile);
  } else if (command === "jobs" && subcommand === "status") {
    const auth = await loadAuth(profile);
    result = await statusJobs(auth, opts);
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
  } else if (command === "agent-chat") {
    const auth = await loadAuth(profile);
    result = await agentChat(auth, opts);
  } else if (command === "generate-image") {
    const auth = await loadAuth(profile);
    result = await generateImage(auth, opts);
    recordJobType = "image";
  } else if (command === "generate-video") {
    const auth = await loadAuth(profile);
    result = await generateVideo(auth, opts);
    recordJobType = "video";
  } else if (command === "generate-audio") {
    const auth = await loadAuth(profile);
    result = await generateAudio(auth, opts);
    recordJobType = "audio";
  } else if (command === "video" && subcommand === "create") {
    const auth = await loadAuth(profile);
    recordJobOpts = { model: "seedance-2.0-vip", ...opts };
    result = await generateVideo(auth, withDefaultSigner(recordJobOpts));
    recordJobType = "video";
  } else if (command === "video" && subcommand === "status") {
    const auth = await loadAuth(profile);
    result = await checkMedia(auth, opts["history-id"]);
  } else if (command === "video" && subcommand === "queue") {
    const auth = await loadAuth(profile);
    result = await checkQueue(auth, opts["history-id"]);
  } else if (command === "video" && subcommand === "wait") {
    const auth = await loadAuth(profile);
    result = await waitMedia(auth, {
      "interval-ms": 30000,
      "timeout-ms": 86400000,
      ...opts
    });
  } else if (command === "video" && subcommand === "download") {
    const auth = await loadAuth(profile);
    result = await downloadMedia(auth, opts);
  } else if (command === "video" && subcommand === "run") {
    const auth = await loadAuth(profile);
    recordJobOpts = { model: "seedance-2.0-vip", ...opts };
    result = await runMediaWorkflow(auth, recordJobOpts, generateVideo, waitMedia, downloadMedia);
    recordJobType = "video";
  } else if (command === "image" && subcommand === "create") {
    const auth = await loadAuth(profile);
    result = await generateImage(auth, withDefaultSigner(opts));
    recordJobType = "image";
  } else if (command === "image" && subcommand === "status") {
    const auth = await loadAuth(profile);
    result = await checkImage(auth, opts["history-id"]);
  } else if (command === "image" && subcommand === "queue") {
    const auth = await loadAuth(profile);
    result = await checkQueue(auth, opts["history-id"]);
  } else if (command === "image" && subcommand === "wait") {
    const auth = await loadAuth(profile);
    result = await waitImage(auth, opts);
  } else if (command === "image" && subcommand === "download") {
    const auth = await loadAuth(profile);
    result = await downloadImage(auth, opts);
  } else if (command === "image" && subcommand === "run") {
    const auth = await loadAuth(profile);
    result = await runMediaWorkflow(auth, opts, generateImage, waitImage, downloadImage);
    recordJobType = "image";
  } else if (command === "audio" && subcommand === "create") {
    const auth = await loadAuth(profile);
    result = await generateAudio(auth, withDefaultSigner(opts));
    recordJobType = "audio";
  } else if (command === "audio" && subcommand === "status") {
    const auth = await loadAuth(profile);
    result = await checkMedia(auth, opts["history-id"]);
  } else if (command === "audio" && subcommand === "queue") {
    const auth = await loadAuth(profile);
    result = await checkQueue(auth, opts["history-id"]);
  } else if (command === "audio" && subcommand === "wait") {
    const auth = await loadAuth(profile);
    result = await waitMedia(auth, opts);
  } else if (command === "audio" && subcommand === "download") {
    const auth = await loadAuth(profile);
    result = await downloadMedia(auth, opts);
  } else if (command === "audio" && subcommand === "run") {
    const auth = await loadAuth(profile);
    result = await runMediaWorkflow(auth, opts, generateAudio, waitMedia, downloadMedia);
    recordJobType = "audio";
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
  } else if (command === "check-media") {
    const auth = await loadAuth(profile);
    result = await checkMedia(auth, opts["history-id"]);
  } else if (command === "queue-media") {
    const auth = await loadAuth(profile);
    result = await checkQueue(auth, opts["history-id"]);
  } else if (command === "wait-media") {
    const auth = await loadAuth(profile);
    result = await waitMedia(auth, opts);
  } else if (command === "download-media") {
    const auth = await loadAuth(profile);
    result = await downloadMedia(auth, opts);
  } else if (command === "download") {
    result = await download(opts.url, opts.output);
  } else {
    throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
  }

  if (recordJobType) await appendJob({ type: recordJobType, result: result.create || result, opts: recordJobOpts, profile });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
