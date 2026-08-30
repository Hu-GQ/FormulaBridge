(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FormulaBridge = root.FormulaBridge || {};
    root.FormulaBridge.FormulaStore = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SETTINGS_KEY = "FormulaBridge.Formulas.v1";

  function settings() {
    if (typeof Office === "undefined" || !Office.context || !Office.context.document) {
      throw new Error("Formula storage is available only inside Microsoft Word.");
    }
    return Office.context.document.settings;
  }

  function emptyStore() {
    return { schema: 1, formulas: {} };
  }

  function readStore() {
    var raw = settings().get(SETTINGS_KEY);
    var parsed;
    if (!raw) {
      return emptyStore();
    }
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (error) {
      throw new Error("Formula metadata in this document is damaged.");
    }
    if (!parsed || parsed.schema !== 1 || !parsed.formulas) {
      throw new Error("This document uses an unsupported FormulaBridge metadata schema.");
    }
    return parsed;
  }

  function saveStore(store, callback) {
    callback = callback || function () {};
    settings().set(SETTINGS_KEY, JSON.stringify(store));
    settings().saveAsync(function (result) {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        callback(null, store);
      } else {
        callback(new Error(result.error && result.error.message ? result.error.message : "Could not save formula metadata."));
      }
    });
  }

  function get(id) {
    var store = readStore();
    return store.formulas[id] || null;
  }

  function upsert(record, callback) {
    var store = readStore();
    var existing = store.formulas[record.id];
    var now = new Date().toISOString();
    store.formulas[record.id] = {
      id: record.id,
      source: record.source,
      mode: record.mode,
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now
    };
    saveStore(store, callback);
  }

  function remove(id, callback) {
    var store = readStore();
    delete store.formulas[id];
    saveStore(store, callback);
  }

  function all() {
    return readStore();
  }

  return {
    SETTINGS_KEY: SETTINGS_KEY,
    all: all,
    get: get,
    remove: remove,
    upsert: upsert
  };
}));
