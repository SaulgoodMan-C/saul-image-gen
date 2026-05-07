# Saul Image Gen

一个给 AI Agent 使用的本地生图工具。

配置一次图片 API 后，脚本可以根据提示词或参考图生成图片，并保存到本地文件。

配置方式接近 Cherry Studio / Chatbox：只填 API 地址、Key 和模型；供应商由你自己决定。

## 快速开始

1. 安装到 Codex skills 目录：

```bash
mkdir -p ~/.codex/skills/saul-skills
git clone https://github.com/SaulgoodMan-C/saul-image-gen.git \
  ~/.codex/skills/saul-skills/saul-image-gen
```

2. 配置：

```text
~/.codex/skills/saul-skills/saul-image-gen/.env
```

可以从示例文件开始：

```bash
cd ~/.codex/skills/saul-skills/saul-image-gen
cp .env.example .env
```

然后编辑 `.env`，填自己的 `IMAGE_API_KEY`、`IMAGE_API_URL` 和 `IMAGE_MODEL`。

3. 生成图片：

```bash
npx -y tsx ~/.codex/skills/saul-skills/saul-image-gen/scripts/main.ts \
  --prompt "一只戴墨镜的柴犬，赛博朋克风格"
```

生成成功后，图片会保存到 `DEFAULT_OUTPUT_DIR` 配置的目录，并自动生成文件名；默认目录是 `~/Desktop/images`。

如果想精确指定文件名，可以加：

```bash
--image ./generated/shiba.png
```

## 配置

只需要配置一套 Image API。

```dotenv
[image-api]
# 支持：Tuzi、OpenAI 官方图片接口、OpenAI-compatible 中转、兼容 /images/generations 或 /responses 的图片供应商。
IMAGE_API_KEY=你的_key
IMAGE_API_URL=https://api.tu-zi.com/coding
IMAGE_MODEL=gpt-image-2
IMAGE_WIRE_API=responses
IMAGE_REF_MODE=generations-json
```

默认最终请求会这样拼：

```text
POST {IMAGE_API_URL}/responses              # IMAGE_WIRE_API=responses
POST {IMAGE_API_URL}/images/generations
POST {IMAGE_API_URL}/images/edits
```

特殊中转接口如果路径不同，再看 `references/config.md` 里的高级覆盖项。

## 常用参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--prompt` | 是 | 生图提示词 |
| `--image` | 否 | 最终图片保存路径；不填则保存到 `DEFAULT_OUTPUT_DIR` 并自动命名，默认是 `~/Desktop/images` |
| `--model` | 否 | 单次指定模型 |
| `--ar` | 否 | 图片比例，例如 `1:1`、`16:9`、`9:16` |
| `--quality` | 否 | 图片质量：`normal`、`2k`、`4k` |
| `--ref` | 否 | 一个或多个参考图路径 |
| `--json` | 否 | 输出机器可读 JSON |

## 常用示例

指定比例和质量：

```bash
npx -y tsx ~/.codex/skills/saul-skills/saul-image-gen/scripts/main.ts \
  --prompt "电影感城市夜景海报" \
  --image ./generated/poster.png \
  --ar 16:9 \
  --quality 2k
```

使用参考图：

```bash
npx -y tsx ~/.codex/skills/saul-skills/saul-image-gen/scripts/main.ts \
  --prompt "参考这张图的构图，生成更梦幻的版本" \
  --image ./generated/ref-style.png \
  --ref ./input/reference.png
```

输出 JSON：

```bash
npx -y tsx ~/.codex/skills/saul-skills/saul-image-gen/scripts/main.ts \
  --prompt "一张极简产品海报" \
  --image ./generated/product.png \
  --json
```

`--json` 输出包含：

```json
{
  "savedImage": "./generated/image-20260425-141530-12345.png",
  "provider": "image-api",
  "model": "gpt-image-2",
  "imageUrl": "https://...",
  "imageBase64": "iVBORw0KGgo..."
}
```

`imageBase64` 会比较长，适合给程序或 AI 串联处理，不适合直接给人看。

## 配置优先级

```text
命令行参数 > .env / shell 环境变量 > 脚本内置默认值
```

| 场景 | 做法 |
| --- | --- |
| 单次临时修改 | 使用命令行参数，例如 `--model`、`--ar`、`--quality` |
| 长期默认配置 | 写进 `.env` |
| 没写的配置 | 使用脚本内置默认值 |

## 常见问题

| 问题 | 处理方式 |
| --- | --- |
| 提示缺少 API Key | 去 `.env` 填 `IMAGE_API_KEY` |
| 提示输出文件已存在 | 换一个 `--image` 路径；不传 `--image` 时脚本会自动命名 |
| 参考图找不到 | 检查 `--ref` 后面的路径是否真实存在 |
| 不知道 URL 怎么填 | 先用服务商示例 URL；中转接口则改成中转地址 |
| API 报错 | 保留错误文本；如果有 `request_id`，反馈问题时一起提供 |

反馈给服务商时，注意提供脱敏后的调用时间、接口名、请求体和响应体。

## 更多文档

| 文档 | 内容 |
| --- | --- |
| `references/config.md` | 配置细节 |
| `references/api.md` | API 细节 |
| `SKILL.md` | AI 调用说明 |

## 测试

```bash
cd ~/.codex/skills/saul-skills/saul-image-gen
bun test
```

测试不需要真实 API Key。

## 发布注意

不要提交 `.env`、真实 API Key 或生成图片。仓库里的 `.env.example` 只放占位值。
