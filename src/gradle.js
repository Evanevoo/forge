'use strict';
/**
 * Idempotent patching of android/app/build.gradle.
 *
 * Design notes
 * ------------
 * 1. Everything Forge adds is wrapped in FORGE-SIGNING-START/END markers, and
 *    patching always *unpatches first*. That makes `patch(patch(x)) === patch(x)`
 *    and also makes the patch upgradeable: a newer Forge simply replaces the
 *    old block instead of stacking a second one.
 *
 * 2. No passwords or paths are written into build.gradle. The injected
 *    signingConfig reads FORGE_STORE_FILE / FORGE_STORE_PASSWORD /
 *    FORGE_KEY_ALIAS / FORGE_KEY_PASSWORD from the environment, which Forge
 *    sets on the Gradle child process only. Nothing secret ever lands on disk.
 */
const fs = require('fs');
const path = require('path');

const START = '// FORGE-SIGNING-START - managed by Forge. Do not edit inside this block.';
const END = '// FORGE-SIGNING-END';
// Swallows the newline that precedes the block so removal restores the file
// byte-for-byte — which is what makes patch(patch(x)) === patch(x).
const START_RE = /\n?[ \t]*\/\/ FORGE-SIGNING-START[^\n]*\n[\s\S]*?\/\/ FORGE-SIGNING-END[^\n]*(?:\n|$)/g;
const RELEASE_LINE_RE = /^[ \t]*signingConfig[^\n]*\/\/ FORGE-SIGNING-RELEASE \(was: ([^)]*)\)[^\n]*\n/gm;

const CONFIG_NAME = 'forgeRelease';

/* ------------------------------------------------------ Groovy scanning -- */

/**
 * Find the block whose header matches `headerRe`, returning the index range of
 * the block body. Skips string literals and comments so braces inside them
 * don't confuse the scan.
 */
function findBlock(src, headerRe, from = 0, to = src.length) {
  headerRe.lastIndex = 0;
  const slice = src.slice(from, to);
  const m = headerRe.exec(slice);
  if (!m) return null;
  const headerStart = from + m.index;
  const openBrace = src.indexOf('{', headerStart + m[0].length - 1);
  if (openBrace < 0) return null;
  const close = matchBrace(src, openBrace);
  if (close < 0) return null;
  const lead = /^\n?([ \t]*)/.exec(m[0]);
  return {
    headerStart,
    openBrace,
    bodyStart: openBrace + 1,
    bodyEnd: close,
    closeBrace: close,
    indent: lead ? lead[1] : '',
  };
}

/** Given the index of a '{', return the index of its matching '}' (or -1). */
function matchBrace(src, openIndex) {
  let depth = 0;
  let i = openIndex;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '/' && next === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = src.indexOf('*/', i + 2);
      i = close < 0 ? src.length : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const triple = src.substr(i, 3) === quote.repeat(3);
      i += triple ? 3 : 1;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (triple && src.substr(i, 3) === quote.repeat(3)) { i += 3; break; }
        if (!triple && src[i] === quote) { i += 1; break; }
        if (!triple && src[i] === '\n') break; // unterminated; bail out safely
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function indentOf(src, index) {
  const lineStart = src.lastIndexOf('\n', index - 1) + 1;
  const m = /^[ \t]*/.exec(src.slice(lineStart, index));
  return m ? m[0] : '';
}

/* ------------------------------------------------------------- Patching -- */

/** The `forgeRelease { ... }` config itself, without markers. */
function forgeConfigLines(i) {
  return [
    i + CONFIG_NAME + ' {',
    i + '    // Credentials are supplied by Forge through the environment at build',
    i + '    // time, so no keystore path or password is ever stored in this file.',
    i + '    def forgeStoreFile = System.getenv("FORGE_STORE_FILE")',
    i + '    if (forgeStoreFile != null && forgeStoreFile.length() > 0) {',
    i + '        storeFile file(forgeStoreFile)',
    i + '        storePassword System.getenv("FORGE_STORE_PASSWORD")',
    i + '        keyAlias System.getenv("FORGE_KEY_ALIAS")',
    i + '        keyPassword System.getenv("FORGE_KEY_PASSWORD")',
    i + '    } else {',
    i + '        logger.warn("Forge: FORGE_STORE_FILE is not set - release artifacts will be UNSIGNED.")',
    i + '    }',
    i + '}',
  ];
}

/** Marker-wrapped config, for insertion inside an existing signingConfigs {}. */
function forgeSigningBlock(indent) {
  return [indent + START, ...forgeConfigLines(indent), indent + END, ''].join('\n');
}

/** Marker-wrapped signingConfigs {} containing the config, for a fresh insert. */
function signingConfigsBlock(indent) {
  return [
    indent + START,
    indent + 'signingConfigs {',
    ...forgeConfigLines(indent + '    '),
    indent + '}',
    indent + END,
    '',
  ].join('\n');
}

/** Remove any previously-injected Forge content, restoring the original file. */
function unpatch(source) {
  let out = source.replace(RELEASE_LINE_RE, (whole, was) => {
    const indent = /^[ \t]*/.exec(whole)[0];
    if (!was || was === 'NONE') return '';
    return indent + was + '\n';
  });
  out = out.replace(START_RE, '');
  return out;
}

/**
 * Inject (or refresh) the Forge release signingConfig.
 *
 * @param {string} source contents of android/app/build.gradle
 * @returns {{content: string, changed: boolean, notes: string[]}}
 */
function patchBuildGradle(source) {
  const notes = [];
  const original = source;
  let src = unpatch(source);

  const android = findBlock(src, /(^|\n)[ \t]*android[ \t]*\{/);
  if (!android) {
    throw new Error('Could not find an `android { }` block in build.gradle — is this really android/app/build.gradle?');
  }

  // --- 1. signingConfigs -------------------------------------------------
  let signing = findBlock(src, /(^|\n)[ \t]*signingConfigs[ \t]*\{/, android.bodyStart, android.bodyEnd);
  if (signing) {
    const innerIndent = signing.indent + '    ';
    const insertAt = signing.bodyStart;
    src = src.slice(0, insertAt) + '\n' + forgeSigningBlock(innerIndent) + src.slice(insertAt);
    notes.push('Added `' + CONFIG_NAME + '` to the existing signingConfigs block.');
  } else {
    const insertAt = android.bodyStart;
    src = src.slice(0, insertAt) + '\n' + signingConfigsBlock(android.indent + '    ') + src.slice(insertAt);
    notes.push('Created a signingConfigs block with `' + CONFIG_NAME + '`.');
  }

  // --- 2. buildTypes { release { signingConfig ... } } --------------------
  const android2 = findBlock(src, /(^|\n)[ \t]*android[ \t]*\{/);
  const buildTypes = findBlock(src, /(^|\n)[ \t]*buildTypes[ \t]*\{/, android2.bodyStart, android2.bodyEnd);
  if (!buildTypes) {
    throw new Error('Could not find a `buildTypes { }` block inside `android { }`.');
  }
  const release = findBlock(src, /(^|\n)[ \t]*release[ \t]*\{/, buildTypes.bodyStart, buildTypes.bodyEnd);
  if (!release) {
    throw new Error('Could not find a `release { }` build type inside `buildTypes { }`.');
  }

  const body = src.slice(release.bodyStart, release.bodyEnd);
  const existing = /^[ \t]*signingConfig[ \t]+[^\n]*$/m.exec(body);
  const releaseIndent = release.indent + '    ';

  if (existing) {
    const was = existing[0].trim();
    const replacement = releaseIndent + 'signingConfig signingConfigs.' + CONFIG_NAME
      + ' // FORGE-SIGNING-RELEASE (was: ' + was + ')';
    const newBody = body.slice(0, existing.index) + replacement + body.slice(existing.index + existing[0].length);
    src = src.slice(0, release.bodyStart) + newBody + src.slice(release.bodyEnd);
    notes.push('Pointed the release build type at `signingConfigs.' + CONFIG_NAME + '` (previously: ' + was + ').');
  } else {
    const line = '\n' + releaseIndent + 'signingConfig signingConfigs.' + CONFIG_NAME
      + ' // FORGE-SIGNING-RELEASE (was: NONE)';
    src = src.slice(0, release.bodyStart) + line + src.slice(release.bodyStart);
    notes.push('Added `signingConfig signingConfigs.' + CONFIG_NAME + '` to the release build type.');
  }

  return { content: src, changed: src !== original, notes };
}

/* -------------------------------------------------------------- On disk -- */

function appBuildGradlePath(projectDir) {
  return path.join(projectDir, 'android', 'app', 'build.gradle');
}

function inspectSigning(projectDir) {
  const file = appBuildGradlePath(projectDir);
  const kts = file + '.kts';
  if (!fs.existsSync(file)) {
    if (fs.existsSync(kts)) {
      return { exists: false, kotlinDsl: true, patched: false, file: kts };
    }
    return { exists: false, kotlinDsl: false, patched: false, file };
  }
  const text = fs.readFileSync(file, 'utf8');
  return {
    exists: true,
    kotlinDsl: false,
    patched: text.includes('FORGE-SIGNING-START'),
    releaseWired: /signingConfigs\.forgeRelease/.test(text),
    file,
  };
}

/**
 * Patch android/app/build.gradle on disk. Keeps a one-time .forge-backup of
 * the pristine file the first time it touches it.
 */
function applySigningConfig(projectDir) {
  const file = appBuildGradlePath(projectDir);
  if (!fs.existsSync(file)) {
    if (fs.existsSync(file + '.kts')) {
      throw new Error('This project uses build.gradle.kts (Kotlin DSL). Forge v1 only patches the Groovy build.gradle produced by `expo prebuild`.');
    }
    throw new Error('android/app/build.gradle not found. Run prebuild first.');
  }
  const source = fs.readFileSync(file, 'utf8');
  const backup = file + '.forge-backup';
  if (!fs.existsSync(backup) && !source.includes('FORGE-SIGNING-START')) {
    fs.writeFileSync(backup, source, 'utf8');
  }
  const { content, changed, notes } = patchBuildGradle(source);
  if (changed) fs.writeFileSync(file, content, 'utf8');
  return { file, changed, notes, backup: fs.existsSync(backup) ? backup : null };
}

/* ------------------------------------------------------- JVM memory ---- */
/**
 * React Native templates ship `org.gradle.jvmargs` with a 512 MB metaspace,
 * which is not enough for a project with many Kotlin modules or KSP. Gradle
 * mentions this in a warning halfway through the log, then dies minutes later
 * with `OutOfMemoryError: Metaspace` and a daemon-disappeared message that
 * never names the cause. Detect it up front instead.
 */
const MEM_RE = {
  heap: /-Xmx(\d+)\s*([kmg])?/i,
  metaspace: /-XX:MaxMetaspaceSize=(\d+)\s*([kmg])?/i,
};

function toMb(value, unit) {
  const n = parseInt(value, 10);
  switch (String(unit || 'b').toLowerCase()) {
    case 'g': return n * 1024;
    case 'm': return n;
    case 'k': return Math.round(n / 1024);
    default: return Math.round(n / (1024 * 1024));
  }
}

function parseJvmArgs(line) {
  const out = { heapMb: null, metaspaceMb: null };
  if (!line) return out;
  const h = MEM_RE.heap.exec(line);
  const m = MEM_RE.metaspace.exec(line);
  if (h) out.heapMb = toMb(h[1], h[2]);
  if (m) out.metaspaceMb = toMb(m[1], m[2]);
  return out;
}

/** What to recommend for a machine with `totalRamMb` of physical memory. */
function recommendJvmArgs(totalRamMb) {
  const gb = (totalRamMb || 0) / 1024;
  if (gb >= 24) return { heapMb: 8192, metaspaceMb: 2048 };
  if (gb >= 12) return { heapMb: 6144, metaspaceMb: 2048 };
  if (gb >= 8) return { heapMb: 4096, metaspaceMb: 1024 };
  return { heapMb: 2048, metaspaceMb: 1024 };
}

/** Minimums below which this build is likely to die. */
const MIN_HEAP_MB = 3072;
const MIN_METASPACE_MB = 1024;

function jvmArgsPath(projectDir) {
  return path.join(projectDir, 'android', 'gradle.properties');
}

function inspectJvmArgs(projectDir, totalRamMb) {
  const file = jvmArgsPath(projectDir);
  const recommended = recommendJvmArgs(totalRamMb || require('os').totalmem() / (1024 * 1024));
  if (!fs.existsSync(file)) {
    return { file, exists: false, ok: false, heapMb: null, metaspaceMb: null, recommended, reasons: ['android/gradle.properties not found'] };
  }
  const text = fs.readFileSync(file, 'utf8');
  const line = (/^\s*org\.gradle\.jvmargs\s*=(.*)$/m.exec(text) || [])[1] || null;
  const { heapMb, metaspaceMb } = parseJvmArgs(line);

  const reasons = [];
  // An unset metaspace means the JVM default (a few hundred MB) — not enough.
  if (metaspaceMb == null) reasons.push('MaxMetaspaceSize is not set (JVM default is too small for this project)');
  else if (metaspaceMb < MIN_METASPACE_MB) reasons.push('MaxMetaspaceSize is ' + metaspaceMb + ' MB; builds of this size need at least ' + MIN_METASPACE_MB + ' MB');
  if (heapMb != null && heapMb < MIN_HEAP_MB) reasons.push('heap is ' + heapMb + ' MB; at least ' + MIN_HEAP_MB + ' MB is safer');

  return { file, exists: true, ok: reasons.length === 0, line, heapMb, metaspaceMb, recommended, reasons };
}

/**
 * Raise org.gradle.jvmargs to at least the recommended values. Never lowers a
 * setting the user has already raised, and is a no-op once applied.
 */
function ensureJvmArgs(projectDir, totalRamMb) {
  const file = jvmArgsPath(projectDir);
  if (!fs.existsSync(file)) throw new Error('android/gradle.properties not found — run prebuild first.');

  const current = inspectJvmArgs(projectDir, totalRamMb);
  const heapMb = Math.max(current.heapMb || 0, current.recommended.heapMb);
  const metaspaceMb = Math.max(current.metaspaceMb || 0, current.recommended.metaspaceMb);
  if (current.ok && heapMb === current.heapMb && metaspaceMb === current.metaspaceMb) {
    return { file, changed: false, heapMb, metaspaceMb };
  }

  const text = fs.readFileSync(file, 'utf8');
  const rest = (current.line || '')
    .replace(MEM_RE.heap, '')
    .replace(MEM_RE.metaspace, '')
    .trim();
  const value = ['-Xmx' + heapMb + 'm', '-XX:MaxMetaspaceSize=' + metaspaceMb + 'm', rest]
    .filter(Boolean).join(' ');
  const line = 'org.gradle.jvmargs=' + value;

  const backup = file + '.forge-backup';
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, text, 'utf8');

  const next = /^\s*org\.gradle\.jvmargs\s*=.*$/m.test(text)
    ? text.replace(/^\s*org\.gradle\.jvmargs\s*=.*$/m, line)
    : (text.replace(/\s*$/, '\n') + '\n# Raised by Forge - the template default is too small for this project.\n' + line + '\n');

  fs.writeFileSync(file, next, 'utf8');
  return { file, changed: true, heapMb, metaspaceMb, backup };
}

/** Gradle needs sdk.dir; write it if the file is missing or has no sdk.dir. */
function ensureLocalProperties(projectDir, sdkPath) {
  const file = path.join(projectDir, 'android', 'local.properties');
  const escaped = String(sdkPath).replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  let text = '';
  if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8');
  if (/^\s*sdk\.dir\s*=/m.test(text)) return { file, changed: false };
  const line = 'sdk.dir=' + escaped + '\n';
  fs.writeFileSync(file, text ? (text.replace(/\s*$/, '\n') + line) : ('# Written by Forge\n' + line), 'utf8');
  return { file, changed: true };
}

module.exports = {
  patchBuildGradle,
  unpatch,
  applySigningConfig,
  inspectSigning,
  ensureLocalProperties,
  inspectJvmArgs,
  ensureJvmArgs,
  parseJvmArgs,
  recommendJvmArgs,
  appBuildGradlePath,
  findBlock,
  matchBrace,
  CONFIG_NAME,
};
