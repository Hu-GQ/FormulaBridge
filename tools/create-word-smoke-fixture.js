"use strict";

var core = require("../src/core");
var source = "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}";
var compiled = {
  inline: core.compile("E=mc^2", { mode: "inline", id: "fb-word-smoke-inline" }),
  display: core.compile(source, { mode: "display", id: "fb-word-smoke-display" }),
  numbered: core.compile("a^2+b^2=c^2", { mode: "numbered", id: "fb-word-smoke-numbered" })
};

process.stdout.write(JSON.stringify(compiled));
