# 阶段 0 支持矩阵

固定被测提交：`7e36332c61ab780c7ad13e61cdc3354071d6d45f`。支持窗口按 2026-09-07 固定为 TeX Live 2024、2025、2026 和当前稳定 MiKTeX；覆盖三个 Word 产品／通道与四个 TeX 发行版的全部 12 个组合。文档提交与被测提交分别记录，不随 main 推进改变被测代码。

每行均须在该环境运行 `vsto-installation`、`source-portable-copy`、`dual-format-roundtrip`、`tex-isolation`，生成统一报告并独立执行 `validate-report`。只有四项全部通过、校验通过且临时系统改动恢复后，才能将该行标记为 `passed`。`pending` 表示尚无完整通过证据，不表示兼容性通过或失败。

| Word 产品／通道（x64） | TeX 发行版 | 状态 | 统一报告 SHA-256 |
| --- | --- | --- | --- |
| Office 2024 | TeX Live 2024 | pending | — |
| Office 2024 | TeX Live 2025 | pending | — |
| Office 2024 | TeX Live 2026 | passed | 44EC59BEC6CD5E365E642772B5F92C3647415B86C77C44313C118AFFE88A5EB1 |
| Office 2024 | MiKTeX | pending | — |
| Microsoft 365 Current Channel | TeX Live 2024 | pending | — |
| Microsoft 365 Current Channel | TeX Live 2025 | pending | — |
| Microsoft 365 Current Channel | TeX Live 2026 | pending | — |
| Microsoft 365 Current Channel | MiKTeX | pending | — |
| Microsoft 365 Monthly Enterprise Channel | TeX Live 2024 | pending | — |
| Microsoft 365 Monthly Enterprise Channel | TeX Live 2025 | pending | — |
| Microsoft 365 Monthly Enterprise Channel | TeX Live 2026 | pending | — |
| Microsoft 365 Monthly Enterprise Channel | MiKTeX | pending | — |

## 已筛选的环境准备结果

- 已通过的 Office 2024 行使用 Word `16.0.17932.20076`、`ProPlus2024Volume`、zh-CN；四项结果、报告校验和恢复记录见[项目任务清单](project-task-checklist.md)。
- 新验收虚拟机使用 Windows 11 Pro 25H2 x64，build `26200.9168`。按用户最新要求不再复制虚拟机；未创建待删除的部分克隆。原有 TeX Live 2026 和构建工具链未重新安装。
- Current Channel 安装器退出码为 `0`；实际 Word `16.0.20326.20132`、`O365ProPlusRetail`、x64、zh-CN，通道 ID `492350f6-3a01-4f97-b9c0-c7c6ddf67d60`。用户完成激活操作后，交互会话中的 Word COM 已成功创建、编辑和保存合成文档；`vnextdiag.ps1 -action list` 仍返回 `No licenses found`，该诊断没有提供可确认的订阅许可状态。尚未运行完整门禁。
- Monthly Enterprise 的目标版本为 `16.0.20228.20188`；安装文件下载退出码 `0`，尚未安装和验收。两通道的目标版本依据微软[受支持版本表](https://learn.microsoft.com/en-us/officeupdates/update-history-microsoft365-apps-by-date)确定。
- MiKTeX Portable 已安装，LuaHBTeX `1.25.7`，发行版 `MiKTeX 26.5 Portable`。首次健康检查因缺少 `lualatex.fmt` 失败；准备格式和依赖后，以关闭自动安装的参数完成基础编译，退出码 `0` 且生成 PDF。尚未通过隔离门禁。
- TeX Live 2024／2025 已从 [TUG 列出的历史镜像](https://tug.org/historic/)分别安装到独立年度目录，安装退出码均为 `0`，LuaHBTeX 版本分别为 `1.18.0`／`1.22.0`，尚未运行隔离门禁。下载物的哈希用于标识本次取得的文件，不单独构成发行方签名验证。

| 对象 | 版本／年份 | SHA-256 |
| --- | --- | --- |
| Microsoft ODT setup.exe（Microsoft Authenticode 有效） | 16.0.20228.20124 | F266BC16834FBFAE5AA7ACA7C27ED5F393CAC0BB2ACEBC2D5BB2DD7813CF7497 |
| MiKTeX lualatex.exe | 26.5 Portable | DD34FD3916D06511748022EF1654F635C8F1A3FD4940C5349BB6C3B643CA52A9 |
| TeX Live lualatex.exe | 2024 | 435380C1DCFF46EED2AF3FC4F65DF7E0040A55E8654759ABC64BA534AE4B6113 |
| TeX Live lualatex.exe | 2025 | CC944A1DB010B47FCF5CCB5D1B184CBA208FE7FEA9F18BEC414940E6FD3E24A6 |
| TeX Live install-tl.zip | 2024 | 9534F56501056E0D1AD714056DFEAF1A6CEE78644342ABE354036000F170B4BA |
| TeX Live install-tl.zip | 2025 | 3E4E7AE975DCF321AF8A2CBF6AA050ABA5012DD4528255D552FA479F456C464B |

完整 evidence、截图、原始日志和原始报告只保留在验收虚拟机；宿主仓库仅记录筛选后的结果、版本、提交和哈希。密码只经交互 stdin 使用。每个环境结束后移除本次新增的临时证书、打印机、计划任务、AppContainer profile 和 ACL，并恢复原系统设置；准备中的环境不能提前记为已恢复。

## 裁决

尚未通过完整支持矩阵，阶段 1 门禁保持关闭，[Issue #8](https://github.com/Hu-GQ/FormulaBridge/issues/8) 保持开放。既有 Office 2024／TeX Live 2026 的通过结果仅覆盖该组合。
