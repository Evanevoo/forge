'use strict';
/**
 * Gradle release builds.
 *
 * Signing credentials are passed in through the environment of the Gradle
 * child process only (see gradle.js for the matching signingConfig), so no
 * secret is written to disk or to build.gradle at any point.
 */
const fs = require('fs');
const path = require('path');
const { stream, IS_WIN } = require('./exec');
const { ensureLocalProperties } = require('./gradle');

const TARGETS = {
  bundle: { task: 'bundleRelease', ext: '.aab', outDir: ['app', 'build', 'outputs', 'bundle', 'release'], label: 'Android App Bundle (.aab)' },
  apk: { task: 'assembleRelease', ext: '.apk', outDir: ['app', 'build', 'outputs', 'apk', 'release'], label: 'APK (.apk)' },
};

/**
 * Crash-reporting SDKs bolt a Gradle task onto the release build that uploads
 * source maps or debug symbols to their servers, and fail the whole build when
 * no auth token is configured — after everything has already compiled. A local
 * release build has no business needing a cloud account, so Forge turns those
 * uploads off by default and says so in the log.
 *
 * Documented switches, read from the environment by each vendor's Gradle script:
 *   Sentry  — SENTRY_DISABLE_AUTO_UPLOAD, SENTRY_DISABLE_NATIVE_DEBUG_UPLOAD
 */
function symbolUploadEnv(skip) {
  if (!skip) return {};
  return {
    SENTRY_DISABLE_AUTO_UPLOAD: 'true',
    SENTRY_DISABLE_NATIVE_DEBUG_UPLOAD: 'true',
  };
}

function newestArtifact(androidDir, target) {
  const dir = path.join(androidDir, ...TARGETS[target].outDir);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(TARGETS[target].ext))
    .map((f) => {
      const full = path.join(dir, f);
      let mtime = 0;
      let size = 0;
      try { const st = fs.statSync(full); mtime = st.mtimeMs; size = st.size; } catch (_) { /* ignore */ }
      return { file: full, name: f, mtime, size };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] || null;
}

/**
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {'bundle'|'apk'} opts.target
 * @param {object} opts.env   toolchain env (from prereqs.toolchainEnv)
 * @param {object} opts.sdk
 * @param {object|null} opts.signing {path, alias, storePassword, keyPassword}
 * @param {function} opts.onLine
 * @param {string[]} [opts.extraArgs]
 * @returns {{promise: Promise<object>, cancel: function}}
 */
function runBuild({ projectDir, target = 'bundle', env, sdk, signing, onLine, extraArgs = [], skipSymbolUploads = true }) {
  if (!TARGETS[target]) throw new Error('Unknown build target: ' + target);
  const androidDir = path.join(projectDir, 'android');
  if (!fs.existsSync(androidDir)) throw new Error('No android/ folder — run prebuild first.');

  const wrapper = IS_WIN ? 'gradlew.bat' : './gradlew';
  const wrapperPath = path.join(androidDir, IS_WIN ? 'gradlew.bat' : 'gradlew');
  if (!fs.existsSync(wrapperPath)) throw new Error('Gradle wrapper not found at ' + wrapperPath);

  if (sdk && sdk.path) {
    const lp = ensureLocalProperties(projectDir, sdk.path);
    if (lp.changed && onLine) onLine('stdout', '[forge] wrote sdk.dir into android/local.properties');
  }

  const buildEnv = { ...env, ...symbolUploadEnv(skipSymbolUploads) };
  if (signing && signing.path) {
    buildEnv.FORGE_STORE_FILE = signing.path;
    buildEnv.FORGE_STORE_PASSWORD = signing.storePassword;
    buildEnv.FORGE_KEY_ALIAS = signing.alias;
    buildEnv.FORGE_KEY_PASSWORD = signing.keyPassword || signing.storePassword;
  }

  const args = [TARGETS[target].task, '--console=plain', '--no-daemon', ...extraArgs];
  const startedAt = Date.now();
  if (onLine) {
    onLine('stdout', '[forge] ' + wrapper + ' ' + args.join(' '));
    onLine('stdout', '[forge] cwd: ' + androidDir);
    onLine('stdout', '[forge] JAVA_HOME: ' + (buildEnv.JAVA_HOME || '(unset)'));
    onLine('stdout', '[forge] ANDROID_HOME: ' + (buildEnv.ANDROID_HOME || '(unset)'));
    onLine('stdout', '[forge] signing: ' + (signing && signing.path ? signing.path + ' (alias ' + signing.alias + ')' : 'NONE - output will be unsigned'));
    onLine('stdout', '[forge] crash-reporter symbol uploads: ' + (skipSymbolUploads ? 'skipped' : 'enabled (needs vendor auth tokens)'));
  }

  const proc = stream({ file: wrapper, args, cwd: androidDir, env: buildEnv, onLine });

  const promise = proc.promise.then((res) => {
    const artifact = res.code === 0 ? newestArtifact(androidDir, target) : null;
    return {
      ...res,
      target,
      task: TARGETS[target].task,
      durationMs: Date.now() - startedAt,
      artifact,
    };
  });

  return { promise, cancel: proc.cancel };
}

/** `gradlew clean` for the android project. */
function runClean({ projectDir, env, onLine }) {
  const androidDir = path.join(projectDir, 'android');
  const wrapper = IS_WIN ? 'gradlew.bat' : './gradlew';
  return stream({ file: wrapper, args: ['clean', '--console=plain'], cwd: androidDir, env, onLine });
}

module.exports = { runBuild, runClean, newestArtifact, symbolUploadEnv, TARGETS };
