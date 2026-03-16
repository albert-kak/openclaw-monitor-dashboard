"use strict";

const fs = require("fs");
const path = require("path");

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function decodeDoubleQuotedValue(rawValue) {
  return rawValue.replace(/\\([\\nrt"])/g, (match, token) => {
    if (token === "n") return "\n";
    if (token === "r") return "\r";
    if (token === "t") return "\t";
    if (token === "\"") return "\"";
    if (token === "\\") return "\\";
    return match;
  });
}

function isEscapedAt(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function parseQuotedValue(valuePart, key, filePath, lineNo, warnings) {
  const quote = valuePart[0];
  let endQuoteIndex = -1;

  for (let cursor = 1; cursor < valuePart.length; cursor += 1) {
    if (valuePart[cursor] !== quote) continue;
    if (quote === "\"" && isEscapedAt(valuePart, cursor)) continue;
    endQuoteIndex = cursor;
    break;
  }

  if (endQuoteIndex < 0) {
    warnings.push(`${filePath}:${lineNo} ignored unmatched quote for "${key}"`);
    return null;
  }

  const trailing = valuePart.slice(endQuoteIndex + 1).trim();
  if (trailing && !trailing.startsWith("#")) {
    warnings.push(`${filePath}:${lineNo} ignored trailing text for "${key}"`);
  }

  const inner = valuePart.slice(1, endQuoteIndex);
  return quote === "\"" ? decodeDoubleQuotedValue(inner) : inner;
}

function parseEnvContent(content, filePath = ".env") {
  const values = {};
  const warnings = [];
  const lines = String(content ?? "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    let line = lines[index];
    if (index === 0 && line.charCodeAt(0) === 0xFEFF) {
      line = line.slice(1);
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const statement = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trimStart()
      : trimmed;

    const equalIndex = statement.indexOf("=");
    if (equalIndex <= 0) {
      warnings.push(`${filePath}:${lineNo} ignored invalid line`);
      continue;
    }

    const key = statement.slice(0, equalIndex).trim();
    if (!ENV_KEY_PATTERN.test(key)) {
      warnings.push(`${filePath}:${lineNo} ignored invalid key "${key}"`);
      continue;
    }

    const valuePart = statement.slice(equalIndex + 1).trim();
    if (!valuePart) {
      values[key] = "";
      continue;
    }

    const quote = valuePart[0];
    if (quote === "\"" || quote === "'") {
      const parsedValue = parseQuotedValue(valuePart, key, filePath, lineNo, warnings);
      if (parsedValue == null) {
        continue;
      }
      values[key] = parsedValue;
      continue;
    }

    values[key] = valuePart.replace(/\s+#.*$/, "").trim();
  }

  return { values, warnings };
}

function loadEnvFile(filePath, env = process.env, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const appliedKeys = [];
  const override = options.override === true;

  if (!fs.existsSync(resolvedPath)) {
    return {
      filePath: resolvedPath,
      loaded: false,
      parsedKeys: 0,
      appliedKeys,
      warnings: [],
    };
  }

  let rawContent = "";
  try {
    rawContent = fs.readFileSync(resolvedPath, "utf8");
  } catch (error) {
    return {
      filePath: resolvedPath,
      loaded: false,
      parsedKeys: 0,
      appliedKeys,
      warnings: [
        `${resolvedPath} failed to read (${error?.code ?? "UNKNOWN"})`,
      ],
    };
  }

  const parsed = parseEnvContent(rawContent, resolvedPath);
  for (const [key, value] of Object.entries(parsed.values)) {
    if (override || env[key] === undefined) {
      env[key] = value;
      appliedKeys.push(key);
    }
  }

  return {
    filePath: resolvedPath,
    loaded: true,
    parsedKeys: Object.keys(parsed.values).length,
    appliedKeys,
    warnings: parsed.warnings,
  };
}

module.exports = {
  loadEnvFile,
  parseEnvContent,
};
