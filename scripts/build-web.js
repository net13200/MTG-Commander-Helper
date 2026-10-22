// Copies the static web app into www/ for the Android build (Capacitor's webDir).
// The web app itself has no build step; this only gathers its files.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "www");
const files = ["index.html", "style.css", "icon.svg", "manifest.webmanifest", "sw.js", "js", "icons"];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of files) fs.cpSync(path.join(root, f), path.join(out, f), { recursive: true });
console.log("www/ ready:", files.join(", "));
