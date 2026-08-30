(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FormulaBridge = root.FormulaBridge || {};
    root.FormulaBridge.HtmlWriter = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function render(node) {
    var result = "";
    var i;
    var j;
    if (!node) {
      return "";
    }
    switch (node.type) {
    case "row":
      for (i = 0; i < node.children.length; i += 1) {
        result += render(node.children[i]);
      }
      return result;
    case "symbol":
      return "<span class=\"fb-atom\">" + escapeHtml(node.value) + "</span>";
    case "literal":
      return "<span class=\"fb-literal\">" + escapeHtml(node.value) + "</span>";
    case "style":
      return "<span class=\"fb-style fb-style-" + escapeHtml(node.style) + "\">" + render(node.body) + "</span>";
    case "fraction":
      return "<span class=\"fb-frac\"><span class=\"fb-num\">" + render(node.numerator) +
        "</span><span class=\"fb-den\">" + render(node.denominator) + "</span></span>";
    case "root":
      return "<span class=\"fb-root\">" +
        (node.degree ? "<sup class=\"fb-root-degree\">" + render(node.degree) + "</sup>" : "") +
        "<span class=\"fb-root-symbol\">√</span><span class=\"fb-radicand\">" +
        render(node.radicand) + "</span></span>";
    case "script":
      return "<span class=\"fb-script\"><span class=\"fb-script-base\">" + render(node.base) +
        "</span>" + (node.sub ? "<sub>" + render(node.sub) + "</sub>" : "") +
        (node.sup ? "<sup>" + render(node.sup) + "</sup>" : "") + "</span>";
    case "matrix":
      result = "<table class=\"fb-matrix\"><tbody>";
      for (i = 0; i < node.rows.length; i += 1) {
        result += "<tr>";
        for (j = 0; j < node.rows[i].length; j += 1) {
          result += "<td>" + render(node.rows[i][j]) + "</td>";
        }
        result += "</tr>";
      }
      return result + "</tbody></table>";
    case "delimiter":
      return "<span class=\"fb-delimiter\"><span>" + escapeHtml(node.begin) +
        "</span>" + render(node.body) + "<span>" + escapeHtml(node.end) + "</span></span>";
    default:
      throw new Error("Unsupported AST node type: " + node.type);
    }
  }

  return { render: render, escapeHtml: escapeHtml };
}));

