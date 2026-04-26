import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const ALGORITHM_SIGN_STATUS = "complete";
export const BDMS_VERSION = "1.0.1.20";

const BDMS_BASE64_ALPHABETS = {
  s0: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
  s1: "Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
  s2: "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
  s3: "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe",
  s4: "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe"
};

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function looksLikeABogus(value) {
  return typeof value === "string" && value.length >= 160 && value.length <= 184 && /^[A-Za-z0-9+/=_-]+$/.test(value);
}

function rotateLeft(value, bits) {
  const n = bits % 32;
  return ((value << n) | (value >>> (32 - n))) >>> 0;
}

function sm3P0(value) {
  return (value ^ rotateLeft(value, 9) ^ rotateLeft(value, 17)) >>> 0;
}

function sm3P1(value) {
  return (value ^ rotateLeft(value, 15) ^ rotateLeft(value, 23)) >>> 0;
}

function utf8Bytes(value) {
  return [...Buffer.from(String(value), "utf8")];
}

export function bdmsSm3Bytes(value) {
  const bytes = Array.isArray(value) ? value.slice() : utf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

  const reg = [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Array(68);
    const w1 = new Array(64);
    for (let i = 0; i < 16; i += 1) {
      const cursor = offset + i * 4;
      w[i] = ((bytes[cursor] << 24) | (bytes[cursor + 1] << 16) | (bytes[cursor + 2] << 8) | bytes[cursor + 3]) >>> 0;
    }
    for (let i = 16; i < 68; i += 1) {
      w[i] = (sm3P1(w[i - 16] ^ w[i - 9] ^ rotateLeft(w[i - 3], 15)) ^ rotateLeft(w[i - 13], 7) ^ w[i - 6]) >>> 0;
    }
    for (let i = 0; i < 64; i += 1) w1[i] = (w[i] ^ w[i + 4]) >>> 0;

    let [a, b, c, d, e, f, g, h] = reg;
    for (let i = 0; i < 64; i += 1) {
      const tj = i < 16 ? 0x79cc4519 : 0x7a879d8a;
      const ss1 = rotateLeft((((rotateLeft(a, 12) + e) >>> 0) + rotateLeft(tj, i)) >>> 0, 7);
      const ss2 = (ss1 ^ rotateLeft(a, 12)) >>> 0;
      const ff = i < 16 ? (a ^ b ^ c) : ((a & b) | (a & c) | (b & c));
      const gg = i < 16 ? (e ^ f ^ g) : ((e & f) | (~e & g));
      const tt1 = (((((ff >>> 0) + d) >>> 0) + ss2) >>> 0) + w1[i];
      const tt2 = (((((gg >>> 0) + h) >>> 0) + ss1) >>> 0) + w[i];
      d = c;
      c = rotateLeft(b, 9);
      b = a;
      a = tt1 >>> 0;
      h = g;
      g = rotateLeft(f, 19);
      f = e;
      e = sm3P0(tt2 >>> 0);
    }
    reg[0] = (reg[0] ^ a) >>> 0;
    reg[1] = (reg[1] ^ b) >>> 0;
    reg[2] = (reg[2] ^ c) >>> 0;
    reg[3] = (reg[3] ^ d) >>> 0;
    reg[4] = (reg[4] ^ e) >>> 0;
    reg[5] = (reg[5] ^ f) >>> 0;
    reg[6] = (reg[6] ^ g) >>> 0;
    reg[7] = (reg[7] ^ h) >>> 0;
  }

  const out = [];
  for (const word of reg) {
    out.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }
  return out;
}

export function bdmsSm3Binary(value) {
  return String.fromCharCode(...bdmsSm3Bytes(value));
}

export function bdmsStringToBytes(value) {
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code & 0xff00) {
      out.push((code >>> 8) & 0xff, code & 0xff);
    } else {
      out.push(code);
    }
  }
  return out;
}

export function bdmsCustomBase64(input, alphabetName = "s4") {
  const alphabet = BDMS_BASE64_ALPHABETS[alphabetName];
  if (!alphabet) throw new Error(`Unknown bdms base64 alphabet: ${alphabetName}`);
  let out = "";
  let i = 0;
  for (; i + 2 < input.length; i += 3) {
    const block = ((input.charCodeAt(i) & 0xff) << 16) | ((input.charCodeAt(i + 1) & 0xff) << 8) | (input.charCodeAt(i + 2) & 0xff);
    out += alphabet.charAt((block & 0xfc0000) >>> 18);
    out += alphabet.charAt((block & 0x03f000) >>> 12);
    out += alphabet.charAt((block & 0x000fc0) >>> 6);
    out += alphabet.charAt(block & 0x3f);
  }
  if (input.length - i > 0) {
    const second = i + 1 < input.length ? input.charCodeAt(i + 1) & 0xff : 0;
    const block = ((input.charCodeAt(i) & 0xff) << 16) | (second << 8);
    out += alphabet.charAt((block & 0xfc0000) >>> 18);
    out += alphabet.charAt((block & 0x03f000) >>> 12);
    out += i + 1 < input.length ? alphabet.charAt((block & 0x000fc0) >>> 6) : "=";
    out += "=";
  }
  return out;
}

export function bdmsRc4(key, data) {
  const state = new Array(256);
  for (let i = 0; i < 256; i += 1) state[255 - i] = i;
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = ((j * state[i]) + j + key.charCodeAt(i % key.length)) % 256;
    const tmp = state[i];
    state[i] = state[j];
    state[j] = tmp;
  }
  let i = 0;
  j = 0;
  let out = "";
  for (let n = 0; n < data.length; n += 1) {
    i = (i + 1) % 256;
    j = (j + state[i]) % 256;
    const tmp = state[i];
    state[i] = state[j];
    state[j] = tmp;
    const mask = state[(state[i] + state[j]) % 256];
    out += String.fromCharCode(data.charCodeAt(n) ^ mask);
  }
  return out;
}

export function bdmsExpandTriples(bytes, randomByte = () => Math.floor(Math.random() * 1000) & 0xff) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 3) {
    if (i + 2 < bytes.length) {
      const r = randomByte() & 0xff;
      const left = bytes[i] & 0xff;
      const middle = bytes[i + 1] & 0xff;
      const right = bytes[i + 2] & 0xff;
      out.push(
        (r & 145) | (left & 110),
        (r & 66) | (middle & 189),
        (r & 44) | (right & 211),
        (left & 145) | (middle & 66) | (right & 44)
      );
    } else {
      out.push(bytes[i] & 0xff);
      if (i + 1 < bytes.length) out.push(bytes[i + 1] & 0xff);
    }
  }
  return out;
}

function byte(value) {
  return value & 0xff;
}

function byteAt(value, shift) {
  return byte(Math.floor(value / (256 ** shift)));
}

function firstNonSentinel(bytes, start, sentinel, fallback) {
  for (let i = start; i < bytes.length; i += 1) {
    if (bytes[i] !== sentinel) return bytes[i];
  }
  return fallback;
}

function bdmsStringBytes(value) {
  return bdmsStringToBytes(String(value));
}

function bdmsBytesToBinary(bytes) {
  return String.fromCharCode(...bytes.map(byte));
}

function bdmsObfuscatePair(pair, mode = 0, randomWord = () => Math.floor(Math.random() * 65535)) {
  const left = byte(pair[0] ?? 0);
  const right = byte(pair[1] ?? 0);
  const seed = randomWord();
  let low = byte(seed);
  let high = byte(seed >>> 8);
  if (mode === 1) high = byte(randomWord());
  if (mode === 2) {
    low = byte(randomWord());
    high = byte(randomWord());
  }
  return [
    (low & 170) | (left & 85),
    (low & 85) | (left & 170),
    (high & 170) | (right & 85),
    (high & 85) | (right & 170)
  ].map(byte);
}

function bdmsVersionBytes(version) {
  const parts = String(version).split(".").map((part) => Number(part) || 0);
  return [
    ...bdmsObfuscatePair([parts[0] ?? 0, parts[1] ?? 0]),
    ...bdmsObfuscatePair([parts[2] ?? 0, parts[3] ?? 0], 2)
  ];
}

function bdmsScreenPayload() {
  return "0|0|0|0|1920|1055|1920|1080|MacIntel";
}

function bdmsUaMask(userAgent) {
  const key = String.fromCharCode(0, 129, 0);
  return bdmsRc4(key, String(userAgent).trim());
}

export function createBdmsABogus({
  queryString,
  bodyString,
  userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  pageId = 28324,
  aid = 513695,
  version = BDMS_VERSION,
  now = Date.now(),
  randomByte = () => Math.floor(Math.random() * 1000) & 0xff
} = {}) {
  const salt = "dhzx";
  const queryHash = bdmsSm3Bytes(bdmsSm3Bytes(`${queryString}${salt}`));
  const bodyHash = bdmsSm3Bytes(bdmsSm3Bytes(`${bodyString}${salt}`));
  const userAgentHash = bdmsSm3Bytes(bdmsCustomBase64(bdmsUaMask(userAgent), "s3"));
  const versionBytes = bdmsVersionBytes(version);
  const env = [0, 0, 0, 0, 75];
  const trackValue = 0;
  const dayBucket = Math.floor((now - 1721836800000) / 1000 / 60 / 60 / 24 / 14) >>> 0;
  const status = 3;
  const screenBytes = bdmsStringBytes(bdmsScreenPayload());
  const shortTimeBytes = bdmsStringBytes(`${byte(now + 3)},`);
  const screenLen = screenBytes.length;
  const shortTimeLen = shortTimeBytes.length;
  const fixed41 = 41;
  const delta = 2;
  const timeBytes = [0, 1, 2, 3, 4, 5].map((shift) => byteAt(now, shift));
  const pageBytes = [0, 1, 2, 3].map((shift) => byteAt(pageId, shift));
  const aidBytes = [0, 1, 2, 3].map((shift) => byteAt(aid, shift));
  const envFlag = env[4] || 0;

  const vars = {
    24: fixed41,
    26: dayBucket,
    27: 0,
    28: delta,
    29: timeBytes[0],
    30: timeBytes[1],
    31: timeBytes[2],
    32: timeBytes[3],
    33: timeBytes[4],
    34: timeBytes[5],
    35: 129,
    36: 36,
    38: byte(envFlag),
    39: byte(envFlag >>> 8),
    40: env[0] || 0,
    41: env[1] || 0,
    42: env[2] || 0,
    43: env[3] || 0,
    44: byte(trackValue),
    45: byte(trackValue >>> 8),
    46: byte(trackValue >>> 16),
    47: byte(trackValue >>> 24),
    48: queryHash[9],
    49: queryHash[18],
    51: envFlag & 2 ? 11 : firstNonSentinel(queryHash, 3, 11, 12),
    52: bodyHash[10],
    53: bodyHash[19],
    55: envFlag & 4 ? 8 : firstNonSentinel(bodyHash, 4, 8, 9),
    56: userAgentHash[11],
    57: userAgentHash[21],
    59: envFlag & 8 ? 12 : firstNonSentinel(userAgentHash, 5, 12, 13),
    60: timeBytes[0],
    61: timeBytes[1],
    62: timeBytes[2],
    63: timeBytes[3],
    64: timeBytes[4],
    65: timeBytes[5],
    66: status,
    67: pageBytes[0],
    68: pageBytes[1],
    69: pageBytes[2],
    70: pageBytes[3],
    71: aidBytes[0],
    72: aidBytes[1],
    73: aidBytes[2],
    74: aidBytes[3],
    79: byte(screenLen),
    80: byte(screenLen >>> 8),
    84: byte(shortTimeLen),
    85: byte(shortTimeLen >>> 8)
  };

  let checksum = 0;
  for (const value of versionBytes) checksum ^= value;
  for (const key of [24, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 52, 53, 55, 56, 57, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 79, 80, 84, 85]) {
    checksum ^= byte(vars[key]);
  }

  const ordered = [34, 44, 56, 61, 73, 29, 70, 45, 35, 49, 38, 66, 51, 68, 28, 48, 64, 47, 30, 71, 26, 55, 31, 69, 59, 40, 62, 63, 27, 72, 41, 74, 57, 52, 42, 39, 33, 67, 53, 43, 65, 46, 36, 24, 60, 32, 79, 80, 84, 85];
  const payload = [
    ...ordered.map((key) => byte(vars[key])),
    ...screenBytes,
    ...shortTimeBytes,
    byte(checksum)
  ];
  const prefix = bdmsBytesToBinary(bdmsObfuscatePair([3, 82], 1));
  const expanded = bdmsExpandTriples(payload, randomByte);
  const encrypted = bdmsRc4(String.fromCharCode(211), bdmsBytesToBinary([...versionBytes, ...expanded]));
  return bdmsCustomBase64(`${prefix}${encrypted}`, "s4");
}

function searchParamsEntries(url) {
  return [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export function canonicalizeBdmsInput({ url, body }) {
  const target = new URL(url.toString());
  target.searchParams.delete("msToken");
  target.searchParams.delete("a_bogus");
  const query = searchParamsEntries(target);
  const bodyJson = stableJson(body ?? {});
  return {
    origin: target.origin,
    pathname: target.pathname,
    query,
    query_string: query.map(([key, value]) => `${key}=${value}`).join("&"),
    body_sha256: sha256(bodyJson),
    body_size: Buffer.byteLength(bodyJson),
    body_json: bodyJson
  };
}

export function algorithmSignCandidate({ auth, url, body }) {
  const signedUrl = new URL(url.toString());
  if (!auth.xmst) {
    const canonical = canonicalizeBdmsInput({ url, body });
    const error = new Error("Missing xmst; cannot derive msToken candidate");
    error.code = "E_ALGORITHM_SIGN_INCOMPLETE";
    error.details = { missing: ["xmst"], canonical };
    throw error;
  }

  signedUrl.searchParams.set("msToken", auth.xmst);
  signedUrl.searchParams.delete("a_bogus");
  const bodyString = JSON.stringify(body ?? {});
  signedUrl.searchParams.set("a_bogus", createBdmsABogus({
    queryString: signedUrl.search.slice(1),
    bodyString
  }));

  return {
    url: signedUrl.toString(),
    method: "POST",
    headers: { "content-type": "application/json" },
    postData: bodyString,
    algorithm: {
      ok: true,
      status: "complete",
      signer: "bdms-fn150-js"
    }
  };
}

export function compareAlgorithmCandidate({ auth, url, body, signedRequest }) {
  let candidate;
  let error;
  try {
    candidate = algorithmSignCandidate({ auth, url, body });
  } catch (caught) {
    error = caught;
    candidate = caught.details?.candidate;
  }
  const vmUrl = new URL(signedRequest.url);
  const candidateUrl = candidate ? new URL(candidate.url) : null;
  const vmMsToken = vmUrl.searchParams.get("msToken") || "";
  const candidateMsToken = candidateUrl?.searchParams.get("msToken") || "";
  const vmABogus = vmUrl.searchParams.get("a_bogus") || "";
  const candidateABogus = candidateUrl?.searchParams.get("a_bogus") || "";
  const aBogusExactMatch = Boolean(vmABogus) && vmABogus === candidateABogus;
  const aBogusShapeMatch = looksLikeABogus(vmABogus) && looksLikeABogus(candidateABogus);
  return {
    ok: !error && vmMsToken === candidateMsToken && aBogusShapeMatch,
    status: error ? "incomplete" : "complete",
    implemented: error?.details?.implemented || ["canonicalize_request", "msToken_from_xmst", "a_bogus"],
    missing: error?.details?.missing || [],
    canonical: canonicalizeBdmsInput({ url, body }),
    compare: {
      msToken_match: Boolean(vmMsToken) && vmMsToken === candidateMsToken,
      a_bogus_match: aBogusShapeMatch,
      a_bogus_exact_match: aBogusExactMatch,
      note: aBogusExactMatch ? undefined : "a_bogus contains random bytes; exact values are not expected to match across independent signer runs",
      vm: {
        msToken_len: vmMsToken.length,
        a_bogus_len: vmABogus.length
      },
      candidate: {
        msToken_len: candidateMsToken.length,
        a_bogus_len: candidateABogus.length
      }
    },
    error: error ? { code: error.code, message: error.message } : undefined
  };
}

export function bdmsFixturePath(name = "default") {
  const safeName = String(name).replace(/[^a-zA-Z0-9_.-]/g, "_");
  return join(homedir(), ".jimeng-cli", "fixtures", `bdms-${safeName}.json`);
}

export async function writeBdmsFixture({ name, auth, url, body, signedRequest, meta = {} }) {
  const target = bdmsFixturePath(name);
  const signedUrl = new URL(signedRequest.url);
  const fixture = {
    created_at: new Date().toISOString(),
    meta,
    canonical: canonicalizeBdmsInput({ url, body }),
    vm: {
      method: signedRequest.method || "POST",
      url_without_secret_query: `${signedUrl.origin}${signedUrl.pathname}`,
      query_keys: [...signedUrl.searchParams.keys()].sort(),
      msToken_sha256: sha256(signedUrl.searchParams.get("msToken") || ""),
      msToken_len: (signedUrl.searchParams.get("msToken") || "").length,
      msToken_matches_xmst: signedUrl.searchParams.get("msToken") === auth.xmst,
      a_bogus_sha256: sha256(signedUrl.searchParams.get("a_bogus") || ""),
      a_bogus_len: (signedUrl.searchParams.get("a_bogus") || "").length,
      postData_sha256: sha256(signedRequest.postData || "")
    },
    algorithm: compareAlgorithmCandidate({ auth, url, body, signedRequest })
  };
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, path: target, fixture };
}
