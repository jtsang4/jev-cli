# jev-cli

> [English](./README.md) | 简体中文

**[Jev](https://docs.typesafe.ai)**（TypeSafe AI 的评估模型）的命令行工具。传入一段 state 和若干带类型的 question，返回结构化 JSON。

Jev 是一个 "System One" 模型：它不生成文字，而是针对共享的 state 回答带类型的问题，返回选项、分数和概率，供代码直接分支判断。因此它适合做分类、路由、评分卡和自动校验，不适合用来写文本——它根本不生成文本。

```bash
jev-cli eval -s "客服为用户全额退款 40 美元并致歉。" -q '{
  "refunded": {"type": "boolean", "instructions": "是否发生了退款？"},
  "tone":     {"type": "choice",  "instructions": "客服的语气如何？",
               "criteria": {"warm": "友好且有温度", "curt": "生硬或敷衍"}},
  "quality":  {"type": "score",   "instructions": "为这次处理打分。",
               "criteria": ["差", "合格", "优秀"]}
}'
```

```json
{
  "refunded": { "type": "boolean", "probability": 0.99 },
  "tone": { "type": "choice", "choice": "warm", "probabilities": { "curt": 0.02, "warm": 0.98 } },
  "quality": { "type": "score", "score": 1.78, "probabilities": { "0": 0, "1": 0.22, "2": 0.78 } }
}
```

## 安装

```bash
bun install -g @jtsang/jev-cli   # 或：npm install -g @jtsang/jev-cli
```

发布产物可在 Node 22+ 或 Bun 下运行。

## 配置

在 [TypeSafe AI 控制台](https://console.typesafe.ai/keys)获取 API Key，然后：

```bash
jev-cli config init
jev-cli config set providers.jev.apiKey <你的-key>
jev-cli doctor
```

默认 provider 是 `jev`，直连 TypeSafe AI 官方 API。如果你更想走 [Vercel AI Gateway](https://vercel.com/dashboard/ai-gateway) 转发，切过去即可：

```bash
jev-cli config set provider vercel
jev-cli config set providers.vercel.apiKey <你的-gateway-key>
```

`doctor` 会发起一次极小的评估请求，确认 key 和模型确实可用。加 `--offline` 则只校验配置，不发网络请求。

## 用法

```
jev-cli eval  -s, --state <文本>          -q, --questions <json>
              --state-file <路径>            --questions-file <路径>
              --state-json                   将 state 按 JSON 解析
              --provider <名称>  --model <id>  --timeout <毫秒>
              --full     附带 usage、warnings 和 provider 元数据
              --compact  输出单行 JSON

jev-cli config init | path | list | get <key> | set <key> <value> | unset <key>
jev-cli doctor [--offline] [--provider <名称>] [--model <id>]
```

两个输入都支持用 `-` 读取 stdin，但一次调用中只能有一个这么做：

```bash
git diff | jev-cli eval --state-file - --questions-file ./checks.json
```

## 问题类型

每个 question 都必须有 `instructions`。`instructions` 和各项 criteria 描述都可以是字符串、JSON 对象或 JSON 数组。

| 类型 | `criteria` | 返回结构 |
| --- | --- | --- |
| `boolean` | 可选 `{"true": …, "false": …}` | `{"type":"boolean","probability":0.98}` —— 是 **P(true)**，且未经校准 |
| `choice` | **必填。** 选项名 → 描述（可为 `null`） | `{"type":"choice","choice":"warm","probabilities":{…}}` |
| `score` | **必填。** 至少 **2** 个等级的数组，从低到高 | `{"type":"score","score":1.83,"probabilities":{…}}` |

三个容易踩的点：

- `boolean` 返回的是"为真的概率"，不是布尔值，也不是置信度，需要自己定阈值。
- `score` 是 `[0, 等级数-1]` 区间内的小数位置，为概率加权平均值，而非下标。
- `choice` 原样返回选项名，所以选项名应直接取代码里要 switch 的值。

`choice` 和 `score` 的置信度由 TypeSafe 单独给出，加 `--full` 后可在 `providerMetadata` 中读到：`jev` provider 下位于 `jev.answers.<id>.confidence`，走 gateway 时位于 `typesafe.confidence`。

所有 question 针对同一个 state **并行且相互隔离**地评估，因此多问几个几乎不增加成本——但每个问题都必须能独立成立。保持问题原子化，把组合逻辑放回自己的代码里。

## 配置文件

位于 `~/.jev-cli/config.yaml`，以 `0600` 权限写入。可用 `JEV_CLI_HOME` 覆盖目录。

```yaml
provider: jev
providers:
  jev:
    apiKey: "..."
    model: jev-latest
    # baseURL: https://api.typesafe.ai/v1
  vercel:
    apiKey: "vck_..."
    model: typesafe-ai/jev
    # baseURL: https://ai-gateway.vercel.sh/v4/ai
```

只有当前 `provider` 对应的配置会被读取，因此两套配置可以同时留在文件里。

| `provider` | 默认模型 | key 获取地址 | 环境变量回退 |
| --- | --- | --- | --- |
| `jev`（默认） | `jev-latest` | [TypeSafe AI](https://console.typesafe.ai/keys) | `JEV_CLI_API_KEY`、`TYPESAFE_API_KEY`、`TYPESAFE_AI_API_KEY` |
| `vercel` | `typesafe-ai/jev` | [Vercel AI Gateway](https://vercel.com/dashboard/ai-gateway) | `JEV_CLI_API_KEY`、`AI_GATEWAY_API_KEY` |

优先级为**命令行参数 > 环境变量 > 配置文件**——在 CI 中直接设环境变量即可，无需配置文件。

用 `jev-cli config set provider <名称>` 永久切换，或用 `--provider <名称>` 临时切换单次调用。注意 `JEV_CLI_API_KEY` 对当前生效的 provider 一律生效：如果两个 provider 都配好了，请改用各自专属的环境变量，否则同一个 key 会被发给两边。

`jev` provider 的 `model` 可填 `jev-latest`、`jev-preview`，或锁定具体版本如 `jev-1.13.0`。一旦校准了置信度阈值，建议锁版本，因为别名会随新版本发布而改变指向。

`config list` 默认对 key 做掩码，除非显式加 `--show-secrets`。

## 退出码

`eval` 的错误以 JSON 写入 stderr，stdout 只保留结果。

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | provider 或网络失败 |
| `2` | 参数用法错误或 question 不合法 |
| `3` | 缺少凭证或凭证被拒绝 |

## Agent skill

本包内置 [`skills/use-jev-cli`](./skills/use-jev-cli/SKILL.md)，用于告诉编码 agent 何时以及如何使用 `jev-cli`。

## 开发

```bash
bun install
bun test            # 单元测试 + CLI 端到端测试
bun run typecheck
bun run build       # 打包到 dist/cli.js，面向 Node
bun link            # 把本地构建装成全局 jev-cli
```

发布流程见 [RELEASING.md](./RELEASING.md)。

## 许可

MIT
