// Pure filesystem helpers shared across the board-status loaders.
import fs from "node:fs";
import path from "node:path";

export function listDirectories(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }
  try {
    return fs
      .readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

export function collectFiles(rootPath, fileName) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }
  const matches = [];
  walk(rootPath, (absolutePath) => {
    if (path.basename(absolutePath) === fileName) {
      matches.push(absolutePath);
    }
  });
  return matches;
}

export function walk(rootPath, visitor) {
  let entries = [];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, visitor);
    } else {
      visitor(absolutePath);
    }
  }
}

export function readJson(filePath) {
  if (!filePath) {
    return null;
  }
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function readJsonSafe(filePath) {
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

export function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf-8");
}

export function readTextSafe(filePath) {
  try {
    return readText(filePath);
  } catch {
    return "";
  }
}

export function statMtimeIso(targetPath) {
  const stat = fs.statSync(targetPath, { throwIfNoEntry: false });
  return stat?.mtime?.toISOString?.() || null;
}

export function newestMtimeIso(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return null;
  }
  let newest = fs.statSync(rootPath, { throwIfNoEntry: false })?.mtimeMs || 0;
  walk(rootPath, (absolutePath) => {
    const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
    if (stat?.mtimeMs && stat.mtimeMs > newest) {
      newest = stat.mtimeMs;
    }
  });
  return newest ? new Date(newest).toISOString() : null;
}
