import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type Quality = "normal" | "2k" | "4k";

type CliArgs = {
  prompt: string | null;
  imagePath: string | null;
  model: string | null;
  aspectRatio: string | null;
  quality: Quality | null;
  referenceImages: string[];
  json: boolean;
  help: boolean;
};

type Provider = "image-api" | "tuzi" | "openai-compatible";
type WireMode = "generic" | "openai-compatible" | "responses";
type RequestBodyMode = "json" | "multipart";
type TuziRefMode = "generations-json" | "edits-multipart";

type ResolvedConfig = {
  prompt: string;
  outputPath: string;
  provider: Provider;
  wireMode: WireMode;
  apiKey: string;
  model: string;
  aspectRatio: string | null;
  quality: Quality | null;
  referenceImages: string[];
  json: boolean;
  baseUrl: string;
};

type GenerationResponse = {
  data?: Array<{
    url?: string;
    b64_json?: string;
    base64?: string;
    image_base64?: string;
  }>;
  error?: unknown;
};

type ResponsesImageResponse = {
  output?: Array<{
    type?: string;
    result?: string;
    content?: Array<{
      type?: string;
      text?: string;
      image_base64?: string;
    }>;
  }>;
  output_text?: string;
  error?: unknown;
};

type ImageResult = {
  bytes: Uint8Array;
  url: string | null;
  base64: string;
};

const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_LEGACY_TUZI_MODEL = "gemini-3-pro-image-preview";
const DEFAULT_OPENAI_MODEL = "gpt-image-1.5";
const DEFAULT_IMAGE_API_URL = "https://api.tu-zi.com/v1";
const DEFAULT_OPENAI_API_URL = "https://api.openai.com/v1";
const DEFAULT_OUTPUT_DIR = "~/Desktop/images";
const SUPPORTED_RATIOS = new Set(["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "21:9"]);
const EXTENDED_RATIOS = new Set(["1:4", "4:1", "1:8", "8:1"]);
const QUALITY_CAPABLE_MODELS = new Set(["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"]);
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function printUsage(): void {
  console.log(`Usage:
  npx -y tsx scripts/main.ts --prompt "一只猫"
  npx -y tsx scripts/main.ts --prompt "一只猫" --image ./out/cat.png
  npx -y tsx scripts/main.ts --prompt "海报风格宇航员" --image ./out/poster.png --ar 16:9 --quality 2k
  npx -y tsx scripts/main.ts --prompt "参考图生成" --image ./out/ref.png --ref ./ref-1.png ./ref-2.jpg

Options:
  --prompt <text>      Prompt text to send to the image endpoint. Required.
  --image <path>       Output path for the final image. Optional; overrides DEFAULT_OUTPUT_DIR.
  --model <id>         Model ID such as gemini-3-pro-image-preview or gpt-image-1.5.
  --ar <ratio>         Aspect ratio such as 1:1, 16:9, 3:4.
  --quality <level>    One of: normal, 2k, 4k.
  --ref <files...>     One or more reference images.
  --json               Emit machine-readable JSON to stdout.
  -h, --help           Show this help.

Environment:
  IMAGE_API_KEY        Image API bearer token.
  IMAGE_API_URL        Image API address. Default: https://api.tu-zi.com/v1
  IMAGE_WIRE_API       Optional wire protocol: images or responses.
  IMAGE_MODEL          Optional default image model.
  IMAGE_RESPONSES_URL  Optional full Responses endpoint override.
  IMAGE_GENERATIONS_URL Optional full generations endpoint override.
  IMAGE_EDITS_URL      Optional full edits endpoint override.
  IMAGE_REF_MODE       Optional reference-image mode: generations-json or edits-multipart.
  DEFAULT_QUALITY      Optional default quality: normal, 2k, or 4k.
  DEFAULT_ASPECT_RATIO Optional default aspect ratio such as 1:1, 16:9, 3:4.
  DEFAULT_OUTPUT_DIR   Optional default output directory. Default: ~/Desktop/images

Config precedence:
  CLI args > .env / shell environment > built-in defaults

Config files:
  ${path.join(SKILL_DIR, ".env")}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    prompt: null,
    imagePath: null,
    model: null,
    aspectRatio: null,
    quality: null,
    referenceImages: [],
    json: false,
    help: false,
  };

  const takeMany = (index: number): { values: string[]; nextIndex: number } => {
    const values: string[] = [];
    let cursor = index + 1;
    while (cursor < argv.length && !argv[cursor]!.startsWith("-")) {
      values.push(argv[cursor]!);
      cursor += 1;
    }
    return { values, nextIndex: cursor - 1 };
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]!;

    if (current === "--help" || current === "-h") {
      args.help = true;
      continue;
    }
    if (current === "--json") {
      args.json = true;
      continue;
    }
    if (current === "--prompt") {
      args.prompt = argv[i + 1] ?? fail("Missing value for --prompt.");
      i += 1;
      continue;
    }
    if (current === "--image") {
      args.imagePath = argv[i + 1] ?? fail("Missing value for --image.");
      i += 1;
      continue;
    }
    if (current === "--model") {
      args.model = argv[i + 1] ?? fail("Missing value for --model.");
      i += 1;
      continue;
    }
    if (current === "--ar") {
      args.aspectRatio = argv[i + 1] ?? fail("Missing value for --ar.");
      i += 1;
      continue;
    }
    if (current === "--quality") {
      const quality = argv[i + 1];
      if (quality !== "normal" && quality !== "2k" && quality !== "4k") {
        fail(`Invalid --quality value "${quality ?? ""}". Use normal, 2k, or 4k.`);
      }
      args.quality = quality;
      i += 1;
      continue;
    }
    if (current === "--ref") {
      const { values, nextIndex } = takeMany(i);
      if (values.length === 0) {
        fail("Missing file path(s) after --ref.");
      }
      args.referenceImages.push(...values);
      i = nextIndex;
      continue;
    }
    fail(`Unknown option "${current}".`);
  }

  return args;
}

async function loadDotEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      parsed[key] = value;
    }
    return parsed;
  } catch {
    return {};
  }
}

async function loadEnvFiles(): Promise<void> {
  const skillEnv = await loadDotEnvFile(path.join(SKILL_DIR, ".env"));
  for (const [key, value] of Object.entries(skillEnv)) {
    if (!(key in process.env)) process.env[key] = value;
  }
}

function ensurePrompt(prompt: string | null): string {
  if (!prompt || prompt.trim().length === 0) {
    fail("Prompt is required. Pass it with --prompt.");
  }
  return prompt.trim();
}

function expandHomePath(filePath: string): string {
  if (filePath === "~") return process.env.HOME || filePath;
  if (filePath.startsWith("~/")) return path.join(process.env.HOME || "~", filePath.slice(2));
  return filePath;
}

function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function buildGeneratedOutputPath(): string {
  const outputDir = process.env.DEFAULT_OUTPUT_DIR?.trim() || DEFAULT_OUTPUT_DIR;
  const fileName = `image-${formatTimestamp(new Date())}-${process.pid}.png`;
  return path.join(expandHomePath(outputDir), fileName);
}

function normalizeOutputPath(imagePath: string | null): string {
  const configuredPath = imagePath && imagePath.trim().length > 0 ? imagePath : buildGeneratedOutputPath();
  const absolutePath = path.resolve(expandHomePath(configuredPath));
  return path.extname(absolutePath) ? absolutePath : `${absolutePath}.png`;
}

async function ensureOutputDoesNotExist(outputPath: string): Promise<void> {
  try {
    await access(outputPath);
    fail(`Refusing to overwrite existing file: ${outputPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("Refusing to overwrite")) throw error;
  }
}

async function validateOutputParent(outputPath: string): Promise<void> {
  const parentDirectory = path.dirname(outputPath);
  try {
    const info = await stat(parentDirectory);
    if (!info.isDirectory()) {
      fail(`Output path is invalid because its parent is not a directory: ${parentDirectory}`);
    }
  } catch {
    return;
  }
}

async function validateReferenceImages(referenceImages: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const filePath of referenceImages) {
    const absolutePath = path.resolve(filePath);
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        fail(`Reference image is not a file: ${absolutePath}`);
      }
    } catch {
      fail(`Reference image not found: ${absolutePath}`);
    }
    resolved.push(absolutePath);
  }
  return resolved;
}

function validateAspectRatio(model: string, aspectRatio: string | null): void {
  if (!aspectRatio) return;
  if (SUPPORTED_RATIOS.has(aspectRatio)) return;
  if (model === "gemini-3.1-flash-image-preview" && EXTENDED_RATIOS.has(aspectRatio)) return;
  fail(`Aspect ratio "${aspectRatio}" is not supported by model "${model}". See references/api.md for supported ratios.`);
}

function validateOpenAIAspectRatio(aspectRatio: string | null): void {
  if (!aspectRatio) return;
  if (!aspectRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)) {
    fail(`Invalid aspect ratio "${aspectRatio}". Use values like 1:1 or 16:9.`);
  }
}

function validateQuality(provider: Provider, model: string, quality: Quality | null): void {
  if (!quality) return;
  if (provider === "openai-compatible") return;
  if (QUALITY_CAPABLE_MODELS.has(model)) return;
  if (isOpenAIModel(model)) return;
  fail(
    `Model "${model}" does not support --quality. Use a known quality-capable model such as gemini-3-pro-image-preview, gemini-3.1-flash-image-preview, or gpt-image-*, or omit --quality.`,
  );
}

function mapAspectRatioToSize(aspectRatio: string | null): string | null {
  if (!aspectRatio) return null;
  const match = aspectRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) {
    fail(`Invalid aspect ratio "${aspectRatio}". Use values like 1:1 or 16:9.`);
  }
  return `${match[1]}x${match[2]}`;
}

function mapQuality(quality: Quality | null): string | null {
  if (quality === null) return null;
  if (quality === "normal") return "1k";
  return quality;
}

function parseAspectRatio(aspectRatio: string): { width: number; height: number } | null {
  const match = aspectRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function mapOpenAIAspectRatioToSize(aspectRatio: string | null): string {
  if (!aspectRatio) return "1024x1024";
  const parsed = parseAspectRatio(aspectRatio);
  if (!parsed) {
    fail(`Invalid aspect ratio "${aspectRatio}". Use values like 1:1 or 16:9.`);
  }

  const ratio = parsed.width / parsed.height;
  if (Math.abs(ratio - 1) < 0.1) return "1024x1024";
  if (ratio > 1) return "1536x1024";
  if (ratio < 1) return "1024x1536";
  return "1024x1024";
}

function mapResponsesAspectRatioToSize(aspectRatio: string | null, quality: Quality | null): string | null {
  const configured = configuredValue("IMAGE_RESPONSES_SIZE");
  if (configured) return configured;
  if (!aspectRatio) return null;
  const parsed = parseAspectRatio(aspectRatio);
  if (!parsed) {
    fail(`Invalid aspect ratio "${aspectRatio}". Use values like 1:1 or 16:9.`);
  }

  const ratio = parsed.width / parsed.height;
  if (Math.abs(ratio - 1) < 0.1) return "1024x1024";
  return ratio > 1 ? "1536x1024" : "1024x1536";
}

function mapResponsesToolQuality(quality: Quality | null): string | null {
  if (!quality) return null;
  return quality === "normal" ? "medium" : "high";
}

function getResponsesBackground(): string | null {
  const value = configuredValue("IMAGE_BACKGROUND", "IMAGE_RESPONSES_BACKGROUND");
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "transparent" || normalized === "opaque" || normalized === "auto") return normalized;
  fail(`Invalid IMAGE_BACKGROUND value "${value}". Use transparent, opaque, or auto.`);
}

function isOpenAIModel(model: string | null): boolean {
  if (!model) return false;
  return model.startsWith("gpt-image-") || model.startsWith("dall-e-");
}

function configuredValue(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function hasConfiguredValue(...names: string[]): boolean {
  return configuredValue(...names) !== null;
}

function isOpenAIApiUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === "api.openai.com" || hostname.endsWith(".openai.com");
  } catch {
    return false;
  }
}

function resolveWireMode(provider: Provider, model: string, baseUrl: string): WireMode {
  const configured = configuredValue("IMAGE_WIRE_API");
  if (configured) {
    const value = configured.trim().toLowerCase();
    if (value === "responses") return "responses";
    if (value !== "images") {
      fail(`Invalid IMAGE_WIRE_API value "${configured}". Use images or responses.`);
    }
  }
  if (provider === "openai-compatible") return "openai-compatible";
  if (provider === "image-api" && (isOpenAIApiUrl(baseUrl) || model.startsWith("dall-e-"))) {
    return "openai-compatible";
  }
  return "generic";
}

function getEnvModel(provider: Provider): string | null {
  const configured = configuredValue("IMAGE_MODEL");
  if (configured) return configured;
  if (provider === "openai-compatible") return configuredValue("OPENAI_IMAGE_MODEL");
  if (provider === "tuzi") return configuredValue("TUZI_IMAGE_MODEL");
  return configuredValue("TUZI_IMAGE_MODEL", "OPENAI_IMAGE_MODEL");
}

function normalizePath(configuredPath: string | undefined, defaultPath: string): string {
  const value = configuredPath?.trim() || defaultPath;
  return value.startsWith("/") ? value : `/${value}`;
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/g, "");
}

function joinUrl(baseUrl: string, endpointPath: string): string {
  return `${trimTrailingSlashes(baseUrl)}${normalizePath(endpointPath, "")}`;
}

function getEndpointOverride(provider: Provider, kind: "generations" | "edits"): string | null {
  if (provider === "image-api") {
    return kind === "generations" ? configuredValue("IMAGE_GENERATIONS_URL") : configuredValue("IMAGE_EDITS_URL");
  }

  const value =
    provider === "openai-compatible"
      ? kind === "generations"
        ? process.env.OPENAI_GENERATIONS_URL
        : process.env.OPENAI_EDITS_URL
      : kind === "generations"
        ? process.env.TUZI_GENERATIONS_URL
        : process.env.TUZI_EDITS_URL;
  return value?.trim() ? trimTrailingSlashes(value.trim()) : null;
}

function getEndpointUrl(provider: Provider, baseUrl: string, kind: "generations" | "edits"): string {
  return getEndpointOverride(provider, kind) ?? joinUrl(baseUrl, getProviderPath(provider, kind));
}

function getResponsesEndpointUrl(baseUrl: string): string {
  return configuredValue("IMAGE_RESPONSES_URL") ?? joinUrl(baseUrl, process.env.IMAGE_RESPONSES_PATH || "/responses");
}

function getProviderPath(provider: Provider, kind: "generations" | "edits"): string {
  if (provider === "image-api") {
    return kind === "generations"
      ? normalizePath(process.env.IMAGE_GENERATIONS_PATH, "/images/generations")
      : normalizePath(process.env.IMAGE_EDITS_PATH, "/images/edits");
  }

  if (provider === "openai-compatible") {
    return kind === "generations"
      ? normalizePath(process.env.OPENAI_GENERATIONS_PATH, "/images/generations")
      : normalizePath(process.env.OPENAI_EDITS_PATH, "/images/edits");
  }

  return kind === "generations"
    ? normalizePath(process.env.TUZI_GENERATIONS_PATH, "/images/generations")
    : normalizePath(process.env.TUZI_EDITS_PATH, "/images/edits");
}

function getBodyMode(provider: Provider, kind: "generations" | "edits"): RequestBodyMode {
  const rawValue =
    provider === "image-api"
      ? kind === "generations"
        ? process.env.IMAGE_GENERATIONS_BODY
        : process.env.IMAGE_EDITS_BODY
      : provider === "openai-compatible"
      ? kind === "generations"
        ? process.env.OPENAI_GENERATIONS_BODY
        : process.env.OPENAI_EDITS_BODY
      : kind === "generations"
        ? process.env.TUZI_GENERATIONS_BODY
        : process.env.TUZI_EDITS_BODY;
  const defaultValue: RequestBodyMode = kind === "generations" ? "json" : "multipart";
  const value = (rawValue || defaultValue).trim().toLowerCase();
  if (value !== "json" && value !== "multipart") {
    fail(`Invalid ${provider} ${kind} body mode "${rawValue}". Use json or multipart.`);
  }
  return value;
}

function getResponseFormat(provider: Provider, kind: "generations" | "edits"): string {
  if (provider === "image-api") {
    return kind === "generations" ? process.env.IMAGE_GENERATIONS_RESPONSE_FORMAT || "url" : process.env.IMAGE_EDITS_RESPONSE_FORMAT || "url";
  }
  if (provider === "openai-compatible") {
    return kind === "generations"
      ? process.env.OPENAI_GENERATIONS_RESPONSE_FORMAT || "url"
      : process.env.OPENAI_EDITS_RESPONSE_FORMAT || "url";
  }
  return kind === "generations" ? process.env.TUZI_GENERATIONS_RESPONSE_FORMAT || "url" : process.env.TUZI_EDITS_RESPONSE_FORMAT || "url";
}

function getImageRefMode(provider: Provider): TuziRefMode {
  const configured =
    provider === "tuzi"
      ? configuredValue("TUZI_REF_MODE", "IMAGE_REF_MODE")
      : configuredValue("IMAGE_REF_MODE", "TUZI_REF_MODE");
  const value = (configured || "generations-json").trim().toLowerCase();
  if (value !== "generations-json" && value !== "edits-multipart") {
    fail(`Invalid IMAGE_REF_MODE value "${value}". Use generations-json or edits-multipart.`);
  }
  return value;
}

function resolveModel(cliModel: string | null, provider: Provider): string {
  if (cliModel) return cliModel;
  const configured = getEnvModel(provider);
  if (configured) return configured;
  if (provider === "openai-compatible") return DEFAULT_OPENAI_MODEL;
  if (provider === "tuzi") return DEFAULT_LEGACY_TUZI_MODEL;
  return DEFAULT_MODEL;
}

function resolveAspectRatio(cliAspectRatio: string | null): string | null {
  if (cliAspectRatio) return cliAspectRatio;
  return process.env.DEFAULT_ASPECT_RATIO || null;
}

function resolveQuality(cliQuality: Quality | null): Quality | null {
  if (cliQuality) return cliQuality;
  const envQuality = process.env.DEFAULT_QUALITY;
  return envQuality === "normal" || envQuality === "2k" || envQuality === "4k" ? envQuality : null;
}

function resolveProvider(modelHint: string | null): Provider {
  const hasImageKey = hasConfiguredValue("IMAGE_API_KEY");
  const hasOpenAIKey = hasConfiguredValue("OPENAI_API_KEY");
  const hasTuziKey = hasConfiguredValue("TUZI_API_KEY");

  if (hasImageKey) return "image-api";

  if (hasOpenAIKey && !hasTuziKey) return "openai-compatible";
  if (hasTuziKey && !hasOpenAIKey) return "tuzi";
  if (hasOpenAIKey && hasTuziKey) {
    return isOpenAIModel(modelHint) ? "openai-compatible" : "tuzi";
  }

  fail(
    `IMAGE_API_KEY is required. Export it in the shell or store it in ${path.join(SKILL_DIR, ".env")}.`,
  );
}

async function resolveBaseUrl(provider: Provider): Promise<string> {
  if (provider === "image-api") {
    const configured = configuredValue("IMAGE_API_URL", "TUZI_API_URL", "OPENAI_API_URL", "TUZI_BASE_URL", "OPENAI_BASE_URL") || DEFAULT_IMAGE_API_URL;
    return trimTrailingSlashes(configured);
  }
  if (provider === "openai-compatible") {
    const configured = configuredValue("OPENAI_API_URL", "OPENAI_BASE_URL") || DEFAULT_OPENAI_API_URL;
    return trimTrailingSlashes(configured);
  }
  return trimTrailingSlashes(configuredValue("TUZI_API_URL", "TUZI_BASE_URL") || DEFAULT_IMAGE_API_URL);
}

function resolveApiKey(provider: Provider): string | null {
  if (provider === "image-api") return configuredValue("IMAGE_API_KEY", "TUZI_API_KEY", "OPENAI_API_KEY");
  if (provider === "openai-compatible") return configuredValue("OPENAI_API_KEY");
  return configuredValue("TUZI_API_KEY");
}

async function resolveConfig(args: CliArgs): Promise<ResolvedConfig> {
  await loadEnvFiles();

  const prompt = ensurePrompt(args.prompt);
  const outputPath = normalizeOutputPath(args.imagePath);
  const modelHint = args.model || configuredValue("IMAGE_MODEL", "OPENAI_IMAGE_MODEL", "TUZI_IMAGE_MODEL");
  const provider = resolveProvider(modelHint);
  const model = resolveModel(args.model, provider);
  const baseUrl = await resolveBaseUrl(provider);
  const wireMode = resolveWireMode(provider, model, baseUrl);
  const aspectRatio = resolveAspectRatio(args.aspectRatio);
  const quality = resolveQuality(args.quality);

  if (wireMode === "responses") {
    validateOpenAIAspectRatio(aspectRatio);
  } else if (wireMode === "openai-compatible") {
    validateOpenAIAspectRatio(aspectRatio);
  } else {
    validateAspectRatio(model, aspectRatio);
  }
  validateQuality(provider, model, quality);

  const referenceImages = await validateReferenceImages(args.referenceImages);
  await ensureOutputDoesNotExist(outputPath);
  await validateOutputParent(outputPath);

  const apiKey = resolveApiKey(provider);
  if (!apiKey) {
    fail(`IMAGE_API_KEY is required. Export it in the shell or store it in ${path.join(SKILL_DIR, ".env")}.`);
  }

  return {
    prompt,
    outputPath,
    provider,
    wireMode,
    apiKey,
    model,
    aspectRatio,
    quality,
    referenceImages,
    json: args.json,
    baseUrl,
  };
}

async function readReferenceAsDataUrl(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const mime =
    extension === ".jpg" || extension === ".jpeg"
      ? "image/jpeg"
      : extension === ".webp"
        ? "image/webp"
        : extension === ".gif"
          ? "image/gif"
          : "image/png";
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

function extractImageField(payload: GenerationResponse): string {
  const item = payload.data?.[0];
  if (!item) {
    fail("Image API response did not contain image data.");
  }
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item.base64) return `data:image/png;base64,${item.base64}`;
  if (item.image_base64) return `data:image/png;base64,${item.image_base64}`;
  if (item.url) return item.url;
  fail("Image API response did not include a supported image field.");
}

function normalizeImageData(value: string): string {
  if (value.startsWith("data:") || value.startsWith("http://") || value.startsWith("https://")) return value;
  return `data:image/png;base64,${value}`;
}

function findResponsesImageField(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findResponsesImageField(item);
      if (found) return found;
    }
    return null;
  }

  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const type = typeof object.type === "string" ? object.type : "";

  if (type.includes("image_generation") && typeof object.result === "string") {
    return normalizeImageData(object.result);
  }
  if (type === "output_image" && typeof object.image_base64 === "string") {
    return normalizeImageData(object.image_base64);
  }
  if (typeof object.b64_json === "string") return normalizeImageData(object.b64_json);
  if (typeof object.image_base64 === "string") return normalizeImageData(object.image_base64);
  if (typeof object.url === "string") return object.url;

  for (const nested of Object.values(object)) {
    const found = findResponsesImageField(nested);
    if (found) return found;
  }
  return null;
}

function parseServerSentEventData(text: string): unknown[] {
  const payloads: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());
    if (dataLines.length === 0) continue;
    const data = dataLines.join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      // Ignore non-JSON SSE payloads; image data is carried in JSON events.
    }
  }
  return payloads;
}

function extractResponsesImageFieldFromText(text: string): string {
  try {
    const found = findResponsesImageField(JSON.parse(text));
    if (found) return found;
  } catch {
    // Fall through to SSE parsing.
  }

  const found = findResponsesImageField(parseServerSentEventData(text));
  if (found) return found;
  fail("Responses API output did not include image_generation_call image data.");
}

async function fetchImageResult(imageField: string): Promise<ImageResult> {
  if (imageField.startsWith("data:")) {
    const marker = imageField.indexOf(",");
    if (marker === -1) {
      fail("Invalid data URL returned by image API.");
    }
    const base64 = imageField.slice(marker + 1);
    return {
      bytes: Uint8Array.from(Buffer.from(base64, "base64")),
      url: null,
      base64,
    };
  }

  const response = await fetch(imageField);
  if (!response.ok) {
    fail(`Image download failed with status ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bytes,
    url: imageField,
    base64: Buffer.from(bytes).toString("base64"),
  };
}

function getMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

async function callGenericImageApi(config: ResolvedConfig): Promise<ImageResult> {
  if (config.referenceImages.length > 0 && getImageRefMode(config.provider) === "edits-multipart") {
    if (getBodyMode(config.provider, "edits") !== "multipart") {
      fail("IMAGE_REF_MODE=edits-multipart requires multipart edits requests.");
    }

    const form = new FormData();
    form.append("model", config.model);
    form.append("prompt", config.prompt);
    const size = mapAspectRatioToSize(config.aspectRatio);
    if (size) form.append("size", size);
    form.append("response_format", getResponseFormat(config.provider, "edits"));

    const quality = mapQuality(config.quality);
    if (quality) form.append("quality", quality);

    for (const imagePath of config.referenceImages) {
      const bytes = await readFile(imagePath);
      form.append("image", new Blob([bytes], { type: getMimeType(imagePath) }), path.basename(imagePath));
    }

    const response = await fetch(getEndpointUrl(config.provider, config.baseUrl, "edits"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      const responseText = (await response.text()).trim();
      fail(`Image API edit request failed with status ${response.status}${responseText ? `: ${responseText}` : "."}`);
    }

    const payload = (await response.json()) as GenerationResponse;
    return fetchImageResult(extractImageField(payload));
  }

  if (getBodyMode(config.provider, "generations") !== "json") {
    fail("Image API generations currently requires JSON requests.");
  }

  const body: Record<string, unknown> = {
    model: config.model,
    prompt: config.prompt,
    response_format: getResponseFormat(config.provider, "generations"),
  };

  const size = mapAspectRatioToSize(config.aspectRatio);
  if (size) body.size = size;

  const quality = mapQuality(config.quality);
  if (quality) body.quality = quality;

  if (config.referenceImages.length > 0) {
    const images: string[] = [];
    for (const imagePath of config.referenceImages) {
      images.push(await readReferenceAsDataUrl(imagePath));
    }
    body.image = images;
  }

  const response = await fetch(getEndpointUrl(config.provider, config.baseUrl, "generations"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseText = (await response.text()).trim();
    fail(`Image API request failed with status ${response.status}${responseText ? `: ${responseText}` : "."}`);
  }

  const payload = (await response.json()) as GenerationResponse;
  const imageField = extractImageField(payload);
  return fetchImageResult(imageField);
}

function mapOpenAIEditQuality(quality: Quality | null): string | null {
  if (!quality) return null;
  return quality === "normal" ? "medium" : "high";
}

async function callOpenAICompatibleApi(config: ResolvedConfig): Promise<ImageResult> {
  if (config.referenceImages.length > 0) {
    if (getBodyMode(config.provider, "edits") !== "multipart") {
      fail("Image API edits currently requires multipart requests.");
    }

    const form = new FormData();
    form.append("model", config.model);
    form.append("prompt", config.prompt);
    form.append("size", mapOpenAIAspectRatioToSize(config.aspectRatio));
    form.append("response_format", getResponseFormat(config.provider, "edits"));

    const quality = mapOpenAIEditQuality(config.quality);
    if (quality && config.model.startsWith("gpt-image-")) {
      form.append("quality", quality);
    }

    for (const imagePath of config.referenceImages) {
      const bytes = await readFile(imagePath);
      form.append("image", new Blob([bytes], { type: getMimeType(imagePath) }), path.basename(imagePath));
    }

    const response = await fetch(getEndpointUrl(config.provider, config.baseUrl, "edits"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      const responseText = (await response.text()).trim();
      fail(`Image API edit request failed with status ${response.status}${responseText ? `: ${responseText}` : "."}`);
    }

    const payload = (await response.json()) as GenerationResponse;
    return fetchImageResult(extractImageField(payload));
  }

  if (getBodyMode(config.provider, "generations") !== "json") {
    fail("Image API generations currently requires JSON requests.");
  }

  const body: Record<string, unknown> = {
    model: config.model,
    prompt: config.prompt,
    size: mapOpenAIAspectRatioToSize(config.aspectRatio),
  };

  if (config.model.startsWith("dall-e-3") && config.quality) {
    body.quality = config.quality === "normal" ? "standard" : "hd";
  }

  const response = await fetch(getEndpointUrl(config.provider, config.baseUrl, "generations"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseText = (await response.text()).trim();
    fail(`Image API generation request failed with status ${response.status}${responseText ? `: ${responseText}` : "."}`);
  }

  const payload = (await response.json()) as GenerationResponse;
  return fetchImageResult(extractImageField(payload));
}

async function callResponsesImageApi(config: ResolvedConfig): Promise<ImageResult> {
  const promptLines = [config.prompt];
  const outputRequirements: string[] = [];
  if (config.aspectRatio) outputRequirements.push(`Aspect ratio: ${config.aspectRatio}.`);
  if (config.quality) outputRequirements.push(`Quality target: ${config.quality}.`);
  if (outputRequirements.length > 0) {
    promptLines.push("", "Output requirements:", ...outputRequirements.map((requirement) => `- ${requirement}`));
  }

  const input =
    config.referenceImages.length === 0
      ? promptLines.join("\n")
      : [
          {
            role: "user",
            content: [
              { type: "input_text", text: promptLines.join("\n") },
              ...(await Promise.all(
                config.referenceImages.map(async (imagePath) => ({
                  type: "input_image",
                  image_url: await readReferenceAsDataUrl(imagePath),
                })),
              )),
            ],
          },
        ];

  const imageTool: Record<string, unknown> = { type: "image_generation" };
  const size = mapResponsesAspectRatioToSize(config.aspectRatio, config.quality);
  const quality = mapResponsesToolQuality(config.quality);
  const background = getResponsesBackground();
  if (size) imageTool.size = size;
  if (quality) imageTool.quality = quality;
  if (background) {
    imageTool.background = background;
    imageTool.output_format = "png";
  }

  const body: Record<string, unknown> = {
    model: config.model,
    input,
    tools: [imageTool],
  };

  const response = await fetch(getResponsesEndpointUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseText = (await response.text()).trim();
    fail(`Responses image generation request failed with status ${response.status}${responseText ? `: ${responseText}` : "."}`);
  }

  const payloadText = await response.text();
  return fetchImageResult(extractResponsesImageFieldFromText(payloadText));
}

async function callImageApi(config: ResolvedConfig): Promise<ImageResult> {
  if (config.wireMode === "responses") {
    return callResponsesImageApi(config);
  }
  if (config.wireMode === "openai-compatible") {
    return callOpenAICompatibleApi(config);
  }
  return callGenericImageApi(config);
}

async function saveOutput(outputPath: string, bytes: Uint8Array): Promise<void> {
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
  } catch {
    fail(`Unable to create the output directory for: ${outputPath}`);
  }
  try {
    await writeFile(outputPath, bytes);
  } catch {
    fail(`Unable to write the output image to: ${outputPath}`);
  }
  try {
    await access(outputPath);
  } catch {
    fail(`Output file was not created: ${outputPath}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const config = await resolveConfig(args);
  const imageResult = await callImageApi(config);
  await saveOutput(config.outputPath, imageResult.bytes);

  if (config.json) {
    console.log(
      JSON.stringify(
        {
          savedImage: config.outputPath,
          provider: "image-api",
          model: config.model,
          aspectRatio: config.aspectRatio,
          quality: config.quality,
          referenceImages: config.referenceImages,
          imageUrl: imageResult.url,
          imageBase64: imageResult.base64,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Saved image: ${config.outputPath}`);
  console.log("Provider: image-api");
  console.log(`Model: ${config.model}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
