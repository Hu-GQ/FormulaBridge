(function () {
  "use strict";

  var initialized = false;
  var currentFormulaId = null;
  var previewTimer = null;

  function element(id) {
    return document.getElementById(id);
  }

  function selectedMode() {
    var modes = document.getElementsByName("formula-mode");
    var i;
    for (i = 0; i < modes.length; i += 1) {
      if (modes[i].checked) {
        return modes[i].value;
      }
    }
    return "inline";
  }

  function setSelectedMode(mode) {
    var modes = document.getElementsByName("formula-mode");
    var i;
    for (i = 0; i < modes.length; i += 1) {
      modes[i].checked = modes[i].value === mode;
    }
  }

  function setBusy(isBusy) {
    element("insert-button").disabled = isBusy;
    element("update-button").disabled = isBusy;
    element("load-button").disabled = isBusy;
  }

  function showStatus(message, kind) {
    var status = element("status");
    status.className = "status " + (kind || "info");
    status.textContent = message;
  }

  function diagnosticMessage(error, source) {
    var position = typeof error.position === "number" ? error.position : null;
    var prefix = "";
    var before;
    var lines;
    if (position !== null) {
      before = source.slice(0, position);
      lines = before.split(/\r?\n/);
      prefix = "第 " + lines.length + " 行，第 " + (lines[lines.length - 1].length + 1) + " 列：";
    }
    return prefix + (error.message || String(error));
  }

  function compileCurrent(idOverride, modeOverride) {
    var source = element("source").value;
    return FormulaBridge.Core.compile(source, {
      id: idOverride || undefined,
      mode: modeOverride || selectedMode()
    });
  }

  function updatePreview() {
    var source = element("source").value;
    try {
      var compiled = compileCurrent(currentFormulaId || undefined);
      element("preview").innerHTML = compiled.previewHtml;
      showStatus("公式有效，可以插入。", "success");
    } catch (error) {
      element("preview").innerHTML = "<span class=\"preview-placeholder\">预览不可用</span>";
      showStatus(diagnosticMessage(error, source), "error");
    }
  }

  function schedulePreview() {
    if (previewTimer) {
      clearTimeout(previewTimer);
    }
    previewTimer = setTimeout(updatePreview, 120);
  }

  function formulaIdFromTag(tag) {
    var prefix = "FormulaBridge:";
    return tag && tag.indexOf(prefix) === 0 ? tag.slice(prefix.length) : null;
  }

  function findSelectedControl(context) {
    var selection = context.document.getSelection();
    var controls = selection.contentControls;
    controls.load("items/tag");
    return context.sync().then(function () {
      var i;
      var id;
      for (i = 0; i < controls.items.length; i += 1) {
        id = formulaIdFromTag(controls.items[i].tag);
        if (id) {
          return { control: controls.items[i], id: id };
        }
      }
      throw new Error("请完整选中一个 FormulaBridge 公式后重试。");
    });
  }

  function insertFormula() {
    var compiled;
    try {
      compiled = compileCurrent();
    } catch (error) {
      showStatus(diagnosticMessage(error, element("source").value), "error");
      return;
    }
    setBusy(true);
    Word.run(function (context) {
      var range = context.document.getSelection();
      range.insertOoxml(compiled.ooxml, "Replace");
      return context.sync();
    }).then(function () {
      FormulaBridge.FormulaStore.upsert(compiled, function (error) {
        setBusy(false);
        if (error) {
          showStatus("公式已插入，但源码保存失败：" + error.message, "error");
          return;
        }
        currentFormulaId = compiled.id;
        showStatus("公式已作为 Word 原生数学内容插入。", "success");
      });
    }).catch(function (error) {
      setBusy(false);
      showStatus(error.message || String(error), "error");
    });
  }

  function loadSelectedFormula() {
    setBusy(true);
    Word.run(function (context) {
      return findSelectedControl(context).then(function (selected) {
        return { id: selected.id };
      });
    }).then(function (selected) {
      var record = FormulaBridge.FormulaStore.get(selected.id);
      if (!record) {
        throw new Error("已找到公式，但文档中的 LaTeX 源码记录缺失。");
      }
      currentFormulaId = selected.id;
      element("source").value = record.source;
      setSelectedMode(record.mode);
      updatePreview();
      showStatus("已载入所选公式。", "success");
    }).catch(function (error) {
      showStatus(error.message || String(error), "error");
    }).then(function () {
      setBusy(false);
    });
  }

  function updateSelectedFormula() {
    setBusy(true);
    Word.run(function (context) {
      return findSelectedControl(context).then(function (selected) {
        var existing = FormulaBridge.FormulaStore.get(selected.id);
        var compiled;
        if (!existing) {
          throw new Error("文档中的 LaTeX 源码记录缺失，无法安全更新。");
        }
        if (existing.mode !== selectedMode()) {
          throw new Error("MVP 暂不支持直接改变已插入公式的类型；请插入新公式后删除旧公式。");
        }
        compiled = compileCurrent(selected.id, existing.mode);
        selected.control.insertOoxml(compiled.innerOoxml, "Replace");
        return context.sync().then(function () { return compiled; });
      });
    }).then(function (compiled) {
      FormulaBridge.FormulaStore.upsert(compiled, function (error) {
        setBusy(false);
        if (error) {
          showStatus("公式已更新，但源码保存失败：" + error.message, "error");
          return;
        }
        showStatus("公式及文档内源码已更新。", "success");
      });
    }).catch(function (error) {
      setBusy(false);
      showStatus(error.message || String(error), "error");
    });
  }

  function initialize() {
    if (initialized) {
      return;
    }
    initialized = true;
    element("source").addEventListener("input", schedulePreview);
    element("insert-button").addEventListener("click", insertFormula);
    element("load-button").addEventListener("click", loadSelectedFormula);
    element("update-button").addEventListener("click", updateSelectedFormula);
    updatePreview();
  }

  if (typeof Office !== "undefined" && Office.onReady) {
    Office.onReady(function () { initialize(); });
  }
  if (typeof Office !== "undefined") {
    Office.initialize = function () { initialize(); };
  }
}());
