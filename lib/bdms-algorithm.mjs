import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const ALGORITHM_SIGN_STATUS = "incomplete";
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
  const canonical = canonicalizeBdmsInput({ url, body });
  const signedUrl = new URL(url.toString());
  if (!auth.xmst) {
    const error = new Error("Missing xmst; cannot derive msToken candidate");
    error.code = "E_ALGORITHM_SIGN_INCOMPLETE";
    error.details = { missing: ["xmst"], canonical };
    throw error;
  }

  signedUrl.searchParams.set("msToken", auth.xmst);

  const error = new Error("Pure JS bdms algorithm signer is incomplete: a_bogus generation is not implemented yet");
  error.code = "E_ALGORITHM_SIGN_INCOMPLETE";
  error.details = {
    status: ALGORITHM_SIGN_STATUS,
    implemented: ["canonicalize_request", "msToken_from_xmst"],
    missing: ["a_bogus_fn150_translation"],
    canonical,
    candidate: {
      url: signedUrl.toString(),
      method: "POST",
      headers: { "content-type": "application/json" },
      postData: JSON.stringify(body)
    }
  };
  throw error;
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
  return {
    ok: !error && vmMsToken === candidateMsToken && vmABogus === candidateABogus,
    status: error ? "incomplete" : "complete",
    implemented: error?.details?.implemented || ["canonicalize_request", "msToken_from_xmst", "a_bogus"],
    missing: error?.details?.missing || [],
    canonical: canonicalizeBdmsInput({ url, body }),
    compare: {
      msToken_match: Boolean(vmMsToken) && vmMsToken === candidateMsToken,
      a_bogus_match: Boolean(vmABogus) && vmABogus === candidateABogus,
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
