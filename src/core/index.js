(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./latex-parser"),
      require("./omml-writer"),
      require("./html-writer")
    );
  } else {
    root.FormulaBridge = root.FormulaBridge || {};
    root.FormulaBridge.Core = factory(
      root.FormulaBridge.LatexParser,
      root.FormulaBridge.OmmlWriter,
      root.FormulaBridge.HtmlWriter
    );
  }
}(typeof self !== "undefined" ? self : this, function (parser, ommlWriter, htmlWriter) {
  "use strict";

  var MODES = { inline: true, display: true, numbered: true };

  function createId() {
    return "fb-" + new Date().getTime().toString(36) + "-" +
      Math.floor(Math.random() * 0x100000000).toString(36);
  }

  function compile(source, options) {
    var mode = options && options.mode ? options.mode : "inline";
    var id = options && options.id ? options.id : createId();
    var ast;
    if (!MODES[mode]) {
      throw new Error("Unsupported formula mode: " + mode);
    }
    ast = parser.parse(source);
    return {
      id: id,
      mode: mode,
      source: String(source),
      ast: ast,
      previewHtml: htmlWriter.render(ast),
      ooxml: ommlWriter.createFormula(ast, { id: id, mode: mode }),
      innerOoxml: ommlWriter.createInner(ast, mode)
    };
  }

  return {
    ParseError: parser.ParseError,
    compile: compile,
    createId: createId,
    parse: parser.parse
  };
}));

