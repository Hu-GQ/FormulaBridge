# 阶段 0 双格式 Word 往返样机

本样机实现 Issue #5 的表示层可行性门槛：使用本地 TeX 实际生成的 `x^2 + y^2 = z^2` 样本，以 path-only SVG 和 PNG fallback 保存，并用 Office DrawingML 的 `asvg:svgBlip` 扩展把两者嵌入同一个 Word 图片对象。它只验证双格式载体和 Word 往返，不实现生产 TeX 渲染器、公式身份/源码复制语义或阶段 1 编辑功能。

版本化样本位于 `tests/fixtures/dual-format/`。`formula.tex` 由 TeX Live 的 `latex`/`pdflatex` 编译；`dvisvgm --no-fonts` 生成 SVG，Poppler 从同源 PDF 生成 PNG。`manifest.json` 记录源文件、工具版本、命令、尺寸和三个输入/输出文件的 SHA-256。包生成器在每次使用前验证这些哈希；普通 smoke 不需要重新安装 TeX。需要更新样本时，在有 TeX Live、dvisvgm 和 Poppler 的机器上显式重建并提升 fixture 版本：

```powershell
npm run dual-format:fixture -- -OutputDirectory tests/fixtures/dual-format
```

## 自包含载体

`tools/dual-format-package.js` 生成最小 DOCX 和两个同源图像，并检查：

- SVG 与 PNG 都是包内 `word/media` 部件；
- PNG 是 `a:blip` fallback，SVG 是同一 blip 的 `asvg:svgBlip` 扩展；
- 每个关系 ID 都解析到包内实际媒体部件，没有 dangling、外部图片或外部字体关系；
- 保存/复制后的每个 PNG 与已验证的本地 TeX PNG 哈希一致，不能用损坏但仍存在的 fallback 蒙混通过；
- SVG 不含文本、字体声明、外部 URL、脚本、事件处理器或 `foreignObject`。

无需 Word 的快速包检查可以在任意有 Node.js 和 PowerShell 7 的环境运行：

```powershell
npm run dual-format:smoke -- -EvidenceDirectory C:\phase0-dual-format-package -PackageOnly
```

## Word 冒烟

完整冒烟必须在 Windows 上运行，要求：

- Microsoft Word 可由当前用户启动，且运行前没有其他 `WINWORD` 进程；
- Poppler `pdftoppm.exe` 可从 `PATH` 找到，或通过 `-PdfToPpmPath` 指定；
- 系统安装 Microsoft Print to PDF 或通过 `-PrintToPdfPrinter` 指定兼容打印机；
- FormulaBridge VSTO 加载项不存在，或可在本次隐藏 Word 实例中断开。

常见 Microsoft Print to PDF 安装使用交互式 `PORTPROMPT:` 端口，无法为无人值守测试接受输出路径。显式传入 `-ProvisionPrintCapture` 后，runner 会创建以当前进程 ID 唯一命名的临时打印机和文件端口；它不修改已有打印机，并在 `finally` 中先关闭 Word、再删除临时打印机和端口。创建打印机需要当前环境允许使用 Windows 打印管理命令。

```powershell
$commit = git rev-parse HEAD
npm run dual-format:smoke -- `
  -EvidenceDirectory C:\phase0-dual-format-evidence `
  -ExpectedCommit $commit `
  -PdfToPpmPath C:\tools\poppler\Library\bin\pdftoppm.exe `
  -ProvisionPrintCapture
```

runner 在 FormulaBridge 未连接的独立隐藏 Word 实例中完成真实的保存、关闭、重开、同文档普通复制、跨文档普通复制、打印和 PDF 导出。每个 DOCX 都重新解析 OOXML 关系；两个 PDF 都校验结构、用 Poppler 渲染，再与同源 PNG 做归一化墨迹边界、宽高比、墨迹比例和平均绝对误差比较。视觉比较使用容差，不依赖逐像素完全一致。验收断言从检查集读取，视觉门槛由同一份设置同时驱动比较与证据序列化。

## Phase 0 集成与证据

`tools/phase0-providers/dual-format-roundtrip.js` 已注册到 `phase0/checks.json` 的当前检查集。统一执行时可设置：

- `FORMULABRIDGE_PDFTOPPM`：`pdftoppm.exe` 的绝对路径；
- `FORMULABRIDGE_PRINT_TO_PDF_PRINTER`：已有的非交互式 PDF 打印机名称；
- `FORMULABRIDGE_PROVISION_PRINT_CAPTURE=1`：显式允许创建并清理临时文件端口打印机；
- `FORMULABRIDGE_PWSH`：PowerShell 7 可执行文件。

然后按[阶段 0 证据基线](phase0-evidence.md)运行统一入口。通过结果包含：

```text
evidence/dual-format-roundtrip/
├── result/result.json
├── log/smoke.log
├── docx-package/roundtrip-documents.zip
├── pdf/word-export.pdf
├── print-output/word-print.pdf
└── visual-diff/visual-diff.json
```

`result.json` 逐项记录自包含双格式、保存/重开、两类普通复制、打印/PDF 和未加载 FormulaBridge 六项断言。环境前提缺失时结果为 `blocked`；执行后发现关系、输出或视觉不符合门槛时为 `failed`。无论通过或失败，都归档已经产生的 DOCX、源样本/来源清单、渲染图像、PDF 和视觉诊断；比较指标先落盘再判定失败，统一入口不会删除唯一的复现产物。临时打印端口清理有界重试，仍无法清理时也不能报告通过。当前样机验证未发现需要修改 ADR-0010 的表示层不稳定性。
