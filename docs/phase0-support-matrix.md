# 阶段 0 支持矩阵

固定被测提交：`7e36332c61ab780c7ad13e61cdc3354071d6d45f`。支持窗口按 2026-09-07 固定为 TeX Live 2024、2025、2026 和当前稳定 MiKTeX；覆盖三个 Word 产品／通道与四个 TeX 发行版的全部 12 个组合。文档提交与被测提交分别记录，不随 main 推进改变被测代码。

每行均须在该环境运行 `vsto-installation`、`source-portable-copy`、`dual-format-roundtrip`、`tex-isolation`，生成统一报告并独立执行 `validate-report`。只有四项全部通过、校验通过且临时系统改动恢复后，才能将该行标记为 `passed`。`pending` 表示尚无完整结果；`failed` 表示已取得未通过门禁的报告。报告校验通过不等于报告中的检查通过。

| Word 产品／通道（x64） | TeX 发行版 | 状态 | 统一报告 SHA-256 |
| --- | --- | --- | --- |
| Office 2024 | TeX Live 2024 | pending | — |
| Office 2024 | TeX Live 2025 | pending | — |
| Office 2024 | TeX Live 2026 | passed | 44EC59BEC6CD5E365E642772B5F92C3647415B86C77C44313C118AFFE88A5EB1 |
| Office 2024 | MiKTeX | pending | — |
| Microsoft 365 Current Channel | TeX Live 2024 | failed | F56F298E20728ADCEF3E685BDBC940C8E0540F4130379BB82955C13778F92830 |
| Microsoft 365 Current Channel | TeX Live 2025 | failed | FD3803354FC0CE16822DA7E501BFBE5F52097582A92566051227831CAF5C5445 |
| Microsoft 365 Current Channel | TeX Live 2026 | failed | 4BB2676FE33CF0B44D5B4283630F5EF9CB1ABC1FACCC07ACF944B89FF6750C71 |
| Microsoft 365 Current Channel | MiKTeX | failed | A9BFAED298B0D7135F780768FEE81C1FEB4C1C2A2DD871018F0EC3CE092DDD72 |
| Microsoft 365 Monthly Enterprise Channel | TeX Live 2024 | pending | — |
| Microsoft 365 Monthly Enterprise Channel | TeX Live 2025 | pending | — |
| Microsoft 365 Monthly Enterprise Channel | TeX Live 2026 | pending | — |
| Microsoft 365 Monthly Enterprise Channel | MiKTeX | pending | — |

## 已筛选的环境准备结果

- 已通过的 Office 2024 行使用 Word `16.0.17932.20076`、`ProPlus2024Volume`、zh-CN；四项结果、报告校验和恢复记录见[项目任务清单](project-task-checklist.md)。
- 新验收虚拟机使用 Windows 11 Pro 25H2 x64，build `26200.9168`。按用户最新要求不再复制虚拟机；未创建待删除的部分克隆。原有 TeX Live 2026 和构建工具链未重新安装。
- Current Channel 安装器退出码为 `0`；实际 Word `16.0.20326.20132`、`O365ProPlusRetail`、x64、zh-CN，通道 ID `492350f6-3a01-4f97-b9c0-c7c6ddf67d60`。用户完成激活操作后，交互会话中的 Word COM 已成功创建、编辑和保存合成文档；`vnextdiag.ps1 -action list` 仍返回 `No licenses found`，旧许可诊断为 `TIMEBASED_SUB`／`OOB_GRACE`。不将可编辑性记为已确认订阅激活。
- Monthly Enterprise 的目标版本为 `16.0.20228.20188`；安装文件下载退出码 `0`，尚未安装和验收。两通道的目标版本依据微软[受支持版本表](https://learn.microsoft.com/en-us/officeupdates/update-history-microsoft365-apps-by-date)确定。
- MiKTeX Portable 已安装，LuaHBTeX `1.25.7`，发行版 `MiKTeX 26.5 Portable`。首次健康检查因缺少 `lualatex.fmt` 失败；准备格式和依赖后，以关闭自动安装的参数完成基础编译，退出码 `0` 且生成 PDF。隔离门禁结果见后文。
- TeX Live 2024／2025 已从 [TUG 列出的历史镜像](https://tug.org/historic/)分别安装到独立年度目录，安装退出码均为 `0`，LuaHBTeX 版本分别为 `1.18.0`／`1.22.0`，已运行隔离门禁，结果见后文。下载物的哈希用于标识本次取得的文件，不单独构成发行方签名验证。

| 对象 | 版本／年份 | SHA-256 |
| --- | --- | --- |
| Microsoft ODT setup.exe（Microsoft Authenticode 有效） | 16.0.20228.20124 | F266BC16834FBFAE5AA7ACA7C27ED5F393CAC0BB2ACEBC2D5BB2DD7813CF7497 |
| MiKTeX lualatex.exe | 26.5 Portable | DD34FD3916D06511748022EF1654F635C8F1A3FD4940C5349BB6C3B643CA52A9 |
| TeX Live lualatex.exe | 2024 | 435380C1DCFF46EED2AF3FC4F65DF7E0040A55E8654759ABC64BA534AE4B6113 |
| TeX Live lualatex.exe | 2025 | CC944A1DB010B47FCF5CCB5D1B184CBA208FE7FEA9F18BEC414940E6FD3E24A6 |
| TeX Live install-tl.zip | 2024 | 9534F56501056E0D1AD714056DFEAF1A6CEE78644342ABE354036000F170B4BA |
| TeX Live install-tl.zip | 2025 | 3E4E7AE975DCF321AF8A2CBF6AA050ABA5012DD4528255D552FA479F456C464B |

完整 evidence、截图、原始日志和原始报告只保留在验收虚拟机；宿主仓库仅记录筛选后的结果、版本、提交和哈希。密码只经交互 stdin 使用。每个环境结束后移除本次新增的临时证书、打印机、计划任务、AppContainer profile 和 ACL，并恢复原系统设置；准备中的环境不能提前记为已恢复。

## Current Channel／TeX Live 2026 首次运行

被测提交保持固定。统一报告生成退出码 `1`，`validate-report` 退出码 `0`，报告结论 `failed`，SHA-256 为上表所列值。四项均实际执行，未经筛选的材料保留在虚拟机。

| 检查 | 结果 | 已筛选结论 |
| --- | --- | --- |
| vsto-installation | passed | 在交互会话 1 的非提升令牌下完成安装与诊断断言 |
| source-portable-copy | passed | 源码复制七项断言通过 |
| dual-format-roundtrip | failed | 保存、重开及复制通过；`-ProvisionPrintCapture` 路径的 `PrintOut` 调用发生布尔参数到 `Object` 的绑定错误 |
| tex-isolation | failed | 文件、网络、资源及固定策略断言通过；生命周期宿主超过冻结脚本的 8 分钟期限，取消、同宿主恢复和 Word 生存断言未完成 |

本次 VSTO 使用非提升令牌，其余检查使用提升令牌，均在会话 1、临时 `EnableLUA=1` 下执行。冻结源码、检查断言和时间限制没有修改。报告汇总使用字符串方式读取原始 ISO 时间戳，避免 PowerShell 自动转换日期后改变 schema 要求的表示格式。

超时终止后发现一个本次创建的 `FBTex` profile 和 TeX 根目录上的对应 SID ACE；已删除该 ACE 与 profile，删除 API 返回 `0`，复查指定目录及映射无残留。首次打印捕获的临时打印机已由脚本删除；VSTO 任务及首轮 Word／TeX 任务已删除。临时 Root 证书仍在受控清理清单内，UAC 尚待整个 Current Channel 环境结束后恢复，不能记为该环境已清理完成。

后续按原 Office 2024 验收配置，以标准权限、显式 STA 和预配 PDF 打印机复测冻结的双格式脚本，六项断言全部通过，退出码 `0`；该检查片段 SHA-256 为 `4B7F9AD20C713B2CC4B7223590B821392C4E6E28FB4DFEC84566830BF6E971A0`。新结果单独保留，不覆盖首次失败报告，后续沿用这一打印配置。TeX 的固定生命周期超时仍是未解决的门禁问题，整行仍不能标记通过。

## Current Channel／TeX Live 2026 普通优先级复测

同一冻结提交使用显式 STA、仅进程级的选定 TeX PATH 和 Normal 优先级复测，未改变原生检查、8 分钟生命周期期限或产品资源策略。生命周期仍超时，取消、同宿主恢复与 Word 生存断言未完成，普通优先级没有解决该门禁问题。

独立的新统一报告合并原 VSTO／源码复制通过片段、已通过的双格式复测片段和本次 TeX 失败片段：前三项 `passed`、TeX `failed`；生成退出码 `1`，`validate-report` 退出码 `0`。新报告 SHA-256：`4BDB7EE8AB74AB9F41A8A4D4B6BD09B3F44A04F9BDEEF3B5552639B3C6CA2218`；本次 TeX 片段 SHA-256：`0C77DAB5C056CFFB2A825E718C5778D0CC317DE81E04383500D9DCFA635DCE94`。上表保留首次失败报告标识，首次材料未覆盖。

本次超时遗留一个 profile，队列因此停止；删除 API 返回 `0`，profile 映射已消失，TeX 根目录、受保护子目录及祖先目录未发现对应 SID ACE 残留。随后恢复串行队列。用户完成 Root 证书的交互删除后，复查临时证书在 `My`、`Root`、`TrustedPublisher` 的计数均为 `0`；UAC 及当前运行任务仍待整个环境结束后恢复。

## Current Channel 其余 Word 检查

Current Channel／TeX Live 2024、2025 和 MiKTeX 的 `vsto-installation`、`source-portable-copy`、`dual-format-roundtrip` 共九项检查均通过。它们均使用固定提交、交互会话 1 和标准权限；双格式检查使用显式 STA 与预配 PDF 打印机。该批任务及临时打印机已删除，默认打印机列表与运行前一致（空）。这九项 Word 检查不能单独满足四项统一门禁。

| Current Channel 的检查片段 | TeX Live 2024 SHA-256 | TeX Live 2025 SHA-256 | MiKTeX SHA-256 |
| --- | --- | --- | --- |
| vsto-installation | C1BB9BE0B2A5FE544D7A951276E5DFA740B3DB40D14A6A6019CA31DA1F7B79C6 | 001B0E89EAD2A24C003D4DC76C4F57D77FAEEC47131D9F5D162465FD42EB5BE9 | EB0031BF73128ACCF9E77DCA9C3A0F457038A3DBFD573F6B3CF6CB7AEB5E4726 |
| source-portable-copy | 8CC18F560A0B9749FB0AE5F758F400F3597ADF9452FC21FAC79364ED52CC3D89 | FF36F9B4C485986820C7E6471CD3C818B2994850592452D9244C970B5C75011B | 9842DC039A37A4CFA9B2A79025A19D1B6763F28C0DD1EF543249D7CB49AF1AE5 |
| dual-format-roundtrip | D4A66B4B3D2B578EBE87FAF606BF0C30904DC4795B894CF542BE631D9114323C | 94E62CBB679EB2B833AC6CA9AEC1959D7B207CDDF43699A4D4D11A260CC21BF6 | E94A2AAA4572533D348DEDC56CBBD09C54A250FC34870C763AD235C0EAD103A4 |

## 裁决

Current Channel 其余三个组合现已完成首次四项运行，各统一报告的 `validate-report` 退出码均为 `0`，但 TeX 检查均为 `failed`。TeX Live 2024／2025 的原生沙箱成功启动、引擎退出码 `1`，良性公式未生成 PDF；MiKTeX 的良性公式触发固定墙钟时限，亦无 PDF。后续攻击及生命周期断言未运行，不能将其判为通过。三个组合均报告 `profileDeleted=true`、`aclRestored=true`。年度版在普通环境中的合成公式编译退出码均为 `0` 且生成 PDF，隔离环境失败的原因仍待诊断。报告 SHA-256 见上表，原始材料仅在虚拟机中保留。

尚未通过完整支持矩阵，阶段 1 门禁保持关闭，[Issue #8](https://github.com/Hu-GQ/FormulaBridge/issues/8) 保持开放。既有 Office 2024／TeX Live 2026 的通过结果仅覆盖该组合。
