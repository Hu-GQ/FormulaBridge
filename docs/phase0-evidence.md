# 阶段 0 证据基线

本基线让验证人员用一个入口运行固定的阶段 0 检查集，生成可比较的 `report.json`、可审阅的 `report.md` 和自包含证据目录。它只定义证据与报告契约，不实现 VSTO 安装、普通复制、双格式往返或 TeX 隔离检查。

## 统一入口

运行清单必须符合 [`schemas/phase0-run.schema.json`](../schemas/phase0-run.schema.json)。证据文件路径相对于输入清单所在目录；corpus manifest 路径相对于仓库根目录。命令会依次校验输入 schema、固定检查集、固定运行时、证据完整性、corpus manifest 与固定哈希、输出报告 schema，然后把证据复制到输出目录并写入两种报告：

```powershell
npm run phase0 -- run --input C:\phase0-run\run.json --output C:\phase0-run\report
```

输入清单记录：

- 40 位 Git 提交号；
- Windows 版本、构建号、体系结构和语言；
- Word 可用性，或版本、通道、位数和语言；
- 固定的 Node.js、.NET Framework、.NET、VSTO Runtime 和 WebView2 Runtime；每项必须记录可用版本，或显式记录 `unavailable` 与原因；
- TeX 可用性，或发行版与版本；
- 签名环境可用性，或测试/正式信任等级及工具版本；
- corpus 版本和 manifest；
- 每项检查的名称、时间、结果、原因和证据文件。

报告为每个证据文件计算 SHA-256 和字节数，只写相对证据位置，不把本机用户名或绝对路径写入报告。证据统一映射到输出目录的 `evidence/<检查 ID>/<证据种类>/` 隔离树中，避免与 `report.json`、`report.md` 等报告产物冲突；每项检查同时记录该次运行的环境快照。独立 `validate-report` 会重新读取这些文件并核对大小、SHA-256、corpus manifest 和检查集 manifest。

## 固定检查与证据

[`phase0/checks.json`](../phase0/checks.json)固定 `1.0.0` 检查集和运行时清单。运行输入必须按清单顺序恰好包含以下四项，不能省略、改名或用任意 sample 检查替代：

- VSTO 用户级安装、自动加载和外部诊断；
- 源码可移植普通复制；
- SVG 与 PNG Word 往返；
- TeX 文件/网络隔离及资源上限。

`passed` 必须同时提供清单中的 `result`、`log` 和全部通过产物；`failed` 至少保留 `result` 与 `log`；`blocked`、`not-run` 必须记录原因。此处只冻结后续样机要提交的证据种类，不实现那些样机。

## 结果定义

- `passed`：全部必需检查已执行且证据完整，并满足验收条件。
- `failed`：检查已经执行但验收条件失败；失败证据仍必须保留。
- `blocked`：缺少必需环境或前置条件，检查不能完成；必须记录原因。
- `not-run`：检查未执行；必须记录原因，不能当作通过。

总体结果按 `failed`、`blocked`、`not-run`、`passed` 的顺序取最严格状态。Word、TeX 或签名环境显式为 `unavailable` 时，总体结果至少为 `blocked`；缺少必需字段属于无效证据，不能生成通过报告。

退出码 `0` 表示全部通过。退出码 `1` 表示已经生成有效报告，但总体结果是 `failed`、`blocked` 或 `not-run`。退出码 `2` 表示输入、corpus、报告 schema 或证据不完整，报告不可信。

## Schema 与独立校验

- [`schemas/phase0-checks.schema.json`](../schemas/phase0-checks.schema.json)：固定检查与运行时清单，当前 `schemaVersion` 为 `1`。
- [`schemas/phase0-run.schema.json`](../schemas/phase0-run.schema.json)：运行输入，当前 `schemaVersion` 为 `1`。
- [`schemas/phase0-report.schema.json`](../schemas/phase0-report.schema.json)：机器报告，当前 `schemaVersion` 为 `1`。
- [`schemas/phase0-corpus.schema.json`](../schemas/phase0-corpus.schema.json)：语料清单，当前 `schemaVersion` 为 `1`。

可以独立验证版本化语料或已有报告：

```powershell
npm run phase0 -- validate-corpus --manifest corpus/phase0/manifest.json
npm run phase0 -- validate-checks --manifest phase0/checks.json
npm run phase0 -- validate-report --report C:\phase0-run\report\report.json
```

不兼容字段变更必须提升 schema 版本。报告中的 corpus 版本必须等于 manifest 的 `corpusVersion`，且 manifest 与所有语料文件的 SHA-256 必须匹配。

## 最小无隐私语料

[`corpus/phase0/manifest.json`](../corpus/phase0/manifest.json)固定为合成、无个人数据的 `1.0.0` 语料，包含：

- 可由 Word 打开的最小 `.docx`，并保留可审计 OOXML 源文件；
- 一个最小 LaTeX 公式 JSON；
- 一个尝试读取受控根外 canary 的恶意 TeX 文件。

这些文件只是阶段 0 runner 与后续样机共享的最小基线，不提前实现后续 ticket 的完整发布验证语料。
