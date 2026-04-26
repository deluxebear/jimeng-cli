import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import vm from "node:vm";
import { algorithmSignCandidate, compareAlgorithmCandidate, writeBdmsFixture } from "./bdms-algorithm.mjs";

const BASE_URL_CN = "https://jimeng.jianying.com";
const DEFAULT_ASSISTANT_ID_CN = 513695;
const BDMS_VERSION = "1.0.1.20";
const SDK_PAGE_ID = 28324;
const SDK_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const BDMS_URLS = [
  "https://lf3-lv-buz.vlabstatic.com/obj/image-lvweb-buz/common/scripts/bdms-1.0.1.20.js",
  "https://lf-c-flwb.bytetos.com/obj/rc-client-security/web/stable/1.0.1.20/bdms.js",
  "https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.1.20/bdms.js"
];
const BDMS_PATHS = [
  "/mweb/v1/generate",
  "/mweb/v1/super_resolution",
  "/mweb/v1/painting",
  "/mweb/v1/aigc_draft/generate",
  "/mweb/v1/normal_hd",
  "/mweb/v1/doodle",
  "/mweb/v1/batch_generate_video",
  "/mweb/v1/mixblend",
  "/mweb/v1/fusion",
  "/mweb/v1/creation_agent/v2/conversation",
  "/commerce/v1/subscription/make_unauto_order",
  "/commerce/v1/benefits/credit_receive",
  "/commerce/v1/purchase/make_order",
  "/commerce/v3/trade/init_trade",
  "/commerce/v2/subscription/sign_and_pay",
  "/mweb/v1/get_explore",
  "/mweb/v1/feed_short_video",
  "/mweb/v1/feed",
  "/mweb/v1/get_homepage",
  "/mweb/v1/get_weekly_challenge_work_list",
  "/mweb/v1/mget_item_info",
  "/mweb/v1/get_item_info",
  "/mweb/v1/get_history_by_ids",
  "/mweb/v1/get_history",
  "/mweb/v1/get_local_item_list",
  "/mweb/search/v1/search",
  "/lv/v1/user/update",
  "/mweb/v1/publish",
  "competition/v1/submit_artwork",
  "/mweb/v1/mark_favorite",
  "/mweb/v1/follow",
  "/commerce/v3/trade/user/apply_order_refund"
];

function uuid(noDash = false) {
  const id = randomUUID();
  return noDash ? id.replaceAll("-", "") : id;
}

function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
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

function redact(value) {
  if (!value) return value;
  if (value.length <= 10) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|cookie|authorization|session|secret|xmst|a_bogus/i.test(key)) {
      out[key] = typeof nested === "string" ? redact(nested) : "[redacted]";
    } else {
      out[key] = redactObject(nested);
    }
  }
  return out;
}

function requirePlaywright() {
  const candidates = [
    import.meta.url,
    join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/")
  ];
  for (const candidate of candidates) {
    try {
      return createRequire(candidate)("playwright");
    } catch {}
  }
  throw new Error("Playwright is required for --browser-sign. Install playwright locally or run inside Codex desktop.");
}

function normalizeSignedHeaders(headers, auth, referer) {
  const normalized = { ...headers };
  for (const key of Object.keys(normalized)) {
    if (/^(host|content-length|cookie)$/i.test(key)) delete normalized[key];
  }
  normalized.cookie = generateCookie(auth.sessionid);
  normalized.origin = BASE_URL_CN;
  normalized.referer = referer;
  return normalized;
}

export async function browserSignRequest({ port = 9222, url, body, referer }) {
  const { chromium } = requirePlaywright();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page;
  let captured;
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error(`No Chrome context found on CDP port ${port}`);
    page = context.pages().find((candidate) => candidate.url().includes("jimeng.jianying.com")) || context.pages()[0];
    if (!page || !page.url().includes("jimeng.jianying.com")) {
      page = await context.newPage();
      await page.goto(referer, { waitUntil: "domcontentloaded" });
    }

    let resolveCapture;
    const capture = new Promise((resolve) => {
      resolveCapture = resolve;
    });
    const timer = setTimeout(() => resolveCapture(null), 10000);
    await page.route("**/mweb/v1/aigc_draft/generate**", async (route) => {
      const request = route.request();
      captured = {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData()
      };
      clearTimeout(timer);
      resolveCapture(captured);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({ ret: "9999", errmsg: "blocked locally after signing" })
      });
    });

    await page.evaluate(async ({ targetUrl, payload }) => {
      await fetch(targetUrl, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }, { targetUrl: url.toString(), payload: body });

    captured = await capture;
    if (!captured) throw new Error("Timed out waiting for browser-signed Jimeng request");
    const signedUrl = new URL(captured.url);
    if (!signedUrl.searchParams.get("msToken") || !signedUrl.searchParams.get("a_bogus")) {
      throw new Error("Browser did not add msToken/a_bogus to the request");
    }
    return captured;
  } finally {
    if (page) await page.unroute("**/mweb/v1/aigc_draft/generate**").catch(() => {});
    await browser.close().catch(() => {});
  }
}

function sdkCachePath(name) {
  return join(homedir(), ".jimeng-cli", "sdk", name);
}

async function loadBdmsSource() {
  const cacheFile = sdkCachePath(`bdms-${BDMS_VERSION}.js`);
  try {
    return await readFile(cacheFile, "utf8");
  } catch {}

  const localCapture = join(process.cwd(), "captures", "signature", `bdms-${BDMS_VERSION}.js`);
  try {
    const source = await readFile(localCapture, "utf8");
    await mkdir(dirname(cacheFile), { recursive: true, mode: 0o700 });
    await writeFile(cacheFile, source, { mode: 0o600 });
    return source;
  } catch {}

  let lastError;
  for (const sourceUrl of BDMS_URLS) {
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const source = await response.text();
      if (!source.includes("window.bdms")) throw new Error("downloaded script does not expose window.bdms");
      await mkdir(dirname(cacheFile), { recursive: true, mode: 0o700 });
      await writeFile(cacheFile, source, { mode: 0o600 });
      return source;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Unable to load bdms ${BDMS_VERSION}: ${lastError?.message || "unknown error"}`);
}

function bdmsInitConfig() {
  return {
    aid: DEFAULT_ASSISTANT_ID_CN,
    pageId: SDK_PAGE_ID,
    paths: BDMS_PATHS,
    track: { mode: 2 }
  };
}

export async function localSignRequest({ auth, url, body }) {
  if (!auth.xmst) {
    throw new Error("Missing xmst in auth.json. Run capture-auth again from a logged-in Jimeng Chrome session.");
  }
  const { chromium } = requirePlaywright();
  const bdmsSource = await loadBdmsSource();
  const browser = await chromium.launch({ headless: true });
  let captured;
  try {
    const context = await browser.newContext({
      userAgent: SDK_USER_AGENT,
      viewport: { width: 1280, height: 720 },
      locale: "zh-CN"
    });
    const page = await context.newPage();
    await page.route("**/mweb/v1/aigc_draft/generate**", async (route) => {
      const request = route.request();
      captured = {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData()
      };
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({ ret: "9999", errmsg: "blocked locally after signing" })
      });
    });
    await page.route("https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><head></head><body>jimeng local signer</body></html>"
      });
    });
    await page.goto("https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0", { waitUntil: "domcontentloaded" });
    await page.evaluate(({ bdmsSource, config, authState }) => {
      localStorage.setItem("xmst", authState.xmst);
      if (authState.web_runtime_security_uid) localStorage.setItem("web_runtime_security_uid", authState.web_runtime_security_uid);
      if (authState.msuuid) localStorage.setItem("__msuuid__", authState.msuuid);
      (0, eval)(bdmsSource);
      window.bdms.init(config);
    }, {
      bdmsSource,
      config: bdmsInitConfig(),
      authState: {
        xmst: auth.xmst,
        web_runtime_security_uid: auth.web_runtime_security_uid,
        msuuid: auth.msuuid
      }
    });
    await page.evaluate(async ({ targetUrl, payload }) => {
      await fetch(targetUrl, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }, { targetUrl: url.toString(), payload: body });
    await page.waitForTimeout(250);
    if (!captured) throw new Error("Timed out waiting for local bdms-signed Jimeng request");
    const signedUrl = new URL(captured.url);
    if (!signedUrl.searchParams.get("msToken") || !signedUrl.searchParams.get("a_bogus")) {
      throw new Error("Local bdms did not add msToken/a_bogus to the request");
    }
    return captured;
  } finally {
    await browser.close().catch(() => {});
  }
}

class VmStorage {
  constructor() {
    this.values = {};
  }

  getItem(key) {
    return this.values[key] ?? null;
  }

  setItem(key, value) {
    this.values[key] = String(value);
  }

  removeItem(key) {
    delete this.values[key];
  }

  clear() {
    this.values = {};
  }
}

class VmClassList {
  add() {}
  remove() {}
  contains() {
    return false;
  }
  toggle() {
    return false;
  }
}

class VmElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeName = this.tagName;
    this.children = [];
    this.childNodes = this.children;
    this.style = {};
    this.attrs = {};
    this.parentNode = null;
    this.classList = new VmClassList();
    this.dataset = {};
    this.width = 300;
    this.height = 150;
  }

  setAttribute(key, value) {
    this.attrs[key] = String(value);
    this[key] = String(value);
  }

  getAttribute(key) {
    return this.attrs[key] || null;
  }

  addEventListener(event, callback) {
    if (event === "load") setTimeout(callback, 0);
  }

  removeEventListener() {}

  appendChild(element) {
    this.children.push(element);
    element.parentNode = this;
    return element;
  }

  removeChild(element) {
    this.children = this.children.filter((child) => child !== element);
    return element;
  }

  insertBefore(element) {
    return this.appendChild(element);
  }

  getContext() {
    return {
      fillStyle: "",
      strokeStyle: "",
      font: "",
      textBaseline: "",
      fillRect() {},
      clearRect() {},
      getImageData() {
        return { data: new Uint8ClampedArray(4) };
      },
      putImageData() {},
      drawImage() {},
      measureText() {
        return { width: 1 };
      },
      fillText() {},
      strokeText() {},
      beginPath() {},
      arc() {},
      stroke() {},
      closePath() {},
      rect() {},
      isPointInPath() {
        return false;
      }
    };
  }

  toDataURL() {
    return "data:image/png;base64,eA==";
  }

  click() {}
}

class VmHeaders {
  constructor(init = {}) {
    this.map = new Map();
    for (const [key, value] of Object.entries(init)) this.set(key, value);
  }

  set(key, value) {
    this.map.set(String(key).toLowerCase(), String(value));
  }

  get(key) {
    return this.map.get(String(key).toLowerCase()) || null;
  }

  entries() {
    return this.map.entries();
  }

  forEach(callback) {
    for (const [key, value] of this.map) callback(value, key, this);
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}

function createBdmsVmContext() {
  const captured = [];
  const head = new VmElement("head");
  const body = new VmElement("body");
  const html = new VmElement("html");
  head.parentNode = html;
  body.parentNode = html;

  function VmXMLHttpRequest() {
    this.headers = {};
    this.readyState = 0;
    this.status = 200;
    this.responseText = "{}";
    this.response = this.responseText;
  }
  VmXMLHttpRequest.prototype.open = function open(method, requestUrl) {
    this.method = method;
    this.url = String(requestUrl);
    captured.push({ kind: "xhr.open", method, url: this.url });
  };
  VmXMLHttpRequest.prototype.send = function send(bodyPayload) {
    this.body = bodyPayload;
    this.readyState = 4;
    captured.push({ kind: "xhr.send", url: this.url, body: bodyPayload });
  };
  VmXMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(key, value) {
    this.headers[key] = value;
  };
  VmXMLHttpRequest.prototype.addEventListener = function addEventListener(event, callback) {
    if (event === "load") this.onload = callback;
    if (event === "readystatechange") this.onreadystatechange = callback;
  };
  VmXMLHttpRequest.prototype.removeEventListener = function removeEventListener() {};
  VmXMLHttpRequest.prototype.overrideMimeType = function overrideMimeType() {};

  function VmRequest(input, options = {}) {
    this.url = String(input?.url || input);
    this.method = options.method || input?.method || "GET";
    this.headers = options.headers instanceof VmHeaders ? options.headers : new VmHeaders(options.headers || {});
    this.body = options.body;
  }

  const document = {
    cookie: "",
    referrer: "",
    head,
    body,
    documentElement: html,
    scripts: [],
    createElement: (tag) => new VmElement(tag),
    createTextNode: (text) => ({ nodeType: 3, data: "", textContent: text, nodeValue: text }),
    createComment: (text) => ({ nodeType: 8, textContent: text }),
    getElementsByTagName: (tag) => {
      if (tag === "head") return [head];
      if (tag === "body") return [body];
      return [];
    },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    write() {},
    createEvent() {
      return { initEvent() {} };
    }
  };

  const window = {};
  const originalFetch = async (input, options) => {
    captured.push({ kind: "fetch", url: String(input?.url || input), method: options?.method || input?.method || "GET", headers: options?.headers || {}, postData: options?.body });
    return {
      ok: true,
      status: 200,
      headers: new VmHeaders({ "content-type": "application/json" }),
      text: async () => "{}",
      json: async () => ({})
    };
  };

  Object.assign(window, {
    window,
    self: window,
    globalThis: window,
    top: window,
    parent: window,
    document,
    Document: function Document() {},
    HTMLDocument: function HTMLDocument() {},
    Element: VmElement,
    HTMLElement: VmElement,
    HTMLCanvasElement: VmElement,
    DOMTokenList: VmClassList,
    NodeList: Array,
    HTMLCollection: Array,
    CSSRuleList: Array,
    CSSStyleDeclaration: function CSSStyleDeclaration() {},
    navigator: {
      userAgent: SDK_USER_AGENT,
      language: "zh-CN",
      languages: ["zh-CN"],
      platform: "MacIntel",
      plugins: [1],
      mimeTypes: [1],
      hardwareConcurrency: 8,
      webdriver: false
    },
    location: new URL("https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0"),
    performance: {
      now: () => Date.now(),
      timing: {},
      getEntriesByType: () => [],
      measure() {},
      mark() {}
    },
    localStorage: new VmStorage(),
    sessionStorage: new VmStorage(),
    Storage: VmStorage,
    XMLHttpRequest: VmXMLHttpRequest,
    fetch: originalFetch,
    Request: VmRequest,
    Headers: VmHeaders,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 16),
    cancelAnimationFrame: clearTimeout,
    console: {
      ...console,
      error() {}
    },
    MutationObserver: function MutationObserver(callback) {
      this.observe = () => {
        if (callback) queueMicrotask(callback);
      };
      this.disconnect = () => {};
    },
    Event: function Event(type) {
      this.type = type;
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    screen: {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1055,
      colorDepth: 24,
      pixelDepth: 24
    },
    devicePixelRatio: 2
  });

  return { context: vm.createContext(window), window, captured, originalFetch };
}

export async function nodeSignRequest({ auth, url, body }) {
  if (!auth.xmst) {
    throw new Error("Missing xmst in auth.json. Run capture-auth again from a logged-in Jimeng Chrome session.");
  }
  const bdmsSource = await loadBdmsSource();
  const { context, window, captured, originalFetch } = createBdmsVmContext();
  window.localStorage.setItem("xmst", auth.xmst);
  if (auth.web_runtime_security_uid) window.localStorage.setItem("web_runtime_security_uid", auth.web_runtime_security_uid);
  if (auth.msuuid) window.localStorage.setItem("__msuuid__", auth.msuuid);
  vm.runInContext(bdmsSource, context, { filename: `bdms-${BDMS_VERSION}.js`, timeout: 5000 });
  if (!window.bdms || window.fetch === originalFetch) throw new Error("Node VM bdms did not initialize request hooks");
  window.bdms.init(bdmsInitConfig());
  await new Promise((resolve) => setTimeout(resolve, 50));
  await window.fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  const signedRequest = captured.find((entry) => entry.kind === "fetch" && entry.url.includes("/mweb/v1/aigc_draft/generate"));
  if (!signedRequest) throw new Error("Node VM bdms did not capture a signed Jimeng request");
  const signedUrl = new URL(signedRequest.url);
  if (!signedUrl.searchParams.get("msToken") || !signedUrl.searchParams.get("a_bogus")) {
    throw new Error("Node VM bdms did not add msToken/a_bogus to the request");
  }
  return {
    url: signedRequest.url,
    method: signedRequest.method || "POST",
    headers: signedRequest.headers || { "content-type": "application/json" },
    postData: signedRequest.postData
  };
}

function patchBdmsTrace(source) {
  const needle = "function K(t,e){var r=Y[t];Z.has(t)&&B.delete(Z.get(t));var n=function(){return X(r,this,arguments,e)};return Z.set(t,n),B.set(n,[r,e]),n}";
  const replacement = `function K(t,e){var r=Y[t];try{r.__id=t;globalThis.__bdmsStrings=z;globalThis.__bdmsMeta&&(globalThis.__bdmsMeta[t]||(globalThis.__bdmsMeta[t]={id:t,args:r&&r[1],strict:r&&r[2],code_len:r&&r[0]&&r[0].length,try_blocks:r&&r[3]&&r[3].length,code:r&&r[0]}))}catch(_){}Z.has(t)&&B.delete(Z.get(t));var n=function(){var a=[].slice.call(arguments),o={event:"call",id:t,args:a.map(function(v){return globalThis.__bdmsDescribe?globalThis.__bdmsDescribe(v,80):null==v?v:Array.isArray(v)?"array:"+v.length:typeof v==="object"?Object.prototype.toString.call(v):typeof v+":"+String(v).slice(0,80)})};try{globalThis.__bdmsTrace&&globalThis.__bdmsTrace.push(o);globalThis.__bdmsExecStack&&globalThis.__bdmsExecStack.push(t)}catch(_){}var ret;try{ret=X(r,this,arguments,e)}finally{try{globalThis.__bdmsExecStack&&globalThis.__bdmsExecStack.pop()}catch(_){}}try{globalThis.__bdmsTrace&&globalThis.__bdmsTrace.push({event:"return",id:t,result:globalThis.__bdmsDescribe?globalThis.__bdmsDescribe(ret,120):null==ret?ret:typeof ret==="object"?Object.prototype.toString.call(ret):typeof ret+":"+String(ret).slice(0,120)})}catch(_){}return ret};return Z.set(t,n),B.set(n,[r,e]),n}`;
  if (!source.includes(needle)) throw new Error("Unable to patch bdms VM function factory for tracing");
  source = source.replace(needle, replacement);
  const xNeedle = "function X(t,e,r,n){var o,i,u,c,a,s,f,l,p=-1,h=[],v=[];";
  const xReplacement = "function X(t,e,r,n){var o,i,u,c,a,s,f,l,p=-1,h=[],v=[],__bid;";
  if (!source.includes(xNeedle)) throw new Error("Unable to patch bdms VM executor id tracking");
  source = source.replace(xNeedle, xReplacement);
  const gNeedle = "function g(t,e,r,n){var p=Math.min(r.length,t[1]),h={};";
  const gReplacement = "function g(t,e,r,n){__bid=t&&t.__id;var p=Math.min(r.length,t[1]),h={};";
  if (!source.includes(gNeedle)) throw new Error("Unable to patch bdms VM activation id tracking");
  source = source.replace(gNeedle, gReplacement);
  const callNeedle = `var I=B.get(T);if(I)v.push([o,i,u,c,a,s,f,l]),g(I[0],C,L,I[1]);else{var q=T.apply(C,L);h[++p]=q}`;
  const callReplacement = `var I=B.get(T);try{if(globalThis.__bdmsCallsites&&globalThis.__bdmsCallsitesIds&&globalThis.__bdmsCallsitesIds[__bid]){var __vl=globalThis.__bdmsValueLimit||160;globalThis.__bdmsCallsites.push({from:__bid,pc:s-2,argc:k,to:I&&I[0]&&I[0].__id,args:L.map(function(v){return globalThis.__bdmsDescribe?globalThis.__bdmsDescribe(v,__vl):null==v?v:Array.isArray(v)?"array:"+v.length:typeof v==="function"?"function":typeof v==="object"?Object.prototype.toString.call(v):typeof v+":"+String(v).slice(0,__vl)})})}}catch(_){}if(I)v.push([o,i,u,c,a,s,f,l,__bid]),g(I[0],C,L,I[1]);else{var q=T.apply(C,L);h[++p]=q}`;
  if (!source.includes(callNeedle)) throw new Error("Unable to patch bdms VM internal call tracing");
  source = source.replace(callNeedle, callReplacement);
  const returnNeedle = "h[++p]=l,o=g[0],i=g[1],u=g[2],c=g[3],a=g[4],s=g[5],f=g[6],l=g[7],!0)";
  const returnReplacement = "h[++p]=l,o=g[0],i=g[1],u=g[2],c=g[3],a=g[4],s=g[5],f=g[6],l=g[7],__bid=g[8],!0)";
  if (!source.includes(returnNeedle)) throw new Error("Unable to patch bdms VM return id restore");
  source = source.replace(returnNeedle, returnReplacement);
  const throwReturnNeedle = "if(g=v.pop())return o=g[0],i=g[1],u=g[2],c=g[3],a=g[4],s=g[5],d();";
  const throwReturnReplacement = "if(g=v.pop())return o=g[0],i=g[1],u=g[2],c=g[3],a=g[4],s=g[5],__bid=g[8],d();";
  if (!source.includes(throwReturnNeedle)) throw new Error("Unable to patch bdms VM throw id restore");
  source = source.replace(throwReturnNeedle, throwReturnReplacement);
  const loopNeedle = "for(;;){var t=o[s++];if(t<38)";
  const loopReplacement = `for(;;){var __pc=s,t=o[s++];try{var __id=__bid,__ids=globalThis.__bdmsOpTraceIds,__min=globalThis.__bdmsOpPcMin,__max=globalThis.__bdmsOpPcMax,__vl=globalThis.__bdmsValueLimit||180;if(globalThis.__bdmsOpTrace&&__ids&&__ids[__id]&&(__min==null||__pc>=__min)&&(__max==null||__pc<=__max))globalThis.__bdmsOpTrace.push({id:__id,pc:__pc,op:t,stack:h.slice(Math.max(0,p-8),p+1).map(function(v){return globalThis.__bdmsDescribe?globalThis.__bdmsDescribe(v,__vl):null==v?v:Array.isArray(v)?"array:"+v.length:typeof v==="function"?"function":typeof v==="object"?Object.prototype.toString.call(v):typeof v+":"+String(v).slice(0,__vl)})})}catch(_){}if(t<38)`;
  if (!source.includes(loopNeedle)) throw new Error("Unable to patch bdms VM opcode loop for tracing");
  return source.replace(loopNeedle, loopReplacement);
}

export async function traceNodeSignRequest({ auth, url, body, opIds = [], opPcMin = null, opPcMax = null, valueLimit = 160 }) {
  if (!auth.xmst) {
    throw new Error("Missing xmst in auth.json. Run capture-auth again from a logged-in Jimeng Chrome session.");
  }
  const bdmsSource = patchBdmsTrace(await loadBdmsSource());
  const { context, window, captured, originalFetch } = createBdmsVmContext();
  window.__bdmsTrace = [];
  window.__bdmsMeta = {};
  window.__bdmsStrings = [];
  window.__bdmsOpTrace = [];
  window.__bdmsCallsites = [];
  window.__bdmsExecStack = [];
  window.__bdmsOpTraceIds = Object.fromEntries(opIds.map((id) => [String(id), true]));
  window.__bdmsCallsitesIds = window.__bdmsOpTraceIds;
  window.__bdmsOpPcMin = opPcMin == null ? null : Number(opPcMin);
  window.__bdmsOpPcMax = opPcMax == null ? null : Number(opPcMax);
  window.__bdmsValueLimit = Number(valueLimit || 160);
  window.__bdmsDescribe = (value, limit = 160) => {
    if (value == null) return value;
    if (Array.isArray(value)) {
      const sample = value.slice(0, Math.min(value.length, 64)).map((item) =>
        typeof item === "number" ? item : typeof item === "string" ? item.charCodeAt(0) : null
      );
      return `array:${value.length}:${sample.join(",")}`;
    }
    if (typeof value === "function") return "function";
    if (typeof value === "object") return Object.prototype.toString.call(value);
    return `${typeof value}:${String(value).slice(0, limit)}`;
  };
  window.localStorage.setItem("xmst", auth.xmst);
  if (auth.web_runtime_security_uid) window.localStorage.setItem("web_runtime_security_uid", auth.web_runtime_security_uid);
  if (auth.msuuid) window.localStorage.setItem("__msuuid__", auth.msuuid);
  vm.runInContext(bdmsSource, context, { filename: `bdms-${BDMS_VERSION}-trace.js`, timeout: 5000 });
  if (!window.bdms || window.fetch === originalFetch) throw new Error("Node VM bdms did not initialize request hooks");
  window.bdms.init(bdmsInitConfig());
  await new Promise((resolve) => setTimeout(resolve, 50));
  await window.fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  const signedRequest = captured.find((entry) => entry.kind === "fetch" && entry.url.includes("/mweb/v1/aigc_draft/generate"));
  if (!signedRequest) throw new Error("Node VM bdms did not capture a signed Jimeng request");
  const counts = {};
  for (const entry of window.__bdmsTrace) {
    if (entry.event !== "call") continue;
    counts[entry.id] = (counts[entry.id] || 0) + 1;
  }
  return {
    signedRequest,
    trace: window.__bdmsTrace,
    opTrace: window.__bdmsOpTrace,
    callsites: window.__bdmsCallsites,
    meta: window.__bdmsMeta,
    strings: window.__bdmsStrings,
    counts: Object.fromEntries(Object.entries(counts).sort((left, right) => Number(left[0]) - Number(right[0])))
  };
}

export async function algorithmSignRequest({ auth, url, body, fallback = true }) {
  try {
    return algorithmSignCandidate({ auth, url, body });
  } catch (error) {
    if (!fallback) throw error;
    const signedRequest = await nodeSignRequest({ auth, url, body });
    return {
      ...signedRequest,
      algorithm: {
        ok: false,
        fallback: "node-sign",
        code: error.code || "E_ALGORITHM_SIGN",
        message: error.message,
        details: error.details
      }
    };
  }
}

export async function compareAlgorithmSignRequest({ auth, url, body }) {
  const signedRequest = await nodeSignRequest({ auth, url, body });
  return compareAlgorithmCandidate({ auth, url, body, signedRequest });
}

export async function createBdmsFixture({ auth, url, body, name = "default", meta = {} }) {
  const signedRequest = await nodeSignRequest({ auth, url, body });
  return writeBdmsFixture({ name, auth, url, body, signedRequest, meta });
}

export async function requestSignedJson(auth, uri, signedRequest, { referer, redact = true } = {}) {
  const response = await fetch(signedRequest.url, {
    method: signedRequest.method || "POST",
    headers: normalizeSignedHeaders(signedRequest.headers || {}, auth, referer),
    body: signedRequest.postData
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
