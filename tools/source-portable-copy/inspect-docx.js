"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var zlib = require("node:zlib");

var formulaNamespace = "urn:formulabridge:formula-metadata:v1";
var formulaTagPrefix = "FormulaBridge.Formula:";
var carrierTag = "FormulaBridge.CopyCarrier:v1";
var formulaIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

var crcTable = Array.from({ length: 256 }, function (_, index) {
  var value = index;

  for (var bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }

  return value >>> 0;
});

function crc32(buffer) {
  var value = 0xffffffff;

  for (var index = 0; index < buffer.length; index += 1) {
    value = (value >>> 8) ^ crcTable[(value ^ buffer[index]) & 0xff];
  }

  return (value ^ 0xffffffff) >>> 0;
}

function fail(message) {
  throw new Error("DOCX package validation failed: " + message);
}

function findEndOfCentralDirectory(buffer) {
  var minimumOffset = Math.max(0, buffer.length - 65557);

  for (var offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  fail("the ZIP end-of-central-directory record is missing");
}

function readZipEntries(docxPath) {
  var buffer = fs.readFileSync(docxPath);
  var endOffset = findEndOfCentralDirectory(buffer);
  var entryCount = buffer.readUInt16LE(endOffset + 10);
  var centralOffset = buffer.readUInt32LE(endOffset + 16);
  var entries = new Map();
  var cursor = centralOffset;

  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    fail("ZIP64 packages are not supported by the Phase 0 inspector");
  }

  for (var index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      fail("the central directory is malformed");
    }

    var method = buffer.readUInt16LE(cursor + 10);
    var expectedCrc = buffer.readUInt32LE(cursor + 16);
    var compressedSize = buffer.readUInt32LE(cursor + 20);
    var uncompressedSize = buffer.readUInt32LE(cursor + 24);
    var nameLength = buffer.readUInt16LE(cursor + 28);
    var extraLength = buffer.readUInt16LE(cursor + 30);
    var commentLength = buffer.readUInt16LE(cursor + 32);
    var localOffset = buffer.readUInt32LE(cursor + 42);
    var name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    var normalizedName = name.replace(/\\/g, "/");

    if (/^(?:\/|\\)|(?:^|[\\/])\.\.(?:[\\/]|$)|^[A-Za-z]:/.test(name)) {
      fail("an unsafe ZIP entry path was found: " + name);
    }
    if (entries.has(normalizedName)) {
      fail("a duplicate ZIP entry was found: " + normalizedName);
    }
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      fail("a local ZIP header is malformed: " + name);
    }

    var localNameLength = buffer.readUInt16LE(localOffset + 26);
    var localExtraLength = buffer.readUInt16LE(localOffset + 28);
    var dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    var compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    var content;

    if (method === 0) {
      content = Buffer.from(compressed);
    } else if (method === 8) {
      content = zlib.inflateRawSync(compressed);
    } else {
      fail("unsupported ZIP compression method " + method + " for " + name);
    }

    if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) {
      fail("ZIP size or CRC validation failed for " + name);
    }

    entries.set(normalizedName, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function decodeXml(value) {
  return value.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|amp|lt|gt|quot|apos);/gi, function (entity, hex, decimal) {
    if (hex) {
      return String.fromCodePoint(parseInt(hex, 16));
    }
    if (decimal) {
      return String.fromCodePoint(parseInt(decimal, 10));
    }

    return {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": "\"",
      "&apos;": "'"
    }[entity.toLowerCase()];
  });
}

function readXml(entries, name) {
  var content = entries.get(name);

  if (!content) {
    fail("required package part is missing: " + name);
  }

  var xml = content.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    fail("DTD or entity declarations are not allowed in " + name);
  }

  return xml;
}

function structuredDocumentTags(xml) {
  var roots = [];
  var stack = [];
  var expression = /<w:sdt(?:\s[^>]*)?>|<\/w:sdt>/g;
  var match;

  while ((match = expression.exec(xml)) !== null) {
    if (match[0][1] !== "/") {
      var node = { start: match.index, children: [] };
      if (stack.length === 0) {
        roots.push(node);
      } else {
        stack[stack.length - 1].children.push(node);
      }
      stack.push(node);
    } else {
      if (stack.length === 0) {
        fail("document.xml contains an unmatched content-control close tag");
      }
      var completed = stack.pop();
      completed.end = expression.lastIndex;
    }
  }

  if (stack.length !== 0) {
    fail("document.xml contains an unclosed content control");
  }

  return roots;
}

function contentControlTag(xml) {
  var propertiesEnd = xml.indexOf("<w:sdtContent");
  var properties = propertiesEnd === -1 ? xml : xml.slice(0, propertiesEnd);
  var match = properties.match(/<w:tag\b[^>]*\bw:val="([^"]*)"[^>]*\/?\s*>/);

  return match ? decodeXml(match[1]) : "";
}

function flatten(nodes) {
  return nodes.reduce(function (result, node) {
    return result.concat(node, flatten(node.children));
  }, []);
}

function textContent(xml) {
  return Array.from(xml.matchAll(/<(?:w|m):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|m):t>/g), function (match) {
    return decodeXml(match[1]);
  }).join("");
}

function carrierPayload(documentXml, formulaNode) {
  var carriers = flatten(formulaNode.children).filter(function (node) {
    return contentControlTag(documentXml.slice(node.start, node.end)) === carrierTag;
  });

  if (carriers.length !== 1) {
    fail("each managed formula must contain exactly one portable copy carrier");
  }

  var carrierXml = documentXml.slice(carriers[0].start, carriers[0].end);
  var textRuns = Array.from(carrierXml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g))
    .filter(function (match) { return textContent(match[0]).replace(/\s/g, "").length > 0; });
  var encoded = textContent(carrierXml).replace(/\s/g, "");
  var decoded;

  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) ||
    Buffer.from(encoded, "base64").toString("base64") !== encoded
  ) {
    fail("the portable copy carrier is not canonical base64");
  }

  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch (error) {
    fail("the portable copy carrier is not valid base64 JSON");
  }

  var fields = decoded && typeof decoded === "object" && !Array.isArray(decoded)
    ? Object.keys(decoded).sort()
    : [];

  if (
    fields.join(",") !== "checksum,formulaId,label,latex,schemaVersion" ||
    decoded.schemaVersion !== 1 ||
    !formulaIdPattern.test(decoded.formulaId) ||
    typeof decoded.label !== "string" ||
    typeof decoded.latex !== "string" ||
    decoded.latex.length === 0 ||
    !/^[0-9a-f]{64}$/.test(decoded.checksum)
  ) {
    fail("the portable copy carrier does not match schema version 1");
  }

  return {
    node: carriers[0],
    payload: decoded,
    hidden: textRuns.length > 0 && textRuns.every(function (match) {
      return /<w:rPr(?:\s[^>]*)?>[\s\S]*?<w:vanish(?:\s*\/|\s[^>]*\/)>[\s\S]*?<\/w:rPr>/.test(match[0]);
    })
  };
}

function checksum(payload) {
  return crypto.createHash("sha256")
    .update([
      payload.schemaVersion,
      payload.formulaId,
      payload.label,
      payload.latex
    ].join("\n"), "utf8")
    .digest("hex");
}

function parseAttributes(tag) {
  var attributes = {};

  Array.from(tag.matchAll(/([A-Za-z_][A-Za-z0-9_.:-]*)="([^"]*)"/g)).forEach(function (match) {
    attributes[match[1].replace(/^.*:/, "")] = decodeXml(match[2]);
  });

  return attributes;
}

function customXmlRecords(entries) {
  var records = new Map();

  Array.from(entries.keys())
    .filter(function (name) { return /^customXml\/item\d+\.xml$/.test(name); })
    .forEach(function (name) {
      var xml = readXml(entries, name);
      if (!xml.includes(formulaNamespace)) {
        return;
      }

      Array.from(xml.matchAll(/<(?:(?:[A-Za-z_][\w.-]*):)?formula\b([^>]*)>([\s\S]*?)<\/(?:(?:[A-Za-z_][\w.-]*):)?formula>/g)).forEach(function (match) {
        var attributes = parseAttributes(match[1]);
        var latexMatch = match[2].match(/<(?:(?:[A-Za-z_][\w.-]*):)?latex\b[^>]*>([\s\S]*?)<\/(?:(?:[A-Za-z_][\w.-]*):)?latex>/);

        if (!latexMatch || !attributes.id || records.has(attributes.id)) {
          fail("the authoritative Custom XML formula store is incomplete or duplicated");
        }

        records.set(attributes.id, {
          formulaId: attributes.id,
          label: attributes.label || "",
          latex: decodeXml(latexMatch[1]),
          checksum: attributes.checksum
        });
      });
    });

  return records;
}

function assertSyntheticPackagePrivacy(entries) {
  var fields = [
    { part: "docProps/core.xml", names: ["creator", "lastModifiedBy"] },
    { part: "docProps/app.xml", names: ["Company", "Manager"] }
  ];
  var populated = [];

  fields.forEach(function (definition) {
    if (!entries.has(definition.part)) {
      return;
    }
    var xml = readXml(entries, definition.part);
    definition.names.forEach(function (name) {
      var expression = new RegExp(
        "<(?:[A-Za-z_][\\w.-]*:)?" + name + "\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?" + name + ">",
        "i"
      );
      var match = xml.match(expression);
      if (match && decodeXml(match[1].replace(/<[^>]+>/g, "")).trim().length > 0) {
        populated.push(definition.part + ":" + name);
      }
    });
  });

  if (entries.has("docProps/custom.xml") && /<property\b/i.test(readXml(entries, "docProps/custom.xml"))) {
    populated.push("docProps/custom.xml:property");
  }
  if (populated.length > 0) {
    fail("synthetic evidence contains personal document metadata fields: " + populated.join(", "));
  }
}

function inspect(docxPath) {
  var entries = readZipEntries(docxPath);
  assertSyntheticPackagePrivacy(entries);
  var documentXml = readXml(entries, "word/document.xml");
  var store = customXmlRecords(entries);
  var formulaIds = new Set();
  var formulaLabels = new Set();
  var formulas = flatten(structuredDocumentTags(documentXml))
    .map(function (node) {
      return { node: node, xml: documentXml.slice(node.start, node.end) };
    })
    .filter(function (item) {
      return contentControlTag(item.xml).startsWith(formulaTagPrefix);
    })
    .map(function (item) {
      var tagIdentity = contentControlTag(item.xml).slice(formulaTagPrefix.length);
      var carrier = carrierPayload(documentXml, item.node);
      var payload = carrier.payload;
      var stored = store.get(payload.formulaId);
      var visibleXml = item.xml.slice();
      var relativeStart = carrier.node.start - item.node.start;
      var relativeEnd = carrier.node.end - item.node.start;

      visibleXml = visibleXml.slice(0, relativeStart) + visibleXml.slice(relativeEnd);
      var visibleText = textContent(visibleXml).trim();

      var mismatches = [];

      if (payload.schemaVersion !== 1) {
        mismatches.push("schema version");
      }
      if (payload.formulaId !== tagIdentity) {
        mismatches.push("object identity");
      }
      if (payload.checksum !== checksum(payload)) {
        mismatches.push("carrier checksum");
      }
      if (!carrier.hidden) {
        mismatches.push("hidden carrier formatting");
      }
      if (visibleText.length === 0) {
        mismatches.push("visible representation");
      }
      if (formulaIds.has(payload.formulaId)) {
        mismatches.push("duplicate formula identity");
      }
      if (payload.label && formulaLabels.has(payload.label)) {
        mismatches.push("duplicate formula label");
      }
      if (!stored) {
        mismatches.push("Custom XML record");
      } else {
        if (stored.label !== payload.label) {
          mismatches.push("label");
        }
        if (stored.latex !== payload.latex) {
          mismatches.push("LaTeX source");
        }
        if (stored.checksum !== payload.checksum) {
          mismatches.push("Custom XML checksum");
        }
      }
      if (mismatches.length !== 0) {
        fail(
          "the visible object, portable carrier, and Custom XML store disagree for " +
          tagIdentity + ": " + mismatches.join(", ")
        );
      }

      formulaIds.add(payload.formulaId);
      if (payload.label) {
        formulaLabels.add(payload.label);
      }

      return {
        formulaId: payload.formulaId,
        label: payload.label,
        latex: payload.latex,
        visibleText: visibleText,
        carrierVersion: payload.schemaVersion,
        carrierHidden: carrier.hidden,
        authoritativeStore: "customXml"
      };
    });

  if (formulas.length === 0) {
    fail("no managed formula was found");
  }

  return {
    schemaVersion: 1,
    privacy: "synthetic-no-personal-metadata",
    formulas: formulas
  };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) {
      throw new Error("Usage: inspect-docx <document.docx>");
    }
    process.stdout.write(JSON.stringify(inspect(process.argv[2]), null, 2) + "\n");
  } catch (error) {
    process.stderr.write("inspect-docx: " + error.message + "\n");
    process.exitCode = 1;
  }
}

module.exports = { inspect: inspect, readZipEntries: readZipEntries };
