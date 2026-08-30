#!/usr/bin/env node
"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");
var Ajv2020 = require("ajv/dist/2020");

var projectRoot = path.resolve(__dirname, "..");
var runSchemaPath = path.join(projectRoot, "schemas", "phase0-run.schema.json");
var corpusSchemaPath = path.join(projectRoot, "schemas", "phase0-corpus.schema.json");
var reportSchemaPath = path.join(projectRoot, "schemas", "phase0-report.schema.json");
var checkSetSchemaPath = path.join(projectRoot, "schemas", "phase0-checks.schema.json");
var checkSetPath = path.join(projectRoot, "phase0", "checks.json");
var statusPolicies = {
  passed: {
    precedence: 0,
    exitCode: 0,
    requiresEvidence: true,
    requiresPassedEvidence: true,
    requiresReason: false
  },
  "not-run": {
    precedence: 1,
    exitCode: 1,
    requiresEvidence: false,
    requiresPassedEvidence: false,
    requiresReason: true
  },
  blocked: {
    precedence: 2,
    exitCode: 1,
    requiresEvidence: false,
    requiresPassedEvidence: false,
    requiresReason: true
  },
  failed: {
    precedence: 3,
    exitCode: 1,
    requiresEvidence: true,
    requiresPassedEvidence: false,
    requiresReason: false
  }
};

function parseArguments(argumentsList) {
  var options = {};

  for (var index = 1; index < argumentsList.length; index += 2) {
    options[argumentsList[index].replace(/^--/, "")] = argumentsList[index + 1];
  }

  return {
    command: argumentsList[0],
    input: options.input,
    output: options.output,
    manifest: options.manifest,
    report: options.report
  };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function toPortablePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function archivedEvidenceLocation(check, item) {
  return toPortablePath(path.join(
    "evidence",
    check.id,
    item.kind,
    path.basename(item.path)
  ));
}

function resolvePathInside(rootDirectory, relativePath, description) {
  var resolvedRoot = path.resolve(rootDirectory);
  var resolvedPath = path.resolve(resolvedRoot, relativePath);
  var pathFromRoot = path.relative(resolvedRoot, resolvedPath);

  if (pathFromRoot.startsWith(".." + path.sep) || path.isAbsolute(pathFromRoot)) {
    throw new Error(description + " must stay inside " + resolvedRoot);
  }

  return resolvedPath;
}

function requireFileInside(rootDirectory, relativePath, description) {
  var resolvedPath = resolvePathInside(rootDirectory, relativePath, description);

  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new Error(description + " is missing: " + relativePath);
  }

  return resolvedPath;
}

function formatSchemaError(error) {
  var location = error.instancePath || "/";

  if (error.keyword === "required") {
    location = location.replace(/\/$/, "") + "/" + error.params.missingProperty;
  }

  return location + " " + error.message;
}

function validateWithSchema(value, schemaPath, schemaName) {
  var ajv = new Ajv2020({ allErrors: true });
  var schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

  if (schemaPath !== runSchemaPath) {
    ajv.addSchema(JSON.parse(fs.readFileSync(runSchemaPath, "utf8")));
  }

  var validate = ajv.compile(schema);

  if (!validate(value)) {
    throw new Error(
      schemaName + " schema validation failed: " + validate.errors.map(formatSchemaError).join("; ")
    );
  }
}

function validateChecksAgainstSet(checks, checkSet) {
  var checkIds = new Set();

  checks.forEach(function (check) {
    var policy = statusPolicies[check.status];

    if (checkIds.has(check.id)) {
      throw new Error("evidence validation failed: duplicate check id " + check.id);
    }
    checkIds.add(check.id);

    if (policy.requiresEvidence && check.evidence.length === 0) {
      throw new Error("evidence validation failed: " + check.id + " requires at least one evidence file");
    }

    if (policy.requiresReason && !check.reason) {
      throw new Error("evidence validation failed: " + check.id + " requires a reason");
    }

  });

  checkSet.checks.forEach(function (definition, index) {
    var check = checks[index];

    if (!check || check.id !== definition.id) {
      throw new Error("evidence validation failed: required check " + definition.id + " is missing");
    }
    if (check.name !== definition.name) {
      throw new Error("evidence validation failed: check name does not match " + definition.id);
    }

    var evidenceKinds = new Set(check.evidence.map(function (item) { return item.kind; }));
    var requiredKinds = [];
    var policy = statusPolicies[check.status];

    if (evidenceKinds.size !== check.evidence.length) {
      throw new Error("evidence validation failed: duplicate evidence kind for " + check.id);
    }
    if (policy.requiresEvidence) {
      requiredKinds = definition.requiredEvidenceKinds;
    }
    if (policy.requiresPassedEvidence) {
      requiredKinds = requiredKinds.concat(definition.passedEvidenceKinds);
    }

    requiredKinds.forEach(function (kind) {
      if (!evidenceKinds.has(kind)) {
        throw new Error("evidence validation failed: " + check.id + " requires " + kind + " evidence");
      }
    });
  });

  if (checks.length !== checkSet.checks.length) {
    throw new Error("evidence validation failed: the run must contain exactly the required checks");
  }
}

function validateRequiredRuntimes(environment, checkSet) {
  checkSet.requiredRuntimes.forEach(function (runtimeName, index) {
    var runtime = environment.runtimes[index];

    if (!runtime || runtime.name !== runtimeName) {
      throw new Error("environment validation failed: required runtime " + runtimeName + " is missing");
    }
  });

  if (environment.runtimes.length !== checkSet.requiredRuntimes.length) {
    throw new Error("environment validation failed: runtimes must match the required runtime set");
  }
}

function validateRunEvidence(input, inputDirectory, checkSet) {
  validateChecksAgainstSet(input.checks, checkSet);

  input.checks.forEach(function (check) {
    if (Date.parse(check.finishedAt) < Date.parse(check.startedAt)) {
      throw new Error("evidence validation failed: " + check.id + " finishes before it starts");
    }

    check.evidence.forEach(function (item) {
      requireFileInside(inputDirectory, item.path, "evidence file");
    });
  });

  if (Date.parse(input.finishedAt) < Date.parse(input.startedAt)) {
    throw new Error("evidence validation failed: run finishes before it starts");
  }

  validateRequiredRuntimes(input.environment, checkSet);
}

function overallStatus(checks, environment) {
  var highestPrecedence = checks.reduce(function (highest, check) {
    return Math.max(highest, statusPolicies[check.status].precedence);
  }, statusPolicies.passed.precedence);

  var environmentUnavailable = (
    environment.word.availability === "unavailable" ||
    environment.tex.availability === "unavailable" ||
    environment.signing.availability === "unavailable" ||
    environment.runtimes.some(function (runtime) { return runtime.availability === "unavailable"; })
  );

  if (environmentUnavailable && highestPrecedence < statusPolicies.blocked.precedence) {
    highestPrecedence = statusPolicies.blocked.precedence;
  }

  return Object.keys(statusPolicies).find(function (status) {
    return statusPolicies[status].precedence === highestPrecedence;
  });
}

function validateCorpus(manifestPath) {
  var resolvedManifestPath = path.resolve(manifestPath);
  var manifestDirectory = path.dirname(resolvedManifestPath);
  var manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, "utf8"));
  var ids = new Set();
  var categories = new Set();

  validateWithSchema(manifest, corpusSchemaPath, "corpus manifest");

  manifest.entries.forEach(function (entry) {
    var artifactPath;

    if (ids.has(entry.id)) {
      throw new Error("corpus validation failed: duplicate entry id " + entry.id);
    }
    ids.add(entry.id);
    categories.add(entry.category);

    artifactPath = requireFileInside(manifestDirectory, entry.path, "corpus file");

    if (sha256(artifactPath) !== entry.sha256) {
      throw new Error("corpus validation failed: hash mismatch for " + entry.path);
    }
  });

  ["word", "formula", "malicious-tex"].forEach(function (category) {
    if (!categories.has(category)) {
      throw new Error("corpus validation failed: missing " + category + " corpus entry");
    }
  });

  return manifest;
}

function validateCheckSet(manifestPath) {
  var manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf8"));

  validateWithSchema(manifest, checkSetSchemaPath, "check set");
  return manifest;
}

function buildReport(input, inputDirectory, corpus, checkSet) {
  var checks = input.checks.map(function (check) {
    var reportCheck = {
      id: check.id,
      name: check.name,
      status: check.status,
      startedAt: check.startedAt,
      finishedAt: check.finishedAt,
      environment: input.environment,
      evidence: check.evidence.map(function (item) {
        var absolutePath = path.resolve(inputDirectory, item.path);

        return {
          kind: item.kind,
          location: archivedEvidenceLocation(check, item),
          sha256: sha256(absolutePath),
          sizeBytes: fs.statSync(absolutePath).size
        };
      })
    };

    if (check.reason) {
      reportCheck.reason = check.reason;
    }

    return reportCheck;
  });

  return {
    schemaVersion: input.schemaVersion,
    runId: input.runId,
    commit: input.commit,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    overallStatus: overallStatus(checks, input.environment),
    environment: input.environment,
    corpus: corpus,
    checkSet: checkSet,
    checks: checks
  };
}

function validateArchivedEvidence(report, reportDirectory) {
  report.checks.forEach(function (check) {
    check.evidence.forEach(function (item) {
      var evidencePath = requireFileInside(reportDirectory, item.location, "report evidence");
      var sizeBytes = fs.statSync(evidencePath).size;

      if (sha256(evidencePath) !== item.sha256) {
        throw new Error("report evidence hash mismatch for " + item.location);
      }
      if (sizeBytes !== item.sizeBytes) {
        throw new Error("report evidence size mismatch for " + item.location);
      }
    });
  });
}

function validateReport(report, reportDirectory) {
  validateWithSchema(report, reportSchemaPath, "report");

  if (report.overallStatus !== overallStatus(report.checks, report.environment)) {
    throw new Error("report validation failed: overallStatus does not match the check results");
  }

  if (reportDirectory) {
    validateArchivedEvidence(report, reportDirectory);

    var corpusManifestPath = requireFileInside(
      projectRoot,
      report.corpus.manifest,
      "report corpus manifest"
    );
    var reportCheckSetPath = requireFileInside(
      projectRoot,
      report.checkSet.manifest,
      "report check set"
    );

    if (sha256(corpusManifestPath) !== report.corpus.sha256) {
      throw new Error("report corpus manifest hash mismatch");
    }
    if (sha256(reportCheckSetPath) !== report.checkSet.sha256) {
      throw new Error("report check set hash mismatch");
    }
    var corpusManifest = validateCorpus(corpusManifestPath);
    var checkSet = validateCheckSet(reportCheckSetPath);

    if (corpusManifest.corpusVersion !== report.corpus.version) {
      throw new Error("report corpus version mismatch");
    }
    if (checkSet.checkSetVersion !== report.checkSet.version) {
      throw new Error("report check set version mismatch");
    }
    validateChecksAgainstSet(report.checks, checkSet);
    validateRequiredRuntimes(report.environment, checkSet);
  }

  return report;
}

function archiveEvidence(input, inputDirectory, outputDirectory) {
  input.checks.forEach(function (check) {
    check.evidence.forEach(function (item) {
      var sourcePath = requireFileInside(inputDirectory, item.path, "evidence file");
      var targetPath = resolvePathInside(
        outputDirectory,
        archivedEvidenceLocation(check, item),
        "archived evidence path"
      );

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath);
      }
    });
  });
}

function describeWord(word) {
  if (word.availability === "unavailable") {
    return "`unavailable` — " + word.reason;
  }

  return "`" + word.version + "` (" + word.channel + ", " + word.bitness + ", " + word.language + ")";
}

function describeTex(tex) {
  if (tex.availability === "unavailable") {
    return "`unavailable` — " + tex.reason;
  }

  return tex.installations.map(function (installation) {
    return "`" + installation.distribution + " " + installation.version + "`";
  }).join(", ");
}

function describeSigning(signing) {
  if (signing.availability === "unavailable") {
    return "`unavailable` — " + signing.reason;
  }

  return "`" + signing.trustLevel + "` (" + signing.tools.map(function (tool) {
    return tool.name + " " + tool.version;
  }).join(", ") + ")";
}

function renderMarkdown(report) {
  var lines = [
    "# FormulaBridge Phase 0 Evidence Report",
    "",
    "- Run: `" + report.runId + "`",
    "- Commit: `" + report.commit + "`",
    "- Result: `" + report.overallStatus + "`",
    "- Time: `" + report.startedAt + "` – `" + report.finishedAt + "`",
    "- Windows: `" + report.environment.windows.version + " " + report.environment.windows.build + "` (" + report.environment.windows.architecture + ", " + report.environment.windows.language + ")",
    "- Word: " + describeWord(report.environment.word),
    "- Runtimes: " + report.environment.runtimes.map(function (runtime) {
      if (runtime.availability === "unavailable") {
        return "`" + runtime.name + " unavailable` — " + runtime.reason;
      }
      return "`" + runtime.name + " " + runtime.version + "`";
    }).join(", "),
    "- TeX: " + describeTex(report.environment.tex),
    "- Signing: " + describeSigning(report.environment.signing),
    "",
    "## Checks",
    ""
  ];

  report.checks.forEach(function (check) {
    lines.push("### " + check.name);
    lines.push("");
    lines.push("- Result: `" + check.status + "`");
    if (check.reason) {
      lines.push("- Reason: " + check.reason);
    }
    lines.push("- Time: `" + check.startedAt + "` – `" + check.finishedAt + "`");
    lines.push("- Environment: Word " + describeWord(check.environment.word));
    lines.push("- Evidence:");
    check.evidence.forEach(function (item) {
      lines.push("  - `" + item.location + "` — `sha256:" + item.sha256 + "`");
    });
    lines.push("");
  });

  return lines.join("\n") + "\n";
}

function run(inputPath, outputDirectory) {
  var resolvedInputPath = path.resolve(inputPath);
  var input = JSON.parse(fs.readFileSync(resolvedInputPath, "utf8"));
  var inputDirectory = path.dirname(resolvedInputPath);
  validateWithSchema(input, runSchemaPath, "input");
  var corpusManifestPath = requireFileInside(
    projectRoot,
    input.corpus.manifest,
    "corpus manifest"
  );
  var checkSet = validateCheckSet(checkSetPath);
  validateRunEvidence(input, inputDirectory, checkSet);
  var corpusManifest = validateCorpus(corpusManifestPath);

  if (corpusManifest.corpusVersion !== input.corpus.version) {
    throw new Error("corpus validation failed: input version does not match the manifest");
  }

  var report = buildReport(input, inputDirectory, {
    version: input.corpus.version,
    manifest: toPortablePath(input.corpus.manifest),
    sha256: sha256(corpusManifestPath)
  }, {
    version: checkSet.checkSetVersion,
    manifest: "phase0/checks.json",
    sha256: sha256(checkSetPath)
  });
  validateReport(report);

  fs.mkdirSync(outputDirectory, { recursive: true });
  archiveEvidence(input, inputDirectory, outputDirectory);
  fs.writeFileSync(
    path.join(outputDirectory, "report.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  fs.writeFileSync(path.join(outputDirectory, "report.md"), renderMarkdown(report));
  validateReport(report, path.resolve(outputDirectory));

  return report;
}

function main() {
  var argumentsValue = parseArguments(process.argv.slice(2));

  if (argumentsValue.command === "validate-corpus" && argumentsValue.manifest) {
    validateCorpus(argumentsValue.manifest);
    return;
  }

  if (argumentsValue.command === "validate-checks" && argumentsValue.manifest) {
    validateCheckSet(argumentsValue.manifest);
    return;
  }

  if (argumentsValue.command === "validate-report" && argumentsValue.report) {
    var resolvedReportPath = path.resolve(argumentsValue.report);
    validateReport(
      JSON.parse(fs.readFileSync(resolvedReportPath, "utf8")),
      path.dirname(resolvedReportPath)
    );
    return;
  }

  if (argumentsValue.command !== "run" || !argumentsValue.input || !argumentsValue.output) {
    throw new Error(
      "Usage: phase0-evidence run --input <run.json> --output <directory>\n" +
      "       phase0-evidence validate-corpus --manifest <manifest.json>\n" +
      "       phase0-evidence validate-checks --manifest <checks.json>\n" +
      "       phase0-evidence validate-report --report <report.json>"
    );
  }

  var report = run(argumentsValue.input, argumentsValue.output);

  process.exitCode = statusPolicies[report.overallStatus].exitCode;
}

try {
  main();
} catch (error) {
  process.stderr.write("phase0-evidence: " + error.message + "\n");
  process.exitCode = 2;
}
