"use strict";

var fs = require("fs");
var http = require("http");
var https = require("https");
var path = require("path");

var root = path.resolve(__dirname, "..");
var port = Number(process.env.FORMULABRIDGE_PORT || 3000);
var forceHttp = process.env.FORMULABRIDGE_FORCE_HTTP === "1";
var certPath = path.join(root, "certs", "localhost.crt");
var keyPath = path.join(root, "certs", "localhost.key");
var mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

function handler(request, response) {
  var pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  var relative = pathname === "/" ? "app/taskpane.html" : pathname.replace(/^\/+/, "");
  var target = path.resolve(root, relative);
  if (target.indexOf(root + path.sep) !== 0) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }
  fs.readFile(target, function (error, data) {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    response.end(data);
  });
}

var server;
var protocol;
if (!forceHttp && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  server = https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, handler);
  protocol = "https";
} else {
  server = http.createServer(handler);
  protocol = "http";
}

server.listen(port, "127.0.0.1", function () {
  process.stdout.write("FormulaBridge development server: " + protocol + "://localhost:" + port + "\n");
  if (protocol !== "https") {
    process.stdout.write("Word sideloading requires trusted certs/localhost.crt and certs/localhost.key.\n");
  }
});
