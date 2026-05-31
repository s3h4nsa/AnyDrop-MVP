const fs = require("node:fs");
const path = require("node:path");

const required = [
  "server.js",
  "public/app.html",
  "public/app.js",
  "public/css/main.css",
  "public/js/transfer.js",
  "public/js/receiver.js",
  "public/js/utils.js",
];

let failed = false;
for (const file of required) {
  const fullPath = path.join(__dirname, "..", file);
  const stat = fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;
  if (!stat || stat.size === 0) {
    console.error(`Missing required build artifact: ${file}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("Build check passed. AnyDrop is ready to run.");
