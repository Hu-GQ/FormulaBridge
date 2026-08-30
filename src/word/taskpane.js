(function () {
  "use strict";

  var PREFERENCES_KEY = "FormulaBridge.Preferences.v1";
  var initialized = false;
  var currentFormulaId = null;
  var previewTimer = null;
  var preferences = {
    editorFontSize: 14,
    showLineNumbers: true,
    autoRefresh: true,
    previewZoom: 100,
    defaultMode: "inline"
  };

  function element(id) {
    return document.getElementById(id);
  }

  function forEachNode(nodes, callback) {
    var i;
    for (i = 0; i < nodes.length; i += 1) {
      callback(nodes[i], i);
    }
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

  function modeLabel(mode) {
    if (mode === "display") {
      return "独立公式";
    }
    if (mode === "numbered") {
      return "编号公式";
    }
    return "行内公式";
  }

  function setSelectedMode(mode) {
    var modes = document.getElementsByName("formula-mode");
    var i;
    for (i = 0; i < modes.length; i += 1) {
      modes[i].checked = modes[i].value === mode;
    }
    element("mode-status").textContent = modeLabel(mode);
    element("detail-mode").textContent = modeLabel(mode);
  }

  function setBusy(isBusy) {
    var ids = ["insert-button", "update-button", "load-button"];
    var i;
    for (i = 0; i < ids.length; i += 1) {
      element(ids[i]).disabled = isBusy;
    }
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

  function updateLineNumbers() {
    var source = element("source");
    var count = source.value.split(/\r?\n/).length;
    var numbers = [];
    var i;
    for (i = 1; i <= count; i += 1) {
      numbers.push(i);
    }
    element("line-numbers").textContent = numbers.join("\n");
    element("line-numbers").scrollTop = source.scrollTop;
  }

  function updateCursorPosition() {
    var source = element("source");
    var position = typeof source.selectionStart === "number" ? source.selectionStart : 0;
    var before = source.value.slice(0, position).split(/\r?\n/);
    element("cursor-position").textContent = "Ln " + before.length + ", Col " + (before[before.length - 1].length + 1);
  }

  function updateDetails(compiled) {
    var source = element("source").value;
    element("detail-mode").textContent = modeLabel(selectedMode());
    element("detail-source-length").textContent = source.length;
    element("detail-omml-length").textContent = compiled ? compiled.ooxml.length + " bytes" : "—";
  }

  function activateTab(name) {
    var names = ["preview", "errors", "details"];
    var i;
    var active;
    for (i = 0; i < names.length; i += 1) {
      active = names[i] === name;
      element(names[i] + "-tab").className = "output-tab" + (active ? " active" : "");
      element(names[i] + "-tab").setAttribute("aria-selected", active ? "true" : "false");
      element(names[i] + "-panel").className = "output-panel" + (active ? "" : " is-hidden");
    }
  }

  function updatePreview() {
    var started = new Date().getTime();
    var source = element("source").value;
    var compiled;
    var message;
    try {
      compiled = compileCurrent(currentFormulaId || undefined);
      element("preview").innerHTML = compiled.previewHtml;
      element("error-log").textContent = "未发现错误。";
      element("error-count").textContent = "0";
      element("error-count").className = "tab-count";
      element("error-log").className = "error-log";
      updateDetails(compiled);
      showStatus("预览完成（" + (new Date().getTime() - started) + " ms）", "success");
      return true;
    } catch (error) {
      message = diagnosticMessage(error, source);
      element("preview").innerHTML = "<span class=\"preview-placeholder\">预览不可用</span>";
      element("error-log").textContent = "编译失败\n\n" + message + "\n\n请检查括号、命令名称和参数。";
      element("error-count").textContent = "1";
      element("error-count").className = "tab-count has-error";
      element("error-log").className = "error-log has-error";
      updateDetails(null);
      showStatus(message, "error");
      return false;
    }
  }

  function refreshPreview() {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    activateTab(updatePreview() ? "preview" : "errors");
  }

  function schedulePreview() {
    if (!preferences.autoRefresh) {
      showStatus("源码已修改；按 Ctrl+R 刷新预览。", "info");
      return;
    }
    if (previewTimer) {
      clearTimeout(previewTimer);
    }
    previewTimer = setTimeout(function () {
      previewTimer = null;
      updatePreview();
    }, 160);
  }

  function loadPreferences() {
    var raw;
    var stored;
    try {
      raw = window.localStorage.getItem(PREFERENCES_KEY);
      if (!raw) {
        return;
      }
      stored = JSON.parse(raw);
      preferences.editorFontSize = parseInt(stored.editorFontSize, 10) || preferences.editorFontSize;
      preferences.showLineNumbers = stored.showLineNumbers !== false;
      preferences.autoRefresh = stored.autoRefresh !== false;
      preferences.previewZoom = parseInt(stored.previewZoom, 10) || preferences.previewZoom;
      if (stored.defaultMode === "inline" || stored.defaultMode === "display" || stored.defaultMode === "numbered") {
        preferences.defaultMode = stored.defaultMode;
      }
    } catch (error) {
      showStatus("无法读取本地界面设置，已使用默认值。", "info");
    }
  }

  function persistPreferences() {
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch (error) {
      showStatus("当前环境不能保存界面设置，但本次会话仍可使用。", "info");
    }
  }

  function applyPreferences() {
    var lineNumbers = element("line-numbers");
    element("source").style.fontSize = preferences.editorFontSize + "px";
    element("preview").style.fontSize = (22 * preferences.previewZoom / 100) + "px";
    lineNumbers.className = preferences.showLineNumbers ? "line-numbers" : "line-numbers is-hidden";
  }

  function fillPropertiesForm() {
    element("editor-font-size").value = String(preferences.editorFontSize);
    element("show-line-numbers").checked = preferences.showLineNumbers;
    element("auto-refresh").checked = preferences.autoRefresh;
    element("preview-zoom").value = String(preferences.previewZoom);
    element("default-mode").value = preferences.defaultMode;
  }

  function saveProperties() {
    preferences.editorFontSize = parseInt(element("editor-font-size").value, 10) || 14;
    preferences.showLineNumbers = element("show-line-numbers").checked;
    preferences.autoRefresh = element("auto-refresh").checked;
    preferences.previewZoom = parseInt(element("preview-zoom").value, 10) || 100;
    preferences.defaultMode = element("default-mode").value;
    applyPreferences();
    persistPreferences();
    closeModals();
    updatePreview();
    showStatus("属性已保存。", "success");
  }

  function closeMenus() {
    var triggers = document.querySelectorAll(".menu-trigger");
    var popups = document.querySelectorAll(".menu-popup");
    forEachNode(triggers, function (trigger) {
      trigger.setAttribute("aria-expanded", "false");
    });
    forEachNode(popups, function (popup) {
      if (popup.className.indexOf("is-hidden") === -1) {
        popup.className += " is-hidden";
      }
    });
  }

  function toggleMenu(trigger) {
    var popup = trigger.nextElementSibling;
    var willOpen = popup.className.indexOf("is-hidden") !== -1;
    closeMenus();
    if (willOpen) {
      popup.className = popup.className.replace(/\s*is-hidden/g, "");
      trigger.setAttribute("aria-expanded", "true");
    }
  }

  function openModal(id) {
    closeMenus();
    if (id === "properties-modal") {
      fillPropertiesForm();
    }
    element(id).className = "modal-overlay";
  }

  function closeModals() {
    forEachNode(document.querySelectorAll(".modal-overlay"), function (modal) {
      modal.className = "modal-overlay is-hidden";
    });
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

  function wordAvailable() {
    if (typeof Word === "undefined" || !Word.run) {
      showStatus("请在 Microsoft Word 2016 或更高版本中执行此操作。", "error");
      return false;
    }
    return true;
  }

  function insertFormula() {
    var compiled;
    if (!wordAvailable()) {
      return;
    }
    try {
      compiled = compileCurrent();
    } catch (error) {
      showStatus(diagnosticMessage(error, element("source").value), "error");
      activateTab("errors");
      return;
    }
    setBusy(true);
    showStatus("正在插入 Word 原生公式…", "info");
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
    if (!wordAvailable()) {
      return;
    }
    setBusy(true);
    showStatus("正在读取所选公式…", "info");
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
      updateLineNumbers();
      updateCursorPosition();
      updatePreview();
      activateTab("preview");
      showStatus("已载入所选公式。", "success");
    }).catch(function (error) {
      showStatus(error.message || String(error), "error");
    }).then(function () {
      setBusy(false);
    });
  }

  function updateSelectedFormula() {
    if (!wordAvailable()) {
      return;
    }
    setBusy(true);
    showStatus("正在更新所选公式…", "info");
    Word.run(function (context) {
      return findSelectedControl(context).then(function (selected) {
        var existing = FormulaBridge.FormulaStore.get(selected.id);
        var compiled;
        if (!existing) {
          throw new Error("文档中的 LaTeX 源码记录缺失，无法安全更新。");
        }
        if (existing.mode !== selectedMode()) {
          throw new Error("当前版本不能直接改变已插入公式的类型；请插入新公式后删除旧公式。");
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
        currentFormulaId = compiled.id;
        showStatus("公式及文档内源码已更新。", "success");
      });
    }).catch(function (error) {
      setBusy(false);
      showStatus(error.message || String(error), "error");
    });
  }

  function setSelection(start, end) {
    var source = element("source");
    source.focus();
    if (source.setSelectionRange) {
      source.setSelectionRange(start, typeof end === "number" ? end : start);
    }
    updateCursorPosition();
  }

  function replaceSelection(text, caretStart, caretEnd) {
    var source = element("source");
    var start = typeof source.selectionStart === "number" ? source.selectionStart : source.value.length;
    var end = typeof source.selectionEnd === "number" ? source.selectionEnd : start;
    source.value = source.value.slice(0, start) + text + source.value.slice(end);
    setSelection(start + caretStart, start + (typeof caretEnd === "number" ? caretEnd : caretStart));
    updateLineNumbers();
    schedulePreview();
  }

  function insertSnippet(kind) {
    var source = element("source");
    var start = typeof source.selectionStart === "number" ? source.selectionStart : source.value.length;
    var end = typeof source.selectionEnd === "number" ? source.selectionEnd : start;
    var selected = source.value.slice(start, end);
    var text;
    var caret;
    var selectionEnd;
    if (kind === "fraction") {
      text = "\\frac{" + selected + "}{}";
      caret = selected ? text.length - 1 : 6;
    } else if (kind === "root") {
      text = "\\sqrt{" + selected + "}";
      caret = selected ? text.length : 6;
    } else if (kind === "sup") {
      text = selected ? "{" + selected + "}^{}" : "^{}";
      caret = text.length - 1;
    } else if (kind === "sub") {
      text = selected ? "{" + selected + "}_{}" : "_{}";
      caret = text.length - 1;
    } else if (kind === "matrix") {
      text = "\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}";
      caret = 16;
      selectionEnd = 17;
    } else if (kind === "greek") {
      text = "\\alpha";
      caret = text.length;
    } else {
      text = "\\text{" + selected + "}";
      caret = selected ? text.length : 6;
    }
    replaceSelection(text, caret, selectionEnd);
  }

  function newFormula() {
    currentFormulaId = null;
    element("source").value = "";
    setSelectedMode(preferences.defaultMode);
    updateLineNumbers();
    updateCursorPosition();
    updatePreview();
    activateTab("preview");
    setSelection(0);
    showStatus("已新建空白公式。", "success");
  }

  function executeEditorCommand(command) {
    var source = element("source");
    source.focus();
    if (document.execCommand) {
      document.execCommand(command, false, null);
    }
    updateLineNumbers();
    updateCursorPosition();
    schedulePreview();
  }

  function dispatchCommand(command) {
    closeMenus();
    if (command === "new") {
      newFormula();
    } else if (command === "refresh") {
      refreshPreview();
    } else if (command === "load") {
      loadSelectedFormula();
    } else if (command === "insert") {
      insertFormula();
    } else if (command === "update") {
      updateSelectedFormula();
    } else if (command === "undo" || command === "redo") {
      executeEditorCommand(command);
    } else if (command === "select-all") {
      element("source").focus();
      element("source").select();
      updateCursorPosition();
    } else if (command === "show-preview") {
      activateTab("preview");
    } else if (command === "show-errors") {
      activateTab("errors");
    } else if (command === "properties") {
      openModal("properties-modal");
    } else if (command === "help") {
      openModal("help-modal");
    } else if (command === "about") {
      openModal("about-modal");
    } else if (command === "close-modal") {
      closeModals();
    } else if (command === "save-properties") {
      saveProperties();
    } else if (command.indexOf("snippet-") === 0) {
      insertSnippet(command.slice(8));
    }
  }

  function handleSourceKeydown(event) {
    var keyCode = event.keyCode || event.which;
    if (keyCode === 9) {
      event.preventDefault();
      replaceSelection("  ", 2);
    }
  }

  function handleGlobalKeydown(event) {
    var keyCode = event.keyCode || event.which;
    var command = null;
    if (keyCode === 27) {
      closeMenus();
      closeModals();
      return;
    }
    if (keyCode === 112) {
      command = "help";
    } else if (event.altKey && keyCode >= 49 && keyCode <= 51) {
      event.preventDefault();
      setSelectedMode(["inline", "display", "numbered"][keyCode - 49]);
      schedulePreview();
      return;
    } else if (event.ctrlKey && keyCode === 82) {
      command = "refresh";
    } else if (event.ctrlKey && keyCode === 78) {
      command = "new";
    } else if (event.ctrlKey && keyCode === 80) {
      command = "properties";
    } else if (event.ctrlKey && event.shiftKey && keyCode === 76) {
      command = "load";
    } else if (event.ctrlKey && event.shiftKey && keyCode === 13) {
      command = "update";
    } else if (event.ctrlKey && keyCode === 13) {
      command = "insert";
    }
    if (command) {
      event.preventDefault();
      dispatchCommand(command);
    }
  }

  function bindInterface() {
    var source = element("source");
    var commandButtons = document.querySelectorAll("[data-command]");
    var menuTriggers = document.querySelectorAll(".menu-trigger");
    var tabs = document.querySelectorAll("[data-tab]");
    var modes = document.getElementsByName("formula-mode");
    source.addEventListener("input", function () {
      updateLineNumbers();
      updateCursorPosition();
      schedulePreview();
    });
    source.addEventListener("scroll", updateLineNumbers);
    source.addEventListener("click", updateCursorPosition);
    source.addEventListener("keyup", updateCursorPosition);
    source.addEventListener("keydown", handleSourceKeydown);
    forEachNode(commandButtons, function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        dispatchCommand(button.getAttribute("data-command"));
      });
    });
    forEachNode(menuTriggers, function (trigger) {
      trigger.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleMenu(trigger);
      });
    });
    forEachNode(tabs, function (tab) {
      tab.addEventListener("click", function () {
        activateTab(tab.getAttribute("data-tab"));
      });
    });
    forEachNode(modes, function (mode) {
      mode.addEventListener("change", function () {
        setSelectedMode(mode.value);
        schedulePreview();
      });
    });
    forEachNode(document.querySelectorAll(".modal-overlay"), function (modal) {
      modal.addEventListener("click", function (event) {
        if (event.target === modal) {
          closeModals();
        }
      });
    });
    document.addEventListener("click", closeMenus);
    document.addEventListener("keydown", handleGlobalKeydown);
  }

  function initialize() {
    if (initialized) {
      return;
    }
    initialized = true;
    loadPreferences();
    applyPreferences();
    setSelectedMode(preferences.defaultMode);
    bindInterface();
    updateLineNumbers();
    updateCursorPosition();
    updatePreview();
    showStatus("编辑器已就绪。", "success");
  }

  if (typeof Office !== "undefined" && Office.onReady) {
    Office.onReady(function () { initialize(); });
  }
  if (typeof Office !== "undefined") {
    Office.initialize = function () { initialize(); };
  }
  if (typeof Office === "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize);
    } else {
      initialize();
    }
  }
}());
