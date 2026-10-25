import { createRequire } from "node:module";
const require = createRequire(new URL("../scripts/package.json", import.meta.url));
const { PDFArray, PDFName, decodePDFRawStream } = require("pdf-lib");

// Read actual image drawing transforms, not just the PDF page's declared boxes.
export function pdfImageSizes(document, page) {
  const sizes = [];
  const multiply = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const identity = [1, 0, 0, 1, 0, 0];
  function inspect(streams, resources, initial = identity) {
    let matrix = initial;
    const stack = [];
    const source = streams.map(stream =>
      Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")).join("\n");
    const number = "[-+]?(?:\\d*\\.\\d+|\\d+)";
    const commands = new RegExp(`(?<!\\S)(q|Q)(?!\\S)|((?:${number}\\s+){6})cm\\b|/([\\w]+)\\s+Do\\b`, "g");
    for (const match of source.matchAll(commands)) {
      if (match[1] === "q") stack.push(matrix);
      else if (match[1] === "Q") matrix = stack.pop() || initial;
      else if (match[2]) matrix = multiply(matrix, match[2].trim().split(/\s+/).map(Number));
      else {
        const object = resources.lookup(PDFName.of("XObject")).lookup(PDFName.of(match[3]));
        const subtype = object.dict.get(PDFName.of("Subtype")).toString();
        if (subtype === "/Image") {
          sizes.push({ width: Math.hypot(matrix[0], matrix[1]), height: Math.hypot(matrix[2], matrix[3]) });
        } else if (subtype === "/Form") {
          const formMatrix = object.dict.lookup(PDFName.of("Matrix"));
          inspect([object], object.dict.lookup(PDFName.of("Resources")) || resources,
            formMatrix ? multiply(matrix, formMatrix.asArray().map(n => n.asNumber())) : matrix);
        }
      }
    }
  }
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref => document.context.lookup(ref)) : [contents];
  inspect(streams, page.node.Resources());
  return sizes;
}
