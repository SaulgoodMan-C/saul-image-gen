import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const SKILL_DIR = path.join(import.meta.dir, "..");
const SCRIPT_PATH = path.join(import.meta.dir, "main.ts");
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=",
  "base64",
);

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()!;
    await rm(root, { recursive: true, force: true });
  }
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "saul-skills-"));
  tempRoots.push(root);
  return root;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body);
}

async function readTextBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void handler(request, response).catch((error) => {
      response.statusCode = 500;
      response.end(String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address.");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function runSkill(args: {
  env?: Record<string, string>;
  homeFiles?: Array<{ relativePath: string; content: string }>;
  cliArgs: string[];
  omitImage?: boolean;
}): Promise<{
  exitCode: number;
  homeDir: string;
  stdout: string;
  stderr: string;
  outputPath: string;
}> {
  const tempRoot = await createTempRoot();
  const outputPath = path.join(tempRoot, "generated", "image.png");
  const imageArgs = args.omitImage ? [] : ["--image", outputPath];

  for (const file of args.homeFiles ?? []) {
    const targetPath = path.join(tempRoot, file.relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content, "utf8");
  }

  const proc = Bun.spawn({
    cmd: [process.execPath, SCRIPT_PATH, "--prompt", "test prompt", ...imageArgs, ...args.cliArgs],
    cwd: tempRoot,
    env: {
      ...process.env,
      HOME: tempRoot,
      IMAGE_WIRE_API: "",
      IMAGE_RESPONSES_URL: "",
      IMAGE_RESPONSES_PATH: "",
      IMAGE_RESPONSES_SIZE: "",
      IMAGE_BACKGROUND: "",
      IMAGE_RESPONSES_BACKGROUND: "",
      ...args.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return {
    exitCode,
    homeDir: tempRoot,
    stdout,
    stderr,
    outputPath,
  };
}

describe("saul-skills script", () => {
  test("uses neutral IMAGE_API_URL for image generation", async () => {
    let requestPath = "";
    let requestAuth = "";
    let requestBody: Record<string, unknown> | null = null;
    const server = await startServer(async (request, response) => {
      requestPath = request.url ?? "";
      requestAuth = request.headers.authorization ?? "";
      requestBody = await readJsonBody(request);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "image-test-key",
          IMAGE_API_URL: `${server.origin}/v1`,
          IMAGE_MODEL: "gpt-image-2",
          DEFAULT_QUALITY: "",
          DEFAULT_ASPECT_RATIO: "",
        },
        cliArgs: [],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Provider: image-api");
      expect(result.stdout).toContain("Model: gpt-image-2");
      expect(requestPath).toBe("/v1/images/generations");
      expect(requestAuth).toBe("Bearer image-test-key");
      expect(requestBody).toEqual({
        model: "gpt-image-2",
        prompt: "test prompt",
        response_format: "url",
      });
      await access(result.outputPath);
      const savedBytes = await readFile(result.outputPath);
      expect(Buffer.compare(savedBytes, PNG_BYTES)).toBe(0);
    } finally {
      await server.close();
    }
  });

  test("uses Responses image_generation when IMAGE_WIRE_API is responses", async () => {
    let requestPath = "";
    let requestAuth = "";
    let requestBody: Record<string, unknown> | null = null;
    const server = await startServer(async (request, response) => {
      requestPath = request.url ?? "";
      requestAuth = request.headers.authorization ?? "";
      requestBody = await readJsonBody(request);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ output: [{ type: "image_generation_call", result: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "image-test-key",
          IMAGE_API_URL: `${server.origin}/coding`,
          IMAGE_WIRE_API: "responses",
          IMAGE_MODEL: "gpt-image-2",
          DEFAULT_QUALITY: "",
          DEFAULT_ASPECT_RATIO: "",
        },
        cliArgs: [],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Provider: image-api");
      expect(result.stdout).toContain("Model: gpt-image-2");
      expect(requestPath).toBe("/coding/responses");
      expect(requestAuth).toBe("Bearer image-test-key");
      expect(requestBody).toEqual({
        model: "gpt-image-2",
        input: "test prompt",
        tools: [{ type: "image_generation" }],
      });
      await access(result.outputPath);
      const savedBytes = await readFile(result.outputPath);
      expect(Buffer.compare(savedBytes, PNG_BYTES)).toBe(0);
    } finally {
      await server.close();
    }
  });

  test("parses Responses image_generation from server-sent events", async () => {
    const server = await startServer(async (request, response) => {
      await readJsonBody(request);
      response.setHeader("Content-Type", "text/event-stream");
      response.end(
        [
          "event: response.output_item.done",
          `data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "image_generation_call", result: PNG_BYTES.toString("base64") } })}`,
          "",
          "event: response.completed",
          "data: {}",
          "",
        ].join("\n"),
      );
    });

    try {
      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "image-test-key",
          IMAGE_API_URL: `${server.origin}/coding`,
          IMAGE_WIRE_API: "responses",
          IMAGE_MODEL: "gpt-image-2",
          DEFAULT_QUALITY: "",
          DEFAULT_ASPECT_RATIO: "",
        },
        cliArgs: [],
      });

      expect(result.exitCode).toBe(0);
      const savedBytes = await readFile(result.outputPath);
      expect(Buffer.compare(savedBytes, PNG_BYTES)).toBe(0);
    } finally {
      await server.close();
    }
  });

  test("sends reference images to Responses image_generation input", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const server = await startServer(async (request, response) => {
      requestBody = await readJsonBody(request);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ output: [{ type: "image_generation_call", result: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const tempRoot = await createTempRoot();
      const refOne = path.join(tempRoot, "ref.png");
      await writeFile(refOne, PNG_BYTES);

      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "image-test-key",
          IMAGE_API_URL: `${server.origin}/coding`,
          IMAGE_WIRE_API: "responses",
          IMAGE_MODEL: "gpt-image-2",
          IMAGE_BACKGROUND: "transparent",
          DEFAULT_QUALITY: "",
          DEFAULT_ASPECT_RATIO: "",
        },
        cliArgs: ["--ref", refOne, "--ar", "9:16", "--quality", "4k"],
      });

      expect(result.exitCode).toBe(0);
      expect(requestBody?.model).toBe("gpt-image-2");
      expect(requestBody?.tools).toEqual([
        {
          type: "image_generation",
          size: "1024x1536",
          quality: "high",
          background: "transparent",
          output_format: "png",
        },
      ]);
      const input = requestBody?.input as Array<{ content: Array<Record<string, string>> }>;
      expect(Array.isArray(input)).toBe(true);
      expect(input[0]?.content[0]).toMatchObject({ type: "input_text" });
      expect(input[0]?.content[0]?.text).toContain("test prompt");
      expect(input[0]?.content[0]?.text).toContain("Aspect ratio: 9:16.");
      expect(input[0]?.content[0]?.text).toContain("Quality target: 4k.");
      expect(input[0]?.content[1]?.type).toBe("input_image");
      expect(input[0]?.content[1]?.image_url).toStartWith("data:image/png;base64,");
      await access(result.outputPath);
    } finally {
      await server.close();
    }
  });

  test("json output includes image URL and base64", async () => {
    const server = await startServer(async (request, response) => {
      if (request.url === "/image.png") {
        response.setHeader("Content-Type", "image/png");
        response.end(PNG_BYTES);
        return;
      }

      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ url: `${server.origin}/image.png` }] }));
    });

    try {
      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "image-test-key",
          IMAGE_API_URL: `${server.origin}/v1`,
          IMAGE_MODEL: "",
          OPENAI_API_KEY: "",
          OPENAI_IMAGE_MODEL: "",
          DEFAULT_QUALITY: "",
          DEFAULT_ASPECT_RATIO: "",
        },
        cliArgs: ["--json"],
      });

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.imageUrl).toBe(`${server.origin}/image.png`);
      expect(payload.imageBase64).toBe(PNG_BYTES.toString("base64"));
      await access(result.outputPath);
    } finally {
      await server.close();
    }
  });

  test("public-facing files do not contain real-looking API keys", async () => {
    const publicFiles = [
      ".env.example",
      "SKILL.md",
      "README.md",
      "references/config.md",
      "references/api.md",
      "agents/openai.yaml",
    ];
    const secretPrefix = ["s", "k"].join("");
    const secretPattern = new RegExp(`\\b${secretPrefix}-[A-Za-z0-9]{16,}\\b`);

    for (const relativePath of publicFiles) {
      const content = await readFile(path.join(SKILL_DIR, relativePath), "utf8");
      expect(content).not.toMatch(secretPattern);
    }
  });

  test("public-facing config docs do not recommend legacy provider variable names", async () => {
    const publicFiles = [
      ".env.example",
      "SKILL.md",
      "README.md",
      "references/config.md",
      "agents/openai.yaml",
    ];
    const legacyVariablePattern = /\b(?:OPENAI|TUZI)_(?:API_KEY|API_URL|IMAGE_MODEL|GENERATIONS_URL|EDITS_URL)\b/;

    for (const relativePath of publicFiles) {
      const content = await readFile(path.join(SKILL_DIR, relativePath), "utf8");
      expect(content).not.toMatch(legacyVariablePattern);
    }
  });

  test("keeps legacy OPENAI variables working as fallback", async () => {
    let requestPath = "";
    let requestAuth = "";
    let requestBody: Record<string, unknown> | null = null;
    const server = await startServer(async (request, response) => {
      requestPath = request.url ?? "";
      requestAuth = request.headers.authorization ?? "";
      requestBody = await readJsonBody(request);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "",
          IMAGE_API_URL: "",
          IMAGE_MODEL: "",
          OPENAI_API_KEY: "openai-test-key",
          OPENAI_API_URL: `${server.origin}/v1`,
        },
        cliArgs: ["--model", "gpt-image-1.5"],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Provider: image-api");
      expect(requestPath).toBe("/v1/images/generations");
      expect(requestAuth).toBe("Bearer openai-test-key");
      expect(requestBody).toEqual({
        model: "gpt-image-1.5",
        prompt: "test prompt",
        size: "1024x1024",
      });
    } finally {
      await server.close();
    }
  });

  test("preserves the Tuzi generation flow", async () => {
    let requestPath = "";
    let requestAuth = "";
    let requestBody: Record<string, unknown> | null = null;
    const server = await startServer(async (request, response) => {
      requestPath = request.url ?? "";
      requestAuth = request.headers.authorization ?? "";
      requestBody = await readJsonBody(request);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "",
          IMAGE_API_URL: "",
          IMAGE_MODEL: "",
          TUZI_API_KEY: "tuzi-test-key",
          TUZI_API_URL: `${server.origin}/v1`,
          TUZI_IMAGE_MODEL: "",
          OPENAI_API_KEY: "",
          OPENAI_IMAGE_MODEL: "",
          DEFAULT_QUALITY: "",
          DEFAULT_ASPECT_RATIO: "",
        },
        cliArgs: [],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Provider: image-api");
      expect(result.stdout).toContain("Model: gemini-3-pro-image-preview");
      expect(requestPath).toBe("/v1/images/generations");
      expect(requestAuth).toBe("Bearer tuzi-test-key");
      expect(requestBody).toEqual({
        model: "gemini-3-pro-image-preview",
        prompt: "test prompt",
        response_format: "url",
      });
      await access(result.outputPath);
    } finally {
      await server.close();
    }
  });

  test("uses custom neutral generations endpoint URL", async () => {
    let requestPath = "";
    const server = await startServer(async (request, response) => {
      requestPath = request.url ?? "";
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "image-test-key",
          IMAGE_API_URL: `${server.origin}/v1`,
          IMAGE_GENERATIONS_URL: `${server.origin}/custom/generations`,
          IMAGE_MODEL: "",
          OPENAI_API_KEY: "",
          OPENAI_IMAGE_MODEL: "",
          DEFAULT_QUALITY: "",
          DEFAULT_ASPECT_RATIO: "",
        },
        cliArgs: [],
      });

      expect(result.exitCode).toBe(0);
      expect(requestPath).toBe("/custom/generations");
    } finally {
      await server.close();
    }
  });

  test("uses DEFAULT_OUTPUT_DIR when --image is omitted", async () => {
    const tempRoot = await createTempRoot();
    const outputDir = path.join(tempRoot, "desktop", "images");
    const server = await startServer(async (request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "image-test-key",
          IMAGE_API_URL: `${server.origin}/v1`,
          IMAGE_MODEL: "",
          OPENAI_API_KEY: "",
          OPENAI_IMAGE_MODEL: "",
          DEFAULT_QUALITY: "",
          DEFAULT_ASPECT_RATIO: "",
          DEFAULT_OUTPUT_DIR: outputDir,
        },
        cliArgs: [],
        omitImage: true,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const savedLine = result.stdout.split("\n").find((line) => line.startsWith("Saved image: "));
      expect(savedLine).toBeDefined();
      const savedPath = savedLine!.replace("Saved image: ", "");
      expect(savedPath.startsWith(`${outputDir}${path.sep}`)).toBe(true);
      expect(path.basename(savedPath)).toMatch(/^image-\d{8}-\d{6}-\d+\.png$/);
      const savedBytes = await readFile(savedPath);
      expect(Buffer.compare(savedBytes, PNG_BYTES)).toBe(0);
    } finally {
      await server.close();
    }
  });

  test("uses Desktop images as the built-in output directory", async () => {
    const server = await startServer(async (request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "image-test-key",
          IMAGE_API_URL: `${server.origin}/v1`,
          IMAGE_MODEL: "",
          OPENAI_API_KEY: "",
          OPENAI_IMAGE_MODEL: "",
          DEFAULT_QUALITY: "",
          DEFAULT_ASPECT_RATIO: "",
          DEFAULT_OUTPUT_DIR: "",
        },
        cliArgs: [],
        omitImage: true,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const savedLine = result.stdout.split("\n").find((line) => line.startsWith("Saved image: "));
      expect(savedLine).toBeDefined();
      const savedPath = savedLine!.replace("Saved image: ", "");
      const expectedDir = path.join(result.homeDir, "Desktop", "images");
      expect(savedPath.startsWith(`${expectedDir}${path.sep}`)).toBe(true);
      expect(path.basename(savedPath)).toMatch(/^image-\d{8}-\d{6}-\d+\.png$/);
      const savedBytes = await readFile(savedPath);
      expect(Buffer.compare(savedBytes, PNG_BYTES)).toBe(0);
    } finally {
      await server.close();
    }
  });

  test("uses environment defaults from .env-style variables", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const server = await startServer(async (request, response) => {
      requestBody = await readJsonBody(request);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "image-test-key",
          IMAGE_API_URL: `${server.origin}/v1`,
          IMAGE_MODEL: "gemini-3.1-flash-image-preview",
          DEFAULT_ASPECT_RATIO: "1:4",
          DEFAULT_QUALITY: "4k",
        },
        cliArgs: [],
      });

      expect(result.exitCode).toBe(0);
      expect(requestBody).toMatchObject({
        model: "gemini-3.1-flash-image-preview",
        size: "1x4",
        quality: "4k",
      });
    } finally {
      await server.close();
    }
  });

  test("allows neutral gpt-image models to use quality defaults", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const server = await startServer(async (request, response) => {
      requestBody = await readJsonBody(request);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "image-test-key",
          IMAGE_API_URL: `${server.origin}/v1`,
          IMAGE_MODEL: "gpt-image-2",
          OPENAI_API_KEY: "",
          OPENAI_IMAGE_MODEL: "",
          DEFAULT_QUALITY: "4k",
          DEFAULT_ASPECT_RATIO: "",
        },
        cliArgs: [],
      });

      expect(result.exitCode).toBe(0);
      expect(requestBody).toMatchObject({
        model: "gpt-image-2",
        quality: "4k",
      });
    } finally {
      await server.close();
    }
  });

  test("uses repeated image fields for OpenAI-wire edits when model requires it", async () => {
    let requestPath = "";
    let requestAuth = "";
    let requestBody = "";
    const server = await startServer(async (request, response) => {
      requestPath = request.url ?? "";
      requestAuth = request.headers.authorization ?? "";
      requestBody = await readTextBody(request);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const tempRoot = await createTempRoot();
      const refOne = path.join(tempRoot, "ref-1.png");
      const refTwo = path.join(tempRoot, "ref-2.png");
      await writeFile(refOne, PNG_BYTES);
      await writeFile(refTwo, PNG_BYTES);

      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "image-test-key",
          IMAGE_API_URL: `${server.origin}/v1`,
          IMAGE_MODEL: "dall-e-3",
        },
        cliArgs: ["--ar", "3:2", "--ref", refOne, refTwo],
      });

      expect(result.exitCode).toBe(0);
      expect(requestPath).toBe("/v1/images/edits");
      expect(requestAuth).toBe("Bearer image-test-key");
      expect(requestBody).toContain('name="image"');
      expect(requestBody).not.toContain('name="image[]"');
      expect(requestBody.match(/name="image"/g)?.length).toBe(2);
      expect(requestBody).toContain('name="size"');
      expect(requestBody).toContain("1536x1024");
      expect(requestBody).toContain('name="response_format"');
      expect(requestBody).toContain("url");
    } finally {
      await server.close();
    }
  });

  test("uses custom neutral edits endpoint URL", async () => {
    let requestPath = "";
    const server = await startServer(async (request, response) => {
      requestPath = request.url ?? "";
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const tempRoot = await createTempRoot();
      const refOne = path.join(tempRoot, "ref.png");
      await writeFile(refOne, PNG_BYTES);

      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "image-test-key",
          IMAGE_API_URL: `${server.origin}/v1`,
          IMAGE_EDITS_URL: `${server.origin}/custom/edits`,
          IMAGE_REF_MODE: "edits-multipart",
        },
        cliArgs: ["--ref", refOne],
      });

      expect(result.exitCode).toBe(0);
      expect(requestPath).toBe("/custom/edits");
    } finally {
      await server.close();
    }
  });

  test("can send Tuzi references through multipart edits", async () => {
    let requestPath = "";
    let requestAuth = "";
    let requestBody = "";
    const server = await startServer(async (request, response) => {
      requestPath = request.url ?? "";
      requestAuth = request.headers.authorization ?? "";
      requestBody = await readTextBody(request);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString("base64") }] }));
    });

    try {
      const tempRoot = await createTempRoot();
      const refOne = path.join(tempRoot, "tuzi-ref.png");
      await writeFile(refOne, PNG_BYTES);

      const result = await runSkill({
        env: {
          IMAGE_API_KEY: "",
          IMAGE_API_URL: "",
          IMAGE_MODEL: "",
          TUZI_API_KEY: "tuzi-test-key",
          TUZI_API_URL: `${server.origin}/v1`,
          TUZI_REF_MODE: "edits-multipart",
          TUZI_EDITS_PATH: "/images/edits",
          TUZI_IMAGE_MODEL: "",
          OPENAI_API_KEY: "",
          OPENAI_IMAGE_MODEL: "",
          DEFAULT_QUALITY: "",
          DEFAULT_ASPECT_RATIO: "",
        },
        cliArgs: ["--ref", refOne],
      });

      expect(result.exitCode).toBe(0);
      expect(requestPath).toBe("/v1/images/edits");
      expect(requestAuth).toBe("Bearer tuzi-test-key");
      expect(requestBody).toContain('name="image"');
      expect(requestBody).toContain('name="response_format"');
      expect(requestBody).toContain("url");
    } finally {
      await server.close();
    }
  });
});
