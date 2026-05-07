# 配置说明

如果只是马上使用，先配置一套 Image API 即可。

```text
~/.codex/skills/saul-skills/saul-image-gen/.env
```

`.env` 参考 Codex `config.toml` 的风格，用 section 把配置分组。

脚本只读取 `KEY=value` 行，`[section]` 行用于人类阅读。

## 私有配置

`.env` 可以放真实 API Key。

不要提交、截图或分享这个文件。

## 默认偏好

```dotenv
[defaults]
DEFAULT_QUALITY=
DEFAULT_ASPECT_RATIO=
DEFAULT_OUTPUT_DIR=~/Desktop/images
```

- `DEFAULT_QUALITY`：默认质量，例如 `normal`、`2k`、`4k`。
- `DEFAULT_ASPECT_RATIO`：默认比例，例如 `1:1`、`16:9`、`9:16`。
- `DEFAULT_OUTPUT_DIR`：不传 `--image` 时的默认保存目录，脚本会自动生成文件名。

质量和比例留空表示不指定。`DEFAULT_QUALITY` 只会在已知支持质量参数的模型上放行；输出目录留空时，脚本使用内置兜底 `~/Desktop/images`。

## Image API

日常配置收敛成 API 地址、Key 和模型，体验接近 Cherry Studio / Chatbox。

```dotenv
[image-api]
# 支持：Tuzi、OpenAI 官方图片接口、OpenAI-compatible 中转、兼容 /images/generations 或 /responses 的图片供应商。
IMAGE_API_KEY=你的_key
IMAGE_API_URL=https://api.tu-zi.com/v1
IMAGE_MODEL=gpt-image-2
IMAGE_WIRE_API=responses
IMAGE_REF_MODE=generations-json
```

脚本会把 API 地址自动拼成最终图片接口：

```text
POST {IMAGE_API_URL}/responses
POST {IMAGE_API_URL}/images/generations
POST {IMAGE_API_URL}/images/edits
```

`IMAGE_API_URL` 可以带或不带结尾斜杠，脚本会自动处理。

如果接口返回 `Image generation is not enabled for this group`，说明请求已经到达供应商，但当前 key 或分组没有开启生图权限。请换成服务商提供的图片接口 base URL，或让服务商给该 key/group 开启 image generation；这不是 Codex skill 安装问题。

## 参考图模式

`IMAGE_REF_MODE` 控制使用参考图时的走法：

- `generations-json`：常见写法，参考图放进 `/images/generations` 的 JSON `image` 数组。
- `edits-multipart`：参考图走 `/images/edits`，使用 `multipart/form-data`。

不同供应商对参考图字段的支持不完全一样。如果服务端报参数错误，先换另一个模式。

## 高级接口覆盖

多数时候不用配置这些项。只有中转服务的最终路径不标准时，再覆盖完整 endpoint URL：

```dotenv
IMAGE_RESPONSES_URL=https://api.example.com/custom/responses
IMAGE_GENERATIONS_URL=https://api.example.com/custom/image
IMAGE_EDITS_URL=https://api.example.com/custom/image-edits
```

## 旧配置兼容

脚本仍会兼容旧版按供应商拆开的环境变量，避免已有本地脚本突然失效。

新配置不建议再写这些旧变量；推广版统一使用 `IMAGE_*`。

## 配置优先级

```text
命令行参数 > .env / shell 环境变量 > 脚本内置默认值
```

- 单次临时覆盖：用命令行参数，比如 `--model`、`--ar`、`--quality`。
- 长期默认配置：写进 `.env`。
- 什么都不写：使用脚本内置默认值。
