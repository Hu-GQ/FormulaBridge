"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var net = require("net");
var os = require("os");
var path = require("path");

var root = path.resolve(__dirname, "..");
var chromePath = process.env.FORMULABRIDGE_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
var pageUrl = process.env.FORMULABRIDGE_URL || null;
var artifacts = path.join(root, "artifacts");
var profile = fs.mkdtempSync(path.join(os.tmpdir(), "formulabridge-ui-"));
var browserProcess = null;
var serverProcess = null;

function delay(milliseconds) {
  return new Promise(function (resolve) {
    setTimeout(resolve, milliseconds);
  });
}

function getFreePort() {
  return new Promise(function (resolve, reject) {
    var server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () {
      var port = server.address().port;
      server.close(function () { resolve(port); });
    });
  });
}

async function waitForTargets(port) {
  var attempts = 0;
  var response;
  while (attempts < 80) {
    attempts += 1;
    try {
      response = await fetch("http://127.0.0.1:" + port + "/json/list");
      if (response.ok) {
        return response.json();
      }
    } catch (error) {
      // Chrome has not opened the debugging endpoint yet.
    }
    await delay(125);
  }
  throw new Error("Chrome DevTools endpoint did not become ready.");
}

async function waitForPage(url) {
  var attempts = 0;
  var response;
  while (attempts < 80) {
    attempts += 1;
    if (serverProcess && serverProcess.exitCode !== null) {
      throw new Error("FormulaBridge development server exited before becoming ready.");
    }
    try {
      response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // The child server may still be binding its local port.
    }
    await delay(125);
  }
  throw new Error("FormulaBridge development server did not become ready.");
}

function connect(url) {
  return new Promise(function (resolve, reject) {
    var socket = new WebSocket(url);
    var callbacks = {};
    var nextId = 1;
    socket.addEventListener("open", function () {
      resolve({
        call: function (method, params) {
          return new Promise(function (resolveCall, rejectCall) {
            var id = nextId;
            nextId += 1;
            callbacks[id] = { resolve: resolveCall, reject: rejectCall };
            socket.send(JSON.stringify({ id: id, method: method, params: params || {} }));
          });
        },
        close: function () { socket.close(); }
      });
    });
    socket.addEventListener("message", function (event) {
      var message = JSON.parse(event.data);
      var callback = callbacks[message.id];
      if (!callback) {
        return;
      }
      delete callbacks[message.id];
      if (message.error) {
        callback.reject(new Error(message.error.message));
      } else {
        callback.resolve(message.result);
      }
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(client, expression) {
  var response = await client.call("Runtime.evaluate", {
    expression: expression,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Browser evaluation failed.");
  }
  return response.result.value;
}

async function waitForEditor(client) {
  var attempts = 0;
  var ready;
  while (attempts < 100) {
    attempts += 1;
    ready = await evaluate(client, "document.readyState === 'complete' && document.getElementById('status') && document.getElementById('status').textContent.indexOf('就绪') !== -1");
    if (ready) {
      return;
    }
    await delay(100);
  }
  ready = await evaluate(client, "JSON.stringify({ readyState: document.readyState, status: document.getElementById('status') && document.getElementById('status').textContent, title: document.title, body: document.body && document.body.innerText.slice(0, 160) })");
  throw new Error("FormulaBridge UI did not initialize. Page state: " + ready);
}

async function saveScreenshot(client, fileName) {
  var response = await client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, fileName), Buffer.from(response.data, "base64"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  var debugPort;
  var serverPort;
  var targets;
  var pageTarget;
  var client;
  var narrow;
  var wide;
  var interaction;

  if (!fs.existsSync(chromePath)) {
    throw new Error("Chrome executable not found: " + chromePath);
  }
  if (!pageUrl) {
    serverPort = await getFreePort();
    pageUrl = "http://127.0.0.1:" + serverPort + "/app/taskpane.html";
    serverProcess = childProcess.spawn(process.execPath, [path.join(root, "tools", "dev-server.js")], {
      cwd: root,
      env: Object.assign({}, process.env, {
        FORMULABRIDGE_FORCE_HTTP: "1",
        FORMULABRIDGE_PORT: String(serverPort)
      }),
      stdio: "ignore"
    });
    await waitForPage(pageUrl);
  }
  debugPort = await getFreePort();
  browserProcess = childProcess.spawn(chromePath, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--remote-debugging-port=" + debugPort,
    "--user-data-dir=" + profile,
    "about:blank"
  ], { stdio: "ignore" });

  targets = await waitForTargets(debugPort);
  pageTarget = targets.filter(function (target) { return target.type === "page"; })[0];
  if (!pageTarget) {
    throw new Error("No Chrome page target was created.");
  }
  client = await connect(pageTarget.webSocketDebuggerUrl);
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Network.enable");
  await client.call("Network.setBlockedURLs", {
    urls: ["https://appsforoffice.microsoft.com/*"]
  });
  await client.call("Emulation.setDeviceMetricsOverride", {
    width: 380,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false
  });
  await client.call("Page.navigate", { url: pageUrl });
  await waitForEditor(client);

  interaction = await evaluate(client, String.raw`(function () {
    var source = document.getElementById("source");
    var firstMenu = document.querySelector(".menu-trigger");
    var menuPopup = firstMenu.nextElementSibling;
    var result = {};
    firstMenu.click();
    result.menuOpened = menuPopup.className.indexOf("is-hidden") === -1;
    document.body.click();
    result.menuClosed = menuPopup.className.indexOf("is-hidden") !== -1;

    source.value = "x";
    source.focus();
    source.setSelectionRange(0, 1);
    document.querySelector('[data-command="snippet-fraction"]').click();
    result.snippetSource = source.value;

    source.value = "\\frac{";
    source.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector('[data-command="refresh"]').click();
    result.errorCount = document.getElementById("error-count").textContent;
    result.errorPanelVisible = document.getElementById("errors-panel").className.indexOf("is-hidden") === -1;

    document.querySelector('[data-command="properties"]').click();
    result.propertiesOpened = document.getElementById("properties-modal").className.indexOf("is-hidden") === -1;
    document.getElementById("editor-font-size").value = "16";
    document.querySelector('[data-command="save-properties"]').click();
    result.fontSizeApplied = source.style.fontSize === "16px";

    source.value = "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}";
    source.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector('[data-command="refresh"]').click();
    result.previewVisible = document.getElementById("preview-panel").className.indexOf("is-hidden") === -1;
    result.previewHasFormula = document.getElementById("preview").textContent.length > 0;

    document.querySelector('[data-command="properties"]').click();
    document.getElementById("editor-font-size").value = "14";
    document.querySelector('[data-command="save-properties"]').click();
    return result;
  }())`);

  narrow = await evaluate(client, `(function () {
    var editor = document.querySelector(".editor-pane").getBoundingClientRect();
    var output = document.querySelector(".output-pane").getBoundingClientRect();
    var actionButtons = document.querySelectorAll(".actionbar button");
    var buttonsFit = true;
    var i;
    for (i = 0; i < actionButtons.length; i += 1) {
      if (actionButtons[i].getBoundingClientRect().right > window.innerWidth + 1) { buttonsFit = false; }
    }
    return {
      width: window.innerWidth,
      noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      panesStacked: output.top > editor.top,
      buttonsFit: buttonsFit
    };
  }())`);
  await saveScreenshot(client, "taskpane-aurora-narrow.png");

  await client.call("Emulation.setDeviceMetricsOverride", {
    width: 1080,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false
  });
  await delay(250);
  wide = await evaluate(client, `(function () {
    var editor = document.querySelector(".editor-pane").getBoundingClientRect();
    var output = document.querySelector(".output-pane").getBoundingClientRect();
    return {
      width: window.innerWidth,
      noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      panesSideBySide: Math.abs(output.top - editor.top) < 2
    };
  }())`);
  await saveScreenshot(client, "taskpane-aurora-wide.png");

  assert(interaction.menuOpened && interaction.menuClosed, "Menu open/close interaction failed.");
  assert(interaction.snippetSource === "\\frac{x}{}", "Fraction snippet insertion failed.");
  assert(interaction.errorCount === "1" && interaction.errorPanelVisible, "Error panel did not activate.");
  assert(interaction.propertiesOpened && interaction.fontSizeApplied, "Properties interaction failed.");
  assert(interaction.previewVisible && interaction.previewHasFormula, "Valid formula preview failed.");
  assert(narrow.width === 380 && narrow.noPageOverflow && narrow.panesStacked && narrow.buttonsFit, "Narrow task-pane layout failed.");
  assert(wide.width === 1080 && wide.noPageOverflow && wide.panesSideBySide, "Wide layout failed.");

  process.stdout.write(JSON.stringify({ interaction: interaction, narrow: narrow, wide: wide }, null, 2) + "\n");
  await client.call("Browser.close");
  client.close();
}

run().catch(function (error) {
  process.stderr.write(error.stack + "\n");
  process.exitCode = 1;
}).finally(function () {
  if (browserProcess && browserProcess.exitCode === null) {
    browserProcess.kill();
  }
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
  }
  try {
    fs.rmSync(profile, { force: true, recursive: true });
  } catch (error) {
    // Chrome can hold its temporary profile briefly after Browser.close.
  }
});
