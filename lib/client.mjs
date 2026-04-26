import { createHash, randomUUID } from "node:crypto";

export const VERSION_CODE = "8.4.0";
export const PLATFORM_CODE = "7";
export const WEB_VERSION = "7.5.0";
export const DA_VERSION = "3.3.9";
export const DRAFT_VERSION = "3.3.14";
export const BASE_URL_CN = "https://jimeng.jianying.com";
export const DEFAULT_ASSISTANT_ID_CN = 513695;

const CLIENT_CONFIG = {
  retry_count: 0,
  retry_delay_ms: 500
};

export function configureClient(config = {}) {
  if (config.retry_count !== undefined) CLIENT_CONFIG.retry_count = Number(config.retry_count) || 0;
  if (config.retry_delay_ms !== undefined) CLIENT_CONFIG.retry_delay_ms = Number(config.retry_delay_ms) || 0;
}

export function uuid(noDash = false) {
  const id = randomUUID();
  return noDash ? id.replaceAll("-", "") : id;
}

export function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

export function md5(input) {
  return createHash("md5").update(input).digest("hex");
}

export function redact(value) {
  if (!value) return value;
  if (value.length <= 10) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function redactObject(value) {
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

export function generateCookie(sessionid) {
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

export function makeUrl(uri, params = {}, noDefaultParams = false) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestJson(auth, method, uri, { data = {}, params = {}, headers = {}, noDefaultParams = false, redact: shouldRedact = true } = {}) {
  let response;
  let lastError;
  const attempts = Math.max(0, CLIENT_CONFIG.retry_count) + 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const deviceTime = unixTimestamp();
    const sign = md5(`9e2c|${uri.slice(-7)}|${PLATFORM_CODE}|${VERSION_CODE}|${deviceTime}||11ac`);
    const url = makeUrl(uri, params, noDefaultParams);
    try {
      response = await fetch(url, {
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
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) break;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await sleep(CLIENT_CONFIG.retry_delay_ms * attempt);
  }
  if (!response) throw lastError || new Error("request failed");
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, endpoint: uri, parsed: shouldRedact ? redactObject(parsed) : parsed };
  }
  if (parsed && typeof parsed === "object" && "ret" in parsed && parsed.ret !== "0") {
    return { ok: false, status: response.status, endpoint: uri, parsed: shouldRedact ? redactObject(parsed) : parsed };
  }
  const body = parsed.data ?? parsed;
  return { ok: true, status: response.status, endpoint: uri, parsed: shouldRedact ? redactObject(body) : body };
}
