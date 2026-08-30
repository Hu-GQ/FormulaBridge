"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var projectRoot = path.resolve(__dirname, "..");
var agentsPath = path.join(projectRoot, "AGENTS.md");
var issueTrackerPath = path.join(projectRoot, "docs", "agents", "issue-tracker.md");
var domainPath = path.join(projectRoot, "docs", "agents", "domain.md");
var triageLabelsPath = path.join(projectRoot, "docs", "agents", "triage-labels.md");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("AGENTS preserves repository rules and points skills at their configuration", function () {
  var agents = read(agentsPath);
  var agentSkillsHeadings = agents.match(/^## Agent skills$/gm) || [];

  assert.match(agents, /每次改动完成后，都必须创建一个对应的Git commit/);
  assert.match(agents, /每次改动后，都必须编写或更新相关测试/);
  assert.equal(agentSkillsHeadings.length, 1);
  assert.match(agents, /GitHub Issues for `Hu-GQ\/FormulaBridge`/);
  assert.match(agents, /single-context layout/);
  assert.doesNotMatch(agents, /^### Triage labels$/m);
});

test("issue tracker configuration targets the FormulaBridge GitHub repository", function () {
  var issueTracker = read(issueTrackerPath);

  assert.match(issueTracker, /^# Issue tracker: GitHub$/m);
  assert.match(issueTracker, /`Hu-GQ\/FormulaBridge`/);
  assert.match(issueTracker, /Use the `gh` CLI/);
  assert.match(issueTracker, /\*\*PRs as a request surface: no\.\*\*/);
});

test("domain configuration fixes the repository to one root context", function () {
  var domain = read(domainPath);

  assert.match(domain, /\*\*single-context\*\* layout/);
  assert.match(domain, /\*\*`CONTEXT\.md`\*\* at the repo root/);
  assert.match(domain, /\*\*`docs\/adr\/`\*\*/);
  assert.match(domain, /Do not introduce `CONTEXT-MAP\.md`/);
  assert.equal(fs.existsSync(triageLabelsPath), false);
});
