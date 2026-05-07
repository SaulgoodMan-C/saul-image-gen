---
name: saul-image-gen
description: 当用户需要根据提示词或参考图生成位图图片，并通过已配置的兼容图片 API 保存到本地文件时使用。不要用于 SVG/矢量图、mask inpainting、精确编辑原图或服务商对比。
---

# Saul Image Gen

生成图片，并保存到本地文件。

适合 AI 在需要“生图并落盘”时直接调用，不用临时写请求、解析和保存逻辑。

## 最常用命令

```bash
npx -y tsx ~/.codex/skills/saul-skills/saul-image-gen/scripts/main.ts \
  --prompt "一只戴墨镜的柴犬，赛博朋克风格"
```

## 适用场景

| 场景 | 说明 |
| --- | --- |
| 文生图 | 用户要生成图片、插画、海报、素材、贴纸或封面 |
| 参考图生成 | 用户给了参考图，希望生成一张新图 |
| 文件落盘 | 用户要求结果保存成 `.png` 等位图文件 |

## 不适用场景

| 场景 | 原因 |
| --- | --- |
| SVG、Logo、Icon 等矢量任务 | 这不是位图生成工具 |
| mask inpainting、局部修补、精确编辑原图 | 当前脚本不提供 mask / 局部编辑流程 |
| 服务商效果、价格、性能对比 | 本技能只负责调用已配置的生图接口 |
| 只需要前端、Canvas 或 SVG 代码 | 这类任务应直接写代码 |

## 调用前检查

| 检查项 | 要求 |
| --- | --- |
| 配置 | `.env` 已配置 `IMAGE_API_KEY`；API 地址和模型按供应商要求填写 |
| 通道 | 兼容 Responses 的接口配置 `IMAGE_WIRE_API=responses`；传统图片接口可省略或设为 `images` |
| 输出路径 | 不传 `--image` 时保存到 `DEFAULT_OUTPUT_DIR` 并自动命名，默认是 `~/Desktop/images`；传了 `--image` 时目标文件不能已存在 |
| 参考图 | 如果用了 `--ref`，参考图文件必须存在 |
| 质量参数 | 如果用了 `--quality`，模型必须支持质量参数 |

配置说明：

```text
references/config.md
```

## 示例

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

## CLI 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--prompt` | 是 | 生图提示词 |
| `--image` | 否 | 最终图片保存路径；不填则保存到 `DEFAULT_OUTPUT_DIR` 并自动命名，默认是 `~/Desktop/images` |
| `--model` | 否 | 单次指定模型 |
| `--ar` | 否 | 图片比例，例如 `1:1`、`16:9`、`9:16` |
| `--quality` | 否 | 图片质量：`normal`、`2k`、`4k` |
| `--ref` | 否 | 一个或多个参考图路径 |
| `--json` | 否 | 输出机器可读 JSON，包含 `imageUrl` 和 `imageBase64` |

`--json` 适合给程序或 AI 串联处理。普通给人看时不要打印完整 base64，内容会很长。

## 排错

| 问题 | 处理方式 |
| --- | --- |
| 提示缺 key | 去 `.env` 填 `IMAGE_API_KEY` |
| 提示文件已存在 | 换一个 `--image` 路径；不传 `--image` 时脚本会自动命名 |
| 提示参考图不存在 | 检查 `--ref` 路径 |
| 提示参数不支持 | 换模型，或去掉 `--quality` / 调整 `--ar` |
| 提示 `Image generation is not enabled for this group` | 请求到达了接口，但当前 API key 对应渠道/权限组没开生图；让用户联系供应商给这个 key/channel 开启 image generation，或换一个有生图权限的 key |
| API 报错 | 保留错误文本，通常和 key、余额、模型或接口地址有关 |

## 测试

```bash
cd ~/.codex/skills/saul-skills/saul-image-gen
bun test
```

测试不需要真实 API Key。
