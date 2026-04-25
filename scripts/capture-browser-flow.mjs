#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const require = createRequire("/Users/xiongyanlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const { chromium } = require("playwright");

const args = parseArgs(process.argv.slice(2));
const port = args.port || "9222";
const output = args.output || "captures/browser-flow.json";
const fullOutput = args["full-output"];
const keepFullStrings = Boolean(fullOutput);
const mode = args.mode || "manual";
const prompt = args.prompt || "参考图中的橙色机器人主体保持一致，换成绿色桌面，近景半身构图，干净白色背景，3D 渲染质感";
const referenceImage = args["reference-image"] || "outputs/jimeng-cli-download-0.png";

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
let page = context.pages().find((candidate) => candidate.url().includes("jimeng.jianying.com/ai-tool/generate"));
if (!page) {
  page = await context.newPage();
  await page.goto("https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0", { waitUntil: "domcontentloaded" });
}

const captures = [];
page.on("request", async (request) => {
  const url = request.url();
  if (!isRelevant(url)) return;
  let postData = null;
  try {
    postData = request.postData();
  } catch {}
  captures.push({
    kind: "request",
    ts: new Date().toISOString(),
    method: request.method(),
    url: redactUrl(url),
    rawUrlPath: pathOnly(url),
    headers: redactHeaders(request.headers()),
    postData: summarizeBody(postData, { redactUris: !fullOutput, keepFullStrings })
  });
});

page.on("response", async (response) => {
  const url = response.url();
  if (!isRelevant(url)) return;
  let body = null;
  const contentType = response.headers()["content-type"] || "";
  if (contentType.includes("application/json")) {
    try {
      body = summarizeJson(await response.json(), { redactUris: !fullOutput, keepFullStrings });
    } catch {}
  }
  captures.push({
    kind: "response",
    ts: new Date().toISOString(),
    status: response.status(),
    url: redactUrl(url),
    rawUrlPath: pathOnly(url),
    body
  });
});

let error = null;
try {
  if (mode === "auto") {
    await page.goto("https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await ensureImageMode(page);
    await uploadReference(page, referenceImage);
    await fillPrompt(page, prompt);
    await page.waitForTimeout(1000);
    await clickGenerate(page);
    await page.waitForTimeout(Number(args["wait-ms"] || 20000));
  } else if (mode === "regen") {
    const buttons = page.getByText("再次生成", { exact: true });
    const count = await buttons.count();
    if (!count) throw new Error("No 再次生成 button found");
    await buttons.nth(Number(args.index || 0)).click();
    await page.waitForTimeout(Number(args["wait-ms"] || 45000));
  } else {
    console.log(JSON.stringify({
      ok: true,
      mode,
      message: "Capture is running. Perform the browser actions now; this process will save after wait-ms.",
      url: page.url()
    }, null, 2));
    await page.waitForTimeout(Number(args["wait-ms"] || 90000));
  }
} catch (caught) {
  error = caught;
} finally {
  await mkdir(dirname(output), { recursive: true });
  if (fullOutput) {
    await mkdir(dirname(fullOutput), { recursive: true });
    await writeFile(fullOutput, JSON.stringify({
      ok: !error,
      mode,
      output: fullOutput,
      count: captures.length,
      error: error ? error.message : undefined,
      captures
    }, null, 2));
  }
  await writeFile(output, JSON.stringify({
    ok: !error,
    mode,
    output,
    count: captures.length,
    error: error ? error.message : undefined,
    captures
  }, null, 2));
  console.log(JSON.stringify({ ok: !error, output, count: captures.length, error: error ? error.message : undefined }, null, 2));
  await browser.close();
  if (error) process.exitCode = 1;
}

async function ensureImageMode(page) {
  const snapshot = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (snapshot.includes("图片生成")) return;
  const modeButton = page.getByText(/Agent 模式|视频生成|图片生成/).last();
  await modeButton.click({ timeout: 5000 }).catch(() => {});
  await page.getByText("图片生成", { exact: true }).click({ timeout: 5000 }).catch(() => {});
}

async function uploadReference(page, filePath) {
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
  const plus = page.locator("input[type=file]");
  if (await plus.count()) {
    await plus.first().setInputFiles(filePath);
    await page.waitForTimeout(3000);
    return;
  }
  await page.mouse.click(474, 783);
  const chooser = await chooserPromise;
  if (!chooser) throw new Error("No file chooser appeared for reference upload");
  await chooser.setFiles(filePath);
  await page.waitForTimeout(5000);
}

async function fillPrompt(page, value) {
  const boxes = page.getByRole("textbox");
  const count = await boxes.count();
  const box = count > 1 ? boxes.nth(count - 1) : boxes.first();
  await box.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type(value);
}

async function clickGenerate(page) {
  const before = await page.locator("body").innerText().catch(() => "");
  const submit = page.locator("button").last();
  await submit.click({ timeout: 5000 }).catch(async () => {
    await page.mouse.click(1092, 868);
  });
  await page.waitForTimeout(3000);
  const after = await page.locator("body").innerText().catch(() => "");
  if (before === after) {
    await page.mouse.click(1092, 868);
  }
}

function isRelevant(url) {
  return /jimeng\.jianying\.com|imagex|byteimg|byteacct|capcut/.test(url) &&
    /(aigc|upload|image|history|algo_proxy|generate|proof|token|ApplyImageUpload|CommitImageUpload)/i.test(url);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function pathOnly(value) {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}`;
  } catch {
    return value;
  }
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|sign|auth|session|key|credential|x-amz|uid|user|im_extra/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

function redactHeaders(headers) {
  const keep = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/cookie|authorization|token|x-amz-security-token/i.test(key)) keep[key] = "[redacted]";
    else if (/content-type|origin|referer|accept|app|device|sign|tdid|lan|loc|pf/i.test(key)) keep[key] = String(value).slice(0, 300);
  }
  return keep;
}

function summarizeBody(body, options = {}) {
  if (!body) return null;
  if (body.length > 500000) return { type: "large", bytes: body.length };
  try {
    return summarizeJson(JSON.parse(body), options);
  } catch {
    return body.slice(0, 2000);
  }
}

function summarizeJson(value, options = {}) {
  return redactDeep(value, 0, options);
}

function redactDeep(value, depth, options = {}) {
  if (depth > 10) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => redactDeep(item, depth + 1, options));
  if (!value || typeof value !== "object") {
    if (!options.keepFullStrings && typeof value === "string" && value.length > 500) return `${value.slice(0, 180)}...[${value.length} chars]`;
    return value;
  }
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/cookie|token|authorization|session|mobile|phone|email|signed|access_key|secret|auth|url/i.test(key) || (options.redactUris !== false && /uri/i.test(key))) {
      out[key] = typeof nested === "string" ? `${nested.slice(0, 12)}...[redacted]` : "[redacted]";
    } else {
      out[key] = redactDeep(nested, depth + 1, options);
    }
  }
  return out;
}
