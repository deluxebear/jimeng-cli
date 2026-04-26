#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { VOICE_MAP, generateAudio as generateAudioRequest } from "../lib/audio.mjs";
import { configureClient, BASE_URL_CN, DEFAULT_ASSISTANT_ID_CN, DRAFT_VERSION, makeUrl, requestJson, uuid } from "../lib/client.mjs";
import { getConfigValue, loadConfig, setConfigValue } from "../lib/config.mjs";
import {
  IMAGE_MODEL_MAP,
  RESOLUTION_OPTIONS,
  generateImage as generateImageRequest,
  uploadImage
} from "../lib/image.mjs";
import {
  addJob,
  appendJob,
  checkImage,
  checkMedia,
  checkQueue,
  download,
  downloadImage,
  downloadMedia,
  listHistory,
  listJobs,
  runMediaWorkflow,
  statusJobs,
  syncJobs,
  waitImage,
  waitMedia,
  withDefaultSigner
} from "../lib/media.mjs";
import { algorithmSignRequest, browserSignRequest, compareAlgorithmSignRequest, createBdmsFixture, localSignRequest, nodeSignRequest, requestSignedJson } from "../lib/signer.mjs";
import { VIDEO_MODEL_MAP, generateVideo as generateVideoRequest } from "../lib/video.mjs";

const DEFAULT_MODEL = "jimeng-4.5";

function usage() {
  return `jimeng CLI

Usage:
  jimeng auth login [--profile default] [--port 9222]
  jimeng auth capture [--profile default] [--port 9222]
  jimeng auth status [--profile default]
  jimeng config list|get|set [key] [value]
  jimeng completion zsh|bash|fish
  jimeng commands list
  jimeng signer compare|fixture [--profile default] [--name default]
  jimeng doctor [--profile default]

  jimeng video create --prompt <text> [--model seedance-2.0-vip] [--ratio 16:9] [--duration 5]
  jimeng video status --history-id <id>
  jimeng video queue --history-id <id>
  jimeng video wait --history-id <id> [--interval-ms 30000] [--timeout-ms 86400000]
  jimeng video download --history-id <id> --index 0 [--output <path>]
  jimeng video run --prompt <text> --output <path> [--model seedance-2.0-vip]

  jimeng image create --prompt <text> [--model jimeng-4.5] [--ratio 1:1] [--resolution 2k] [--reference-image <path>] [--reference-uri <tos-uri>]
  jimeng image status --history-id <id>
  jimeng image queue --history-id <id>
  jimeng image wait --history-id <id>
  jimeng image download --history-id <id> --index 0 [--output <path>]

  jimeng audio create --text <text> [--voice zhishuang-nvda]
  jimeng audio status --history-id <id>
  jimeng audio queue --history-id <id>
  jimeng audio wait --history-id <id>
  jimeng audio download --history-id <id> --index 0 [--output <path>]

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
  node bin/jimeng.mjs generate-image --profile default --prompt <text> [--model jimeng-4.5] [--ratio 1:1] [--resolution 2k] [--reference-image <path>] [--reference-uri <tos-uri>] [--algorithm-sign | --node-sign | --local-sign]
  node bin/jimeng.mjs generate-video --profile default --prompt <text> [--model seedance-2.0-fast] [--ratio 16:9] [--duration 5] [--algorithm-sign | --node-sign | --local-sign | --browser-sign --port 9222]
  node bin/jimeng.mjs generate-audio --profile default --text <text> [--voice zhishuang-nvda] [--algorithm-sign | --node-sign | --local-sign]
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
  --algorithm-sign is experimental; it compares pure JS pieces and falls back to --node-sign until a_bogus is complete.
  --node-sign runs the official bdms VM in a pure Node vm browser shim to create msToken/a_bogus.
  --local-sign uses the official bdms script in a headless local Chromium page to create current msToken/a_bogus query params.
  generate-video --browser-sign uses the logged-in Chrome page as a fallback signer.
  Auth is stored under ~/.jimeng-cli/profiles/<profile>/auth.json.
  login opens an external Chrome profile under ~/.jimeng-cli/browser-profiles/<profile>.
`;
}

const COMPLETION_COMMANDS = {
  auth: ["login", "capture", "status", "save"],
  config: ["list", "get", "set"],
  completion: ["zsh", "bash", "fish"],
  commands: ["list"],
  signer: ["compare", "fixture"],
  video: ["create", "status", "queue", "wait", "download", "run"],
  image: ["create", "status", "queue", "wait", "download", "run"],
  audio: ["create", "status", "queue", "wait", "download", "run"],
  models: ["list"],
  history: ["list"],
  jobs: ["list", "sync", "add", "status"]
};

const TOP_LEVEL_COMMANDS = [
  ...Object.keys(COMPLETION_COMMANDS),
  "doctor",
  "params",
  "session",
  "credits",
  "agent-chat",
  "generate-image",
  "generate-video",
  "generate-audio",
  "upload-image",
  "check-image",
  "wait-image",
  "download-image",
  "check-media",
  "queue-media",
  "wait-media",
  "download-media",
  "download"
];

const COMMON_FLAGS = [
  "--profile",
  "--prompt",
  "--text",
  "--model",
  "--ratio",
  "--resolution",
  "--duration",
  "--voice",
  "--history-id",
  "--index",
  "--output",
  "--output-dir",
  "--interval-ms",
  "--timeout-ms",
  "--limit",
  "--pages",
  "--type",
  "--offset",
  "--reference-image",
  "--reference-uri",
  "--image",
  "--url",
  "--port",
  "--node-sign",
  "--algorithm-sign",
  "--local-sign",
  "--browser-sign",
  "--retry-count",
  "--retry-delay-ms",
  "--compact",
  "--quiet",
  "--help"
];

function commandRegistry() {
  return {
    ok: true,
    commands: TOP_LEVEL_COMMANDS.map((command) => ({
      command,
      subcommands: COMPLETION_COMMANDS[command] || [],
      flags: COMMON_FLAGS
    }))
  };
}

function shellCompletion(shell) {
  const commands = TOP_LEVEL_COMMANDS.join(" ");
  const flags = COMMON_FLAGS.join(" ");
  const subcommands = Object.entries(COMPLETION_COMMANDS)
    .map(([command, items]) => `${command}:${items.join(",")}`)
    .join(" ");
  if (shell === "zsh") {
    return `#compdef jimeng
_jimeng() {
  local -a commands flags subs
  commands=(${commands})
  flags=(${flags})
  case "$words[2]" in
${Object.entries(COMPLETION_COMMANDS).map(([command, items]) => `    ${command}) subs=(${items.join(" ")}) ;;`).join("\n")}
    *) subs=() ;;
  esac
  if (( CURRENT == 2 )); then
    _describe 'command' commands
  elif (( CURRENT == 3 && $#subs > 0 )); then
    _describe 'subcommand' subs
  else
    _describe 'flag' flags
  fi
}
compdef _jimeng jimeng
`;
  }
  if (shell === "bash") {
    return `_jimeng_completion() {
  local cur prev command
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  command="\${COMP_WORDS[1]}"
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commands}" -- "$cur") )
    return 0
  fi
  case "$command" in
${Object.entries(COMPLETION_COMMANDS).map(([command, items]) => `    ${command}) [[ \${COMP_CWORD} -eq 2 ]] && COMPREPLY=( $(compgen -W "${items.join(" ")}" -- "$cur") ) && return 0 ;;`).join("\n")}
  esac
  COMPREPLY=( $(compgen -W "${flags}" -- "$cur") )
}
complete -F _jimeng_completion jimeng
`;
  }
  if (shell === "fish") {
    const lines = [
      "complete -c jimeng -f",
      ...TOP_LEVEL_COMMANDS.map((command) => `complete -c jimeng -n "__fish_use_subcommand" -a "${command}"`),
      ...Object.entries(COMPLETION_COMMANDS).flatMap(([command, items]) =>
        items.map((item) => `complete -c jimeng -n "__fish_seen_subcommand_from ${command}" -a "${item}"`)
      ),
      ...COMMON_FLAGS.map((flag) => `complete -c jimeng -l ${flag.slice(2)}`)
    ];
    return `${lines.join("\n")}\n`;
  }
  throw new Error("completion shell must be zsh, bash, or fish");
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

function positional(opts, index) {
  return opts._?.[index];
}

function withConfigDefaults(opts, config) {
  return {
    ...opts,
    "output-dir": opts["output-dir"] ?? opts.output_dir ?? config.output_dir,
    retry_count: opts["retry-count"] ?? opts.retry_count ?? config.retry_count,
    retry_delay_ms: opts["retry-delay-ms"] ?? opts.retry_delay_ms ?? config.retry_delay_ms
  };
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

async function generateVideo(auth, opts) {
  return generateVideoRequest(auth, opts, {
    assistantId: DEFAULT_ASSISTANT_ID_CN,
    draftVersion: DRAFT_VERSION,
    makeUrl,
    requestJson,
    requestSignedJson,
    algorithmSignRequest,
    nodeSignRequest,
    localSignRequest,
    browserSignRequest
  });
}

async function generateImage(auth, opts) {
  return generateImageRequest(auth, opts, {
    algorithmSignRequest,
    nodeSignRequest,
    localSignRequest,
    requestSignedJson
  });
}

async function generateAudio(auth, opts) {
  return generateAudioRequest(auth, opts, {
    algorithmSignRequest,
    nodeSignRequest,
    localSignRequest,
    requestSignedJson
  });
}

async function signerBody(opts) {
  if (opts.body && opts.body !== true) return JSON.parse(await readFile(opts.body, "utf8"));
  return { doctor: true };
}

async function signerUrl(opts) {
  if (opts.url && opts.url !== true) return new URL(opts.url);
  return makeUrl("/mweb/v1/aigc_draft/generate");
}

async function compareSigner(auth, opts) {
  return {
    ok: true,
    submitted: false,
    algorithm: await compareAlgorithmSignRequest({
      auth,
      url: await signerUrl(opts),
      body: await signerBody(opts)
    })
  };
}

async function createSignerFixture(auth, opts) {
  const result = await createBdmsFixture({
    auth,
    url: await signerUrl(opts),
    body: await signerBody(opts),
    name: opts.name || "default",
    meta: {
      command: "signer fixture",
      submitted: false,
      note: "Private golden fixture for pure JS bdms algorithm development"
    }
  });
  return {
    ok: true,
    submitted: false,
    path: result.path,
    algorithm_status: result.fixture.algorithm.status,
    msToken_matches_xmst: result.fixture.vm.msToken_matches_xmst,
    msToken_len: result.fixture.vm.msToken_len,
    a_bogus_len: result.fixture.vm.a_bogus_len,
    missing: result.fixture.algorithm.missing
  };
}

async function doctor(profile, config) {
  const checks = [];
  checks.push({ name: "config", ok: true, output_dir: config.output_dir, retry_count: config.retry_count, retry_delay_ms: config.retry_delay_ms });
  let auth;
  try {
    auth = await loadAuth(profile);
    checks.push({ name: "auth", ok: true, profile, sessionid: redact(auth.sessionid), xmst_len: auth.xmst?.length || 0 });
  } catch (error) {
    checks.push({ name: "auth", ok: false, error: error.message });
  }
  if (auth) {
    const session = await requestJson(auth, "POST", "/passport/account/info/v2", {
      params: { account_sdk_source: "web" }
    });
    checks.push({ name: "session", ok: session.ok, status: session.status, endpoint: session.endpoint });
    const credits = await requestJson(auth, "POST", "/commerce/v1/benefits/user_credit", {
      data: {},
      headers: { referer: "https://jimeng.jianying.com/ai-tool/image/generate" },
      noDefaultParams: true
    });
    checks.push({ name: "credits", ok: credits.ok, status: credits.status, endpoint: credits.endpoint });
    try {
      const signed = await nodeSignRequest({
        auth,
        url: makeUrl("/mweb/v1/aigc_draft/generate"),
        body: { doctor: true }
      });
      const signedUrl = new URL(signed.url);
      checks.push({
        name: "node_sign",
        ok: true,
        msToken_len: (signedUrl.searchParams.get("msToken") || "").length,
        a_bogus_len: (signedUrl.searchParams.get("a_bogus") || "").length,
        submitted: false
      });
    } catch (error) {
      checks.push({ name: "node_sign", ok: false, submitted: false, error: error.message });
    }
    try {
      const algorithm = await compareAlgorithmSignRequest({
        auth,
        url: makeUrl("/mweb/v1/aigc_draft/generate"),
        body: { doctor: true }
      });
      checks.push({
        name: "algorithm_sign",
        ok: algorithm.compare.msToken_match,
        status: algorithm.status,
        submitted: false,
        msToken_match: algorithm.compare.msToken_match,
        a_bogus_match: algorithm.compare.a_bogus_match,
        missing: algorithm.missing
      });
    } catch (error) {
      checks.push({ name: "algorithm_sign", ok: false, submitted: false, error: error.message });
    }
  }
  return { ok: checks.every((check) => check.ok), profile, checks };
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

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return;
  }
  const { command, subcommand, opts } = parseArgs(argv);
  if (command === "completion") {
    process.stdout.write(shellCompletion(subcommand || positional(opts, 0) || "zsh"));
    return;
  }
  if (command === "commands" && (!subcommand || subcommand === "list")) {
    console.log(JSON.stringify(commandRegistry(), null, opts.compact ? 0 : 2));
    return;
  }
  const profile = opts.profile || "default";
  const config = await loadConfig();
  configureClient({
    retry_count: opts["retry-count"] ?? opts.retry_count ?? config.retry_count,
    retry_delay_ms: opts["retry-delay-ms"] ?? opts.retry_delay_ms ?? config.retry_delay_ms
  });
  const effectiveOpts = withConfigDefaults(opts, config);

  let result;
  let recordJobType;
  let recordJobOpts = effectiveOpts;
  if (command === "login") {
    result = await login(profile, effectiveOpts.port || 9222);
  } else if (command === "capture-auth") {
    result = await captureAuth(profile, effectiveOpts.port || 9222);
  } else if (command === "auth" && subcommand === "login") {
    result = await login(profile, effectiveOpts.port || 9222);
  } else if (command === "auth" && subcommand === "capture") {
    result = await captureAuth(profile, effectiveOpts.port || 9222);
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
  } else if (command === "config" && (!subcommand || subcommand === "list")) {
    result = await getConfigValue();
  } else if (command === "config" && subcommand === "get") {
    result = await getConfigValue(effectiveOpts.key || positional(effectiveOpts, 0));
  } else if (command === "config" && subcommand === "set") {
    result = await setConfigValue(effectiveOpts.key ?? positional(effectiveOpts, 0), effectiveOpts.value ?? positional(effectiveOpts, 1));
  } else if (command === "doctor") {
    result = await doctor(profile, config);
  } else if (command === "signer" && subcommand === "compare") {
    const auth = await loadAuth(profile);
    result = await compareSigner(auth, effectiveOpts);
  } else if (command === "signer" && subcommand === "fixture") {
    const auth = await loadAuth(profile);
    result = await createSignerFixture(auth, effectiveOpts);
  } else if (command === "params") {
    result = listParams();
  } else if (command === "models" && subcommand === "list") {
    result = listParams();
  } else if (command === "history" && subcommand === "list") {
    const auth = await loadAuth(profile);
    result = await listHistory(auth, effectiveOpts);
  } else if (command === "auth" && subcommand === "save") {
    result = await saveAuth(profile, effectiveOpts.sessionid);
  } else if (command === "jobs" && subcommand === "list") {
    result = await listJobs(effectiveOpts);
  } else if (command === "jobs" && subcommand === "sync") {
    const auth = await loadAuth(profile);
    result = await syncJobs(auth, effectiveOpts, profile);
  } else if (command === "jobs" && subcommand === "add") {
    result = await addJob(effectiveOpts, profile);
  } else if (command === "jobs" && subcommand === "status") {
    const auth = await loadAuth(profile);
    result = await statusJobs(auth, effectiveOpts);
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
    result = await agentChat(auth, effectiveOpts);
  } else if (command === "generate-image") {
    const auth = await loadAuth(profile);
    result = await generateImage(auth, effectiveOpts);
    recordJobType = "image";
  } else if (command === "generate-video") {
    const auth = await loadAuth(profile);
    result = await generateVideo(auth, effectiveOpts);
    recordJobType = "video";
  } else if (command === "generate-audio") {
    const auth = await loadAuth(profile);
    result = await generateAudio(auth, effectiveOpts);
    recordJobType = "audio";
  } else if (command === "video" && subcommand === "create") {
    const auth = await loadAuth(profile);
    recordJobOpts = { model: "seedance-2.0-vip", ...effectiveOpts };
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
      ...effectiveOpts
    });
  } else if (command === "video" && subcommand === "download") {
    const auth = await loadAuth(profile);
    result = await downloadMedia(auth, effectiveOpts);
  } else if (command === "video" && subcommand === "run") {
    const auth = await loadAuth(profile);
    recordJobOpts = { model: "seedance-2.0-vip", ...effectiveOpts };
    result = await runMediaWorkflow(auth, recordJobOpts, generateVideo, waitMedia, downloadMedia);
    recordJobType = "video";
  } else if (command === "image" && subcommand === "create") {
    const auth = await loadAuth(profile);
    result = await generateImage(auth, withDefaultSigner(effectiveOpts));
    recordJobType = "image";
  } else if (command === "image" && subcommand === "status") {
    const auth = await loadAuth(profile);
    result = await checkImage(auth, opts["history-id"]);
  } else if (command === "image" && subcommand === "queue") {
    const auth = await loadAuth(profile);
    result = await checkQueue(auth, opts["history-id"]);
  } else if (command === "image" && subcommand === "wait") {
    const auth = await loadAuth(profile);
    result = await waitImage(auth, effectiveOpts);
  } else if (command === "image" && subcommand === "download") {
    const auth = await loadAuth(profile);
    result = await downloadImage(auth, effectiveOpts);
  } else if (command === "image" && subcommand === "run") {
    const auth = await loadAuth(profile);
    result = await runMediaWorkflow(auth, effectiveOpts, generateImage, waitImage, downloadImage);
    recordJobType = "image";
  } else if (command === "audio" && subcommand === "create") {
    const auth = await loadAuth(profile);
    result = await generateAudio(auth, withDefaultSigner(effectiveOpts));
    recordJobType = "audio";
  } else if (command === "audio" && subcommand === "status") {
    const auth = await loadAuth(profile);
    result = await checkMedia(auth, opts["history-id"]);
  } else if (command === "audio" && subcommand === "queue") {
    const auth = await loadAuth(profile);
    result = await checkQueue(auth, opts["history-id"]);
  } else if (command === "audio" && subcommand === "wait") {
    const auth = await loadAuth(profile);
    result = await waitMedia(auth, effectiveOpts);
  } else if (command === "audio" && subcommand === "download") {
    const auth = await loadAuth(profile);
    result = await downloadMedia(auth, effectiveOpts);
  } else if (command === "audio" && subcommand === "run") {
    const auth = await loadAuth(profile);
    result = await runMediaWorkflow(auth, effectiveOpts, generateAudio, waitMedia, downloadMedia);
    recordJobType = "audio";
  } else if (command === "upload-image") {
    const auth = await loadAuth(profile);
    if (!effectiveOpts.image || effectiveOpts.image === true) throw new Error("--image is required");
    const upload = await uploadImage(auth, effectiveOpts.image);
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
    result = await waitImage(auth, effectiveOpts);
  } else if (command === "download-image") {
    const auth = await loadAuth(profile);
    result = await downloadImage(auth, effectiveOpts);
  } else if (command === "check-media") {
    const auth = await loadAuth(profile);
    result = await checkMedia(auth, opts["history-id"]);
  } else if (command === "queue-media") {
    const auth = await loadAuth(profile);
    result = await checkQueue(auth, opts["history-id"]);
  } else if (command === "wait-media") {
    const auth = await loadAuth(profile);
    result = await waitMedia(auth, effectiveOpts);
  } else if (command === "download-media") {
    const auth = await loadAuth(profile);
    result = await downloadMedia(auth, effectiveOpts);
  } else if (command === "download") {
    result = await download(effectiveOpts.url, effectiveOpts.output);
  } else {
    throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
  }

  if (recordJobType) await appendJob({ type: recordJobType, result: result.create || result, opts: recordJobOpts, profile });
  if (!effectiveOpts.quiet) console.log(JSON.stringify(result, null, effectiveOpts.compact ? 0 : 2));
}

main().catch((error) => {
  if (!process.argv.includes("--quiet")) {
    console.error(JSON.stringify({ ok: false, code: error.code || "ERR_CLI", error: error.message }, null, 2));
  }
  process.exitCode = 1;
});
