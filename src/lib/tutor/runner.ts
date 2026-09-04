import { createId } from "@/lib/id";
import { fetchTutorIndex } from "@/lib/tutor/client";
import type { TutorRunExecution, TutorRunRequestPayload, TutorRunLang, TutorVariant } from "@/lib/tutor/types";

// TUTOR-ADAPTER-01: VITE_TUTOR_API_URL ONLY. The old fallback to
// VITE_AI_AGENT_URL dated from when "the AI agent" was the same local
// :8000 python service; today VITE_AI_AGENT_URL is the general AI agent
// (TTS/translation/OCR/bank import -- see src/config/aiAgent.ts) and
// serves NO /v1/topics or /v1/run, so inheriting it only ever turned
// "no tutor adapter configured" (which has a working static-content
// mode) into a guaranteed dead adapter and a FAILED run on every lesson.
const rawApiUrl =
  (import.meta.env.VITE_TUTOR_API_URL as string | undefined)?.trim() ||
  "";
const API_URL = rawApiUrl.replace(/\/+$/, "");
const API_TOKEN = (import.meta.env.VITE_TUTOR_API_TOKEN as string | undefined)?.trim() || "";
const REQUEST_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "X-Adapter-Token": API_TOKEN,
};

const topicsCache = new Map<string, string[]>();
let fallbackTopicsCache: string[] | null = null;
const variantsCache = new Map<string, TutorVariant[]>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toTopicsFromUnknown(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  if (isRecord(payload) && Array.isArray(payload.topics)) {
    const items = payload.topics
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item)) {
          if (typeof item.slug === "string") return item.slug;
          if (typeof item.topic === "string") return item.topic;
          if (typeof item.id === "string") return item.id;
        }
        return null;
      })
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    return items;
  }
  return [];
}

async function fetchStaticTopics(): Promise<string[]> {
  const index = await fetchTutorIndex();
  const topics = index.topics.map((item) => item.slug).filter((slug) => slug.length > 0);
  return topics.length > 0 ? topics : ["exam_bank_ap2"];
}

export function isTutorApiConfigured(): boolean {
  return API_URL.length > 0;
}

export class TopicsEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopicsEndpointError";
  }
}

export class TutorApiHttpError extends Error {
  readonly status: number;
  readonly payload: unknown;
  readonly request: TutorRunRequestPayload;
  readonly responseText: string;

  constructor(status: number, payload: unknown, request: TutorRunRequestPayload, responseText: string) {
    super(`Tutor API error (${status})`);
    this.name = "TutorApiHttpError";
    this.status = status;
    this.payload = payload;
    this.request = request;
    this.responseText = responseText;
  }
}

export async function fetchTutorTopics(mode?: string, lang?: TutorRunLang): Promise<string[]> {
  const modeKey = (mode || "").trim().toLowerCase();
  const langKey = (lang || "").trim().toLowerCase();
  const cacheKey = `${modeKey}:${langKey}`;
  if (topicsCache.has(cacheKey)) {
    return topicsCache.get(cacheKey) ?? [];
  }

  if (!isTutorApiConfigured()) {
    const staticTopics = await fetchStaticTopics();
    topicsCache.set(cacheKey, staticTopics);
    return staticTopics;
  }

  const query = new URLSearchParams();
  if (modeKey) query.set("mode", modeKey);
  if (langKey) query.set("lang", langKey);
  const topicsUrl = `${API_URL}/v1/topics${query.toString() ? `?${query.toString()}` : ""}`;

  let response: Response;
  try {
    response = await fetch(topicsUrl, { headers: REQUEST_HEADERS });
  } catch {
    throw new TopicsEndpointError(`Topics endpoint failed (adapter unreachable at ${API_URL})`);
  }
  if (!response.ok) {
    throw new TopicsEndpointError(`Topics endpoint failed (${response.status})`);
  }
  const payload = await response.json();
  const topics = toTopicsFromUnknown(payload);
  if (topics.length > 0) {
    topicsCache.set(cacheKey, topics);
    return topics;
  }

  throw new TopicsEndpointError("Topics endpoint failed (empty topics list)");
}

export async function fetchTutorFallbackTopics(): Promise<string[]> {
  if (fallbackTopicsCache) return fallbackTopicsCache;

  fallbackTopicsCache = await fetchStaticTopics();
  return fallbackTopicsCache;
}

export async function fetchTutorVariants(topic: string, lang: TutorRunLang): Promise<TutorVariant[]> {
  const key = `${topic}:${lang}`;
  if (variantsCache.has(key)) {
    return variantsCache.get(key) ?? [];
  }
  if (!isTutorApiConfigured()) {
    return [];
  }

  const payload = {
    api_version: "v1",
    // createId, not crypto.randomUUID(): randomUUID exists only in secure
    // contexts, and LAN dev (http://192.168.x.x:8080) is not one -- the
    // bare call threw before the request was even sent (TUTOR-ADAPTER-01).
    request_id: createId(),
    topic,
    lang,
  };

  const response = await fetch(`${API_URL}/v1/variants/list`, {
    method: "POST",
    headers: REQUEST_HEADERS,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  if (!isRecord(data) || !Array.isArray(data.variants)) {
    return [];
  }

  const variants = data.variants
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      label: typeof item.label === "string" ? item.label : undefined,
      description: typeof item.description === "string" ? item.description : undefined,
      is_default: typeof item.is_default === "boolean" ? item.is_default : undefined,
    }))
    .filter((item) => item.id.length > 0);

  variantsCache.set(key, variants);
  return variants;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function isEmptyObject(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}

function looksLikeMojibake(text: string): boolean {
  if (!text) return false;
  let hasHighCodepoint = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 255) {
      hasHighCodepoint = true;
      break;
    }
  }
  if (hasHighCodepoint) return false;
  return /[ÃØÙâ]/.test(text);
}

function decodeLatin1AsUtf8(text: string): string {
  const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function repairMojibakeText(text: string): string {
  if (!looksLikeMojibake(text)) return text;
  try {
    const repaired = decodeLatin1AsUtf8(text);
    if (!repaired || repaired === text) return text;
    const repairedStillBroken = /[ÃØÙâ]/.test(repaired);
    return repairedStillBroken ? text : repaired;
  } catch {
    return text;
  }
}

function repairPayloadEncoding(value: unknown): unknown {
  if (typeof value === "string") {
    return repairMojibakeText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => repairPayloadEncoding(item));
  }
  if (isPlainObject(value)) {
    const repairedEntries = Object.entries(value).map(([key, item]) => [key, repairPayloadEncoding(item)] as const);
    return Object.fromEntries(repairedEntries);
  }
  return value;
}

function defaultParamsFor(topic: string, mode: string): Record<string, unknown> {
  if (!["trace", "quiz"].includes(mode)) return {};

  switch (topic) {
    case "bubblesort":
    case "selectionsort":
    case "insertionsort":
      return { arr: [5, 1, 4, 2, 8] };
    case "binarysearch":
      return { arr: [1, 3, 5, 7, 9], target: 7 };
    case "linearsearch":
      return { arr: [2, 5, 7, 9, 12], target: 9 };
    case "minimum":
      return { arr: [7, 3, 9, 1, 4], start_index: 0 };
    case "count_condition":
      return { arr: [1, 6, 3, 8, 10], threshold: 5, case: "count_gt" };
    case "minmax_avg":
      return { arr: [4, 7, 2, 9, 5] };
    case "maxperiod":
      return { arr: [12, 18, 10, 23, 17] };
    case "checksum":
      return { code: "1234567", case: "compute" };
    case "search_contains":
      return { arr: [3, 8, 1, 6], target: 6, case: "contains" };
    default:
      return {};
  }
}

function extractApiErrorDetail(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const detail = payload.detail;
  if (typeof detail === "string") return detail;
  if (!isRecord(detail)) return "";

  const direct = detail.detail;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const stderr = detail.stderr;
  if (typeof stderr === "string" && stderr.trim()) {
    return stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) || "";
  }

  return "";
}

export function normalizeTutorRunPayload(
  rawPayload: unknown,
  request: TutorRunRequestPayload,
): TutorRunExecution {
  if (!isRecord(rawPayload)) {
    throw new Error("Tutor API returned non-object payload");
  }

  const repairedPayload = repairPayloadEncoding(rawPayload);
  const safePayload = isRecord(repairedPayload) ? repairedPayload : rawPayload;

  const outerResult = safePayload.result;
  const nested = isRecord(outerResult) ? outerResult : null;
  const innerResult = nested && "result" in nested ? nested.result : undefined;

  const result = innerResult ?? outerResult ?? safePayload ?? null;

  const events = asArray(safePayload.events ?? (nested ? nested.events : undefined));
  const statsCandidate = safePayload.stats ?? (nested ? nested.stats : undefined);
  const stats = isRecord(statsCandidate) ? statsCandidate : null;

  const resultForQuestions = isRecord(result) ? result : null;
  const questions = asArray(safePayload.questions ?? (resultForQuestions ? resultForQuestions.questions : undefined));
  const logs = asArray(safePayload.logs).map((item) => String(item));

  return {
    request,
    raw: safePayload,
    result,
    events,
    stats,
    questions,
    logs,
  };
}

export async function runTutorRequest(
  request: Omit<TutorRunRequestPayload, "api_version" | "request_id">,
): Promise<TutorRunExecution> {
  if (!isTutorApiConfigured()) {
    throw new Error("Tutor API not configured");
  }

  const defaultParams = defaultParamsFor(request.topic, request.mode);
  const params = isPlainObject(request.params)
    ? { ...defaultParams, ...request.params }
    : defaultParams;

  const payload: TutorRunRequestPayload = {
    api_version: "v1",
    // See fetchTutorVariants -- secure-context-safe id for LAN dev.
    request_id: createId(),
    topic: request.topic,
    mode: request.mode,
    lang: request.lang,
    params,
  };

  let response: Response;
  try {
    response = await fetch(`${API_URL}/v1/run`, {
      method: "POST",
      headers: REQUEST_HEADERS,
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(`Tutor API unreachable at ${API_URL}`);
  }

  if (!response.ok) {
    let detail = "";
    let errorPayload: unknown = null;
    let responseText = "";
    try {
      responseText = await response.text();
      errorPayload = responseText ? JSON.parse(responseText) : null;
      detail = extractApiErrorDetail(errorPayload);
    } catch {
      // keep generic status-only error
    }
    if (errorPayload !== null || responseText) {
      const error = new TutorApiHttpError(response.status, errorPayload, payload, responseText);
      if (detail) {
        error.message = `Tutor API error (${response.status}): ${detail}`;
      }
      throw error;
    }
    throw new Error(detail ? `Tutor API error (${response.status}): ${detail}` : `Tutor API error (${response.status})`);
  }

  const rawPayload = await response.json();
  return normalizeTutorRunPayload(rawPayload, payload);
}
