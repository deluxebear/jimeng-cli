import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { DRAFT_VERSION, requestJson } from "./client.mjs";

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

function jobsPath() {
  return join(homedir(), ".jimeng-cli", "jobs.jsonl");
}

function defaultOutputPath(opts, item, fallbackType) {
  const outputDir = opts["output-dir"] ?? opts.output_dir ?? "outputs";
  const extension = String(item?.format || fallbackType || "bin").replace(/^\./, "") || "bin";
  return join(outputDir, `${fallbackType || item?.type || "media"}-${opts["history-id"]}-${opts.index || 0}.${extension}`);
}

function redact(value) {
  if (!value) return value;
  if (value.length <= 10) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export async function checkImage(auth, historyId) {
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

export async function checkMedia(auth, historyId) {
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

export async function checkQueue(auth, historyId) {
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

export function historyRequestBody(opts = {}) {
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

export function inferHistoryType(record) {
  if ((record.item_list || []).some((item) => item.video)) return "video";
  if ((record.item_list || []).some((item) => item.audio)) return "audio";
  if ((record.item_list || []).some((item) => item.image)) return "image";
  if (record.generate_type === 10) return "video";
  if (record.generate_type === 44 || record.generate_type === 7) return "audio";
  return "media";
}

export function summarizeHistoryListRecord(record) {
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

export async function listHistory(auth, opts = {}) {
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

export async function downloadImage(auth, opts) {
  const historyId = opts["history-id"];
  if (!historyId || historyId === true) throw new Error("--history-id is required");
  const index = Number(opts.index || 0);
  if (!Number.isInteger(index) || index < 0) throw new Error("--index must be a non-negative integer");
  let output = opts.output;

  const result = await requestJson(auth, "POST", "/mweb/v1/get_history_by_ids", {
    data: { history_ids: [historyId], image_info: IMAGE_INFO },
    redact: false
  });
  const record = result.parsed?.[historyId];
  const images = primaryImages(record);
  const image = images[index];
  if (!image) throw new Error(`No image at index ${index}; available count: ${images.length}`);
  if (!output || output === true) output = defaultOutputPath(opts, image, "image");

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

export async function downloadMedia(auth, opts) {
  const historyId = opts["history-id"];
  if (!historyId || historyId === true) throw new Error("--history-id is required");
  const index = Number(opts.index || 0);
  if (!Number.isInteger(index) || index < 0) throw new Error("--index must be a non-negative integer");
  let output = opts.output;
  const result = await requestJson(auth, "POST", "/mweb/v1/get_history_by_ids", {
    data: { history_ids: [historyId], image_info: IMAGE_INFO },
    redact: false
  });
  const record = result.parsed?.[historyId];
  const media = primaryMedia(record);
  const item = media[index];
  if (!item) throw new Error(`No media at index ${index}; available count: ${media.length}`);
  if (!output || output === true) output = defaultOutputPath(opts, item, item.type || "media");
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

export function primaryImages(record) {
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

export function primaryMedia(record) {
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

export function summarizeHistoryRecord(record) {
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

export function extractImageUrls(items) {
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

export async function waitImage(auth, opts) {
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

export async function waitMedia(auth, opts) {
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

export async function download(url, output) {
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

export function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.slice(0, 48)}...[redacted]`;
  } catch {
    return redact(value);
  }
}

export function withDefaultSigner(opts) {
  if (opts["node-sign"] || opts["local-sign"] || opts["browser-sign"] || opts["no-sign"]) return opts;
  return { ...opts, "node-sign": true };
}

export async function appendJob({ type, result, opts, profile }) {
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

export async function readJobs(limit = 20) {
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

export async function listJobs(opts = {}) {
  return { ok: true, jobs: await readJobs(Number(opts.limit || 20)) };
}

export async function addJob(opts, profile) {
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

export async function syncJobs(auth, opts, profile) {
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

export async function statusJobs(auth, opts = {}) {
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

export async function runMediaWorkflow(auth, opts, createFn, waitFn, downloadFn) {
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
