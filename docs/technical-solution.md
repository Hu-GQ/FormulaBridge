# FormulaBridge 技术方案

| 项目 | 内容 |
| --- | --- |
| 产品名称 | FormulaBridge |
| 文档性质 | 目标产品工程实施方案 |
| 文档状态 | 技术路线已确认，作为后续架构和开发基线 |
| 版本 | 1.0 |
| 更新日期 | 2026-08-30 |
| 首发平台 | Windows 11 x64 + Microsoft 365 Word / Office 2024 x64 |

> 基线声明：本文档与 [product-design.md](product-design.md) 是 FormulaBridge 当前唯一的产品和技术依据。仓库历史内容、旧原型和旧规划不构成实现约束；后续工程以本文档描述的目标架构从干净基线开始。

## 1. 目的与范围

本文档把《FormulaBridge 产品设计文档》转化为可以实施的技术路线，确定首发版本的主要技术栈、运行时边界、关键数据流、安装方式和质量策略。

本方案重点回答以下问题：

- FormulaBridge 如何安装并深度集成到新版 Word。
- 如何实现接近 Aurora 操作习惯的现代可视化编辑器。
- 如何安全调用用户本机的多个 TeX 环境。
- 如何在 OMML 原生公式与 TeX 高保真输出之间选择。
- 如何保证 Word、编辑器和 TeX 编译相互隔离。
- 如何让文档在没有安装 FormulaBridge 的电脑上仍可阅读和打印。

本文档不展开视觉规范、商业授权、自动更新服务端和旧 Aurora 对象逆向细节；这些内容在对应阶段单独设计。

## 2. 技术决策摘要

FormulaBridge 首发采用“原生 Word 宿主 + Web 技术编辑器 + 独立本地渲染进程”的混合架构。

| 层次 | 首选技术 | 主要原因 |
| --- | --- | --- |
| Word 集成 | C#、VSTO、.NET Framework 4.8、Office Interop | 能稳定实现 Ribbon、任务窗格、Word 事件和深度文档操作 |
| 编辑界面 | WebView2、TypeScript、React、CodeMirror 6 | 适合实现源码编辑、即时诊断和可视化预览 |
| 公式核心 | TypeScript、版本化 AST、OMML writer | 保证浏览器预览和 Word 输出使用同一语义模型 |
| 本地渲染 | C#、.NET 10 LTS、独立 `FormulaBridge.RenderHost.exe` | 使用现代运行时并与 Word 进程隔离 |
| 本地通信 | WebView2 Web Message、Named Pipe、版本化 JSON 协议 | 不开放生产环境 HTTP 端口，便于鉴权、取消和诊断 |
| Word 文件处理 | Office Interop、Open XML SDK | 分别覆盖 Word 在线操作和 DOCX 包级检查/迁移 |
| 设置与日志 | JSON 配置、Serilog 结构化日志 | 首发足够简单，方便诊断和迁移 |
| 安装部署 | WiX Toolset 4、MSI/Burn、数字签名 | 适合 VSTO 注册、依赖检查和企业静默部署 |
| 自动化测试 | xUnit、Node Test、浏览器 UI 测试、Word COM 冒烟测试 | 覆盖核心、进程、界面、文档和真实 Word |

首发不采用纯 Office.js、Electron、纯 WinUI 3 或纯 C++ COM 作为主路线。Office.js 保留为后续 macOS、Word 网页版和轻量体验的适配层。

## 3. 总体架构

```text
Microsoft Word x64
  |
  |  VSTO / Office Interop
  v
FormulaBridge.WordAddIn                    .NET Framework 4.8
  |-- Ribbon 与快捷命令
  |-- Word 窗口、选区和文档事件
  |-- 内容控件、OMML、图片和域操作
  |-- WinForms CustomTaskPane 宿主
  |       |
  |       v
  |    WebView2
  |       |-- TypeScript + React
  |       |-- CodeMirror 6
  |       |-- FormulaBridge Core
  |       `-- 源码、预览、错误和设置界面
  |
  |  当前用户 Named Pipe
  v
FormulaBridge.RenderHost.exe               .NET 10 LTS
  |-- TeX 环境配置与探测
  |-- 编译队列、取消和安全限制
  |-- latex / pdflatex / xelatex / lualatex
  |-- dvisvgm / dvipng
  `-- SVG、PNG、日志和缓存

Word 文档
  |-- 可见 OMML 或 SVG + PNG fallback
  |-- FormulaBridge 内容控件
  `-- 文档内源码、环境、样式和编号元数据
```

关键边界：

1. WordAddIn 是唯一直接操作活动 Word 文档的组件。
2. WebView2 只和 WordAddIn 通信，不直接访问 Named Pipe 或启动系统进程。
3. RenderHost 不持有 Word COM 对象，不读取整个 Word 文档。
4. TeX 子进程只接收单次任务所需源码和明确的环境配置。
5. 公式核心不依赖 Word、注册表或具体 TeX 发行版。

## 4. Word 集成层

### 4.1 技术选择

目标项目 `FormulaBridge.WordAddIn` 使用：

- C#。
- Visual Studio Tools for Office（VSTO）Word Add-in。
- .NET Framework 4.8。
- Microsoft Office Primary Interop Assemblies，优先启用嵌入互操作类型。
- 首发生成 x64 安装目标。

选择 VSTO 的原因是 FormulaBridge 需要比普通网页加载项更深的 Windows Word 集成，包括应用级 Ribbon、每窗口任务窗格、选区事件、内容控件事件、字段操作和旧对象迁移入口。

### 4.2 主要职责

WordAddIn 负责：

- 创建和响应 FormulaBridge Ribbon 命令。
- 为每个 Word 窗口管理独立任务窗格实例。
- 获取光标、选区、段落、章节和当前公式上下文。
- 插入或更新 OMML、SVG、PNG fallback、内容控件和编号域。
- 读取和保存 FormulaBridge 文档元数据。
- 把编辑命令转发给 WebView2，把渲染请求转发给 RenderHost。
- 在 Word 主线程上执行必要的 COM 操作，并及时释放 COM 引用。
- 统一处理撤销记录、文档只读状态和受保护视图。

WordAddIn 不负责：

- 在 Word 进程内启动或等待 TeX 编译。
- 在 Word 进程内执行复杂 LaTeX 解析或图片转换。
- 保存全局公式历史数据库。
- 连接云端渲染服务。

### 4.3 任务窗格与浮动窗口

VSTO 自定义任务窗格使用 WinForms `UserControl` 作为宿主，内部放置 WebView2 控件。停靠任务窗格和后续浮动编辑窗口加载相同的前端构建产物，避免维护两套界面。

每个 Word `Window` 对应一个编辑会话。切换窗口、关闭文档或拆分视图时，插件必须正确切换或释放对应会话，不能用单个全局任务窗格错误地共享选区状态。

### 4.4 Word 操作策略

- 新插入公式使用一个 Word 撤销记录完成。
- 更新公式采用“先构建新内容，成功后替换旧内容”的方式。
- 编译或解析失败时不修改原内容。
- 所有耗时操作异步执行，禁止阻塞 Word UI 线程等待 TeX。
- COM 事件只收集必要上下文，复杂工作转交后台组件。
- 插件关闭时取消未完成请求，但不删除已经嵌入的可见公式。

## 5. 编辑器界面

### 5.1 技术选择

编辑器前端采用：

- TypeScript。
- React。
- Vite 构建。
- CodeMirror 6 作为 LaTeX 源码编辑器。
- HTML/CSS 负责 Aurora 风格的菜单、工具栏、源码区和输出区。
- WebView2 作为 Windows 桌面运行容器。

编辑器按照本方案从干净的 TypeScript 工程建立。界面可以借鉴已经确认的操作流程，但不得受仓库历史原型的代码结构、兼容基线或技术债约束。

### 5.2 前端职责

- 源码输入、选择、撤销、重做和快捷键。
- LaTeX 语法高亮、括号匹配、片段和命令补全。
- 行内、独立、编号三种公式模式切换。
- 即时语法诊断和本地 TeX 编译错误定位。
- 展示 OMML 快速预览或 RenderHost 返回的 SVG 预览。
- 编辑宏包、preamble、环境、样式和编号属性。
- 显示编译进度、取消按钮和可读错误信息。

### 5.3 WebView2 集成规则

- 前端资源随安装包本地部署，正式版本不依赖 CDN。
- 使用 WebView2 虚拟主机映射或本地文件映射加载资源，不启动本地 Web 服务器。
- 仅允许受信任的本地源导航；拦截任意外部跳转和新窗口。
- 前端通过 `postMessage` 与 C# 宿主交换版本化消息。
- C# 宿主校验消息类型、长度、字段和当前文档上下文。
- 调试模式可以使用 Vite 开发服务器，发布模式必须使用已打包静态资源。

### 5.4 预览策略

预览分为两级：

1. **快速预览**：FormulaBridge Core 对支持的语法立即生成安全 HTML 或数学预览。
2. **权威预览**：复杂公式经 RenderHost 和用户选择的实际 TeX 环境生成 SVG。

快速预览用于降低输入延迟，最终插入结果必须以 OMML writer 或实际本地 TeX 输出为准。界面必须明确标识尚未完成权威编译的状态，不能把近似预览当作最终结果。

## 6. FormulaBridge Core

### 6.1 技术与边界

FormulaBridge Core 从一开始使用 TypeScript，实现为不依赖 DOM、Office.js、Node.js 文件系统和 TeX 可执行文件的纯核心库。

核心输入是 LaTeX 源码和公式选项，输出是：

- 版本化 Formula AST。
- 语法与能力诊断。
- 支持范围内的 OMML。
- 快速安全预览。
- 是否需要 TeX 高保真回退的明确结论。

### 6.2 处理原则

- 解析器不能静默忽略未知命令。
- 不支持的结构返回带源码位置的诊断。
- OMML writer 只接受已经验证的 AST。
- 所有从源码进入 XML 或 HTML 的文本必须正确转义。
- AST、文档元数据和进程协议分别拥有独立版本号。
- Core 可以在 WebView2 和自动化测试中运行，不依赖 Word。

### 6.3 初始实现顺序

核心实现顺序建议为：

1. 定义版本化 AST、诊断、渲染请求和元数据类型。
2. 实现带源码位置的 LaTeX 解析器及单元测试。
3. 实现 OMML writer、XML 安全测试和 Word 样例验证。
4. 实现能力分析器，决定 OMML 路径或 TeX 路径。
5. 实现安全快速预览，并与前端编辑器集成。

## 7. 本地 TeX 渲染服务

### 7.1 技术选择

`FormulaBridge.RenderHost.exe` 使用 C# 和 .NET 10 LTS，发布为 Windows x64 自包含应用。首发不启用激进裁剪，以降低反射、日志和 Windows API 兼容风险。

RenderHost 按用户会话启动，可由 WordAddIn 按需拉起；空闲一段时间后可以安全退出。它不得注册为高权限 Windows 服务，也不应要求管理员权限运行日常公式编译。

### 7.2 主要职责

- 发现、验证并管理多个 TeX 环境配置。
- 验证所选引擎和转换器的绝对路径。
- 构造受控 TeX 输入模板。
- 启动、监控、取消和回收 TeX 子进程树。
- 生成并检查 SVG、PNG 和编译日志。
- 清理输出中的脚本、外部引用和非预期文件。
- 按内容哈希缓存安全的渲染结果。
- 返回结构化错误，不直接显示 UI。

### 7.3 支持的工具链

首发优先支持：

- `latex` + DVI + `dvisvgm`。
- `pdflatex` + PDF + SVG/PNG 转换。
- `xelatex` + PDF + SVG/PNG 转换。
- `lualatex` + PDF + SVG/PNG 转换。
- `dvipng` 作为特定兼容或诊断路径。

具体可用路径由 TeX 环境配置决定。FormulaBridge 不依赖或修改系统 `PATH`，也不在指定引擎失败后静默换用另一套环境。

### 7.4 单次渲染流程

```text
RenderRequest
  -> 校验协议、源码大小和环境配置
  -> 创建独立随机临时目录
  -> 生成受控 TeX 文档
  -> 以绝对路径启动指定引擎
  -> 应用超时、进程树和输出限制
  -> 调用明确配置的转换器
  -> 验证并清理 SVG / PNG
  -> 计算输出校验值并写入缓存
  -> 返回 RenderResult
  -> 清理临时目录
```

RenderResult 至少包含：

- 请求 ID。
- 是否成功和错误分类。
- 实际环境、引擎及版本。
- SVG 和 PNG 的受控数据或临时结果句柄。
- 尺寸、基线和校验值。
- 已清理的用户可读日志。
- 缓存命中信息和耗时。

## 8. 进程通信

### 8.1 通信路径

```text
WebView2
  -- Web Message -->
WordAddIn
  -- Named Pipe -->
RenderHost
```

正式版本不使用 `localhost` HTTP API。这样可以减少端口冲突、浏览器跨域配置和被其他网页滥用本地 TeX 能力的风险。

### 8.2 Named Pipe 协议

协议采用长度前缀的 UTF-8 JSON 消息，首发保持简单、可抓取和可诊断。所有消息包含：

- `protocolVersion`。
- `requestId`。
- `operation`。
- `payload`。
- 可选取消标识和调用上下文。

首批操作包括：

- `hello`：协商协议和能力。
- `listProfiles`：列出 TeX 环境。
- `validateProfile`：验证环境与工具版本。
- `render`：编译公式。
- `cancel`：取消指定请求。
- `getDiagnostics`：返回脱敏诊断。
- `shutdownIfIdle`：请求空闲退出。

Named Pipe 只允许当前 Windows 用户访问。服务端必须限制消息大小、同时编译数和单用户队列长度，并拒绝未知协议版本及未知字段组合。

### 8.3 版本策略

- WordAddIn 与 RenderHost 可以小版本独立升级，但必须先协商协议。
- 新字段默认可忽略，改变语义的修改提升协议主版本。
- 协议不兼容时禁止编译，并显示修复安装提示。
- 不使用 .NET 二进制序列化或任意对象反序列化。

## 9. TeX 环境管理

### 9.1 环境配置

每个 TeX 环境保存为独立配置，例如：

```json
{
  "schemaVersion": 1,
  "id": "texlive-2024-xelatex",
  "displayName": "TeX Live 2024 / XeLaTeX",
  "distribution": "texlive",
  "engine": "xelatex",
  "enginePath": "D:\\LaTeX\\texlive\\2024\\bin\\windows\\xelatex.exe",
  "converterPath": "D:\\LaTeX\\texlive\\2024\\bin\\windows\\dvisvgm.exe",
  "workingMode": "pdf",
  "lastValidatedAt": "2026-08-30T00:00:00Z"
}
```

配置文件中保存绝对路径和经过探测的版本，不修改注册表中的 TeX 设置，也不永久修改用户或系统环境变量。

### 9.2 选择优先级

环境选择顺序为：

1. 单个公式明确指定的环境。
2. 当前文档默认环境。
3. 用户全局默认环境。

如果指定环境不存在或版本不符合要求，应中止渲染并给出“重新定位、复制配置、选择其他环境”选项。只有用户明确确认后才能改变公式或文档的环境绑定。

### 9.3 环境发现

自动发现只用于生成候选项，不直接改变默认环境。探测来源可以包括：

- 已知 TeX Live 和 MiKTeX 安装位置。
- 卸载注册信息。
- 当前进程可见的 `PATH`。
- 用户手动选择的目录或可执行文件。

每个候选项都要执行无副作用版本检查和最小公式测试，记录引擎、转换器、字体及常用宏包状态。

## 10. 公式渲染与 Word 写入

### 10.1 OMML 快速路径

适用于 Core 可以完整表达且已通过验证的普通公式：

```text
LaTeX -> AST -> OMML -> Word 内容控件
```

优势是公式仍是 Word 原生数学对象，便于搜索、复制、辅助阅读和继续编辑。

### 10.2 TeX 高保真路径

适用于自定义宏、复杂宏包、特殊字体或 OMML 无法正确表达的结构：

```text
LaTeX -> RenderHost -> SVG + PNG fallback -> Word 内容控件
```

SVG 和 PNG 必须嵌入 DOCX 包，不能引用本地临时路径。SVG 是支持环境的首选显示，PNG 用于兼容和降级。插入前必须验证输出格式、尺寸上限、脚本和外部资源引用。

### 10.3 路径选择

Core 的能力分析器首先判断 OMML 是否能无损表达。用户可以为特定公式强制选择：

- Word 原生公式。
- 本地 TeX 高保真公式。
- 自动选择。

自动模式不得因为 TeX 暂时不可用而悄悄生成语义不完整的 OMML。

## 11. Word 文档数据

### 11.1 可见内容

每个公式由带 FormulaBridge 标识的内容控件包裹，内部保存：

- OMML；或
- 已嵌入的 SVG 和 PNG fallback；以及
- 编号、题注或引用所需的 Word 字段。

即使卸载 FormulaBridge，可见内容仍可由 Word 打开、打印和导出。

### 11.2 源码元数据

首发使用文档内 Custom XML Part 保存版本化公式索引，内容控件 Tag 保存固定前缀和 UUID。记录包括源码、模式、渲染路径、环境要求、样式、编号、校验值和时间戳。

同一文档内的编辑、保存和重新打开必须完整恢复公式。跨文档普通复制粘贴是否会携带全部自定义元数据，需要通过不同 Word 版本的实测后再冻结载体方案。在此之前，FormulaBridge 提供自己的“复制公式”命令和剪贴板格式，确保源码与可见内容一起迁移。

### 11.3 一致性与冲突

- 使用源码校验值判断是否需要重新渲染。
- 使用可见内容校验值检测用户绕过插件修改 OMML。
- 元数据损坏时不使用空记录覆盖原数据。
- 冲突时提供“保留 Word 内容”“用源码重建”“另存副本”。
- 文档打开时只建立索引，不批量重编译公式。

Open XML SDK 主要用于 DOCX 包结构验证、批量检查、迁移和不启动 Word 的测试；活动文档的交互操作仍由 Office Interop 完成。

## 12. 安全与隔离

### 12.1 TeX 子进程

- 使用 `ProcessStartInfo.UseShellExecute = false` 和参数列表，不拼接 shell 命令。
- 默认传递 `-no-shell-escape` 和非交互编译参数。
- 每次请求使用独立随机临时目录，不以 Word 文档目录为工作目录。
- 使用 Windows Job Object 或等效机制限制并回收整个子进程树。
- 设置编译时间、并发、内存、输出文件数量和文件大小上限。
- 仅执行所选配置中经过验证的绝对可执行文件路径。
- 不自动编译刚打开文档中的未知公式，用户操作或明确批处理才触发编译。
- 清理 SVG 中的脚本、事件处理器、外部 URL 和非预期资源引用。

`-no-shell-escape` 只能阻止 TeX 启动外部命令，不能单独构成完整文件访问沙箱。正式发布前还应验证受限令牌、文件 ACL 和 TeX 自身输入输出限制的组合方案。

### 12.2 WebView2

- 发布资源完全本地化并使用内容安全策略。
- 禁止任意外部导航、下载和弹窗。
- 不把原生宿主对象直接暴露给不受信任网页。
- 所有 Web Message 按白名单进行结构校验。
- 默认不开启开发者工具，诊断模式需用户明确启用。

### 12.3 隐私与日志

- 默认不上传源码、文档内容、文件名和用户路径。
- 普通日志只记录请求 ID、组件版本、错误类别和脱敏环境信息。
- 编译日志在展示前过滤临时路径和用户名。
- 用户导出诊断包时，源码和完整日志分别单独授权。
- 首发不实现云端渲染。

## 13. 设置、缓存与诊断

### 13.1 本地设置

用户级配置存放在 `%LOCALAPPDATA%\FormulaBridge\`，首发采用版本化 JSON：

- `settings.json`：界面、默认行为和更新通道。
- `tex-profiles.json`：TeX 环境配置。
- `cache/`：可清除的渲染缓存。
- `logs/`：滚动日志。

首发不引入 SQLite。只有在公式模板库、全文历史或大规模索引确实需要查询能力时再评估数据库。

### 13.2 缓存键

渲染缓存至少包含以下输入：

- 规范化源码。
- 完整 preamble 和宏包配置。
- 引擎与转换器绝对身份和版本。
- 字体与关键环境变量摘要。
- FormulaBridge 渲染器版本。
- 输出格式和缩放参数。

环境改变后不能错误复用旧缓存。

### 13.3 诊断

“检查环境”功能应一次性完成：

- Word、VSTO、WebView2 和 RenderHost 版本检查。
- Named Pipe 连通性检查。
- TeX 引擎和转换器版本检查。
- 最小 OMML、SVG 和 PNG 渲染测试。
- 临时目录写入与清理测试。
- 插件注册和签名状态检查。

## 14. 安装、签名与更新

### 14.1 安装技术

使用 WiX Toolset 4 生成 MSI，并按需要使用 Burn 引导程序检查和安装先决条件。安装器负责：

- 安装并注册 x64 VSTO Word Add-in。
- 安装 RenderHost 和本地 WebView2 前端资源。
- 检查 VSTO Runtime 和 WebView2 Runtime。
- 创建当前用户或计算机级插件注册。
- 提供修复、升级、卸载和静默部署参数。
- 保留用户文档，不在卸载时删除文档内公式。

如需支持 32 位 Word，应构建独立 x86 MSI，不在同一个进程内二进制中混用位数。

### 14.2 数字签名

以下产物必须使用可信代码签名证书签名：

- MSI 和引导安装程序。
- WordAddIn 程序集及 VSTO 部署清单。
- RenderHost 和其他可执行文件。
- 更新清单和更新包。

发布流水线应生成软件物料清单并保留可重现的版本、提交号和依赖锁定信息。

### 14.3 更新策略

- 首发提供稳定通道，开发和测试阶段提供预览通道。
- WordAddIn、RenderHost 和前端资源作为兼容版本集合发布。
- 更新失败时可回滚到上一个完整集合。
- 文档元数据升级必须向后兼容，并在写入前保留备份记录。

## 15. 建议的代码组织

目标代码结构建议为：

```text
FormulaBridge/
  docs/
    product-design.md
    technical-solution.md
  src/
    core/                           TypeScript 解析、AST、OMML 与预览
    desktop/
      FormulaBridge.sln
      FormulaBridge.WordAddIn/      VSTO / .NET Framework 4.8
      FormulaBridge.Contracts/      共享协议和 DTO
      FormulaBridge.RenderHost/     .NET 10 LTS
      FormulaBridge.Document/       Word/Open XML 文档逻辑
    web/
      editor/                       TypeScript/React/WebView2 前端
  tests/
    core/
    render-host/
    word-integration/
    ui/
    installer/
  installer/                        WiX Toolset 4
```

代码从上述目标结构逐阶段建立。每个新组件必须与对应测试同时落地，不引入仅为兼容仓库历史原型而存在的适配层。

## 16. 构建与开发环境

推荐开发环境：

- Windows 11 x64。
- Visual Studio 2022，安装 Office/SharePoint 开发和 .NET 桌面开发工作负载。
- .NET Framework 4.8 Developer Pack。
- .NET 10 SDK。
- Node.js 当前 LTS 版本和锁定的包管理器版本。
- Microsoft 365 Word x64 和 Office 2024 x64 测试机。
- WebView2 Evergreen Runtime。
- TeX Live 与 MiKTeX 各至少一个受控测试环境。

本地一键构建应依次完成前端构建、Core 测试、.NET 构建、RenderHost 测试和安装包生成。开发者无需修改全局 `PATH` 才能选择测试 TeX 环境。

## 17. 测试与质量策略

### 17.1 自动化测试层次

| 层次 | 工具 | 覆盖重点 |
| --- | --- | --- |
| Core 单元测试 | Node Test，后续可迁移 Vitest | 解析、AST、OMML、转义、诊断和能力判断 |
| 前端组件测试 | React Testing Library | 状态、快捷键、错误和设置交互 |
| 浏览器 UI 测试 | Playwright | 窄/宽布局、编辑流程和视觉回归 |
| .NET 单元测试 | xUnit | 协议、配置、缓存、安全校验和文档模型 |
| RenderHost 集成测试 | xUnit + 受控 TeX 环境 | 多引擎、宏包、超时、取消和输出检查 |
| Word 冒烟测试 | PowerShell/C# + Word COM | 插入、更新、保存、重新打开和卸载后可见性 |
| DOCX 包测试 | Open XML SDK | 关系、内容类型、Custom XML 和图片 fallback |
| 安装测试 | 干净 Windows 虚拟机 | 安装、升级、修复、静默部署和卸载 |

### 17.2 必测矩阵

- Microsoft 365 Word x64 的至少两个更新通道。
- Office 2024 Word x64。
- 100%、150%、200% 和 300% DPI。
- 简体中文与英文 Windows/Office。
- TeX Live 当前支持版、一个旧年份版和 MiKTeX。
- 不安装 TeX、缺少宏包、路径失效和引擎崩溃。
- 普通用户、无管理员权限和企业策略限制环境。
- 含 1、100 和 1000 个公式的文档。

真实 Word 与安装测试需要带 Office 的专用 Windows 测试机或自托管 CI，不应假设公共托管构建机安装了 Word。

### 17.3 发布门槛

- 所有静态检查和自动化测试通过。
- 没有会导致 Word 崩溃、文档损坏或公式静默变化的已知问题。
- 安装、升级和卸载在干净虚拟机验证通过。
- 生成的 DOCX 通过 Word 打开/保存以及 Open XML 结构检查。
- 未安装 FormulaBridge 的干净 Word 可以显示、打印和导出公式。
- 安全测试确认默认配置无法通过公式启动任意外部命令。

## 18. 分阶段实施建议

### 阶段 A：原生宿主骨架

- 创建 VSTO x64 WordAddIn。
- 完成功能区、每窗口任务窗格和 WebView2 本地资源加载。
- 建立 Web Message 协议和 TypeScript 编辑器基础界面。
- 验证安装后重启 Word 自动出现功能区。

### 阶段 B：RenderHost 基础

- 创建 .NET 10 RenderHost 和 Named Pipe 协议。
- 接入已验证的 TeX Live 2024 环境。
- 实现超时、取消、临时目录、SVG/PNG 和结构化错误。
- 增加多环境配置和环境诊断。

### 阶段 C：双渲染与文档模型

- 使用 TypeScript 实现 Core、AST 和诊断模型。
- 实现 OMML/TeX 能力判断。
- 完成内容控件、Custom XML、校验值和原子更新。
- 实现选中公式重新编辑。

### 阶段 D：产品化

- 完成 React/CodeMirror 编辑器和设置界面。
- 完成编号、交叉引用、批量操作和缓存。
- 建立 WiX 安装、签名、升级和回滚流程。
- 扩充 Word、TeX 和干净虚拟机测试矩阵。

### 阶段 E：兼容与扩展

- 在独立 x86 迁移助手中验证旧 Aurora OLE 读取。
- 评估 32 位 Word 安装包。
- 评估 Office.js 轻量适配器、macOS 和 Word 网页版。

## 19. 主要风险与替代方案

| 风险 | 当前策略 | 必要时的替代方案 |
| --- | --- | --- |
| VSTO 长期演进有限 | 保持插件层轻薄、协议化核心和 RenderHost | 后续增加 Office.js 适配器，或在明确阻塞后评估原生 COM |
| Word COM 调用造成卡顿 | COM 操作最小化，TeX 完全进程外异步执行 | 把批量文档处理移到独立 Open XML 工具 |
| WebView2 运行时或策略受限 | 安装器检查 Evergreen Runtime，提供清晰诊断 | 企业版允许固定版本 WebView2 部署 |
| TeX 宏包行为差异大 | 显式绑定环境、版本和缓存键 | 为项目导出环境报告，不静默换引擎 |
| TeX 文件访问边界复杂 | 无 shell、临时目录、进程限制、受限令牌研究 | 对不受信任公式提供更严格隔离模式 |
| Custom XML 跨文档复制不稳定 | 先提供 FormulaBridge 专用复制命令 | 实测后确定对象级元数据载体和兼容降级 |
| SVG 在不同 Word 版本表现不同 | 嵌入 SVG 与 PNG fallback 并做版本矩阵测试 | 对问题版本强制 PNG 或 OMML 路径 |

不建议在没有验证 VSTO 实际阻塞的情况下直接改用 C++ COM。C++ 可以提供更底层控制，但会显著增加 Office 生命周期、COM 引用、安装和崩溃诊断成本。

## 20. 已确认与暂缓决策

已经确认：

- Windows 11 和 64 位 Word 是首发重点。
- VSTO/C# 是首发 Word 主集成层。
- WebView2/TypeScript/React 是编辑器技术路线。
- 独立 .NET 10 RenderHost 负责本地 TeX。
- 生产环境使用 Named Pipe，不开放 localhost 编译服务。
- OMML 优先，复杂公式采用 SVG + PNG fallback。
- 支持多个显式 TeX 环境，不修改系统 `PATH`。
- WiX/MSI 是首发安装路线。

暂缓到技术验证后决定：

- React 具体状态管理库。
- RenderHost 是否长期常驻及准确空闲退出时间。
- 对象级元数据在普通跨文档复制中的最终载体。
- 32 位 Word、ARM64、macOS 和 Word 网页版的交付时间。
- 自动更新服务端和商业授权系统。
- 旧 Aurora OLE 迁移的支持边界。

## 21. 官方技术参考

- [Microsoft：Office solutions development overview (VSTO)](https://learn.microsoft.com/en-us/visualstudio/vsto/office-solutions-development-overview-vsto?view=visualstudio)
- [Microsoft：Customize the UI for Office applications](https://learn.microsoft.com/en-us/visualstudio/vsto/office-ui-customization?view=visualstudio)
- [Microsoft：Create your own custom task pane](https://learn.microsoft.com/en-us/visualstudio/vsto/custom-task-panes?view=visualstudio)
- [Microsoft：Get started with WebView2 in WinForms apps](https://learn.microsoft.com/en-us/microsoft-edge/webview2/get-started/winforms)
- [Microsoft：Develop Office Add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/develop-overview)
- [Microsoft：Deploy a VSTO solution with Windows Installer](https://learn.microsoft.com/en-us/visualstudio/vsto/deploying-a-vsto-solution-by-using-windows-installer?view=visualstudio)
- [Microsoft：.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy)
