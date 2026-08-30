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

test("README links to the target FormulaBridge technical solution", function () {
  var readme = read(readmePath);

  assert.equal(fs.existsSync(technicalSolutionPath), true);
  assert.match(readme, /\[技术方案\]\(docs\/technical-solution\.md\)/);
  assert.match(readme, /当前以以下两份文档作为唯一的产品与技术依据/);
  assert.match(readme, /正式实现将从干净基线开始/);
});

test("technical solution fixes the approved primary technology stack", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /C#、VSTO、\.NET Framework 4\.8、Office Interop/);
  assert.match(solution, /WebView2、TypeScript、React、CodeMirror 6/);
  assert.match(solution, /C#、\.NET 10 LTS、独立 `FormulaBridge\.RenderHost\.exe`/);
  assert.match(solution, /WiX Toolset 4、MSI\/Burn、数字签名/);
  assert.match(solution, /Office\.js 保留为后续 macOS、Word 网页版和轻量体验的适配层/);
});

test("technical solution keeps Word, web UI, and TeX execution isolated", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /WordAddIn 是唯一直接操作活动 Word 文档的组件/);
  assert.match(solution, /WebView2 只和 WordAddIn 通信/);
  assert.match(solution, /RenderHost 不持有 Word COM 对象/);
  assert.match(solution, /正式版本不使用 `localhost` HTTP API/);
  assert.match(solution, /Named Pipe 只允许当前 Windows 用户访问/);
});

test("technical solution defines native and local TeX rendering paths", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /LaTeX -> AST -> OMML -> Word 内容控件/);
  assert.match(solution, /LaTeX -> RenderHost -> SVG \+ PNG fallback -> Word 内容控件/);
  assert.match(solution, /自动模式不得因为 TeX 暂时不可用而悄悄生成语义不完整的 OMML/);
  assert.match(solution, /SVG 和 PNG 必须嵌入 DOCX 包/);
});

test("technical solution requires explicit TeX profiles and process controls", function () {
  var solution = read(technicalSolutionPath);

  assert.match(solution, /单个公式明确指定的环境/);
  assert.match(solution, /当前文档默认环境/);
  assert.match(solution, /用户全局默认环境/);
  assert.match(solution, /不依赖或修改系统 `PATH`/);
  assert.match(solution, /-no-shell-escape/);
  assert.match(solution, /Windows Job Object/);
  assert.match(solution, /不能单独构成完整文件访问沙箱/);
});

test("technical solution covers deployment and release validation", function () {
  var solution = read(technicalSolutionPath);
  var requiredHeadings = [
    "## 14. 安装、签名与更新",
    "## 15. 建议的代码组织",
    "## 17. 测试与质量策略",
    "## 18. 分阶段实施建议",
    "## 19. 主要风险与替代方案"
  ];

  requiredHeadings.forEach(function (heading) {
    assert.match(solution, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  assert.match(solution, /安装后重启 Word 自动出现功能区/);
  assert.match(solution, /未安装 FormulaBridge 的干净 Word 可以显示、打印和导出公式/);
});

test("product design is aligned with the VSTO and WebView2 primary architecture", function () {
  var productDesign = read(productDesignPath);

  assert.match(productDesign, /x64 VSTO 主插件/);
  assert.match(productDesign, /WebView2 编辑器/);
  assert.match(productDesign, /Office\.js 适配器.*后续.*可选入口/);
  assert.match(productDesign, /正式版本不开放本地 HTTP 编译接口/);
});

test("authoritative documents reject historical prototype constraints", function () {
  var technicalSolution = read(technicalSolutionPath);
  var productDesign = read(productDesignPath);

  assert.match(technicalSolution, /旧原型和旧规划不构成实现约束/);
  assert.match(technicalSolution, /从干净基线开始/);
  assert.match(productDesign, /旧原型和旧规划不构成产品约束/);
  assert.doesNotMatch(technicalSolution, /接入当前编辑器原型/);
  assert.doesNotMatch(technicalSolution, /把现有 Core 迁移到 TypeScript/);
});
