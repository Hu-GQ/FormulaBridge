(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FormulaBridge = root.FormulaBridge || {};
    root.FormulaBridge.OmmlWriter = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NS = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" " +
    "xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\"";

  function escapeXml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function mergeStyle(parent, next) {
    var style = { plain: false, bold: false, italic: false, font: null };
    var key;
    parent = parent || {};
    for (key in style) {
      if (Object.prototype.hasOwnProperty.call(style, key) && parent[key] != null) {
        style[key] = parent[key];
      }
    }
    if (next === "rm" || next === "sf" || next === "tt") {
      style.plain = true;
      style.italic = false;
      style.font = next === "sf" ? "Arial" : next === "tt" ? "Consolas" : null;
    } else if (next === "bf") {
      style.bold = true;
    } else if (next === "it") {
      style.italic = true;
    }
    return style;
  }

  function run(value, style) {
    var mathProperties = "";
    var wordProperties = "";
    style = style || {};
    if (style.plain) {
      mathProperties += "<m:sty m:val=\"p\"/>";
    }
    if (style.bold) {
      wordProperties += "<w:b/>";
    }
    if (style.italic) {
      wordProperties += "<w:i/>";
    }
    if (style.font) {
      wordProperties += "<w:rFonts w:ascii=\"" + escapeXml(style.font) + "\" w:hAnsi=\"" + escapeXml(style.font) + "\"/>";
    }
    return "<m:r>" +
      (mathProperties ? "<m:rPr>" + mathProperties + "</m:rPr>" : "") +
      (wordProperties ? "<w:rPr>" + wordProperties + "</w:rPr>" : "") +
      "<m:t xml:space=\"preserve\">" + escapeXml(value) + "</m:t></m:r>";
  }

  function render(node, style) {
    var i;
    var content = "";
    var rows = "";
    var cells;
    if (!node) {
      return "";
    }
    switch (node.type) {
    case "row":
      for (i = 0; i < node.children.length; i += 1) {
        content += render(node.children[i], style);
      }
      return content;
    case "symbol":
      return run(node.value, style);
    case "literal":
      return run(node.value, mergeStyle(style, node.style === "plain" ? "rm" : node.style));
    case "style":
      return render(node.body, mergeStyle(style, node.style));
    case "fraction":
      return "<m:f><m:fPr><m:type m:val=\"bar\"/></m:fPr><m:num>" +
        render(node.numerator, style) + "</m:num><m:den>" +
        render(node.denominator, style) + "</m:den></m:f>";
    case "root":
      return "<m:rad><m:radPr>" +
        (node.degree ? "" : "<m:degHide m:val=\"1\"/>") +
        "</m:radPr><m:deg>" + render(node.degree, style) +
        "</m:deg><m:e>" + render(node.radicand, style) + "</m:e></m:rad>";
    case "script":
      if (node.sub && node.sup) {
        return "<m:sSubSup><m:e>" + render(node.base, style) + "</m:e><m:sub>" +
          render(node.sub, style) + "</m:sub><m:sup>" + render(node.sup, style) +
          "</m:sup></m:sSubSup>";
      }
      if (node.sub) {
        return "<m:sSub><m:e>" + render(node.base, style) + "</m:e><m:sub>" +
          render(node.sub, style) + "</m:sub></m:sSub>";
      }
      return "<m:sSup><m:e>" + render(node.base, style) + "</m:e><m:sup>" +
        render(node.sup, style) + "</m:sup></m:sSup>";
    case "matrix":
      for (i = 0; i < node.rows.length; i += 1) {
        cells = "";
        for (var j = 0; j < node.rows[i].length; j += 1) {
          cells += "<m:e>" + render(node.rows[i][j], style) + "</m:e>";
        }
        rows += "<m:mr>" + cells + "</m:mr>";
      }
      return "<m:m><m:mPr/>" + rows + "</m:m>";
    case "delimiter":
      return "<m:d><m:dPr><m:begChr m:val=\"" + escapeXml(node.begin) +
        "\"/><m:endChr m:val=\"" + escapeXml(node.end) +
        "\"/></m:dPr><m:e>" + render(node.body, style) + "</m:e></m:d>";
    default:
      throw new Error("Unsupported AST node type: " + node.type);
    }
  }

  function controlProperties(id, mode) {
    return "<w:sdtPr><w:alias w:val=\"FormulaBridge " + escapeXml(mode) + " equation\"/>" +
      "<w:tag w:val=\"FormulaBridge:" + escapeXml(id) + "\"/>" +
      "<w:appearance w:val=\"boundingBox\"/>" +
      "<w:color w:val=\"5B5FC7\"/>" +
      "<w:lock w:val=\"sdtLocked\"/></w:sdtPr>";
  }

  function inlineContent(ast) {
    return "<m:oMath " + NS + ">" + render(ast, {}) + "</m:oMath>";
  }

  function displayContent(ast) {
    return "<w:p " + NS + "><w:pPr><w:jc w:val=\"center\"/></w:pPr>" +
      "<m:oMathPara><m:oMath>" + render(ast, {}) +
      "</m:oMath></m:oMathPara></w:p>";
  }

  function numberedContent(ast, id) {
    var equation = "<w:sdt>" + controlProperties(id, "numbered") +
      "<w:sdtContent>" + inlineContent(ast) + "</w:sdtContent></w:sdt>";
    var number = "<w:p><w:pPr><w:jc w:val=\"right\"/></w:pPr><w:r><w:t>(</w:t></w:r>" +
      "<w:fldSimple w:instr=\" SEQ FormulaBridgeEquation \\* ARABIC \" w:dirty=\"true\">" +
      "<w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t>)</w:t></w:r></w:p>";
    return "<w:tbl " + NS + "><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/>" +
      "<w:tblBorders><w:top w:val=\"nil\"/><w:left w:val=\"nil\"/><w:bottom w:val=\"nil\"/>" +
      "<w:right w:val=\"nil\"/><w:insideH w:val=\"nil\"/><w:insideV w:val=\"nil\"/></w:tblBorders>" +
      "</w:tblPr><w:tblGrid><w:gridCol w:w=\"720\"/><w:gridCol w:w=\"7920\"/><w:gridCol w:w=\"720\"/></w:tblGrid>" +
      "<w:tr><w:tc><w:tcPr><w:tcW w:w=\"720\" w:type=\"dxa\"/></w:tcPr><w:p/></w:tc>" +
      "<w:tc><w:tcPr><w:tcW w:w=\"7920\" w:type=\"dxa\"/></w:tcPr><w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr>" +
      equation + "</w:p></w:tc><w:tc><w:tcPr><w:tcW w:w=\"720\" w:type=\"dxa\"/></w:tcPr>" +
      number + "</w:tc></w:tr></w:tbl>";
  }

  function createInner(ast, mode) {
    if (mode === "inline") {
      return inlineContent(ast);
    }
    if (mode === "numbered") {
      return inlineContent(ast);
    }
    return displayContent(ast);
  }

  function createFormula(ast, options) {
    var mode = options.mode || "inline";
    var id = options.id;
    if (!id) {
      throw new Error("A stable formula id is required.");
    }
    if (mode === "numbered") {
      return numberedContent(ast, id);
    }
    return "<w:sdt " + NS + ">" + controlProperties(id, mode) +
      "<w:sdtContent>" + createInner(ast, mode) + "</w:sdtContent></w:sdt>";
  }

  return {
    createFormula: createFormula,
    createInner: createInner,
    escapeXml: escapeXml,
    renderMath: render
  };
}));
