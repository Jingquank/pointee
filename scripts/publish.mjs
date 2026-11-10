#!/usr/bin/env node
// Publish Pointee to the Chrome Web Store through the store's V2 API.
//
//   node scripts/publish.mjs            run the tests, build, upload the zip. Stops there.
//   node scripts/publish.mjs --submit   the same, then submit the upload for review.
//   node scripts/publish.mjs --status   only report what the store currently holds.
//
// Uploading is safe to repeat: it replaces the draft and nothing reaches
// users. Submitting is the step that cannot be taken back casually — once the
// review passes, the update goes to everyone who has Pointee installed — so it
// is never the default.
//
// Credentials stay out of the repository. The script reads one file,
//   ~/.config/pointee-publish/config.json
//     { "publisherId": "...", "extensionId": "...", "keyFile": "/absolute/path/to/service-account-key.json" }
// (or POINTEE_PUBLISH_CONFIG to point elsewhere). The key is a Google Cloud
// service account's JSON key; that account's email must be added in the
// Developer Dashboard under Account. See docs: developer.chrome.com/docs/webstore/service-accounts

import { createSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ZIP = join(ROOT, "dist", "pointee-chrome.zip");
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const API = "https://chromewebstore.googleapis.com";

const args = new Set(process.argv.slice(2));
const known = ["--submit", "--status", "--skip-tests"];
for (const a of args) if (!known.includes(a)) fail(`Unknown option ${a}. Options: ${known.join(", ")}`);

function fail(message) {
  console.error(`publish: ${message}`);
  process.exit(1);
}

function loadConfig() {
  const path = process.env.POINTEE_PUBLISH_CONFIG || join(homedir(), ".config", "pointee-publish", "config.json");
  if (!existsSync(path)) fail(`no config at ${path}. It needs publisherId, extensionId and keyFile.`);
  const config = JSON.parse(readFileSync(path, "utf8"));
  for (const key of ["publisherId", "extensionId", "keyFile"]) if (!config[key]) fail(`${path} is missing "${key}".`);
  if (!existsSync(config.keyFile)) fail(`the key file ${config.keyFile} does not exist.`);
  return { ...config, key: JSON.parse(readFileSync(config.keyFile, "utf8")) };
}

// A service account signs a short-lived claim with its private key and trades
// it for an access token; nothing long-lived but the key file is ever stored.
async function accessToken(key) {
  const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: key.client_email, scope: SCOPE, aud: key.token_uri, iat: now, exp: now + 600 };
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claim)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const response = await fetch(key.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) fail(`could not get an access token (${response.status}): ${body.error_description || body.error || "no detail"}`);
  return body.access_token;
}

async function call(token, method, url, body) {
  const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}` }, body });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!response.ok) fail(`${method} ${url.replace(API, "")} failed (${response.status}): ${json?.error?.message || text.slice(0, 300)}`);
  return json ?? {};
}

const item = (config) => `publishers/${config.publisherId}/items/${config.extensionId}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const config = loadConfig();
const version = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")).version;
const token = await accessToken(config.key);

if (args.has("--status")) {
  console.log(JSON.stringify(await call(token, "GET", `${API}/v2/${item(config)}:fetchStatus`), null, 2));
  process.exit(0);
}

if (!args.has("--skip-tests")) {
  console.log("publish: running the tests");
  execFileSync("node", ["test/all.mjs"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
}
console.log("publish: building");
execFileSync("./build.sh", { cwd: ROOT, stdio: "ignore" });
const packed = JSON.parse(execFileSync("unzip", ["-p", ZIP, "manifest.json"], { encoding: "utf8" })).version;
if (packed !== version) fail(`the zip holds ${packed}, manifest.json says ${version}.`);

console.log(`publish: uploading ${version}`);
let upload = await call(token, "POST", `${API}/upload/v2/${item(config)}:upload`, readFileSync(ZIP));
for (let i = 0; i < 30 && upload.uploadState === "IN_PROGRESS"; i++) {
  await sleep(2000);
  upload = await call(token, "GET", `${API}/v2/${item(config)}:fetchStatus`);
  upload.uploadState = upload.lastAsyncUploadState ?? upload.uploadState;
}
console.log(`publish: upload ${upload.uploadState ?? "finished"}${upload.crxVersion ? `, the store now holds ${upload.crxVersion}` : ""}`);
if (upload.uploadState && !["SUCCEEDED", "UPLOAD_STATE_UNSPECIFIED"].includes(upload.uploadState) && upload.uploadState !== "IN_PROGRESS") {
  fail(`the store did not accept the package: ${JSON.stringify(upload)}`);
}

if (!args.has("--submit")) {
  console.log("publish: uploaded as a draft. Nothing was submitted; run again with --submit to send it for review.");
  process.exit(0);
}

console.log(`publish: submitting ${version} for review`);
const submitted = await call(token, "POST", `${API}/v2/${item(config)}:publish`);
console.log(`publish: ${JSON.stringify(submitted)}`);
console.log(JSON.stringify(await call(token, "GET", `${API}/v2/${item(config)}:fetchStatus`), null, 2));
