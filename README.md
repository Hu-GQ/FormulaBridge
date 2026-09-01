# FormulaBridge

FormulaBridge 是一款面向现代 Microsoft Word 的本地优先 LaTeX 公式编辑器。它是独立开发的新产品，与 Elevator Lady Inc. 或 Aurora 产品不存在隶属、授权、继承或认可关系。

## 权威设计基线

本仓库当前以以下两份文档作为唯一的产品与技术依据：

- [产品设计文档](docs/product-design.md)：产品方向、用户体验、主要功能、验收标准和发布路线。
- [技术方案](docs/technical-solution.md)：目标技术栈、组件边界、渲染链路、安全、部署和测试策略。

这两份文档以已经确认的产品讨论为基础，并取代仓库中曾经存在的早期需求、路线、Office.js 原型和技术假设。后续实现发生冲突时，以这两份文档为准。

## 当前状态

产品设计和技术方案已经确定，正式实现将从干净基线开始。仓库不保留早期 Office.js 演示代码、旧测试工具、旧资源或过时规划文档。

## 文档验证

```powershell
npm run check
npm test
```

当前测试只验证两份权威文档及其关键决策的一致性。产品源码建立后，应按技术方案逐层增加 TypeScript、.NET、Word、TeX、UI 和安装测试。

## 阶段 0 验证

[阶段 0 证据基线](docs/phase0-evidence.md)提供统一执行命令、版本化 schema、无隐私语料清单，以及机器可读 JSON 与人类可读 Markdown 报告。它建立 Issue #1 的提供者与证据契约；四项前置样机由各自 ticket 实现并注册，未注册检查保持 `not-run`，不能误报通过。

[阶段 0 VSTO 安装样机](docs/vsto-installation-spike.md)实现 Issue #2 的最小 x64 Word VSTO Ribbon、当前用户 WiX 安装包、只读外部诊断、签名构建入口，以及 clean install、重复安装、repair、Word 自动加载和 uninstall 的证据 smoke runner。它不依赖或修改未提交的 `src/web/editor` UI 原型。

[阶段 0 双格式 Word 往返样机](docs/dual-format-roundtrip-spike.md)实现 Issue #5 的自包含 SVG 与 PNG fallback OOXML 载体、Word 保存/重开和普通复制验证、Word 打印与 PDF 导出，以及结构和容差视觉证据。测试在 FormulaBridge 未加载的独立 Word 实例中运行，也不依赖 `src/web/editor`。
