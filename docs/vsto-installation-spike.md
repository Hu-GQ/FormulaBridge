# 阶段 0 VSTO 安装样机

本样机实现 Issue #2 的前置可行性门槛：用签名的当前用户 MSI 安装最小 x64 Word VSTO 加载项，Word 重启后自动加载独立的 FormulaBridge Ribbon，并由 Word 外部诊断程序和自动化 smoke runner 留下可复核证据。它不包含任务窗格、公式编辑、RenderHost、更新器或任何阶段 1 功能，也不读取、扫描或修改用户文档。

## 组成

- `src/desktop/FormulaBridge.WordAddIn`：.NET Framework 4.8 / x64 VSTO Word 加载项，只提供最小 Ribbon。VSTO startup 与 Ribbon `onLoad` 回调把状态原子写入 `%LOCALAPPDATA%\FormulaBridge\Phase0\word-load-state.json`，不访问 Word 文档内容。
- `src/desktop/FormulaBridge.Diagnostics`：只读外部诊断 EXE，检查 x64 Word、VSTO Runtime、HKCU 加载注册、`LoadBehavior=3`、本地 `|vstolocal` 清单、Office policy/Resiliency 状态，以及 startup/Ribbon 加载状态；它只报告问题，不强制启用加载项或绕过组织策略。
- `installer/FormulaBridge.Installer/Package.wxs`：WiX Toolset 4 per-user MSI，安装到当前用户的 Local AppData，只在 HKCU 注册 Word 加载项。卸载删除程序、加载注册和样机加载状态。
- `tools/build-vsto-installation.ps1`：构建、签名、重新计算 VSTO 清单哈希、验证签名并生成 MSI。
- `tools/test-vsto-installation.ps1`：在专用干净 Windows 账户中执行安装生命周期与故障诊断 smoke，并生成固定证据树。

## 实机前提

构建机需要：

- Windows 11 x64；
- Visual Studio 2022，安装 Office/SharePoint（VSTO）和 .NET 桌面开发工作负载、.NET Framework 4.8 targeting pack；
- WiX Toolset 4 的 `wix.exe`；
- Windows SDK 的 `signtool.exe` 与 .NET Framework SDK 的 `mage.exe`；
- 当前用户证书存储 `Cert:\CurrentUser\My` 中已有、带私钥和 Code Signing EKU 的证书。

smoke 机还需要支持矩阵内的 x64 Word 和 VSTO Runtime，并使用没有既存 FormulaBridge 安装、Word 进程或用户文档依赖的干净 Windows 账户。测试证书的信任配置属于测试机预配步骤；构建脚本不会创建、导入或信任证书，也不会请求提权。

## 构建和签名

测试证书运行显式记录为 `test`：

```powershell
npm run vsto:build -- `
  -TrustLevel test `
  -CertificateThumbprint <thumbprint>
```

正式证书运行记录为 `production`，必须同时具有受信任证书链、非自签名证书和 RFC 3161 时间戳：

```powershell
npm run vsto:build -- `
  -TrustLevel production `
  -CertificateThumbprint <thumbprint> `
  -TimestampUrl <rfc3161-url>
```

脚本使用 Visual Studio 的 VSTO Publish 目标生成应用与部署清单；对 FormulaBridge WordAddIn DLL 和 Diagnostics EXE 执行 Authenticode 签名后，用 `mage -Update` 重算并签署两个清单，再用 `wix build -arch x64` 生成 per-user MSI。最后分别用 Windows `signtool verify` 与 `mage -Verify` 验证二进制、MSI 和 VSTO 清单。输出目录包含 `build-metadata.json`，其中以 `trustLevel` 明确区分 test 与 production；测试证据不能替代正式发行签名证据。

如果 Visual Studio VSTO targets、WiX、Windows SDK、证书或 production 时间戳条件缺失，构建立即失败；脚本不会生成占位 MSI，也不会把缺失条件降格成 passed。

## 安装生命周期 smoke

在关闭全部 Word 窗口的干净测试账户中运行：

```powershell
npm run vsto:smoke -- `
  -InstallerPath <build-output>\FormulaBridge.Phase0.x64.msi `
  -BuildMetadataPath <build-output>\build-metadata.json `
  -EvidenceDirectory C:\phase0-vsto-evidence `
  -TrustLevel test
```

runner 按顺序执行 clean install、Word 重启自动加载、repeated install、再次自动加载、repair、再次自动加载、诊断成功路径、缺失/损坏加载状态故障注入、uninstall。它验证：

- MSI 契约和实际注册均只属于当前用户，HKLM 中没有 FormulaBridge Word 加载注册；
- MSI、WordAddIn DLL、Diagnostics EXE 通过 Windows Authenticode 验证，VSTO 应用/部署清单通过 `mage -Verify`；
- Word 的 COM Add-in 状态为 connected，且同一次新启动写出了 startup 与 Ribbon `onLoad` 状态；
- 外部诊断能识别正常状态、缺失状态和损坏状态，且运行前后 Office policy/Resiliency 指纹不变；
- clean install、repeated install、repair 和 uninstall 均成功；卸载清除程序、加载注册和运行状态；
- 从版本化语料复制到临时目录的合成 `.docx` 哨兵在整个生命周期中哈希不变，以证明卸载不扫描或修改用户文档；
- MSI 原始日志只存在于受控临时目录，归档前会替换用户名、用户目录和 Local AppData 路径。

也可以把该 runner 交给阶段 0 的统一执行入口。先设置实际构建产物；路径与信任级别缺失时，provider 会留下 `blocked` 的 result/log，不会伪造通过：

```powershell
$env:FORMULABRIDGE_VSTO_INSTALLER = "<build-output>\FormulaBridge.Phase0.x64.msi"
$env:FORMULABRIDGE_VSTO_BUILD_METADATA = "<build-output>\build-metadata.json"
$env:FORMULABRIDGE_VSTO_TRUST_LEVEL = "test"
npm run phase0 -- execute --input C:\phase0-run\execution.json --output C:\phase0-run\report
```

`execution.json` 的格式、运行时清单和 corpus 引用见[阶段 0 证据基线](phase0-evidence.md)。如果工具不在 `PATH`，可选地设置 `FORMULABRIDGE_SIGNTOOL`、`FORMULABRIDGE_MAGE` 与 `FORMULABRIDGE_PWSH`。统一执行后仍只有 `vsto-installation` 由本 ticket 的 provider 运行，未配置 provider 的其他阶段 0 检查保持 `not-run`。

## 证据

通过运行生成：

```text
<EvidenceDirectory>/
├── check-fragment.json
└── evidence/vsto-installation/
    ├── result/result.json
    ├── log/smoke.log
    ├── installer/FormulaBridge.Phase0.x64.msi
    ├── signature-report/signature-report.json
    ├── word-load-state/word-load-state.json
    └── diagnostics-report/diagnostics-report.json
```

`result.json` 符合阶段 0 check-result schema，并逐项记录 Issue #2 的安装、签名、Ribbon、卸载、生命周期、诊断故障、策略保持和隐私断言。`check-fragment.json` 可作为完整 `phase0-run` 的 `vsto-installation` check；其余三个阶段 0 check 仍必须由各自 ticket 提供。仅 Issue #2 通过不能使完整阶段 0 报告成为 passed。

结果证据的完整相对路径是 `evidence/vsto-installation/result/result.json`。

失败或环境缺失必须保留 `result` 与脱敏 `log`，并以 `failed`、`blocked` 或 `not-run` 表示；没有实际签名 MSI 和真实 Word 自动加载证据时不能标记为 passed。完整报告仍由[阶段 0 证据基线](phase0-evidence.md)归档和验证。

## 权威部署依据

- [Microsoft：Deploy a VSTO Solution with Windows Installer](https://learn.microsoft.com/en-us/visualstudio/vsto/deploying-a-vsto-solution-by-using-windows-installer)
- [Microsoft：Registry entries for VSTO Add-ins](https://learn.microsoft.com/en-us/visualstudio/vsto/registry-entries-for-vsto-add-ins)
- [Microsoft：Sign Office solutions](https://learn.microsoft.com/en-us/visualstudio/vsto/how-to-sign-office-solutions)
- [WiX：Package Scope](https://docs.firegiant.com/wix/schema/wxs/packagescopetype/)
- [WiX：wix build command](https://docs.firegiant.com/wix/tools/wixexe/)
