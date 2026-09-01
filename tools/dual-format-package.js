#!/usr/bin/env node
"use strict";

var fs = require("node:fs");
var path = require("node:path");
var zlib = require("node:zlib");
var formulaTeX = "x^2 + y^2 = z^2";

var crcTable = Array.from({ length: 256 }, function (_, index) {
  var value = index;
  for (var bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(buffer) {
  var value = 0xffffffff;
  for (var index = 0; index < buffer.length; index += 1) {
    value = crcTable[(value ^ buffer[index]) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
  var localParts = [];
  var centralParts = [];
  var offset = 0;

  entries.forEach(function (entry) {
    var name = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    var data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    var checksum = crc32(data);
    var local = Buffer.alloc(30 + name.length);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    var central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    localParts.push(local, data);
    centralParts.push(central);
    offset += local.length + data.length;
  });

  var centralDirectory = Buffer.concat(centralParts);
  var end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat(localParts.concat([centralDirectory, end]));
}

function readZip(filePath) {
  var archive = fs.readFileSync(filePath);
  var endOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) {
    throw new Error("DOCX end-of-central-directory record is missing");
  }

  var count = archive.readUInt16LE(endOffset + 10);
  var centralOffset = archive.readUInt32LE(endOffset + 16);
  var entries = new Map();

  for (var index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("DOCX central-directory entry is invalid");
    }

    var method = archive.readUInt16LE(centralOffset + 10);
    var checksum = archive.readUInt32LE(centralOffset + 16);
    var compressedSize = archive.readUInt32LE(centralOffset + 20);
    var uncompressedSize = archive.readUInt32LE(centralOffset + 24);
    var nameLength = archive.readUInt16LE(centralOffset + 28);
    var extraLength = archive.readUInt16LE(centralOffset + 30);
    var commentLength = archive.readUInt16LE(centralOffset + 32);
    var localOffset = archive.readUInt32LE(centralOffset + 42);
    var name = archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8");

    if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("DOCX local entry is invalid: " + name);
    }

    var localNameLength = archive.readUInt16LE(localOffset + 26);
    var localExtraLength = archive.readUInt16LE(localOffset + 28);
    var dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    var compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    var data;

    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      throw new Error("Unsupported DOCX compression method for " + name);
    }

    if (data.length !== uncompressedSize || crc32(data) !== checksum) {
      throw new Error("DOCX entry integrity check failed: " + name);
    }

    entries.set(name, data);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

var glyphs = {
  x: ["10001", "01010", "00100", "00100", "01010", "10001", "00000"],
  y: ["10001", "01010", "00100", "00100", "00100", "00100", "00000"],
  z: ["11111", "00010", "00100", "01000", "10000", "11111", "00000"],
  "2": ["11110", "00001", "00001", "11110", "10000", "10000", "11111"],
  "+": ["00100", "00100", "00100", "11111", "00100", "00100", "00100"],
  "=": ["00000", "11111", "00000", "11111", "00000", "00000", "00000"]
};

function addGlyph(rectangles, glyph, x, y, cell) {
  glyphs[glyph].forEach(function (row, rowIndex) {
    Array.from(row).forEach(function (pixel, columnIndex) {
      if (pixel === "1") {
        rectangles.push({ x: x + columnIndex * cell, y: y + rowIndex * cell, size: cell });
      }
    });
  });
}

function formulaRectangles() {
  var rectangles = [];
  addGlyph(rectangles, "x", 12, 38, 6);
  addGlyph(rectangles, "2", 46, 12, 4);
  addGlyph(rectangles, "+", 78, 38, 6);
  addGlyph(rectangles, "y", 126, 38, 6);
  addGlyph(rectangles, "2", 160, 12, 4);
  addGlyph(rectangles, "=", 192, 38, 6);
  addGlyph(rectangles, "z", 240, 38, 6);
  addGlyph(rectangles, "2", 274, 12, 4);
  return rectangles;
}

function createSvg(rectangles) {
  var pathData = rectangles.map(function (rectangle) {
    return "M" + rectangle.x + " " + rectangle.y + "h" + rectangle.size + "v" + rectangle.size + "h-" + rectangle.size + "z";
  }).join("");

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 320 100\" role=\"img\" aria-label=\"x squared plus y squared equals z squared\">",
    "<path fill=\"#111827\" d=\"" + pathData + "\"/>",
    "</svg>"
  ].join("");
}

function pngChunk(type, data) {
  var typeBuffer = Buffer.from(type, "ascii");
  var chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function createPng(rectangles) {
  var width = 320;
  var height = 100;
  var rowLength = width * 4 + 1;
  var pixels = Buffer.alloc(rowLength * height);

  for (var row = 0; row < height; row += 1) {
    pixels[row * rowLength] = 0;
  }

  rectangles.forEach(function (rectangle) {
    for (var y = rectangle.y; y < rectangle.y + rectangle.size; y += 1) {
      for (var x = rectangle.x; x < rectangle.x + rectangle.size; x += 1) {
        var offset = y * rowLength + 1 + x * 4;
        pixels[offset] = 17;
        pixels[offset + 1] = 24;
        pixels[offset + 2] = 39;
        pixels[offset + 3] = 255;
      }
    }
  });

  var header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(pixels, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function documentXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="3048000" cy="952500"/><wp:docPr id="1" name="FormulaBridge dual-format formula" descr="x squared plus y squared equals z squared"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="formula.svg" descr="x squared plus y squared equals z squared"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdPng"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip r:embed="rIdSvg"/></a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3048000" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

function createDocument(outputPath, assetsDirectory) {
  var rectangles = formulaRectangles();
  var svg = createSvg(rectangles);
  var png = createPng(rectangles);
  var entries = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    },
    { name: "word/document.xml", data: documentXml() },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdPng" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula.png"/><Relationship Id="rIdSvg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/formula.svg"/></Relationships>`
    },
    { name: "word/media/formula.svg", data: svg },
    { name: "word/media/formula.png", data: png }
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, createZip(entries));

  if (assetsDirectory) {
    fs.mkdirSync(assetsDirectory, { recursive: true });
    fs.writeFileSync(path.join(assetsDirectory, "formula.tex"), formulaTeX + "\n");
    fs.writeFileSync(path.join(assetsDirectory, "formula.svg"), svg);
    fs.writeFileSync(path.join(assetsDirectory, "formula.png"), png);
  }
}

function countMatches(value, expression) {
  return (value.match(expression) || []).length;
}

function xmlAttribute(tag, name) {
  var match = tag.match(new RegExp("\\b" + name + "=\"([^\"]*)\"", "i"));
  return match ? match[1] : undefined;
}

function imageReferenceIds(document, expression) {
  return Array.from(document.matchAll(expression), function (match) { return match[1]; });
}

function inspectDocument(inputPath) {
  var entries = readZip(inputPath);
  var document = (entries.get("word/document.xml") || Buffer.alloc(0)).toString("utf8");
  var relationships = (entries.get("word/_rels/document.xml.rels") || Buffer.alloc(0)).toString("utf8");
  var allRelationships = Array.from(entries.entries())
    .filter(function (entry) { return /(?:^|\/)_[Rr]els\/[^/]+\.rels$/i.test(entry[0]); })
    .map(function (entry) { return entry[1].toString("utf8"); })
    .join("\n");
  var svgEntries = Array.from(entries.keys()).filter(function (name) { return /^word\/media\/[^/]+\.svg$/i.test(name); });
  var pngEntries = Array.from(entries.keys()).filter(function (name) { return /^word\/media\/[^/]+\.png$/i.test(name); });
  var svg = svgEntries.map(function (name) { return entries.get(name).toString("utf8"); }).join("\n");
  var imageRelationships = allRelationships.match(/<Relationship\b[^>]*\bType="[^"]*\/image"[^>]*>/gi) || [];
  var documentRelationships = relationships.match(/<Relationship\b[^>]*>/gi) || [];
  var relationshipById = new Map(documentRelationships.map(function (relationship) {
    return [xmlAttribute(relationship, "Id"), relationship];
  }));
  var svgReferenceIds = imageReferenceIds(document, /<asvg:svgBlip\b[^>]*\br:embed="([^"]+)"/gi);
  var pngReferenceIds = imageReferenceIds(document, /<a:blip\b[^>]*\br:embed="([^"]+)"/gi);

  function isInvalidImageReference(id, expectedExtension) {
    var relationship = relationshipById.get(id);
    var target;
    var packagePath;
    if (!relationship || /\bTargetMode="External"/i.test(relationship)) {
      return true;
    }
    target = xmlAttribute(relationship, "Target");
    if (!target || !new RegExp("\\." + expectedExtension + "$", "i").test(target)) {
      return true;
    }
    packagePath = path.posix.normalize(path.posix.join("word", target.replace(/\\/g, "/")));
    return packagePath.startsWith("../") || !entries.has(packagePath);
  }

  return {
    schemaVersion: 1,
    svgMediaParts: svgEntries.length,
    pngMediaParts: pngEntries.length,
    svgBlipReferences: svgReferenceIds.length,
    pngFallbackReferences: pngReferenceIds.length,
    externalImageRelationships: imageRelationships.filter(function (relationship) {
      return /\bTargetMode="External"/i.test(relationship);
    }).length,
    externalFontRelationships: (allRelationships.match(/<Relationship\b(?=[^>]*\bTargetMode="External")(?=[^>]*\bType="[^"]*font[^"]*")[^>]*>/gi) || []).length,
    danglingImageReferences: svgReferenceIds.filter(function (id) {
      return isInvalidImageReference(id, "svg");
    }).length + pngReferenceIds.filter(function (id) {
      return isInvalidImageReference(id, "png");
    }).length,
    externalSvgReferences: countMatches(svg, /(?:href|src)\s*=\s*["'](?!#|data:)|@import\b|url\s*\(\s*["']?(?:https?:|file:|\/\/|\\\\|[A-Za-z]:)/gi),
    externalFontReferences: countMatches(svg, /@font-face\b|font-family\s*:|<font-face-uri\b|<text\b/gi),
    executableSvgElements: countMatches(svg, /<script\b|<foreignObject\b|\son[a-z]+\s*=|<\?(?!xml\b)/gi)
  };
}

function parseArguments(argumentsList) {
  var options = {};
  for (var index = 1; index < argumentsList.length; index += 2) {
    options[argumentsList[index].replace(/^--/, "")] = argumentsList[index + 1];
  }
  return { command: argumentsList[0], options: options };
}

function main() {
  var parsed = parseArguments(process.argv.slice(2));
  if (parsed.command === "create" && parsed.options.output && parsed.options.inspection) {
    createDocument(path.resolve(parsed.options.output), parsed.options.assets && path.resolve(parsed.options.assets));
    fs.writeFileSync(
      path.resolve(parsed.options.inspection),
      JSON.stringify(inspectDocument(path.resolve(parsed.options.output)), null, 2) + "\n"
    );
    return;
  }
  if (parsed.command === "inspect" && parsed.options.input && parsed.options.output) {
    fs.writeFileSync(
      path.resolve(parsed.options.output),
      JSON.stringify(inspectDocument(path.resolve(parsed.options.input)), null, 2) + "\n"
    );
    return;
  }
  throw new Error("Usage: dual-format-package create --output <docx> --inspection <json> [--assets <directory>]\n       dual-format-package inspect --input <docx> --output <json>");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write("dual-format-package: " + error.message + "\n");
    process.exitCode = 2;
  }
}

module.exports = { createDocument: createDocument, inspectDocument: inspectDocument };
