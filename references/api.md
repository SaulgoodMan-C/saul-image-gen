# API 说明

本文件面向维护者，用来说明当前脚本如何调用兼容图片接口。

如果只是配置 key、URL 和模型，请看：

```text
references/config.md
```

## 速览

当前公开配置统一使用 `IMAGE_*`，默认请求路径如下：

| 场景 | 请求方式 | 接口 |
| --- | --- | --- |
| Responses 生图 | JSON | `POST {IMAGE_API_URL}/responses` |
| 文生图 | JSON | `POST {IMAGE_API_URL}/images/generations` |
| 参考图生成 | JSON | `POST {IMAGE_API_URL}/images/generations` |
| 参考图编辑 | `multipart/form-data` | `POST {IMAGE_API_URL}/images/edits` |

支持范围以接口兼容性为准：Tuzi、OpenAI 官方图片接口、OpenAI-compatible 中转，以及其他兼容 `/images/generations` 或 `/responses` 的图片供应商。

## 请求体

### Responses image_generation

`IMAGE_WIRE_API=responses` 时使用：

```json
{
  "model": "gpt-image-2",
  "input": "生图提示词",
  "tools": [{ "type": "image_generation" }]
}
```

脚本会从 `output[].type=image_generation_call` 的 `result` 字段读取 base64 图片并保存。

### JSON generations

示例最小请求体：

```json
{
  "model": "gpt-image-2",
  "prompt": "一只戴墨镜的柴犬",
  "response_format": "url"
}
```

可选字段：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `size` | `--ar` / `DEFAULT_ASPECT_RATIO` | 通用接口里 `16:9` 会变成 `16x9` |
| `quality` | `--quality` / `DEFAULT_QUALITY` | 通用接口里 `normal` 会变成 `1k` |
| `image` | `--ref` | `IMAGE_REF_MODE=generations-json` 时，本地参考图转成 base64 data URL 数组 |

### Multipart edits

`IMAGE_REF_MODE=edits-multipart` 时走 `/images/edits`。

典型字段：

| 字段 | 说明 |
| --- | --- |
| `image` | 每张参考图一个字段 |
| `prompt` | 提示词 |
| `model` | 模型 |
| `size` | 比例或像素尺寸，取决于供应商协议 |
| `response_format` | 默认 `url` |

## CLI 参数映射

| CLI 参数 | API 字段 / 行为 |
| --- | --- |
| `--prompt` | 请求里的 `prompt` |
| `--model` | 请求里的 `model` |
| `--ar` | 请求里的 `size` |
| `--quality` | 请求里的 `quality`；不同供应商和模型会有不同转换 |
| `--ref` | 根据 `IMAGE_REF_MODE` 走 JSON `image` 数组或 multipart `image` 字段 |
| `--json` | 不影响 API 请求，只影响 CLI 输出 |

使用 `--json` 时，CLI 会额外输出：

| 字段 | 说明 |
| --- | --- |
| `imageUrl` | API 原始返回 URL；如果 API 返回 base64，则为 `null` |
| `imageBase64` | 最终图片内容的 base64 字符串；如果 API 返回 URL，脚本会先下载图片再转换为 base64 |

## 响应解析

脚本只读取 `data[0]` 的第一张图。

解析顺序如下：

| 优先级 | 字段 |
| --- | --- |
| 1 | `b64_json` |
| 2 | `base64` |
| 3 | `image_base64` |
| 4 | `url` |

base64 字段会直接解码保存；`url` 字段会先下载图片再保存。

如果以上字段都没有，脚本会失败。

保存文件后，`--json` 输出还会包含最终图片的 `imageBase64`，方便下一个程序或 AI 继续处理。

## 参数约束

通用路径会对下面模型放行 `--quality`：

| 模型 |
| --- |
| `gemini-3-pro-image-preview` |
| `gemini-3.1-flash-image-preview` |
| `gpt-image-*` |

其他模型默认本地拦截，避免把供应商不支持的参数发出去。不同中转服务的模型支持会变，若服务端已支持新模型，可以把脚本里的 quality 放行列表同步更新。

通用路径标准比例：

```text
1:1, 16:9, 9:16, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 21:9
```

`gemini-3.1-flash-image-preview` 额外支持：

```text
1:4, 4:1, 1:8, 8:1
```

当脚本识别到官方 OpenAI 图片接口或 `dall-e-*` 模型时，会使用像素尺寸映射：

| 输入比例 | 输出尺寸 |
| --- | --- |
| 横图 | `1536x1024` |
| 竖图 | `1024x1536` |
| 方图或未指定 | `1024x1024` |

## 错误处理

| 情况 | 行为 |
| --- | --- |
| HTTP 非 2xx | 显示 API 返回文本 |
| 参数不兼容 | 本地失败，不发请求 |
| 响应里没有图片字段 | 提示缺少图片数据 |
| 响应里包含 `request_id` | 排查问题时应保留 |

反馈给服务商时，建议提供：调用时间、接口名、脱敏后的请求体和响应体。
