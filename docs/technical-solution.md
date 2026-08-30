# FormulaBridge 技术方案

| 项目 | 内容 |
| --- | --- |
| 产品 | FormulaBridge |
| 方案版本 | 1.0 |
| 状态 | 已确认，作为实现与技术验收基线 |
| 更新日期 | 2026-08-30 |
| 主架构 | x64 VSTO + WebView2 + TypeScript Core + 独立 .NET RenderHost |

> 本方案与 [product-design.md](product-design.md) 是 FormulaBridge 当前唯一的实现依据。旧原型和旧规划不构成实现约束；正式实现从干净基线开始。发生冲突时，以产品文档、根目录 [CONTEXT.md](../CONTEXT.md) 和已接受 ADR 为准。

## 1. 方案结论

FormulaBridge 1.0 采用以下技术栈：

| 层次 | 首选技术 | 主要职责 |
| --- | --- | --- |
| Word 集成 | C#、VSTO、.NET Framework 4.8、Office Interop | Ribbon、任务窗格、Word 事件、文档状态和原子写入 |
| 编辑器 | WebView2、TypeScript、React、CodeMirror 6 | LaTeX 编辑、预览、配置、诊断和本地化 |
| FormulaBridge Core | TypeScript 纯库 | 解析、AST、能力判断、OMML、反向导入和辅助说明 |
| 文档模型 | C#、Office Interop、Open XML SDK | 内容控件、Custom XML、字段、书签、校验和离线验证 |
| 本地渲染 | C#、.NET 10 LTS、独立 `FormulaBridge.RenderHost.exe` | 配置发现、隔离调度、TeX 执行、输出清理和缓存 |
| 安装更新 | WiX Toolset 4、MSI/Burn、数字签名 | 当前用户安装、先决条件、升级、回滚和卸载 |
| 自动化测试 | Node Test、xUnit、Playwright、Word COM、Open XML SDK | 单元、协议、安全、文档、UI、安装和发布矩阵 |

Office.js 保留为后续 macOS、Word 网页版和轻量体验的适配层，不进入 Windows 1.0 主路径，也不要求首发安装 Office.js 资源。

## 2. 关键技术约束

1. WordAddIn 是唯一直接操作活动 Word 文档的组件。
2. WebView2 只和 WordAddIn 通信，不能直接调用系统进程或读写 Word 包。
3. RenderHost 不持有 Word COM 对象，也不在 Word 进程内加载 TeX。
4. FormulaBridge Core 不依赖 DOM、Office.js、Node 文件系统或 TeX 可执行文件。
5. 文档输入、Web Message、Named Pipe 消息、TeX 输出和更新清单均视为不可信数据。
6. LaTeX 是权威语义来源；Word 表示只能通过受控投影或显式无损反向导入改变它。
7. 打开、索引或选中公式不得自动编译。
8. 普通复制源码携带、SVG+PNG 往返和 TeX 文件隔离是架构门槛，不是可降级功能。

## 3. 总体架构

```text
Microsoft Word x64
  |
  |  Office Interop / Word events
  v
FormulaBridge.WordAddIn (.NET Framework 4.8, VSTO)
  |-- Ribbon + per-window task pane
  |-- DocumentSession + mutation gate
  |-- DocumentStore + numbering/references
  |-- WebView2 host + message validation
  |
  +-- local Web Message ------------------------------+
  |                                                    |
  v                                                    v
WebView2 Editor                                FormulaBridge Core
(React + CodeMirror 6)                         (TypeScript pure library)
  |                                                    |
  +-- edit state / preview / diagnostics --------------+
  |
  |  authenticated Named Pipe
  v
FormulaBridge.RenderHost.exe (.NET 10 LTS, self-contained x64)
  |-- Render profile manager
  |-- bounded scheduler and cache
  |-- per-job restricted process launcher
  |-- TeX engine and converter adapters
  |-- SVG/PNG validator and sanitizer
  v
latex / pdflatex / xelatex / lualatex + converters
```

主进程边界：

- WordAddIn 崩溃风险必须保持最小，不执行 TeX、不扫描任意文件、不做大规模解析。
- 编辑器可以重建，未提交内容由受保护草稿恢复。
- RenderHost 可以崩溃和重启，不能带走 Word；单次 TeX 子进程必须可取消并回收整棵进程树。

## 4. WordAddIn

### 4.1 技术选择

WordAddIn 使用 C#、VSTO、.NET Framework 4.8 和 Office Interop，目标位数为 x64。选择 VSTO 的原因是 1.0 需要：

- 深度 Ribbon 和自定义任务窗格。
- Word 选择、内容控件、字段、书签、撤销和文档事件。
- 安装后随桌面 Word 自动加载。
- 对活动文档执行精确、同步的原子写入。

VSTO 层保持轻薄。解析、预览和 TeX 编译不放入 Word 进程。

### 4.2 Ribbon 与任务窗格

Ribbon XML 提供独立 FormulaBridge 选项卡，并在“插入”选项卡增加紧凑分组。安装器通过当前用户注册完成加载项注册；Word 重启后自动出现功能区。

每个 Word 文档窗口创建独立 `DocumentSession` 和任务窗格实例：

```text
WindowId
  -> DocumentIdentity
  -> DocumentSession
       -> EditorState
       -> DocumentRequirements
       -> CurrentFormulaId
       -> PendingOperation
```

不同窗口不能共享当前公式或隐式渲染配置。同一文档的 Word 写入由文档级异步锁串行化。

### 4.3 可写状态门禁

所有命令先通过统一的 `DocumentMutationGate`：

- 文件格式必须为 `.docx` 或 `.docm`。
- 文档必须可编辑，且不处于保护视图或只读状态。
- 修订模式和实时共同编辑必须关闭。
- 文档不能带有会因写入失效的数字签名。
- 当前元数据架构必须可安全写入或已完成确认式迁移。

不满足时返回结构化状态和修复建议，绝不尝试绕过 Word、组织策略或文档保护。`.docm` 的 VBA 项目不读取、不执行、不修改。

### 4.4 Word 调用纪律

- 所有 COM 调用集中在 WordAddIn 的文档服务层。
- 禁止在后台线程直接访问 Office COM 对象。
- 对 COM 对象保持短生命周期，避免跨异步边界持有 Range、Selection 等引用。
- 长时间解析和渲染在进程外或 WebView2 中完成，Word 线程只执行短事务。
- 取消和关闭文档时释放会话、WebView2 和事件订阅。

## 5. WebView2 编辑器

### 5.1 前端结构

编辑器使用 TypeScript、React 和 CodeMirror 6，编译为完全本地的静态资源。主要模块包括：

- `editor-session`：源码、选择、草稿、撤销和当前公式状态。
- `preview`：OMML 快速预览和 RenderHost 结果展示。
- `diagnostics`：结构化错误、完整脱敏日志和源码定位。
- `profile-ui`：TeX 安装、渲染配置、映射与健康检查。
- `document-settings`：文档 preamble、编号和引用设置。
- `snippets`：轻量本地片段。
- `accessibility`：键盘、ARIA、高对比度和缩放。

1.0 只实现停靠任务窗格。浮动窗口在 1.1 复用同一前端状态模型，但不能作为 1.0 实现复杂度的理由。

### 5.2 WebView2 安全

- 前端资源本地化并使用严格内容安全策略。
- 禁止任意外部导航、下载、弹窗和远程脚本。
- 正式版本默认关闭开发者工具。
- 不直接暴露原生宿主对象。
- Web Message 使用版本化 schema、字段白名单、大小上限和关联请求 ID。
- WordAddIn 对 Core 生成的 OMML、SVG 标识和操作计划再次验证，不能把前端视为可信写入者。

缺少 WebView2 Runtime 时，VSTO Ribbon 和外部诊断入口仍可报告状态，编辑命令保持禁用。

## 6. FormulaBridge Core

### 6.1 边界

Core 是无副作用 TypeScript 纯库，可同时运行于 WebView2 和 Node 测试。输入和输出为版本化数据结构：

```text
LaTeX source + preamble inputs + formula options
  -> tokenizer/parser
  -> Formula AST
  -> diagnostics + capability analysis
  -> OMML plan | TeX render request
  -> accessible description
```

Core 不负责：

- 选择或启动本机可执行文件。
- 访问 Word COM。
- 读写 DOCX 或本地配置。
- 判断用户是否授权编译。

### 6.2 解析与能力分析

- 解析器不能静默忽略未知命令或环境。
- AST 节点保存源码范围，错误能定位到行列。
- preamble 固定按“渲染配置、文档、公式附加项”组合。
- 重复包选项和命令定义冲突返回错误；不做隐式覆盖。
- OMML writer 只接受已经验证的 AST。
- `CapabilityAnalyzer` 只有在版本化规则证明无损时返回 `omml`。
- 自动模式遇到未知或不支持构造时返回 `tex-required`，不能尝试生成近似 OMML。

### 6.3 OMML 反向导入

OMML-to-LaTeX 不是通用转换器。1.0 只实现 Core 能证明无损的受支持子集：

1. 解析 Word OMML 为受限中间结构。
2. 验证所有结构都有确定 LaTeX 表达。
3. 生成候选源码和语义差异预览。
4. 用户确认后创建新的权威源码。

验证失败时只能恢复原 LaTeX 或脱离管理。SVG、PNG 和不支持的 OMML 不进入 OCR 或猜测流程。

### 6.4 XML 与 HTML 安全

- 所有源码文本必须按目标上下文转义。
- OMML 仅允许预定义命名空间、元素和属性。
- 预览 HTML 不使用不受控 `innerHTML`。
- XML 实体、外部实体和外部资源解析全部关闭。
- 生成结果有结构和大小上限，并在 WordAddIn 中再次校验。

## 7. 进程通信

### 7.1 通信路径

```text
WebView2 -- versioned Web Message --> WordAddIn
WordAddIn -- authenticated Named Pipe --> RenderHost
```

正式版本不使用 `localhost` HTTP API。

### 7.2 Named Pipe 会话认证

RenderHost 每次启动生成随机能力令牌，并通过受保护的本地启动通道交给启动它的 WordAddIn。连接必须同时满足：

- Pipe ACL 只允许当前 Windows 用户和必要系统主体。
- `hello` 握手协商协议版本、组件版本和能力。
- 客户端证明持有本次启动的随机令牌。
- 令牌不写入文档、设置、命令行和日志。
- 握手失败、重放、未知版本和超限消息立即拒绝。

仅有“同一 Windows 用户”不足以授权调用，因为同一用户会话中的其他普通程序不应自由使用 TeX 编译能力。

### 7.3 协议

控制消息采用长度前缀 UTF-8 JSON：

```json
{
  "protocolVersion": 1,
  "requestId": "...",
  "operation": "render",
  "payload": {}
}
```

首批操作：

- `hello`
- `listInstallations`
- `listProfiles`
- `validateProfile`
- `render`
- `cancel`
- `getDiagnostics`
- `shutdownIfIdle`

大体积 SVG/PNG 不以无上限 Base64 塞入 JSON；协议使用有长度限制的二进制 artifact frame 或受控 artifact 读取操作。客户端只能读取本次请求生成的 artifact ID，不能提交任意文件路径。

消息 schema 拒绝未知的危险组合。兼容字段可以忽略；改变语义时提升协议主版本。不使用 .NET 二进制序列化或任意对象反序列化。

## 8. RenderHost 与 TeX 执行

### 8.1 RenderHost

`FormulaBridge.RenderHost.exe` 使用 C# 和 .NET 10 LTS，发布为 Windows x64 自包含程序，首发不做激进裁剪。它按当前用户会话由 WordAddIn 按需启动，不注册高权限 Windows 服务。

职责：

- 发现和验证 TeX 安装候选项。
- 管理用户批准的渲染配置。
- 组合受控 TeX 输入。
- 调度、取消和回收渲染作业。
- 清理并验证 SVG、PNG 和日志。
- 管理有界缓存和数据保留。
- 返回结构化诊断，不直接显示 UI。

### 8.2 首发引擎适配器

四种引擎分别实现适配器并独立测试：

- `latex`：DVI 路径，通常使用 `dvisvgm`，按配置生成 PNG fallback。
- `pdflatex`：PDF 路径，使用经过验证的 PDF-to-SVG/PNG 转换器。
- `xelatex`：PDF 路径，覆盖 Unicode、中文和字体场景。
- `lualatex`：PDF 路径，同时依赖文件与网络隔离防止 Lua 能力越界。

适配器必须声明所需工具、版本、参数、输出类型和健康检查。引擎失败后不得静默换用另一引擎或安装。

### 8.3 单次渲染流程

```text
RenderRequest
  -> 协议、授权、大小和配置校验
  -> 验证批准程序的路径与文件身份
  -> 创建随机作业目录和受限执行上下文
  -> 组合固定顺序 preamble 与公式源码
  -> 启动指定引擎并加入 Job Object
  -> 应用文件、网络、时间、内存和输出限制
  -> 调用指定转换器
  -> 验证并清理 SVG / PNG
  -> 生成完整脱敏日志和可访问性数据
  -> 写入有界缓存并返回 artifact
  -> 回收进程树并清理作业目录
```

### 8.4 文件与进程隔离

`-no-shell-escape` 不能单独构成文件访问沙箱。每个 TeX 作业必须组合：

- 专用受限子进程身份；具体采用受限令牌、AppContainer 类能力身份或等价机制，由隔离样机决定。
- Windows Job Object：超时、内存、活动进程数、终止整棵进程树。
- 文件 ACL：只允许读取批准的 TeX 安装根和随机作业根，并只允许写入作业根。
- TeX 输入输出策略：限制搜索路径、输出目录和辅助工具。
- 网络阻断：不授予网络能力，并通过攻击测试验证。
- 明确的绝对可执行文件路径和参数列表，`UseShellExecute = false`，不拼接 shell 命令。

正式发布的判据是“恶意 TeX 实测无法越界”，而不是选择了某个 Windows API。若原生 TeX 与有效隔离无法同时成立，本地 TeX 路径不得发布。

### 8.5 不可由文档放宽的资源限制

初始默认值：

| 项目 | 交互作业 | 批量单项 |
| --- | ---: | ---: |
| 输入 | 256 KiB | 256 KiB |
| 超时 | 30 秒 | 120 秒 |
| 内存 | 1 GiB | 1 GiB |
| 输出文件 | 最多 64 个 | 最多 64 个 |
| 输出总量 | 64 MiB | 64 MiB |

文档、公式和 preamble 不能提高这些限制。后续产品版本只能依据版本化发布语料调整默认值。

### 8.6 SVG 与 PNG 清理

SVG 必须拒绝或移除：

- `<script>`、事件处理器和可执行内容。
- 外部 URL、外部字体和外部图片引用。
- 超限节点、尺寸、路径复杂度和嵌套。
- 非预期命名空间和处理指令。

PNG 必须验证签名、尺寸、解码结果和资源上限。两种格式必须嵌入 Word 包，并完成保存、重开、普通复制、打印和 PDF 导出测试。

## 9. TeX 安装与渲染配置

### 9.1 本机配置模型

本机保存 `TeXInstallation` 和 `RenderProfile`：

```json
{
  "schemaVersion": 1,
  "id": "texlive-2026-xelatex",
  "displayName": "TeX Live 2026 / XeLaTeX",
  "installationId": "texlive-2026",
  "engine": "xelatex",
  "enginePath": "D:\\texlive\\2026\\bin\\windows\\xelatex.exe",
  "converterPath": "D:\\texlive\\2026\\bin\\windows\\dvisvgm.exe",
  "workingMode": "pdf",
  "approvedIdentity": {
    "version": "...",
    "fileHash": "..."
  },
  "preamble": "...",
  "lastValidatedAt": "..."
}
```

只有本机配置保存绝对路径。用户必须显式批准候选程序；版本、哈希或路径身份变化后配置转为失效并要求重新验证。

### 9.2 发现与健康检查

发现来源只用于建议：

- 已知 TeX Live 和 MiKTeX 安装位置。
- 卸载注册信息。
- 当前进程可见的 `PATH`。
- 用户手动选择的目录或程序。

健康检查执行无副作用版本查询和最小公式渲染，记录引擎、转换器、字体和常用宏包状态。FormulaBridge 不修改注册表中的 TeX 设置，不永久修改环境变量，不自动安装缺失宏包。

### 9.3 文档要求与映射

文档只保存：

- 引擎名称。
- 必需宏包和能力。
- 字体要求。
- 可选发行版或版本指纹。
- 用户在文档上确认的本机映射关系引用。

选择优先级：公式覆盖配置、文档映射、用户全局默认。缺少映射时，嵌入表示和源码可查看，但重新编译与覆盖被阻止。兼容映射可能产生视觉差异，必须提示；不得静默换引擎。

安装、宏包、字体或配置身份变化时，相关公式标记为“待更新”，保留旧嵌入结果，等待用户明确更新。

## 10. Word 文档数据模型

### 10.1 可见对象

每个 FormulaBridge 公式使用带固定前缀和 UUID 的内容控件作为边界，内部包含：

- OMML；或
- 共同嵌入的 SVG 与 PNG fallback；以及
- 编号与引用需要的 Word 字段和书签。

WordAddIn 不锁死可见内容。用户可以在没有 FormulaBridge 时编辑 OMML；再次打开 FormulaBridge 时通过校验值检测分歧。

### 10.2 权威源码与索引

文档级 `CustomXmlFormulaStore` 以明文、版本化 Custom XML 保存权威 LaTeX、索引和文档设置。公式记录至少包含：

```json
{
  "schemaVersion": 1,
  "id": "fb-...",
  "source": "\\frac{a}{b}",
  "mode": "inline",
  "outputKind": "omml",
  "environmentRequirement": {
    "engine": "xelatex",
    "packages": ["amsmath"],
    "fonts": [],
    "versionFingerprint": null
  },
  "profileOverrideId": null,
  "style": {
    "fontSizePt": 11,
    "color": "#000000"
  },
  "numbering": {
    "label": null,
    "formatProfileId": "continuous"
  },
  "sourceChecksum": "...",
  "visibleChecksum": "...",
  "rendererVersion": "...",
  "accessibleDescription": "..."
}
```

文档不保存本机绝对路径、能力令牌或原始日志。明文源码的保密性依赖 Word 文档自身的加密与访问控制。

### 10.3 普通复制载体

普通复制必须通过 `IFormulaCopyCarrier` 抽象实现，并在前置样机后冻结具体载体：

- Custom XML 是文档级权威存储，但不预设它能独立满足对象复制。
- 候选方案可以组合内容控件属性、对象关系、可复制 OOXML 扩展和冗余校验数据。
- 载体必须在受支持 Word 矩阵上通过同文档、跨文档、保存重开和卸载后粘贴测试。
- 粘贴副本生成新 UUID 并清除标签；移动保持 UUID。
- 专用 FormulaBridge 复制命令只能是附加便利功能，不能替代普通 `Ctrl+C/V`。

### 10.4 编号与引用

基本编号由 Word 原生 `SEQ` 和 `REF` 字段及书签实现：

- 标签与 UUID 分离，标签在文档内唯一。
- 标签重命名与所有受管理引用在一个事务中更新。
- 插入、移动、删除更新受影响局部字段。
- 全文更新由用户明确触发。
- 断开字段、重复标签和孤立书签只报告，不自动猜测修复。

### 10.5 公式状态

文档索引使用明确状态而不是笼统“损坏”：

- `managed`：源码和可见表示一致。
- `diverged`：可见 OMML 被外部修改。
- `unmapped`：环境要求没有本机映射。
- `stale`：本机环境身份变化，嵌入结果仍保留。
- `detached`：可见内容存在，但源码记录不可用。
- `identity-conflict`：多个对象共享 UUID。
- `orphan-metadata`：记录找不到可见对象。

打开文档只索引和报告，不修复、不迁移、不编译。

### 10.6 元数据迁移

- 旧程序遇到新 schema 时保持可见内容，并在安全范围只读源码，禁止降级写入。
- 新程序先只读验证旧 schema。
- 用户首次确认写操作时才执行迁移。
- 旧表示保留到成功保存并重开验证之后。
- 重大 schema 迁移提示另存副本。

## 11. 原子文档写入

### 11.1 单公式事务

```text
验证 DocumentMutationGate
  -> 获取文档级写锁
  -> 准备并验证新可见内容与新元数据
  -> StartCustomRecord
  -> 保存旧范围与旧记录的可回滚快照
  -> 写入或替换内容控件
  -> 写入元数据、字段和书签
  -> 重新读取并验证 UUID、校验值和关系
  -> 成功结束撤销记录；失败恢复旧状态
```

具体 COM 写入顺序由纵向闭环样机验证，但必须满足：可见内容与源码不能只成功一半；失败或取消保持原状态；一次用户操作对应一个可理解的 Word 撤销记录。

### 11.2 批量事务

批量更新分为：

1. 固定范围、配置和版本快照。
2. 在不写 Word 的情况下验证、渲染并暂存结果。
3. 展示成功、失败和将采用的写入分组。
4. 用户选择全部取消或显式应用成功项。
5. 按可审计、可撤销分组串行提交。

取消不得留下正在写入一半的公式；失败项不能静默跳过。

## 12. 本地数据、缓存与草稿

用户级目录位于 `%LOCALAPPDATA%\FormulaBridge\`：

```text
settings.json       界面、保留期、更新选择
tex-profiles.json   本机 TeX 安装和渲染配置
snippets.json       轻量公式片段
cache/              清理后的渲染结果
logs/               滚动脱敏日志
drafts/             当前用户加密的未提交草稿
```

首发不使用 SQLite。所有 JSON 都带 schema 版本，并以临时文件、刷盘和原子替换写入。

缓存键至少包含规范化源码、完整组合 preamble、引擎和转换器身份、字体与关键环境摘要、Core/RenderHost 版本、输出格式和缩放参数。缓存只保存清理后的 SVG/PNG、尺寸和不可逆哈希，不保存明文源码或原始日志。

默认保留策略：缓存 1 GiB/30 天 LRU、日志 20 MiB/14 天、草稿 7 天。草稿使用 Windows 当前用户数据保护能力加密；用户可缩短、禁用和立即清除。

## 13. 诊断、隐私与遥测

- 普通日志记录请求 ID、组件版本、耗时、错误类别和脱敏环境信息。
- 界面“完整日志”指本次作业的完整脱敏日志。
- 原始日志仅在用户单次授权后临时导出，并提示潜在源码与路径内容。
- 默认诊断包不包含源码、文档内容、文件名和用户路径。
- 源码、文档片段与原始日志分别授权并允许预览。
- 遥测默认关闭；1.0 不实现云渲染或自动诊断上传。

外部诊断工具在 Word 之外检查：

- Office 版本、位数和支持通道。
- 加载项注册、LoadBehavior、签名和禁用状态。
- VSTO 与 WebView2 Runtime。
- RenderHost 文件、签名和启动能力。
- Named Pipe 握手。
- TeX 配置健康状态。

工具只说明并执行用户授权的修复，不绕过组策略或静默提权。

## 14. 安装、签名与更新

### 14.1 安装包

使用 WiX Toolset 4 构建当前用户 MSI，并按需要使用 Burn 提供先决条件引导。安装内容：

- x64 VSTO WordAddIn 和当前用户加载注册。
- 本地 WebView2 编辑器资源。
- .NET 10 自包含 RenderHost。
- FormulaBridge 外部诊断与修复工具。
- 更新、修复和卸载支持。

安装器检测 Word 位数、VSTO Runtime 和 WebView2 Evergreen Runtime。缺少先决条件时提供独立签名的安装入口；不静默提权。FormulaBridge 1.0 不捆绑或自动下载 TeX。

### 14.2 签名

下列产物必须由可信代码签名证书签名：

- MSI、Burn 引导程序和卸载器。
- WordAddIn 程序集和 VSTO 清单。
- RenderHost、诊断工具及其他可执行文件。
- 更新清单和更新包。

发布生成 SBOM，保存依赖锁、提交号、构建环境和签名审计记录。

### 14.3 更新

- 稳定通道默认；预览通道显式加入。
- 周期联网检查默认关闭；“立即检查”或周期检查由用户启用。
- 安装器内置信任根，验证清单和包的签名、哈希、版本与防降级规则。
- 支持签名密钥轮换和撤销；验证失败绝不安装。
- 等待全部 Word 实例和 RenderHost 退出。
- WordAddIn、前端和 RenderHost 作为一个兼容集合安装或回滚。
- 每次安装由用户确认，不热替换正在加载的组件。

### 14.4 卸载

卸载不扫描或修改用户文档。程序、缓存和普通日志删除；设置、TeX 配置和受保护草稿由用户选择是否保留。

## 15. 建议的代码组织

```text
FormulaBridge/
  CONTEXT.md
  docs/
    product-design.md
    technical-solution.md
    adr/
  src/
    core/                              TypeScript AST、OMML、诊断
    web/
      editor/                          React + CodeMirror 6
    desktop/
      FormulaBridge.sln
      FormulaBridge.WordAddIn/         VSTO / .NET Framework 4.8
      FormulaBridge.Document/          文档模型、字段、写入事务
      FormulaBridge.RenderHost/        .NET 10 LTS
      FormulaBridge.Diagnostics/       Word 外部诊断工具
      FormulaBridge.Protocol/          JSON schema / 生成的 DTO
  installer/                           WiX Toolset 4
  tests/
    core/
    editor/
    protocol/
    render-host/
    document/
    word-integration/
    security/
    installer/
    corpus/
```

协议契约采用版本化 JSON schema，并生成 TypeScript 与 C# 类型；不依赖跨 .NET Framework 4.8 和 .NET 10 共享二进制序列化程序集。

## 16. 构建与依赖策略

开发环境：

- Windows 11 x64。
- Visual Studio 2022，Office/SharePoint 和 .NET 桌面开发工作负载。
- .NET Framework 4.8 Developer Pack。
- .NET 10 SDK 当前补丁版本。
- Node.js 当前 LTS 与锁定包管理器。
- Microsoft 365 Word x64 和 Office 2024 x64 测试机。
- TeX Live 支持窗口内版本与当前稳定 MiKTeX。

要求：

- 使用锁文件和依赖更新审查。
- Core、前端和 .NET 构建可离线复现已锁定版本。
- RenderHost 自包含发布，不要求目标机预装 .NET 10 Runtime。
- 开发者无需修改全局 `PATH` 即可选择测试 TeX。
- CI 生成版本、提交号、协议版本、schema 版本和 SBOM。

## 17. 测试与质量策略

### 17.1 自动化层次

| 层次 | 工具 | 重点 |
| --- | --- | --- |
| 文档契约 | Node Test | 产品、技术、术语和 ADR 一致性 |
| Core 单元 | Node Test 或 Vitest | 解析、AST、OMML、反向导入、转义、能力判断 |
| 编辑器组件 | React Testing Library | 状态、快捷键、错误和设置 |
| UI | Playwright | 任务窗格布局、键盘、DPI 和视觉回归 |
| .NET 单元 | xUnit | 配置、协议、缓存、限制和文档状态 |
| RenderHost 集成 | xUnit + 受控 TeX | 四引擎、取消、超时、输出和隔离 |
| DOCX 包 | Open XML SDK | Custom XML、关系、图片、VBA 保持和 schema |
| Word 集成 | Word COM | 插入、编辑、复制、字段、撤销、保存重开 |
| 安装 | 干净 Windows VM | 安装、自动加载、修复、升级、回滚和卸载 |
| 安全 | 攻击语料 + 进程/文件监控 | 文件、网络、进程、SVG、协议和更新边界 |

### 17.2 发布矩阵

- Microsoft 365 Current Channel x64 当前受支持版本。
- Microsoft 365 Monthly Enterprise Channel x64 当前受支持版本。
- Office 2024 Word x64。
- Windows 与 Office 简体中文和英文。
- 100%、150%、200% 和 300% DPI。
- 当前及前两个年度版 TeX Live、当前稳定 MiKTeX。
- `latex`、`pdflatex`、`xelatex`、`lualatex`。
- 无 TeX、缺宏包、缺字体、路径变化、程序身份变化和进程崩溃。
- `.docx`、`.docm`、AutoSave、修订、共同编辑、只读、保护和签名状态。
- 1、100 和 1000 个公式。

Word 与安装测试运行在带真实 Office 的专用 Windows 虚拟机或自托管 CI；公共托管构建机不作为 Word 兼容证据。

### 17.3 性能门槛

在固定参考机器与版本化语料上：

- Ribbon 加载 p95 ≤ 2 秒。
- 任务窗格热启动 ≤ 1 秒。
- 常见 OMML 预览 p95 ≤ 100 毫秒。
- 常见未缓存 TeX 预览 p95 ≤ 2 秒。
- 1000 公式索引 ≤ 3 秒，并且不自动编译。

### 17.4 发布语料

仓库维护无隐私、版本化的公式和 Word 文档语料，覆盖普通数学、专业宏包、中文、特殊字体、辅助说明、普通复制、千公式、损坏元数据和恶意 TeX。每次发布报告记录系统、Word、TeX、组件和 schema 版本及结果。

## 18. 分阶段实施建议

### 阶段 0：四项前置样机

1. **VSTO 安装样机**：签名用户级安装、Word 重启后自动出现 Ribbon、外部诊断可定位禁用原因。
2. **复制载体样机**：普通 `Ctrl+C/V` 在支持矩阵内保留源码，新建 UUID 并清除标签。
3. **双格式样机**：SVG+PNG 经过保存、重开、复制、打印和 PDF 导出。
4. **隔离样机**：恶意 TeX 无法读受控根外文件、访问网络、派生失控进程或突破资源限制。

任一失败先修改 ADR 和架构，再重新验证；不得进入广泛功能开发。

### 阶段 1：纵向产品闭环

- WiX 用户级安装和 Ribbon。
- 每窗口任务窗格与 WebView2 本地资源。
- Core 最小 AST、一个无损 OMML 子集。
- RenderHost 一条本地 TeX 路径。
- 单公式原子写入、Custom XML、保存重开与恢复编辑。
- 贯穿安装、协议、Word 和 TeX 的自动化测试。

### 阶段 2：FormulaBridge 1.0 完整范围

- 三类公式和四种引擎。
- 多 TeX 安装、渲染配置、映射和宏包诊断。
- 普通复制载体冻结。
- 连续编号、标签和引用。
- 两阶段批量更新、片段、诊断、草稿和数据保留。
- 中英文、可访问性、性能和完整发布矩阵。
- 签名更新、回滚和发布证据。

### 阶段 3：1.1 与后续 1.x

- 1.1：浮动编辑器、章节感知编号。
- 后续 1.x：隔离的 Aurora 迁移助手、扩展导入导出、受控资源导入和企业部署。
- Office.js、32 位 Word、ARM64、macOS 和 Word 网页版在核心产品稳定后重新评估。

## 19. 主要风险与替代方案

| 风险 | 发布前证据 | 不能接受的降级 | 备选方向 |
| --- | --- | --- | --- |
| 普通复制不携带 Custom XML | Word 矩阵复制样机 | 改成专用复制命令 | 更换或组合对象级 OOXML 载体 |
| 原生 TeX 难以限制文件读取 | 恶意 TeX 隔离样机 | 只依赖 `-no-shell-escape` | 更严格能力身份；若仍失败则不发布 TeX 路径 |
| SVG/PNG 在 Word 中关系不稳定 | 保存/复制/打印/PDF 往返 | 只保留一种格式 | 调整包关系和插入方式；必要时缩小 TeX 公式能力而非破坏可见性 |
| VSTO 被策略禁用 | 干净机与受限策略测试 | 修改策略强制启用 | 外部诊断、明确说明、后续评估 Office.js |
| COM 写入和 Custom XML 无法原子撤销 | 纵向闭环事务测试 | 部分成功或清空撤销历史 | 调整写入顺序、回滚快照和事务粒度 |
| TeX 发行版工具差异 | 四引擎和滚动版本矩阵 | 失败后静默换引擎 | 版本化适配器和尽力兼容标记 |
| WebView2 Runtime 缺失或受限 | 安装与策略测试 | Word 启动崩溃 | 原生 Ribbon 降级、独立签名先决条件安装 |
| schema 演进破坏旧文档 | 新旧版本双向测试 | 打开即迁移或降级覆盖 | 确认式迁移、保留旧记录、另存副本 |

不建议在没有 VSTO 实证阻塞前改用 C++ COM。它会增加 Office 生命周期、引用计数、安装和崩溃诊断成本，却不能自动解决复制载体、TeX 隔离和 Word 文档事务问题。

## 20. 不可豁免发布门槛

出现以下任一已知问题，1.0 构建不得晋升为正式版：

- 文档损坏或数据丢失。
- 静默数学语义变化。
- TeX 文件、网络或进程隔离逃逸。
- 未授权代码执行。
- FormulaBridge 导致 Word 崩溃。
- 签名、更新信任链或防降级绕过。
- 四项前置样机未通过。
- 受支持 Word、TeX 或文档矩阵未通过。

日期和进度不能豁免这些信任契约。

## 21. 官方技术参考

- [Microsoft：Office solutions development overview (VSTO)](https://learn.microsoft.com/en-us/visualstudio/vsto/office-solutions-development-overview-vsto?view=visualstudio)
- [Microsoft：Customize the UI for Office applications](https://learn.microsoft.com/en-us/visualstudio/vsto/office-ui-customization?view=visualstudio)
- [Microsoft：Create custom task panes](https://learn.microsoft.com/en-us/visualstudio/vsto/custom-task-panes?view=visualstudio)
- [Microsoft：Deploy a VSTO solution with Windows Installer](https://learn.microsoft.com/en-us/visualstudio/vsto/deploying-a-vsto-solution-by-using-windows-installer?view=visualstudio)
- [Microsoft：Distribute your app and the WebView2 Runtime](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- [Microsoft：Overview of update channels for Microsoft 365 Apps](https://learn.microsoft.com/en-us/microsoft-365-apps/updates/overview-update-channels)
- [Microsoft：.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy)
- [Microsoft：Word UndoRecord object](https://learn.microsoft.com/en-us/office/vba/api/word.undorecord)
- [Microsoft：Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Microsoft：Restricted Tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens)
- [Microsoft：Open XML SDK](https://learn.microsoft.com/en-us/office/open-xml/open-xml-sdk)
- [WiX Toolset documentation](https://docs.firegiant.com/wix/)
