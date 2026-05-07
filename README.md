# Saul Image Gen

一个给 AI Agent 使用的本地生图工具。

配置一次图片 API 后，脚本可以根据提示词或参考图生成图片，并保存到本地文件。

配置方式接近 Cherry Studio / Chatbox：只填 API 地址、Key 和模型；供应商由你自己决定。

## 快速开始

### 推荐：一键安装并配置

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/SaulgoodMan-C/saul-image-gen/main/install/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/SaulgoodMan-C/saul-image-gen/main/install/install.ps1 | iex
```

脚本会安装到 Codex skills 目录，并引导你填写：

- `IMAGE_API_URL`
- `IMAGE_API_KEY`
- `IMAGE_MODEL`

如果 `.env` 已存在，脚本默认保留原配置，不会覆盖真实 Key。

### 测试生成图片

```bash
npx -y tsx ~/.codex/skills/saul-skills/saul-image-gen/scripts/main.ts \
  --prompt "一只戴墨镜的柴犬，赛博朋克风格"
```

Windows PowerShell:

```powershell
npx -y tsx "$HOME\.codex\skills\saul-skills\saul-image-gen\scripts\main.ts" `
  --prompt "一只戴墨镜的柴犬，赛博朋克风格"
```

生成成功后，图片会保存到 `DEFAULT_OUTPUT_DIR` 配置的目录，并自动生成文件名；默认目录是 `~/Desktop/images`。

如果想精确指定文件名，可以加：

```bash
--image ./generated/shiba.png
```

## 下载文件包安装

如果不想运行远程安装脚本，可以下载文件包安装：

- 有发布包时：从 [GitHub Releases](https://github.com/SaulgoodMan-C/saul-image-gen/releases) 下载 `saul-image-gen.zip`。
- 暂无发布包时：点 GitHub 页面绿色 `Code` 按钮，选择 `Download ZIP`，下载源码包。

1. 解压下载的 ZIP。
2. 把 `saul-image-gen` 文件夹拖到 Codex skills 目录：
   - macOS / Linux：`~/.codex/skills/saul-skills/`
   - Windows：`$HOME\.codex\skills\saul-skills\`
3. 运行配置脚本。

macOS / Linux:

```bash
bash ~/.codex/skills/saul-skills/saul-image-gen/install/install.sh
```

Windows PowerShell:

```powershell
& "$HOME\.codex\skills\saul-skills\saul-image-gen\install\install.ps1"
```

## 手动安装

适合想自己管理 Git 更新的用户。

macOS / Linux:

```bash
mkdir -p ~/.codex/skills/saul-skills
git clone https://github.com/SaulgoodMan-C/saul-image-gen.git \
  ~/.codex/skills/saul-skills/saul-image-gen
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\.codex\skills\saul-skills" |
  Out-Null
git clone https://github.com/SaulgoodMan-C/saul-image-gen.git `
  "$HOME\.codex\skills\saul-skills\saul-image-gen"
```

安装后运行配置脚本，或手动创建：

```text
~/.codex/skills/saul-skills/saul-image-gen/.env
```

`.env` 至少填写：

```dotenv
IMAGE_API_KEY=你的_key
IMAGE_API_URL=https://api.tu-zi.com/v1
IMAGE_MODEL=gpt-image-2
IMAGE_WIRE_API=responses
IMAGE_REF_MODE=generations-json
```

`IMAGE_API_KEY` 必须绑定了图片生成权限。同一个 `IMAGE_API_URL` 下，不同 key 也可能对应不同渠道/权限；如果 key 只开了聊天或代码能力，会返回 `Image generation is not enabled for this group`。

## 配置

只需要配置一套 Image API。

```dotenv
[image-api]
# 支持：Tuzi、OpenAI 官方图片接口、OpenAI-compatible 中转、兼容 /images/generations 或 /responses 的图片供应商。
IMAGE_API_KEY=你的_key
IMAGE_API_URL=https://api.tu-zi.com/v1
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
| `Image generation is not enabled for this group` | 不是安装问题；当前 API key 对应的渠道/权限组没开生图。确认这个 key 已开通 image generation，或让服务商换一个有生图权限的 key/channel |
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

不要提交 `.env`、真实 API Key 或生成图片。
