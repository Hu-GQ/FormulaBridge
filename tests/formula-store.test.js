"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var formulaStore = require("../src/word/formula-store");

function installFakeOffice(initialValue) {
  var values = {};
  if (initialValue !== undefined) {
    values[formulaStore.SETTINGS_KEY] = initialValue;
  }
  global.Office = {
    AsyncResultStatus: { Succeeded: "succeeded" },
    context: {
      document: {
        settings: {
          get: function (key) { return values[key]; },
          set: function (key, value) { values[key] = value; },
          saveAsync: function (callback) { callback({ status: "succeeded" }); }
        }
      }
    }
  };
  return values;
}

function upsert(record) {
  return new Promise(function (resolve, reject) {
    formulaStore.upsert(record, function (error, store) {
      if (error) {
        reject(error);
      } else {
        resolve(store);
      }
    });
  });
}

test("stores LaTeX source inside the document settings payload", async function () {
  var values = installFakeOffice();
  await upsert({ id: "fb-one", source: "\\frac{a}{b}", mode: "inline" });
  var persisted = JSON.parse(values[formulaStore.SETTINGS_KEY]);
  assert.equal(persisted.schema, 1);
  assert.equal(persisted.formulas["fb-one"].source, "\\frac{a}{b}");
  assert.equal(formulaStore.get("fb-one").mode, "inline");
  delete global.Office;
});

test("preserves creation time when an equation is updated", async function () {
  installFakeOffice();
  await upsert({ id: "fb-two", source: "x", mode: "inline" });
  var createdAt = formulaStore.get("fb-two").createdAt;
  await upsert({ id: "fb-two", source: "x^2", mode: "inline" });
  assert.equal(formulaStore.get("fb-two").createdAt, createdAt);
  assert.equal(formulaStore.get("fb-two").source, "x^2");
  delete global.Office;
});

test("rejects damaged document metadata instead of overwriting it", function () {
  installFakeOffice("{bad json");
  assert.throws(function () { formulaStore.all(); }, /metadata.*damaged/i);
  delete global.Office;
});
