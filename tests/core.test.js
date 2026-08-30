"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var parser = require("../src/core/latex-parser");
var core = require("../src/core");

test("parses fractions, roots, scripts, and symbols", function () {
  var result = core.compile("\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}", { mode: "inline", id: "fb-test" });
  assert.equal(result.ast.children[0].type, "fraction");
  assert.match(result.ooxml, /<m:f>/);
  assert.match(result.ooxml, /<m:rad>/);
  assert.match(result.ooxml, /<m:sSup>/);
  assert.match(result.ooxml, /±/);
});

test("parses paired subscript and superscript", function () {
  var ast = parser.parse("x_i^2");
  assert.equal(ast.children[0].type, "script");
  assert.equal(ast.children[0].sub.type, "symbol");
  assert.equal(ast.children[0].sup.type, "symbol");
});

test("parses matrices and preserves delimiters", function () {
  var result = core.compile("\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", { mode: "display", id: "fb-matrix" });
  assert.match(result.ooxml, /<m:m>/);
  assert.match(result.ooxml, /m:begChr m:val=\"\(\"/);
  assert.match(result.previewHtml, /fb-matrix/);
});

test("supports Chinese text without external resources", function () {
  var result = core.compile("x=\\text{中文变量}", { mode: "inline", id: "fb-cjk" });
  assert.match(result.ooxml, /中文变量/);
  assert.match(result.previewHtml, /中文变量/);
});

test("escapes source-derived XML content", function () {
  var result = core.compile("a<b \\& c>d", { mode: "inline", id: "fb-escape" });
  assert.match(result.ooxml, /&lt;/);
  assert.match(result.ooxml, /&amp;/);
  assert.doesNotMatch(result.ooxml, /<m:t[^>]*>a<b/);
});

test("creates a portable native equation wrapper", function () {
  var result = core.compile("E=mc^2", { mode: "inline", id: "fb-portable" });
  assert.match(result.ooxml, /FormulaBridge:fb-portable/);
  assert.match(result.ooxml, /<m:oMath/);
  assert.doesNotMatch(result.ooxml, /<o:OLEObject|TargetMode=\"External\"|r:link=/i);
});

test("creates native numbering fields", function () {
  var result = core.compile("a=b", { mode: "numbered", id: "fb-numbered" });
  assert.match(result.ooxml, /SEQ FormulaBridgeEquation/);
  assert.match(result.ooxml, /<w:tbl/);
  assert.match(result.ooxml, /FormulaBridge:fb-numbered/);
  assert.doesNotMatch(result.innerOoxml, /<w:tbl/);
  assert.match(result.innerOoxml, /<m:oMath/);
});

test("rejects unsupported commands without partial output", function () {
  assert.throws(function () {
    core.compile("\\includegraphics{secret.png}", { mode: "inline", id: "fb-bad" });
  }, function (error) {
    return error.name === "ParseError" && error.position === 0 && /Unsupported/.test(error.message);
  });
});

test("rejects malformed input with a source position", function () {
  assert.throws(function () {
    parser.parse("\\frac{a}{b");
  }, function (error) {
    return error.name === "ParseError" && typeof error.position === "number";
  });
});

test("HTML preview escapes literal markup", function () {
  var result = core.compile("\\text{<script>}", { mode: "inline", id: "fb-html" });
  assert.doesNotMatch(result.previewHtml, /<script>/);
  assert.match(result.previewHtml, /&lt;script&gt;/);
});
