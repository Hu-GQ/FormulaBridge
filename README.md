# FormulaBridge

FormulaBridge 是一款面向现代 Microsoft Word 的本地优先 LaTeX 公式编辑器。它是独立开发的新产品，与 Elevator Lady Inc. 或 Aurora 产品不存在隶属、授权、继承或认可关系。

## 权威设计基线

本仓库当前以以下两份文档作为唯一的产品与技术依据：

- [产品设计文档](docs/product-design.md)：产品方向、用户体验、主要功能、验收标准和发布路线。
- [技术方案](docs/technical-solution.md)：目标技术栈、组件边界、渲染链路、安全、部署和测试策略。

这两份文档以已经确认的产品讨论为基础，并取代仓库中曾经存在的早期需求、路线、Office.js 原型和技术假设。后续实现发生冲突时，以这两份文档为准。

## 当前状态

产品设计和技术方案已经确定，阶段 0 的四个检查提供者、外部诊断和资源生命周期验证已整合到同一代码基线。完整验收仍要求签名安装包、受支持的 Windows/Word 环境及真实运行证据；代码和单元测试通过不代表阶段 0 发布门禁已通过。

## 文档验证

```powershell
npm run check
npm test
```

默认测试验证设计一致性、证据契约、诊断故障、资源策略和样机行为。真实 Word、签名安装及 AppContainer 验证由各 smoke runner 执行，缺少前置环境时明确记录为 `blocked` 或跳过。

## 阶段 0 验证

[阶段 0 证据基线](docs/phase0-evidence.md)提供统一执行命令、版本化 schema、无隐私语料清单，以及机器可读 JSON 与人类可读 Markdown 报告。它建立 Issue #1 的提供者与证据契约；四项前置样机由各自 ticket 实现并注册，未注册检查保持 `not-run`，不能误报通过。

[阶段 0 VSTO 安装样机](docs/vsto-installation-spike.md)实现 Issue #2 的最小 x64 Word VSTO Ribbon、当前用户 WiX 安装包、只读外部诊断、签名构建入口，以及 clean install、重复安装、repair、Word 自动加载和 uninstall 的证据 smoke runner。它不依赖或修改未提交的 `src/web/editor` UI 原型。

[阶段 0 源码可移植复制样机](docs/source-portable-copy-spike.md)实现 Issue #4 的组合元数据载体、自动化 DOCX 包检查和真实 Word 剪贴板 smoke runner，覆盖同文档复制、跨文档复制、移动、引用、保存与重开。它只创建合成临时文档，不读取或修改用户文档，也不依赖 `src/web/editor` UI 原型。

[阶段 0 TeX 隔离样机](docs/tex-isolation-spike.md)实现 Issue #6 的 Windows 11 x64 AppContainer、Job Object、文件系统 ACL 和固定 TeX 策略验证，使用恶意 LuaLaTeX 语料证明文件、网络、进程与资源边界。隔离机制或环境不满足时只能生成 `blocked`/`failed` 证据，不能降级为不受控的本地 TeX。

[阶段 0 双格式 Word 往返样机](docs/dual-format-roundtrip-spike.md)实现 Issue #5 的自包含 SVG 与 PNG fallback OOXML 载体、Word 保存/重开和普通复制验证、Word 打印与 PDF 导出，以及结构和容差视觉证据。测试在 FormulaBridge 未加载的独立 Word 实例中运行，也不依赖 `src/web/editor`。

[阶段 0 外部诊断](docs/vsto-diagnostics.md)补齐 Issue #3 的 WebView2、独立签名校验、当前 Word 加载状态及真实禁用场景证据。

[阶段 0 整合与验收记录](docs/phase0-closeout.md)记录统一提交的真实运行结果、原始证据和尚未解除的验收阻塞。
