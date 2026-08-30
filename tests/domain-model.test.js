"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var projectRoot = path.resolve(__dirname, "..");
var contextPath = path.join(projectRoot, "CONTEXT.md");
var sourceAdrPath = path.join(projectRoot, "docs", "adr", "0001-latex-is-authoritative-formula-source.md");
var trustAdrPath = path.join(projectRoot, "docs", "adr", "0002-document-tex-is-untrusted.md");
var renderingAdrPath = path.join(projectRoot, "docs", "adr", "0003-use-omml-only-for-lossless-semantics.md");
var copyAdrPath = path.join(projectRoot, "docs", "adr", "0004-copy-creates-new-formula-identity.md");
var mappingAdrPath = path.join(projectRoot, "docs", "adr", "0005-map-document-requirements-to-local-render-profiles.md");
var isolationAdrPath = path.join(projectRoot, "docs", "adr", "0006-require-tex-filesystem-isolation.md");
var metadataAdrPath = path.join(projectRoot, "docs", "adr", "0007-store-latex-source-as-plain-document-metadata.md");
var distributionAdrPath = path.join(projectRoot, "docs", "adr", "0008-distribute-a-closed-source-signed-desktop-product.md");
var compatibilityAdrPath = path.join(projectRoot, "docs", "adr", "0009-version-document-metadata-and-fail-without-mutation.md");
var fallbackAdrPath = path.join(projectRoot, "docs", "adr", "0010-embed-and-verify-svg-with-png-fallback.md");
var draftAdrPath = path.join(projectRoot, "docs", "adr", "0011-encrypt-local-editor-drafts.md");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("domain glossary defines the accepted FormulaBridge language", function () {
  var context = read(contextPath);

  assert.match(context, /\*\*首要用户\*\*/);
  assert.match(context, /个人科研用户/);
  assert.match(context, /\*\*FormulaBridge 1\.0\*\*/);
  assert.match(context, /可以正式使用的核心版本/);
  assert.match(context, /\*\*支持文档\*\*/);
  assert.match(context, /`\.docx` 和 `\.docm`/);
  assert.match(context, /\*\*正式发行版\*\*/);
  assert.match(context, /闭源桌面产品和签名安装包/);
  assert.match(context, /\*\*核心首发\*\*/);
  assert.match(context, /\*\*LaTeX 源码\*\*/);
  assert.match(context, /权威语义来源/);
  assert.match(context, /\*\*分歧公式\*\*/);
  assert.match(context, /\*\*公式身份\*\*/);
  assert.match(context, /复制创建新身份/);
  assert.match(context, /\*\*公式标签\*\*/);
  assert.match(context, /\*\*基本编号\*\*/);
  assert.match(context, /\*\*公式引用\*\*/);
  assert.match(context, /\*\*源码可移植复制\*\*/);
  assert.match(context, /\*\*文档内源码\*\*/);
  assert.match(context, /\*\*未映射公式\*\*/);
  assert.match(context, /\*\*受管理引用\*\*/);
  assert.match(context, /\*\*双格式表示\*\*/);
  assert.match(context, /\*\*已脱离管理公式\*\*/);
  assert.match(context, /\*\*自动渲染\*\*/);
  assert.match(context, /\*\*TeX 安装\*\*/);
  assert.match(context, /\*\*渲染配置\*\*/);
  assert.match(context, /\*\*首发引擎\*\*/);
  assert.match(context, /\*\*文档环境要求\*\*/);
  assert.match(context, /\*\*公式覆盖配置\*\*/);
  assert.match(context, /\*\*兼容映射\*\*/);
  assert.match(context, /\*\*preamble 层\*\*/);
  assert.match(context, /\*\*渲染缓存\*\*/);
  assert.match(context, /\*\*缺失宏包诊断\*\*/);
  assert.match(context, /\*\*首发交换能力\*\*/);
  assert.match(context, /\*\*公式片段\*\*/);
  assert.match(context, /\*\*受保护草稿\*\*/);
  assert.match(context, /\*\*兼容元数据\*\*/);
  assert.match(context, /\*\*可控卸载\*\*/);
  assert.match(context, /\*\*明确编译操作\*\*/);
  assert.match(context, /\*\*受控 TeX 根\*\*/);
  assert.match(context, /\*\*受保护文档\*\*/);
  assert.match(context, /\*\*用户级安装\*\*/);
});

test("accepted ADRs preserve formula authority and document trust decisions", function () {
  var sourceAdr = read(sourceAdrPath);
  var trustAdr = read(trustAdrPath);
  var renderingAdr = read(renderingAdrPath);
  var copyAdr = read(copyAdrPath);
  var mappingAdr = read(mappingAdrPath);
  var isolationAdr = read(isolationAdrPath);
  var metadataAdr = read(metadataAdrPath);
  var distributionAdr = read(distributionAdrPath);
  var compatibilityAdr = read(compatibilityAdrPath);
  var fallbackAdr = read(fallbackAdrPath);
  var draftAdr = read(draftAdrPath);

  assert.match(sourceAdr, /status: accepted/);
  assert.match(sourceAdr, /LaTeX source as the authoritative semantic state/);
  assert.match(sourceAdr, /instead of attempting an automatic bidirectional merge/);
  assert.match(trustAdr, /status: accepted/);
  assert.match(trustAdr, /never compiled merely because the document opens/);
  assert.match(trustAdr, /FormulaBridge 1\.0 does not expose shell escape/);
  assert.match(renderingAdr, /status: accepted/);
  assert.match(renderingAdr, /OMML only when a versioned Core capability rule proves/);
  assert.match(copyAdr, /status: accepted/);
  assert.match(copyAdr, /pasted instance receives a new UUID/);
  assert.match(copyAdr, /FormulaBridge 1\.0 release gate/);
  assert.match(mappingAdr, /status: accepted/);
  assert.match(mappingAdr, /explicitly maps those requirements to a compatible local render profile/);
  assert.match(mappingAdr, /recompilation and replacement are blocked/);
  assert.match(isolationAdr, /status: accepted/);
  assert.match(isolationAdr, /cannot read outside its explicitly allowed/);
  assert.match(isolationAdr, /cannot directly reference arbitrary document or user paths/);
  assert.match(isolationAdr, /adversarial tests rather than relying on a warning/);
  assert.match(metadataAdr, /status: accepted/);
  assert.match(metadataAdr, /plain Custom XML inside the Word document package/);
  assert.match(distributionAdr, /status: accepted/);
  assert.match(distributionAdr, /closed-source Windows desktop product/);
  assert.match(distributionAdr, /commercial licensing system are not FormulaBridge 1\.0 release gates/);
  assert.match(compatibilityAdr, /status: accepted/);
  assert.match(compatibilityAdr, /refuses to downgrade or overwrite the metadata/);
  assert.match(compatibilityAdr, /marks the formula as detached/);
  assert.match(fallbackAdr, /status: accepted/);
  assert.match(fallbackAdr, /embeds a sanitized SVG together with a PNG fallback/);
  assert.match(fallbackAdr, /ordinary copy, print, and PDF export is a release gate/);
  assert.match(draftAdr, /status: accepted/);
  assert.match(draftAdr, /time-limited drafts protected for the current Windows user/);
});
