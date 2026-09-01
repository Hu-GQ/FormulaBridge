# 阶段 0 整合与验收记录

2026-09-02（Asia/Shanghai）。代码基线已包含 #1、#2、#4、#5、#6 的实现，以及新增的 #3 外部诊断和 #7 终止、取消与恢复验证。统一门禁的实际结果为 **blocked**；尚未获得进入阶段 1 的许可。

## 固定基线与验证结果

真实统一运行固定在提交 `113a9000e744dd8a6c2923279e0612cd67a1af23`，检查集 `1.7.0`、corpus `1.3.0`。后续归档提交只保存本次证据、说明和归档回归检查，不改变被测实现。

| 工作 | 提交 | 结果 |
| --- | --- | --- |
| 整合 #5 与已有 #1/#2/#4/#6 | `6e2437d` | 已合并冲突，四个提供者处于同一基线 |
| #3 外部诊断与故障验证 | `eca3dd0` | 代码、29 项诊断测试及本机缺少注册的真实观测已完成；健康/禁用安装验收待补 |
| #7 取消、进程清理与同宿主恢复 | `1adf84a` | 代码、对抗语料和判定器测试已完成；Windows 11 原生验收待补 |
| 统一时间戳契约 | `113a900` | 修复 PowerShell 七位小数导致统一 schema 拒绝结果的问题；补充原生预检回归 |

该代码基线的 `npm run check` 通过，`npm test` 共 133 项：127 通过、0 失败、6 项需要显式真实环境的测试跳过。[原始默认测试日志](evidence/phase0-integration-2026-09-02/tests.log)随本记录保存。下表来自单独执行的真实统一门禁，因此 Word 的通过结果并非由跳过的单元测试推断。

| Issue | 实际证据 | 验收状态 |
| --- | --- | --- |
| #1 | 四个真实提供者已统一执行；环境、时间、哈希、语料和检查集完整归档；独立 schema/哈希校验通过 | 完成 |
| #2 | 安装实现已整合；没有可用的签名 MSI 和匹配的 `build-metadata.json` | 保持开放，blocked |
| #3 | 缺少注册、位数、依赖、签名、策略及陈旧加载状态的故障测试通过；本机诊断正确报告未安装 | 实现完成；真实健康状态和禁用状态验收未完成 |
| #4 | 真实 Word 的 7 项断言全部通过，包括新 UUID、清标签、移动/引用、保存重开和 DOCX 包检查 | 样机完成 |
| #5 | 真实 Word 的 6 项断言全部通过，包括双格式关系、普通复制、打印和 PDF 视觉回归 | 样机完成 |
| #6 | 当前 Windows 10 被支持平台预检拒绝，未启动隔离 TeX | 保持开放，blocked |
| #7 | 13 个同宿主任务的验证入口已接入；本次 lifecycle report 明确为 `not-run` | 保持开放，blocked |

本次机器为 Windows 10 Home China 22H2 x64（19045.7663），Word HomeStudent2019Retail x64（16.0.19127.20302）。#4/#5 的样机结论仅适用于本次观测，不能代替 #8 要求的 Windows 11 与 Microsoft 365 Current Channel、Monthly Enterprise Channel、Office 2024 x64 矩阵。

## 可复核证据

- [机器报告](evidence/phase0-integration-2026-09-02/report.json)与[人类可读报告](evidence/phase0-integration-2026-09-02/report.md)：包含全部断言证据位置、SHA-256 和版本化输入副本。
- [源码复制 DOCX 证据包](evidence/phase0-integration-2026-09-02/evidence/source-portable-copy/docx-package/package-evidence.zip)。
- [双格式 DOCX 证据包](evidence/phase0-integration-2026-09-02/evidence/dual-format-roundtrip/docx-package/roundtrip-documents.zip)、[Word 导出 PDF](evidence/phase0-integration-2026-09-02/evidence/dual-format-roundtrip/pdf/word-export.pdf)、[Word 打印 PDF](evidence/phase0-integration-2026-09-02/evidence/dual-format-roundtrip/print-output/word-print.pdf)和[视觉差异](evidence/phase0-integration-2026-09-02/evidence/dual-format-roundtrip/visual-diff/visual-diff.json)。
- [TeX 平台阻塞日志](evidence/phase0-integration-2026-09-02/evidence/tex-isolation/log/smoke.log)与[未运行的生命周期结果](evidence/phase0-integration-2026-09-02/evidence/tex-isolation/lifecycle-report/lifecycle-report.json)。
- [独立诊断原始观测](evidence/phase0-integration-2026-09-02/diagnostics-local.json)：2026-09-01 在未安装 FormulaBridge 的本机采集，诊断结果为故障；不能把它当作健康安装通过证据。

归档全部使用合成文档，固定字节不受 Git 换行转换影响。独立验证：

```powershell
npm run phase0 -- validate-report --report docs/evidence/phase0-integration-2026-09-02/report.json
```

此命令退出 `0` 表示归档完整可信；报告中的总体结果仍为 `blocked`。运行 `execute` 的退出 `1` 表示生成了有效的非通过报告，不能改记为发布通过。

## 剩余验收的操作顺序

1. 准备 Windows 11 x64 测试账户和支持的 Word；关闭已有 Word 窗口，供 smoke runner 创建自己的合成测试实例。
2. 在包含 VSTO 工作负载、MSBuild、Mage、SignTool 和 WiX 的构建环境，用已授权证书按 [VSTO 构建步骤](vsto-installation-spike.md)生成同一提交的签名 MSI 与 `build-metadata.json`，明确选择 `test` 或 `production` 信任等级。完整重跑应使用当前待验收提交重新构建，不混用旧包与新 metadata。
3. 设置 `FORMULABRIDGE_VSTO_INSTALLER`、`FORMULABRIDGE_VSTO_BUILD_METADATA`、`FORMULABRIDGE_VSTO_TRUST_LEVEL`，以及已批准 TeX 的 `FORMULABRIDGE_TEX_ENGINE`、`FORMULABRIDGE_TEX_ROOT`、`FORMULABRIDGE_TEX_ENGINE_SHA256`；按 [执行输入说明](phase0-evidence.md)记录真实机器版本、当前提交、语料版本和开始时间。
4. 运行统一入口，保存输出目录：

   ```powershell
   npm run phase0 -- execute --input C:\phase0-run\execution.json --output C:\phase0-run\report
   npm run phase0 -- validate-report --report C:\phase0-run\report\report.json
   ```

5. #2/#3 要求安装、重复安装、修复、卸载以及真实健康/禁用/恢复状态全部通过；#6/#7 要求隔离良性公式、全部攻击、运行中取消、完整 Job 清理、每次失败后的同宿主正常 PDF 和 Word 响应全部通过。缺少计量或清理失败时保持 Issue 开放。
6. 各项验收证据完整后关闭对应 Issue，再由 #8 执行全部支持矩阵和阶段 0 裁决。此次整合没有缩小该门禁。
