# 阶段 0 证据基线

本基线让验证人员用一个入口执行固定的阶段 0 检查提供者，生成可比较的 `report.json`、可审阅的 `report.md` 和自包含证据目录。VSTO 安装、普通复制、双格式往返和 TeX 隔离样机仍由各自 ticket 实现；样机把同步检查提供者注册到固定检查集后，统一入口负责执行、汇总、归档和拒绝不完整结果。

## 统一入口

执行输入必须符合 [`schemas/phase0-execution.schema.json`](../schemas/phase0-execution.schema.json)。`execute` 依次校验环境和 corpus，执行 [`phase0/checks.json`](../phase0/checks.json) 中注册的提供者，再校验结构化结果和证据并生成报告。VSTO 安装与 TeX 隔离样机已经注册提供者；未配置签名 MSI 或受支持的 TeX 环境时明确记为 `blocked`。没有提供者的检查记为 `not-run`，使总门禁返回非零：

```powershell
npm run phase0 -- execute --input C:\phase0-run\execution.json --output C:\phase0-run\report
```

检查提供者是仓库内的 CommonJS 模块，必须同步导出 `run(context)`，只在 runner 提供的临时工作目录写入证据，并返回符合运行清单单项检查结构的结果。提供者抛出异常时，runner 自动保存 `failed` 的结构化结果与日志；新增提供者必须随对应样机测试一起提交并提升检查集版本。

已经由受控外部环境采集的完整运行清单仍可通过 `run` 导入。该清单必须符合 [`schemas/phase0-run.schema.json`](../schemas/phase0-run.schema.json)；证据文件路径相对于输入清单所在目录，corpus manifest 路径相对于仓库根目录：

```powershell
npm run phase0 -- run --input C:\phase0-run\run.json --output C:\phase0-run\report
```

执行输入和完整运行清单共同记录：

- 40 位 Git 提交号；
- Windows 版本、构建号、体系结构和语言；
- Word 可用性，或版本、通道、位数和语言；
- 固定的 Node.js、.NET Framework、.NET、VSTO Runtime 和 WebView2 Runtime；每项必须记录可用版本，或显式记录 `unavailable` 与原因；
- TeX 可用性，或发行版与版本；
- 签名环境可用性，或测试/正式信任等级及工具版本；
- corpus 版本和 manifest。

`execute` 生成的完整运行清单（或外部导入的完整运行清单）还记录每项检查的名称、时间、结果、原因和证据文件。

报告为每个非空证据文件计算 SHA-256 和字节数，只写相对证据位置，不把本机用户名或绝对路径写入报告。`result` 必须符合 [`schemas/phase0-check-result.schema.json`](../schemas/phase0-check-result.schema.json)，并逐项覆盖检查集声明的全部断言；状态或断言不一致会使命令失败。证据统一映射到输出目录的 `evidence/<检查 ID>/<证据种类>/` 隔离树中。runner 同时把当次 corpus manifest、全部 corpus 文件和检查集复制到 `inputs/`，所以独立 `validate-report` 不依赖当前 checkout。所有读取和归档路径都会比较真实路径，符号链接、junction 或 reparse point 不能把文件带出声明根目录。

## 固定检查与证据

[`phase0/checks.json`](../phase0/checks.json)固定当前检查集版本、验收断言、提供者和运行时清单。运行输入必须按清单顺序恰好包含以下四项，不能省略、改名或用任意 sample 检查替代：

- VSTO 用户级安装、自动加载和外部诊断；
- 源码可移植普通复制；
- SVG 与 PNG Word 往返；
- TeX 文件/网络隔离及资源上限。

`passed` 必须同时提供清单中的结构化 `result`、`log` 和全部通过产物；`failed` 至少保留结构化 `result` 与 `log`；`blocked`、`not-run` 必须记录原因。空文件、缺少断言、错误检查 ID、结果状态与断言汇总不一致均属于不可信证据，退出码为 `2`。

## 结果定义

- `passed`：全部必需检查已执行且证据完整，并满足验收条件。
- `failed`：检查已经执行但验收条件失败；失败证据仍必须保留。
- `blocked`：缺少必需环境或前置条件，检查不能完成；必须记录原因。
- `not-run`：检查未执行；必须记录原因，不能当作通过。

总体结果按 `failed`、`blocked`、`not-run`、`passed` 的顺序取最严格状态。Word、TeX 或签名环境显式为 `unavailable` 时，总体结果至少为 `blocked`；缺少必需字段属于无效证据，不能生成通过报告。

退出码 `0` 表示全部通过。退出码 `1` 表示已经生成有效报告，但总体结果是 `failed`、`blocked` 或 `not-run`。退出码 `2` 表示输入、corpus、报告 schema 或证据不完整，报告不可信。

## Schema 与独立校验

- [`schemas/phase0-checks.schema.json`](../schemas/phase0-checks.schema.json)：固定检查与运行时清单，当前 `schemaVersion` 为 `1`。
- [`schemas/phase0-execution.schema.json`](../schemas/phase0-execution.schema.json)：统一执行入口的环境与运行元数据，当前 `schemaVersion` 为 `1`。
- [`schemas/phase0-run.schema.json`](../schemas/phase0-run.schema.json)：运行输入，当前 `schemaVersion` 为 `1`。
- [`schemas/phase0-check-result.schema.json`](../schemas/phase0-check-result.schema.json)：单项检查的断言与汇总状态，当前 `schemaVersion` 为 `1`。
- [`schemas/phase0-report.schema.json`](../schemas/phase0-report.schema.json)：机器报告，当前 `schemaVersion` 为 `1`。
- [`schemas/phase0-corpus.schema.json`](../schemas/phase0-corpus.schema.json)：语料清单，当前 `schemaVersion` 为 `1`。

可以独立验证版本化语料或已有报告：

```powershell
npm run phase0 -- validate-corpus --manifest corpus/phase0/manifest.json
npm run phase0 -- validate-checks --manifest phase0/checks.json
npm run phase0 -- validate-report --report C:\phase0-run\report\report.json
```

不兼容字段变更必须提升 schema 版本。报告中的 corpus 版本必须等于 manifest 的 `corpusVersion`，且归档 manifest 与所有归档语料文件的 SHA-256 必须匹配；检查集也按归档副本的版本和哈希验证。

## 最小无隐私语料

[`corpus/phase0/manifest.json`](../corpus/phase0/manifest.json)固定为合成、无个人数据的版本化语料，包含：

- 可由 Word 打开的最小 `.docx`，并保留可审计 OOXML 源文件；
- 一个最小 LaTeX 公式 JSON；
- 一个可正常编译的最小 LuaLaTeX 输入；
- 覆盖相对/绝对路径、受控输出外写入、环境变量、搜索路径、junction/symbolic-link reparse point、LuaLaTeX 文件与网络、shell/进程、超时、文件数/字节输出洪泛和内存上限的恶意 TeX 语料。

这些文件只是阶段 0 runner 与样机共享的合成基线，不读取用户文档，也不提前实现后续 ticket 的完整发布验证语料。
