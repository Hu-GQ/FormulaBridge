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
var checkResultSchemaPath = path.join(projectRoot, "schemas", "phase0-check-result.schema.json");
var executionSchemaPath = path.join(projectRoot, "schemas", "phase0-execution.schema.json");
var checkSetPath = path.join(projectRoot, "phase0", "checks.json");
var archivedCorpusManifestLocation = "inputs/corpus/manifest.json";
var archivedCheckSetLocation = "inputs/check-set/checks.json";
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

  if (pathFromRoot === ".." || pathFromRoot.startsWith(".." + path.sep) || path.isAbsolute(pathFromRoot)) {
    throw new Error(description + " must stay inside " + resolvedRoot);
  }

  return resolvedPath;
}

function pathIsInside(rootDirectory, candidatePath) {
  var pathFromRoot = path.relative(rootDirectory, candidatePath);

  return pathFromRoot === "" || (
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(".." + path.sep) &&
    !path.isAbsolute(pathFromRoot)
  );
}

function realPath(filePath) {
  var resolveRealPath = fs.realpathSync.native || fs.realpathSync;

  return resolveRealPath(filePath);
}

function requireRealPathInside(rootDirectory, existingPath, description) {
  var resolvedRoot = realPath(path.resolve(rootDirectory));
  var resolvedPath = realPath(existingPath);

  if (!pathIsInside(resolvedRoot, resolvedPath)) {
    throw new Error(description + " real path must stay inside " + resolvedRoot);
  }

  return resolvedPath;
}

function requireFileInside(rootDirectory, relativePath, description) {
  var resolvedPath = resolvePathInside(rootDirectory, relativePath, description);
  var fileStats;

  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new Error(description + " is missing: " + relativePath);
  }

  resolvedPath = requireRealPathInside(rootDirectory, resolvedPath, description);
  fileStats = fs.statSync(resolvedPath);

  if (fileStats.size === 0) {
    throw new Error(description + " is empty: " + relativePath);
  }

  return resolvedPath;
}

function prepareWritableFileInside(rootDirectory, relativePath, description) {
  var resolvedPath = resolvePathInside(rootDirectory, relativePath, description);
  var parentDirectory = path.dirname(resolvedPath);
  var resolvedRoot = path.resolve(rootDirectory);
  var pathFromRoot = path.relative(resolvedRoot, parentDirectory);
  var currentDirectory = resolvedRoot;

  pathFromRoot.split(path.sep).filter(Boolean).forEach(function (segment) {
    currentDirectory = path.join(currentDirectory, segment);
    if (fs.existsSync(currentDirectory)) {
      if (fs.lstatSync(currentDirectory).isSymbolicLink()) {
        throw new Error(description + " parent must not be a symbolic link: " + currentDirectory);
      }
      if (!fs.statSync(currentDirectory).isDirectory()) {
        throw new Error(description + " parent must be a directory: " + currentDirectory);
      }
      requireRealPathInside(rootDirectory, currentDirectory, description + " parent");
    } else {
      fs.mkdirSync(currentDirectory);
    }
  });

  if (fs.existsSync(resolvedPath)) {
    if (fs.lstatSync(resolvedPath).isSymbolicLink()) {
      throw new Error(description + " must not be a symbolic link: " + relativePath);
    }
    requireRealPathInside(rootDirectory, resolvedPath, description);
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

function readJsonFile(filePath, description) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(description + " must contain valid JSON: " + error.message);
    }
    throw error;
  }
}

function aggregateStatuses(items) {
  var highestPrecedence = items.reduce(function (highest, item) {
    return Math.max(highest, statusPolicies[item.status].precedence);
  }, statusPolicies.passed.precedence);

  return Object.keys(statusPolicies).find(function (status) {
    return statusPolicies[status].precedence === highestPrecedence;
  });
}

function validateCheckResult(resultPath, check, definition) {
  var result = readJsonFile(resultPath, "result evidence for " + check.id);
  var assertionIds;

  validateWithSchema(result, checkResultSchemaPath, "result evidence for " + check.id);

  if (result.checkId !== check.id) {
    throw new Error("result evidence validation failed: checkId does not match " + check.id);
  }
  if (result.status !== check.status) {
    throw new Error("result evidence validation failed: status does not match " + check.id);
  }
  if (aggregateStatuses(result.assertions) !== result.status) {
    throw new Error("result evidence validation failed: assertion statuses do not match " + check.id);
  }

  assertionIds = result.assertions.map(function (assertion) { return assertion.id; });
  if (
    assertionIds.length !== definition.requiredAssertions.length ||
    assertionIds.some(function (id, index) { return id !== definition.requiredAssertions[index]; })
  ) {
    throw new Error("result evidence validation failed: required assertions do not match " + check.id);
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

function validateResultEvidence(checks, rootDirectory, checkSet, locationProperty) {
  checks.forEach(function (check, index) {
    var definition = checkSet.checks[index];

    check.evidence.forEach(function (item) {
      if (item.kind === "result") {
        validateCheckResult(
          requireFileInside(rootDirectory, item[locationProperty], "result evidence file"),
          check,
          definition
        );
      }
    });
  });
}

function validateRunEvidence(input, inputDirectory, checkSet) {
  validateChecksAgainstSet(input.checks, checkSet);

  input.checks.forEach(function (check) {
    if (Date.parse(check.finishedAt) < Date.parse(check.startedAt)) {
      throw new Error("evidence validation failed: " + check.id + " finishes before it starts");
    }
    if (
      Date.parse(check.startedAt) < Date.parse(input.startedAt) ||
      Date.parse(check.finishedAt) > Date.parse(input.finishedAt)
    ) {
      throw new Error("evidence validation failed: " + check.id + " timestamps must stay inside the run");
    }

    check.evidence.forEach(function (item) {
      requireFileInside(inputDirectory, item.path, "evidence file");
    });
  });

  if (Date.parse(input.finishedAt) < Date.parse(input.startedAt)) {
    throw new Error("evidence validation failed: run finishes before it starts");
  }

  validateRequiredRuntimes(input.environment, checkSet);
  validateResultEvidence(input.checks, inputDirectory, checkSet, "path");
}

function overallStatus(checks, environment) {
  var calculatedStatus = aggregateStatuses(checks);
  var highestPrecedence = statusPolicies[calculatedStatus].precedence;

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

function createNotRunCheck(definition, reason) {
  var timestamp = new Date().toISOString();

  return {
    id: definition.id,
    name: definition.name,
    status: "not-run",
    reason: reason,
    startedAt: timestamp,
    finishedAt: timestamp,
    evidence: []
  };
}

function createProviderFailureCheck(definition, workspace, error) {
  var timestamp = new Date().toISOString();
  var errorType = error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name) ? error.name : "Error";
  var evidence = definition.requiredEvidenceKinds.map(function (kind) {
    var extension = kind === "result" ? ".json" : ".txt";
    var relativePath = toPortablePath(path.join("evidence", definition.id, kind + extension));
    var evidencePath = prepareWritableFileInside(workspace, relativePath, "provider failure evidence");

    if (kind === "result") {
      fs.writeFileSync(evidencePath, JSON.stringify({
        schemaVersion: 1,
        checkId: definition.id,
        status: "failed",
        assertions: definition.requiredAssertions.map(function (id, index) {
          return {
            id: id,
            status: index === 0 ? "failed" : "not-run",
            reason: index === 0 ? "The check provider failed" : "The provider stopped before this assertion"
          };
        })
      }, null, 2));
    } else {
      fs.writeFileSync(
        evidencePath,
        "The check provider failed before producing complete evidence. Error type: " + errorType + "\n"
      );
    }

    return { path: relativePath, kind: kind };
  });

  return {
    id: definition.id,
    name: definition.name,
    status: "failed",
    startedAt: timestamp,
    finishedAt: new Date().toISOString(),
    evidence: evidence
  };
}

function executeCheckProviders(executionInput, workspace, checkSet) {
  return checkSet.checks.map(function (definition) {
    var providerPath;
    var provider;
    var result;

    if (!definition.provider) {
      return createNotRunCheck(
        definition,
        "No check provider is registered for " + definition.id
      );
    }

    try {
      providerPath = requireFileInside(projectRoot, definition.provider, "check provider");
      delete require.cache[providerPath];
      provider = require(providerPath);
      if (!provider || typeof provider.run !== "function") {
        throw new Error("the provider must export a run(context) function");
      }

      result = provider.run({
        definition: definition,
        environment: executionInput.environment,
        corpus: executionInput.corpus,
        commit: executionInput.commit,
        runId: executionInput.runId,
        workspace: workspace,
        projectRoot: projectRoot
      });
      if (result && typeof result.then === "function") {
        throw new Error("asynchronous providers are not supported");
      }
      return result;
    } catch (error) {
      return createProviderFailureCheck(definition, workspace, error);
    }
  });
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
      reportDirectory,
      report.corpus.manifest,
      "report corpus manifest"
    );
    var reportCheckSetPath = requireFileInside(
      reportDirectory,
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
    validateResultEvidence(report.checks, reportDirectory, checkSet, "location");
  }

  return report;
}

function archiveEvidence(input, inputDirectory, outputDirectory) {
  input.checks.forEach(function (check) {
    check.evidence.forEach(function (item) {
      var sourcePath = requireFileInside(inputDirectory, item.path, "evidence file");
      var targetPath = prepareWritableFileInside(
        outputDirectory,
        archivedEvidenceLocation(check, item),
        "archived evidence path"
      );

      if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath);
      }
    });
  });
}

function copyFileIntoReport(sourcePath, outputDirectory, location, description) {
  var targetPath = prepareWritableFileInside(outputDirectory, location, description);

  if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function archiveReportInputs(corpusManifestPath, corpusManifest, outputDirectory) {
  var corpusDirectory = path.dirname(corpusManifestPath);
  var archivedCorpusDirectory = path.posix.dirname(archivedCorpusManifestLocation);

  copyFileIntoReport(
    corpusManifestPath,
    outputDirectory,
    archivedCorpusManifestLocation,
    "archived corpus manifest"
  );
  corpusManifest.entries.forEach(function (entry) {
    copyFileIntoReport(
      requireFileInside(corpusDirectory, entry.path, "corpus file"),
      outputDirectory,
      toPortablePath(path.join(archivedCorpusDirectory, entry.path)),
      "archived corpus file"
    );
  });
  copyFileIntoReport(
    requireFileInside(projectRoot, "phase0/checks.json", "check set"),
    outputDirectory,
    archivedCheckSetLocation,
    "archived check set"
  );
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
    manifest: archivedCorpusManifestLocation,
    sha256: sha256(corpusManifestPath)
  }, {
    version: checkSet.checkSetVersion,
    manifest: archivedCheckSetLocation,
    sha256: sha256(checkSetPath)
  });
  validateReport(report);

  fs.mkdirSync(outputDirectory, { recursive: true });
  requireRealPathInside(outputDirectory, outputDirectory, "report output directory");
  archiveReportInputs(corpusManifestPath, corpusManifest, outputDirectory);
  archiveEvidence(input, inputDirectory, outputDirectory);
  fs.writeFileSync(
    prepareWritableFileInside(outputDirectory, "report.json", "JSON report"),
    JSON.stringify(report, null, 2) + "\n"
  );
  fs.writeFileSync(
    prepareWritableFileInside(outputDirectory, "report.md", "Markdown report"),
    renderMarkdown(report)
  );
  validateReport(report, path.resolve(outputDirectory));

  return report;
}

function execute(inputPath, outputDirectory) {
  var resolvedInputPath = path.resolve(inputPath);
  var executionInput = readJsonFile(resolvedInputPath, "execution input");
  var checkSet = validateCheckSet(checkSetPath);
  var corpusManifestPath;
  var corpusManifest;
  var workspace;
  var generatedInputPath;
  var checks;
  var finishedAt;

  validateWithSchema(executionInput, executionSchemaPath, "execution input");
  validateRequiredRuntimes(executionInput.environment, checkSet);
  corpusManifestPath = requireFileInside(
    projectRoot,
    executionInput.corpus.manifest,
    "corpus manifest"
  );
  corpusManifest = validateCorpus(corpusManifestPath);
  if (corpusManifest.corpusVersion !== executionInput.corpus.version) {
    throw new Error("corpus validation failed: input version does not match the manifest");
  }

  workspace = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "formulabridge-phase0-execute-"));
  generatedInputPath = path.join(workspace, "run.json");

  try {
    checks = executeCheckProviders(executionInput, workspace, checkSet);
    finishedAt = new Date().toISOString();
    fs.writeFileSync(generatedInputPath, JSON.stringify({
      schemaVersion: executionInput.schemaVersion,
      runId: executionInput.runId,
      commit: executionInput.commit,
      startedAt: executionInput.startedAt,
      finishedAt: finishedAt,
      environment: executionInput.environment,
      corpus: executionInput.corpus,
      checks: checks
    }, null, 2));

    return run(generatedInputPath, outputDirectory);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function main() {
  var argumentsValue = parseArguments(process.argv.slice(2));
  var report;

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

  if (
    argumentsValue.command === "execute" &&
    argumentsValue.input &&
    argumentsValue.output
  ) {
    report = execute(argumentsValue.input, argumentsValue.output);
    process.exitCode = statusPolicies[report.overallStatus].exitCode;
    return;
  }

  if (argumentsValue.command !== "run" || !argumentsValue.input || !argumentsValue.output) {
    throw new Error(
      "Usage: phase0-evidence execute --input <execution.json> --output <directory>\n" +
      "       phase0-evidence run --input <run.json> --output <directory>\n" +
      "       phase0-evidence validate-corpus --manifest <manifest.json>\n" +
      "       phase0-evidence validate-checks --manifest <checks.json>\n" +
      "       phase0-evidence validate-report --report <report.json>"
    );
  }

  report = run(argumentsValue.input, argumentsValue.output);

  process.exitCode = statusPolicies[report.overallStatus].exitCode;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write("phase0-evidence: " + error.message + "\n");
    process.exitCode = 2;
  }
}

module.exports = {
  executeCheckProviders: executeCheckProviders
};
