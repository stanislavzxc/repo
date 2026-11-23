import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { classify } from "./mock-ai.mjs";

const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);
const AI_TIMEOUT_MS = 300;

const html = await readFile(new URL("./index.html", import.meta.url));

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function manualReview(response) {
  return json(response, 200, {
    status: "manual_review",
    topic: null,
    draft: null,
  });
}

function isValidModelResult(data) {
  return (
    data !== null &&
    typeof data === "object" &&
    ALLOWED_TOPICS.has(data.topic) &&
    typeof data.draft === "string" &&
    data.draft.trim().length > 0
  );
}

async function classifyWithTimeout(text, timeoutMs) {
  const controller = new AbortController();
  let timer;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("AI_TIMEOUT"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      classify(text, { signal: controller.signal }),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createAppServer() {
  async function handleTriage(request, response) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);

    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return json(response, 400, { status: "invalid_input" });
    }

    if (
      payload === null ||
      typeof payload !== "object" ||
      typeof payload.text !== "string" ||
      payload.text.trim().length === 0
    ) {
      return json(response, 400, { status: "invalid_input" });
    }

    let rawResult;
    try {
      rawResult = await classifyWithTimeout(payload.text, AI_TIMEOUT_MS);
    } catch {
      return manualReview(response);
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(rawResult);
    } catch {
      return manualReview(response);
    }

    if (!isValidModelResult(parsedResult)) {
      return manualReview(response);
    }

    return json(response, 200, {
      status: "ready",
      topic: parsedResult.topic,
      draft: parsedResult.draft,
    });
  }

  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createAppServer().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
