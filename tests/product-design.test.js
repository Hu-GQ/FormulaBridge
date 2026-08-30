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

test("README links to the approved FormulaBridge product design", function () {
  var readme = read(readmePath);
  assert.equal(fs.existsSync(designPath), true);
  assert.match(readme, /\[docs\/product-design\.md\]\(docs\/product-design\.md\)/);
});

test("product design documents the approved product scope and user workflows", function () {
  var design = read(designPath);
  var requiredHeadings = [
    "# FormulaBridge 产品设计文档",
    "## 4. 目标用户与使用场景",
    "## 6. 产品界面与信息架构",
    "## 7. 核心功能设计",
    "## 13. 首发验收标准",
    "## 14. 版本路线"
  ];

  requiredHeadings.forEach(function (heading) {
    assert.match(design, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  assert.match(design, /重新启动 Word 即可看到 FormulaBridge 功能区/);
  assert.match(design, /停靠任务窗格/);
  assert.match(design, /浮动编辑窗口/);
  assert.match(design, /行内公式/);
  assert.match(design, /独立公式/);
  assert.match(design, /编号公式/);
});

test("product design requires native OMML and secure local TeX rendering", function () {
  var design = read(designPath);

  assert.match(design, /OMML 优先/);
  assert.match(design, /FormulaBridge\.RenderHost\.exe/);
  assert.match(design, /自包含 SVG/);
  assert.match(design, /PNG fallback/);
  assert.match(design, /-no-shell-escape/);
  assert.match(design, /独立随机临时目录/);
  assert.match(design, /公式源码、文档内容和编译日志默认不离开本机/);
});

test("product design supports packages, macros, and multiple explicit TeX environments", function () {
  var design = read(designPath);

  assert.match(design, /宏包、preamble 与自定义命令/);
  assert.match(design, /不同年份的 TeX Live/);
  assert.match(design, /MiKTeX/);
  assert.match(design, /文档默认环境/);
  assert.match(design, /单个公式环境/);
  assert.match(design, /不依赖或修改系统 `PATH`/);
  assert.match(design, /不得静默换用其他引擎/);
});

test("product design preserves portability and defines clean-room legacy migration", function () {
  var design = read(designPath);

  assert.match(design, /对象级源码元数据/);
  assert.match(design, /未安装 FormulaBridge 的干净 Word 可以打开、显示、打印和导出全部公式/);
  assert.match(design, /Equation\.Ribbit/);
  assert.match(design, /不注册或冒用 Aurora 的 CLSID、ProgID 或品牌/);
  assert.match(design, /不覆盖原文件/);
  assert.match(design, /迁移审计报告/);
});
