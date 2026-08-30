(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FormulaBridge = root.FormulaBridge || {};
    root.FormulaBridge.LatexParser = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SYMBOLS = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
    varepsilon: "ϵ", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
    iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ",
    omicron: "ο", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ",
    sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ",
    varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
    Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
    pm: "±", mp: "∓", times: "×", div: "÷", cdot: "⋅", ast: "∗",
    circ: "∘", bullet: "∙", le: "≤", leq: "≤", ge: "≥", geq: "≥",
    ne: "≠", neq: "≠", approx: "≈", sim: "∼", simeq: "≃",
    equiv: "≡", propto: "∝", in: "∈", ni: "∋", notin: "∉",
    subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇",
    cup: "∪", cap: "∩", setminus: "∖", emptyset: "∅",
    forall: "∀", exists: "∃", nexists: "∄", neg: "¬", land: "∧", lor: "∨",
    to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔",
    Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", mapsto: "↦",
    infty: "∞", partial: "∂", nabla: "∇", ell: "ℓ", hbar: "ℏ",
    prime: "′", ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱",
    angle: "∠", degree: "°", triangle: "△", parallel: "∥", perp: "⊥",
    sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬",
    iiint: "∭", oint: "∮", bigcup: "⋃", bigcap: "⋂"
  };

  var FUNCTIONS = {
    sin: true, cos: true, tan: true, cot: true, sec: true, csc: true,
    arcsin: true, arccos: true, arctan: true, sinh: true, cosh: true,
    tanh: true, log: true, ln: true, exp: true, lim: true, min: true,
    max: true, sup: true, inf: true, det: true, dim: true, gcd: true,
    ker: true, Pr: true
  };

  var DELIMITERS = {
    "(": "(", ")": ")", "[": "[", "]": "]", "{": "{", "}": "}",
    "|": "|", ".": "", langle: "〈", rangle: "〉", lbrace: "{",
    rbrace: "}", lvert: "|", rvert: "|", lVert: "‖", rVert: "‖"
  };

  function ParseError(message, position) {
    this.name = "ParseError";
    this.message = message;
    this.position = typeof position === "number" ? position : 0;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ParseError);
    }
  }
  ParseError.prototype = Object.create(Error.prototype);
  ParseError.prototype.constructor = ParseError;

  function Parser(source) {
    this.source = String(source || "");
    this.position = 0;
  }

  Parser.prototype.error = function (message, position) {
    throw new ParseError(message, typeof position === "number" ? position : this.position);
  };

  Parser.prototype.peek = function () {
    return this.source.charAt(this.position);
  };

  Parser.prototype.skipWhitespace = function () {
    while (/\s/.test(this.peek())) {
      this.position += 1;
    }
  };

  Parser.prototype.parse = function () {
    var body = this.parseSequence(null);
    if (this.position < this.source.length) {
      this.error("Unexpected token '" + this.peek() + "'.");
    }
    return { type: "row", children: body };
  };

  Parser.prototype.parseSequence = function (stopCharacter) {
    var nodes = [];
    var node;
    var ch;
    while (this.position < this.source.length) {
      ch = this.peek();
      if (stopCharacter && ch === stopCharacter) {
        this.position += 1;
        return nodes;
      }
      if (ch === "}") {
        this.error("Unmatched closing brace.");
      }
      if (ch === "%") {
        this.skipComment();
        continue;
      }
      if (/\s/.test(ch)) {
        this.skipWhitespace();
        continue;
      }
      if (ch === "^" || ch === "_") {
        this.position += 1;
        this.attachScript(nodes, ch === "^" ? "sup" : "sub");
        continue;
      }
      node = this.parseAtom();
      if (node) {
        nodes.push(node);
      }
    }
    if (stopCharacter) {
      this.error("Missing closing '" + stopCharacter + "'.", this.source.length);
    }
    return nodes;
  };

  Parser.prototype.skipComment = function () {
    while (this.position < this.source.length && this.peek() !== "\n") {
      this.position += 1;
    }
  };

  Parser.prototype.parseAtom = function () {
    var ch = this.peek();
    var children;
    if (ch === "{") {
      this.position += 1;
      children = this.parseSequence("}");
      return { type: "row", children: children };
    }
    if (ch === "\\") {
      return this.parseCommand();
    }
    if (ch === "&") {
      this.error("Alignment marker '&' is only valid inside a supported matrix environment.");
    }
    this.position += 1;
    return { type: "symbol", value: ch };
  };

  Parser.prototype.parseCommandName = function () {
    var start;
    var ch;
    this.position += 1;
    start = this.position;
    while (/[A-Za-z]/.test(this.peek())) {
      this.position += 1;
    }
    if (this.position === start) {
      ch = this.peek();
      if (!ch) {
        this.error("A command name is required after '\\'.", start);
      }
      this.position += 1;
      return ch;
    }
    return this.source.slice(start, this.position);
  };

  Parser.prototype.parseCommand = function () {
    var commandPosition = this.position;
    var name = this.parseCommandName();
    var raw;
    var index;
    var body;
    var root;
    var environment;

    if (SYMBOLS[name]) {
      return { type: "symbol", value: SYMBOLS[name], command: name };
    }
    if (FUNCTIONS[name]) {
      return { type: "literal", value: name, style: "plain" };
    }
    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      return {
        type: "fraction",
        numerator: this.parseRequiredGroup("numerator"),
        denominator: this.parseRequiredGroup("denominator")
      };
    }
    if (name === "sqrt") {
      this.skipWhitespace();
      root = null;
      if (this.peek() === "[") {
        raw = this.readBalancedRaw("[", "]");
        root = parse(raw);
      }
      return { type: "root", degree: root, radicand: this.parseRequiredGroup("radicand") };
    }
    if (name === "text" || name === "operatorname") {
      raw = this.readRawRequiredGroup(name);
      return { type: "literal", value: raw, style: "plain" };
    }
    if (name === "mathrm" || name === "mathbf" || name === "mathit" || name === "mathsf" || name === "mathtt") {
      body = this.parseRequiredGroup(name);
      return { type: "style", style: name.slice(4), body: body };
    }
    if (name === "left" || name === "right" || name === "big" || name === "Big" || name === "bigg" || name === "Bigg") {
      return { type: "symbol", value: this.parseDelimiter() };
    }
    if (name === "begin") {
      environment = this.readRawRequiredGroup("environment name");
      return this.parseEnvironment(environment, commandPosition);
    }
    if (name === "end") {
      this.error("Unexpected \\end command.", commandPosition);
    }
    if (name === "," || name === ";" || name === ":" || name === "quad" || name === "qquad") {
      return { type: "literal", value: name === "qquad" ? "  " : name === "quad" ? " " : " ", style: "plain" };
    }
    if (name === "!" || name === " ") {
      return null;
    }
    if (name === "\\") {
      this.error("A line break is only valid inside a supported matrix environment.", commandPosition);
    }
    if (name === "%" || name === "#" || name === "$" || name === "_" || name === "&" || name === "{" || name === "}") {
      return { type: "symbol", value: name };
    }
    index = Object.prototype.hasOwnProperty.call(DELIMITERS, name) ? DELIMITERS[name] : null;
    if (index !== null) {
      return { type: "symbol", value: index };
    }
    this.error("Unsupported LaTeX command \\" + name + ".", commandPosition);
  };

  Parser.prototype.parseDelimiter = function () {
    var name;
    this.skipWhitespace();
    if (!this.peek()) {
      this.error("A delimiter is required.");
    }
    if (this.peek() === "\\") {
      name = this.parseCommandName();
      if (Object.prototype.hasOwnProperty.call(DELIMITERS, name)) {
        return DELIMITERS[name];
      }
      this.error("Unsupported delimiter \\" + name + ".");
    }
    name = this.peek();
    this.position += 1;
    if (Object.prototype.hasOwnProperty.call(DELIMITERS, name)) {
      return DELIMITERS[name];
    }
    this.error("Unsupported delimiter '" + name + "'.", this.position - 1);
  };

  Parser.prototype.parseRequiredGroup = function (label) {
    var children;
    this.skipWhitespace();
    if (this.peek() !== "{") {
      this.error("A braced " + label + " is required.");
    }
    this.position += 1;
    children = this.parseSequence("}");
    return { type: "row", children: children };
  };

  Parser.prototype.readRawRequiredGroup = function (label) {
    this.skipWhitespace();
    if (this.peek() !== "{") {
      this.error("A braced " + label + " is required.");
    }
    return this.readBalancedRaw("{", "}");
  };

  Parser.prototype.readBalancedRaw = function (open, close) {
    var start;
    var depth = 0;
    var escaped = false;
    var ch;
    if (this.peek() !== open) {
      this.error("Expected '" + open + "'.");
    }
    this.position += 1;
    start = this.position;
    while (this.position < this.source.length) {
      ch = this.peek();
      if (escaped) {
        escaped = false;
        this.position += 1;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        this.position += 1;
        continue;
      }
      if (ch === open) {
        depth += 1;
      } else if (ch === close) {
        if (depth === 0) {
          ch = this.source.slice(start, this.position);
          this.position += 1;
          return ch;
        }
        depth -= 1;
      }
      this.position += 1;
    }
    this.error("Missing closing '" + close + "'.", this.source.length);
  };

  Parser.prototype.attachScript = function (nodes, kind) {
    var base;
    var argument;
    var scripted;
    if (!nodes.length) {
      this.error("A " + (kind === "sup" ? "superscript" : "subscript") + " requires a base.", this.position - 1);
    }
    argument = this.parseScriptArgument();
    base = nodes.pop();
    if (base.type === "script") {
      scripted = base;
    } else {
      scripted = { type: "script", base: base, sub: null, sup: null };
    }
    if (scripted[kind]) {
      this.error("Duplicate " + (kind === "sup" ? "superscript" : "subscript") + ".", this.position);
    }
    scripted[kind] = argument;
    nodes.push(scripted);
  };

  Parser.prototype.parseScriptArgument = function () {
    var ch;
    this.skipWhitespace();
    ch = this.peek();
    if (!ch) {
      this.error("A script argument is required.");
    }
    if (ch === "{") {
      this.position += 1;
      return { type: "row", children: this.parseSequence("}") };
    }
    if (ch === "\\") {
      return this.parseCommand();
    }
    this.position += 1;
    return { type: "symbol", value: ch };
  };

  Parser.prototype.parseEnvironment = function (environment, commandPosition) {
    var supported = {
      matrix: ["", ""], pmatrix: ["(", ")"], bmatrix: ["[", "]"],
      Bmatrix: ["{", "}"], vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"],
      cases: ["{", ""], aligned: ["", ""], align: ["", ""]
    };
    var endMarker;
    var endIndex;
    var body;
    var rowSources;
    var rows = [];
    var i;
    var cellSources;
    var j;
    var matrix;
    if (!Object.prototype.hasOwnProperty.call(supported, environment)) {
      this.error("Unsupported environment '" + environment + "'.", commandPosition);
    }
    endMarker = "\\end{" + environment + "}";
    endIndex = this.source.indexOf(endMarker, this.position);
    if (endIndex < 0) {
      this.error("Missing " + endMarker + ".", commandPosition);
    }
    body = this.source.slice(this.position, endIndex);
    this.position = endIndex + endMarker.length;
    rowSources = splitTopLevel(body, "\\\\");
    for (i = 0; i < rowSources.length; i += 1) {
      cellSources = splitTopLevel(rowSources[i], "&");
      rows[i] = [];
      for (j = 0; j < cellSources.length; j += 1) {
        rows[i].push(parse(cellSources[j]));
      }
    }
    matrix = { type: "matrix", rows: rows };
    if (supported[environment][0] || supported[environment][1]) {
      return {
        type: "delimiter",
        begin: supported[environment][0],
        end: supported[environment][1],
        body: matrix
      };
    }
    return matrix;
  };

  function splitTopLevel(source, separator) {
    var parts = [];
    var start = 0;
    var depth = 0;
    var i = 0;
    var ch;
    while (i < source.length) {
      ch = source.charAt(i);
      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
      }
      if (depth === 0 && source.slice(i, i + separator.length) === separator) {
        parts.push(source.slice(start, i));
        i += separator.length;
        start = i;
        continue;
      }
      i += 1;
    }
    parts.push(source.slice(start));
    return parts;
  }

  function parse(source) {
    var parser = new Parser(source);
    if (!String(source || "").replace(/\s/g, "")) {
      throw new ParseError("Enter a LaTeX formula.", 0);
    }
    return parser.parse();
  }

  return {
    ParseError: ParseError,
    parse: parse,
    symbols: SYMBOLS
  };
}));
