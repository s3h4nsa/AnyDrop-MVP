const { execFileSync } = require("node:child_process");

execFileSync(process.execPath, ["scripts/build.js"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests"], {
  stdio: "inherit",
  shell: true,
});

console.log("Release checks passed.");
