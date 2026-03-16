"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function resolvePathFromEnv(env, envName, fallbackPath) {
  const raw = env?.[envName];
  if (typeof raw === "string" && raw.trim()) {
    return {
      path: path.resolve(raw.trim()),
      source: `env:${envName}`,
    };
  }
  return {
    path: fallbackPath,
    source: "default",
  };
}

function resolveOptionalPathFromEnv(env, envName) {
  const raw = env?.[envName];
  if (typeof raw !== "string" || !raw.trim()) {
    return {
      path: null,
      source: "unset",
    };
  }
  return {
    path: path.resolve(raw.trim()),
    source: `env:${envName}`,
  };
}

function resolveRuntimePaths(env = process.env, options = {}) {
  const dashboardRootDir = options?.dashboardRootDir
    ? path.resolve(options.dashboardRootDir)
    : process.cwd();
  const openclawHome = resolvePathFromEnv(env, "OPENCLAW_HOME", path.join(os.homedir(), ".openclaw"));

  const agentsDir = resolvePathFromEnv(env, "OPENCLAW_AGENTS_DIR", path.join(openclawHome.path, "agents"));
  const logsDir = resolvePathFromEnv(env, "OPENCLAW_LOGS_DIR", path.join(openclawHome.path, "logs"));
  const configPath = resolvePathFromEnv(env, "OPENCLAW_CONFIG_PATH", path.join(openclawHome.path, "openclaw.json"));
  const cronJobsPath = resolvePathFromEnv(env, "OPENCLAW_CRON_JOBS_PATH", path.join(openclawHome.path, "cron", "jobs.json"));
  const skillsDir = resolvePathFromEnv(env, "OPENCLAW_SKILLS_DIR", path.join(openclawHome.path, "skills"));

  const gatewayLogPath = resolvePathFromEnv(env, "OPENCLAW_GATEWAY_LOG_PATH", path.join(logsDir.path, "gateway.log"));
  const gatewayErrorLogPath = resolvePathFromEnv(
    env,
    "OPENCLAW_GATEWAY_ERROR_LOG_PATH",
    path.join(logsDir.path, "gateway.err.log"),
  );

  const stateDir = resolvePathFromEnv(env, "OCD_STATE_DIR", path.join(dashboardRootDir, ".ocd"));
  const pidFile = {
    path: path.join(stateDir.path, "ocd.pid"),
    source: "derived:stateDir",
  };
  const logFile = {
    path: path.join(stateDir.path, "ocd.log"),
    source: "derived:stateDir",
  };
  const errFile = {
    path: path.join(stateDir.path, "ocd.err.log"),
    source: "derived:stateDir",
  };

  const openclawInstallDir = resolveOptionalPathFromEnv(env, "OPENCLAW_INSTALL_DIR");

  return {
    openclawHome,
    agentsDir,
    logsDir,
    configPath,
    cronJobsPath,
    skillsDir,
    gatewayLogPath,
    gatewayErrorLogPath,
    stateDir,
    pidFile,
    logFile,
    errFile,
    openclawInstallDir,
    sessionLogGlob: {
      path: path.join(agentsDir.path, "*", "sessions", "*.jsonl"),
      source: "derived",
    },
  };
}

function checkDirectory(checks, name, dirPath, options = {}) {
  const required = options.required !== false;
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      checks.push({
        name,
        path: dirPath,
        required,
        status: required ? "error" : "warn",
        message: "Path exists but is not a directory",
      });
      return;
    }
    fs.accessSync(dirPath, fs.constants.R_OK);
    checks.push({
      name,
      path: dirPath,
      required,
      status: "ok",
      message: "Directory is readable",
    });
  } catch (error) {
    checks.push({
      name,
      path: dirPath,
      required,
      status: required ? "error" : "warn",
      message: error?.code ? `Unavailable (${error.code})` : "Unavailable",
    });
  }
}

function checkDirectoryWritable(checks, name, dirPath, options = {}) {
  const required = options.required !== false;
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      checks.push({
        name,
        path: dirPath,
        required,
        status: required ? "error" : "warn",
        message: "Path exists but is not a directory",
      });
      return;
    }
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    checks.push({
      name,
      path: dirPath,
      required,
      status: "ok",
      message: "Directory is readable and writable",
    });
  } catch (error) {
    checks.push({
      name,
      path: dirPath,
      required,
      status: required ? "error" : "warn",
      message: error?.code ? `Unavailable (${error.code})` : "Unavailable",
    });
  }
}

function checkFile(checks, name, filePath, options = {}) {
  const required = options.required === true;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      checks.push({
        name,
        path: filePath,
        required,
        status: required ? "error" : "warn",
        message: "Path exists but is not a file",
      });
      return;
    }
    fs.accessSync(filePath, fs.constants.R_OK);
    checks.push({
      name,
      path: filePath,
      required,
      status: "ok",
      message: "File is readable",
    });
  } catch (error) {
    checks.push({
      name,
      path: filePath,
      required,
      status: required ? "error" : "warn",
      message: error?.code ? `Missing or unreadable (${error.code})` : "Missing or unreadable",
    });
  }
}

function validateRuntimeLayout(paths) {
  const checks = [];

  checkDirectory(checks, "openclawHome", paths.openclawHome.path, { required: true });
  checkDirectory(checks, "agentsDir", paths.agentsDir.path, { required: true });
  checkDirectory(checks, "logsDir", paths.logsDir.path, { required: true });

  checkDirectoryWritable(checks, "configDir", path.dirname(paths.configPath.path), { required: true });
  checkDirectory(checks, "cronDir", path.dirname(paths.cronJobsPath.path), { required: false });
  checkDirectory(checks, "skillsDir", paths.skillsDir.path, { required: false });

  checkFile(checks, "gatewayLog", paths.gatewayLogPath.path, { required: false });
  checkFile(checks, "gatewayErrorLog", paths.gatewayErrorLogPath.path, { required: false });
  checkFile(checks, "configFile", paths.configPath.path, { required: false });

  const hasErrors = checks.some((item) => item.status === "error");
  const hasWarnings = checks.some((item) => item.status === "warn");

  return {
    ok: !hasErrors,
    hasWarnings,
    checks,
  };
}

function formatValidationReport(validation) {
  return validation.checks.map((item) => (
    `[${item.status.toUpperCase()}] ${item.name}: ${item.path} (${item.message})`
  ));
}

module.exports = {
  resolveRuntimePaths,
  validateRuntimeLayout,
  formatValidationReport,
};
