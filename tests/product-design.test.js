"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var projectRoot = path.resolve(__dirname, "..");
var designPath = path.join(projectRoot, "docs", "product-design.md");
var readmePath = path.join(projectRoot, "README.md");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("README links to the authoritative FormulaBridge product design", function () {
  var readme = read(readmePath);

  assert.equal(fs.existsSync(designPath), true);
  assert.match(readme, /\[产品设计文档\]\(docs\/product-design\.md\)/);
  assert.match(readme, /唯一的产品与技术依据/);
});

test("product design fixes the 1.0 audience, platform, and deferred scope", function () {
  var design = read(designPath);

  assert.match(design, /已经安装 TeX、使用现代 Windows Word.*个人科研用户/);
  assert.match(design, /Windows 11 x64/);
  assert.match(design, /Current Channel 和 Monthly Enterprise Channel/);
  assert.match(design, /`\.docx` 和 `\.docm`/);
  assert.match(design, /不把 `\.dotx`、`\.dotm`、`\.doc`、`\.rtf` 或 `\.odt` 作为可管理文档格式/);
  assert.match(design, /浮动编辑器和章节感知编号；二者进入 1\.1/);
  assert.match(design, /迁移助手属于后续 1\.x/);
});

test("product design promises automatic Ribbon integration and a visual task pane", function () {
  var design = read(designPath);

  assert.match(design, /重新启动 Word 后，应当自动看到/);
  assert.match(design, /“插入”选项卡中的 FormulaBridge 紧凑分组/);
  assert.match(design, /独立的“FormulaBridge”功能区选项卡/);
  assert.match(design, /右侧停靠任务窗格/);
  assert.match(design, /可视化预览区/);
  assert.match(design, /行内公式、独立公式、编号公式/);
  assert.match(design, /选择公式后点击“编辑”或使用快捷键必须可靠工作/);
});

test("product design uses LaTeX authority with lossless OMML and local TeX fallback", function () {
  var design = read(designPath);

  assert.match(design, /LaTeX 是公式唯一的权威语义来源/);
  assert.match(design, /只有 Core 能证明语义无损时才写入 OMML/);
  assert.match(design, /自包含 SVG 和 PNG fallback/);
  assert.match(design, /`latex`、`pdflatex`、`xelatex`、`lualatex`/);
  assert.match(design, /不自动调用包管理器/);
  assert.match(design, /不依赖或修改系统 `PATH`/);
  assert.match(design, /不得静默切换引擎/);
  assert.match(design, /没有本地 TeX 时，OMML 插入和编辑仍然可用/);
});

test("product design makes source-portable ordinary copy and native numbering release requirements", function () {
  var design = read(designPath);

  assert.match(design, /文档级权威源码以明文 Custom XML 保存/);
  assert.match(design, /普通 Word `Ctrl\+C\/V` 必须保留 LaTeX 和必要元数据/);
  assert.match(design, /粘贴副本获得新 UUID，并默认清除标签/);
  assert.match(design, /专用复制命令不能替代/);
  assert.match(design, /Word 原生 `SEQ`、`REF` 字段和书签/);
  assert.match(design, /打开文档时只报告/);
  assert.match(design, /无损时，预览差异并把 OMML 导入为新的 LaTeX/);
});

test("product design gates Word writes and preserves unsupported states", function () {
  var design = read(designPath);

  assert.match(design, /Word 修订模式/);
  assert.match(design, /实时共同编辑/);
  assert.match(design, /具有数字签名的文档/);
  assert.match(design, /允许查看公式和源码，但阻止插入、更新、删除、修复和重新编号/);
  assert.match(design, /每个 Word 文档窗口拥有独立任务窗格会话/);
  assert.match(design, /作为一次可撤销操作/);
  assert.match(design, /先验证和渲染，再写入 Word/);
  assert.match(design, /不读取、不执行、不修改 VBA/);
});

test("product design requires restricted local execution and local-first privacy", function () {
  var design = read(designPath);

  assert.match(design, /打开或选择公式不触发编译/);
  assert.match(design, /`-no-shell-escape`/);
  assert.match(design, /不能读取任意文档目录或用户路径，也不能访问网络/);
  assert.match(design, /受限子进程身份、Windows Job Object、文件 ACL/);
  assert.match(design, /输入 256 KiB/);
  assert.match(design, /内存 1 GiB/);
  assert.match(design, /遥测默认关闭/);
  assert.match(design, /受保护草稿/);
  assert.match(design, /完整脱敏日志/);
});

test("product design defines signed installation, opt-in updates, and non-destructive uninstall", function () {
  var design = read(designPath);

  assert.match(design, /签名、当前用户安装包/);
  assert.match(design, /不静默提权/);
  assert.match(design, /不捆绑或自动下载 TeX/);
  assert.match(design, /稳定通道为默认；预览通道需要用户明确加入/);
  assert.match(design, /联网更新检查默认关闭/);
  assert.match(design, /安装始终需要用户确认，不进行静默更新/);
  assert.match(design, /卸载绝不修改用户文档/);
});

test("product design defines feasibility spikes, performance budgets, and trust blockers", function () {
  var design = read(designPath);

  assert.match(design, /四个可执行样机/);
  assert.match(design, /普通 `Ctrl\+C\/V` 跨文档携带源码/);
  assert.match(design, /1000 公式文档索引不超过 3 秒/);
  assert.match(design, /静默数学语义变化/);
  assert.match(design, /TeX 隔离逃逸或未授权代码执行/);
  assert.match(design, /FormulaBridge 导致 Word 崩溃/);
  assert.match(design, /迁移审计报告/);
  assert.match(design, /不覆盖原文件/);
});
