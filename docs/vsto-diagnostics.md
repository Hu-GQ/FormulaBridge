# 阶段 0 外部诊断（Issue #3）

`FormulaBridge.Diagnostics.exe` 是 .NET Framework 4.8 / x64 的只读工具。它检查 Word 位数、VSTO、当前用户或机器级 WebView2 Evergreen、当前用户加载注册、LoadBehavior、本地 VSTO 清单、部署签名、Word 禁用项和组织策略，并给出处理建议。诊断从不修改注册表、组织策略或 Word 文档，也不提升权限。

## 开发验证

```powershell
npm run diagnostics:build
node --test tests/diagnostics.test.js
& .\artifacts\diagnostics\FormulaBridge.Diagnostics.exe --output .\artifacts\diagnostics\report.json
```

独立开发构建只需要 .NET Framework 4.8 targeting pack 和系统 C# 编译器。它生成未签名的开发 EXE；正式安装仍由 `vsto:build` 签名，开发 EXE 不能代替签名安装证据。生产 CLI 不接受注入故障或伪造健康状态的参数。

故障测试编译生产代码和单独的测试入口，向同一判定器提供观测数据，覆盖运行时缺失/零版本、注册缺失、位数错误、无效签名、未知信任、LoadBehavior 禁用、Word 崩溃/禁用项、策略阻止、权限拒绝以及缺失、过期、未来时间戳和 PID 复用的加载记录。额外执行真实 Windows 信任 API 的未签名拒绝、清单 DTD 拒绝、负载哈希篡改和外部/路径穿越引用测试。模拟通过不属于实机验收。

## 信任与当前加载状态

部署和应用清单通过 .NET `ManifestSignatureInformation.VerifySignature` 校验，要求强名称和 Authenticode 有效、两个清单签名者一致，并验证本地依赖文件哈希。WordAddIn DLL 和 Diagnostics EXE 使用 Windows `WinVerifyTrust`，并要求与清单签名者一致。校验使用离线撤销信息；本地信息不足返回 `blocked`，不能退化成成功。清单解析禁止 DTD、外部实体、远程 URL、安装目录外的依赖和 reparse point。

加载记录必须来自仍运行的 WINWORD 进程，回调时间必须位于该进程启动时间与当前时间之间，Ribbon 回调不得早于 startup。Word 退出或旧 PID 被复用后，旧状态不能成为当前健康证据；加载项 shutdown 清除回调信号。多个 Word 实例的完整产品会话管理属于阶段 1。

诊断结果包含每个检查的 `passed`/`failed`/`blocked`、原因和处理建议。无法辨认的 Word DisabledItems 以 `blocked` 报告。CLI 返回 `0` 表示全部健康，`1` 表示存在失败或不可验证项，`2` 表示命令不能完成；异常文本不输出用户名、路径或异常原文。

## 真实 Word 验收

沿用[签名安装 smoke](vsto-installation-spike.md)，在有受信任签名安装包和支持 Word 的干净、未提权测试账户中运行 `npm run vsto:smoke -- ...`。`tools/vsto-diagnostics-smoke.ps1` 在 Word 存活且 COM Add-in 已连接时采集健康报告，并在同一实例里注入缺失/损坏状态记录后恢复原字节。

禁用场景只暂时把本次测试安装的 `LoadBehavior` 设为 `2`，启动新的 Word 实例，验证 `Connect=false`、诊断识别禁用且没有当前 Ribbon 回调。无论成功失败都恢复原注册值；不写组织策略或不透明的 DisabledItems。随后重启 Word 验证恢复健康。每次诊断前后比较 Office policy/Resiliency 指纹。场景结果实时归档至 `diagnostics-report.json`，失败时保留已生成的观测。

阶段 0 检查集新增 `diagnostics-prerequisite-and-signature-checks` 和 `diagnostics-real-disabled-state`，缺少实机、签名或信任信息不能通过。支持矩阵的最终裁决仍属于 Issue #8。

## API 依据

- [Microsoft：WebView2 Runtime 的注册表检测](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#detect-if-a-webview2-runtime-is-already-installed)
- [Microsoft：ManifestSignatureInformation.VerifySignature](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.manifestsignatureinformation.verifysignature?view=netframework-4.8.1)
- [Microsoft：WINTRUST_DATA 和离线撤销检查](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-wintrust_data)
