"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var projectRoot = path.resolve(__dirname, "..");
var technicalSolutionPath = path.join(projectRoot, "docs", "technical-solution.md");
var productDesignPath = path.join(projectRoot, "docs", "product-design.md");
var readmePath = path.join(projectRoot, "README.md");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("README links to the authoritative FormulaBridge technical solution", function () {
  var readme = read(readmePath);

  assert.equal(fs.existsSync(technicalSolutionPath), true);
  assert.match(readme, /\[技术方案\]\(docs\/technical-solution\.md\)/);
  assert.match(readme, /正式实现将从干净基线开始/);
});

test("technical solution fixes the approved primary technology stack", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /C#、VSTO、\.NET Framework 4\.8、Office Interop/);
  assert.match(solution, /WebView2、TypeScript、React、CodeMirror 6/);
  assert.match(solution, /C#、\.NET 10 LTS、独立 `FormulaBridge\.RenderHost\.exe`/);
  assert.match(solution, /WiX Toolset 4、MSI\/Burn、数字签名/);
  assert.match(solution, /Office\.js 保留为后续 macOS、Word 网页版和轻量体验的适配层/);
  assert.match(solution, /正式实现从干净基线开始/);
});

test("technical solution keeps Word, WebView2, Core, and RenderHost isolated", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /WordAddIn 是唯一直接操作活动 Word 文档的组件/);
  assert.match(solution, /WebView2 只和 WordAddIn 通信/);
  assert.match(solution, /RenderHost 不持有 Word COM 对象/);
  assert.match(solution, /Core 不依赖 DOM、Office\.js、Node 文件系统或 TeX 可执行文件/);
  assert.match(solution, /正式版本不使用 `localhost` HTTP API/);
  assert.match(solution, /每次启动生成随机能力令牌/);
  assert.match(solution, /仅有“同一 Windows 用户”不足以授权调用/);
});

test("technical solution defines lossless OMML and four explicit TeX adapters", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /只有在版本化规则证明无损时返回 `omml`/);
  assert.match(solution, /不能尝试生成近似 OMML/);
  assert.match(solution, /`latex`：DVI 路径/);
  assert.match(solution, /`pdflatex`：PDF 路径/);
  assert.match(solution, /`xelatex`：PDF 路径/);
  assert.match(solution, /`lualatex`：PDF 路径/);
  assert.match(solution, /引擎失败后不得静默换用另一引擎/);
  assert.match(solution, /不进入 OCR 或猜测流程/);
});

test("technical solution makes TeX filesystem isolation a measured release condition", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /`-no-shell-escape` 不能单独构成文件访问沙箱/);
  assert.match(solution, /专用受限子进程身份/);
  assert.match(solution, /Windows Job Object/);
  assert.match(solution, /文件 ACL/);
  assert.match(solution, /网络阻断/);
  assert.match(solution, /若原生 TeX 与有效隔离无法同时成立，本地 TeX 路径不得发布/);
  assert.match(solution, /\| 输入 \| 256 KiB \| 256 KiB \|/);
  assert.match(solution, /\| 输出总量 \| 64 MiB \| 64 MiB \|/);
});

test("technical solution defines explicit local profile trust and unmapped behavior", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /只有本机配置保存绝对路径/);
  assert.match(solution, /用户必须显式批准候选程序/);
  assert.match(solution, /版本、哈希或路径身份变化后配置转为失效/);
  assert.match(solution, /不自动安装缺失宏包/);
  assert.match(solution, /公式覆盖配置、文档映射、用户全局默认/);
  assert.match(solution, /缺少映射时，嵌入表示和源码可查看/);
  assert.match(solution, /不得静默换引擎/);
});

test("technical solution versions plain document source and preserves ordinary copy", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /明文、版本化 Custom XML 保存权威 LaTeX/);
  assert.match(solution, /文档不保存本机绝对路径、能力令牌或原始日志/);
  assert.match(solution, /普通复制必须通过 `IFormulaCopyCarrier` 抽象实现/);
  assert.match(solution, /Custom XML 是文档级权威存储，但不预设它能独立满足对象复制/);
  assert.match(solution, /粘贴副本生成新 UUID 并清除标签/);
  assert.match(solution, /专用 FormulaBridge 复制命令.*不能替代普通 `Ctrl\+C\/V`/);
  assert.match(solution, /原生 `SEQ` 和 `REF` 字段及书签/);
});

test("technical solution gates and atomically commits Word mutations", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /统一的 `DocumentMutationGate`/);
  assert.match(solution, /修订模式和实时共同编辑必须关闭/);
  assert.match(solution, /VBA 项目不读取、不执行、不修改/);
  assert.match(solution, /StartCustomRecord/);
  assert.match(solution, /可见内容与源码不能只成功一半/);
  assert.match(solution, /在不写 Word 的情况下验证、渲染并暂存结果/);
  assert.match(solution, /打开文档只索引和报告，不修复、不迁移、不编译/);
});

test("technical solution implements local retention, signed updates, and safe prerequisites", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /%LOCALAPPDATA%\\FormulaBridge\\/);
  assert.match(solution, /缓存 1 GiB\/30 天 LRU、日志 20 MiB\/14 天、草稿 7 天/);
  assert.match(solution, /Windows 当前用户数据保护能力加密/);
  assert.match(solution, /不静默提权/);
  assert.match(solution, /稳定通道默认；预览通道显式加入/);
  assert.match(solution, /防降级规则/);
  assert.match(solution, /作为一个兼容集合安装或回滚/);
  assert.match(solution, /1\.0 不捆绑或自动下载 TeX/);
});

test("technical solution begins with four spikes and enforces the release matrix", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /阶段 0：四项前置样机/);
  assert.match(solution, /VSTO 安装样机/);
  assert.match(solution, /复制载体样机/);
  assert.match(solution, /双格式样机/);
  assert.match(solution, /隔离样机/);
  assert.match(solution, /阶段 1：纵向产品闭环/);
  assert.match(solution, /1000 公式索引 ≤ 3 秒/);
  assert.match(solution, /不可豁免发布门槛/);
  assert.match(solution, /日期和进度不能豁免这些信任契约/);
});

test("product and technical documents agree on the task pane and deferred roadmap", function () {
  var productDesign = read(productDesignPath);
  var solution = read(technicalSolutionPath);

  assert.match(productDesign, /1\.0 使用每个 Word 文档窗口独立的右侧停靠任务窗格/);
  assert.match(solution, /1\.0 只实现停靠任务窗格/);
  assert.match(productDesign, /浮动编辑窗口在 1\.1 提供/);
  assert.match(solution, /浮动编辑器、章节感知编号/);
  assert.match(productDesign, /迁移助手属于后续 1\.x/);
  assert.match(productDesign, /Aurora 迁移助手：用户显式启动、独立实现/);
  assert.match(solution, /后续 1\.x：隔离的 Aurora 迁移助手/);
});
