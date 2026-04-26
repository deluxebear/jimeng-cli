import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const ALGORITHM_SIGN_STATUS = "incomplete";

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
