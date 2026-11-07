"use strict";

const fs = require("node:fs");

const COLUMNS = ["username", "length", "type", "score", "status", "http_status", "checked_at", "note", "reasons"];

function esc(v) {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, columns = COLUMNS) {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

function parseLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = parseLine(lines[0]);
  return lines.slice(1).map((l) => {
    const vals = parseLine(l);
    return Object.fromEntries(header.map((h, i) => [h, vals[i] ?? ""]));
  });
}

module.exports = { COLUMNS, toCsv, readCsv };
