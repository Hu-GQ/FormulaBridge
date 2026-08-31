"use strict";

var fs = require("node:fs");
var path = require("node:path");

function run(context) {
  var startedAt = new Date().toISOString();
  var evidence = context.definition.requiredEvidenceKinds
    .concat(context.definition.passedEvidenceKinds)
    .map(function (kind) {
      var relativePath = path.join("evidence", context.definition.id, kind + (kind === "result" ? ".json" : ".txt"));
      var evidencePath = path.join(context.workspace, relativePath);

      fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
      if (kind === "result") {
        fs.writeFileSync(evidencePath, JSON.stringify({
          schemaVersion: 1,
          checkId: context.definition.id,
          status: "passed",
          assertions: context.definition.requiredAssertions.map(function (id) {
            return { id: id, status: "passed" };
          })
        }, null, 2));
      } else {
        fs.writeFileSync(evidencePath, "synthetic provider evidence for " + kind + "\n");
      }

      return {
        path: relativePath.split(path.sep).join("/"),
        kind: kind
      };
    });

  return {
    id: context.definition.id,
    name: context.definition.name,
    status: "passed",
    startedAt: startedAt,
    finishedAt: new Date().toISOString(),
    evidence: evidence
  };
}

module.exports = { run: run };
