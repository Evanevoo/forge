'use strict';
/**
 * Child-process helpers.
 *
 * Everything Forge does externally (java, keytool, npx expo, gradlew) goes
 * through here so that Windows quoting, streaming and cancellation are handled
 * in exactly one place.
 */
const { spawn } = require('child_process');
const os = require('os');

const IS_WIN = process.platform === 'win32';

/** Quote a single argument for cmd.exe. */
function quoteWin(s) {
  s = String(s);
  if (s.length === 0) return '""';
  if (!/[\s&()[\]{}^=;!'+,`~%"]/.test(s)) return s;
  // Escape embedded double quotes, then wrap.
  return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1') + '"';
}

/**
 * Spawn a process.
 *
 * On Windows we go through cmd.exe because the things we call are frequently
 * batch shims (`npx.cmd`, `gradlew.bat`) which CreateProcess cannot execute
 * directly.  We build the command line ourselves so paths containing spaces
 * ("C:\Program Files\Android\...") survive.
 */
function spawnProc({ file, args = [], cwd, env, stdio }) {
  const options = {
    cwd: cwd || undefined,
    env: env || process.env,
    windowsHide: true,
    stdio: stdio || ['ignore', 'pipe', 'pipe'],
  };
  if (IS_WIN) {
    const line = [file, ...args].map(quoteWin).join(' ');
    return spawn(line, [], { ...options, shell: true });
  }
  return spawn(file, args, options);
}

/**
 * Run a process to completion, buffering output. For short commands only
 * (`java -version`, `keytool -list`).
 */
function run({ file, args = [], cwd, env, input, timeout = 120000 }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnProc({
        file,
        args,
        cwd,
        env,
        stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return resolve({ code: -1, stdout: '', stderr: String(err && err.message || err), failed: true });
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        try { child.kill(); } catch (_) { /* ignore */ }
        finish(-1, 'timed out after ' + timeout + 'ms');
      }
    }, timeout);

    function finish(code, extraErr) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr: extraErr ? (stderr + '\n' + extraErr) : stderr,
        failed: code !== 0,
      });
    }

    if (child.stdout) child.stdout.on('data', (d) => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => finish(-1, String(err && err.message || err)));
    child.on('close', (code) => finish(code == null ? -1 : code));

    if (input != null && child.stdin) {
      child.stdin.end(input);
    }
  });
}

/**
 * Run a process, emitting output line by line as it arrives.
 * Returns { promise, cancel }.
 */
function stream({ file, args = [], cwd, env, onLine }) {
  let child;
  let cancelled = false;
  const emit = (streamName, text) => {
    if (typeof onLine === 'function' && text.length) onLine(streamName, text);
  };

  const promise = new Promise((resolve) => {
    try {
      child = spawnProc({ file, args, cwd, env });
    } catch (err) {
      emit('stderr', 'Failed to start: ' + (err && err.message || err));
      return resolve({ code: -1, cancelled: false, failed: true });
    }

    const buffers = { stdout: '', stderr: '' };
    const pump = (name) => (chunk) => {
      buffers[name] += chunk.toString();
      let idx;
      while ((idx = buffers[name].indexOf('\n')) >= 0) {
        const line = buffers[name].slice(0, idx).replace(/\r$/, '');
        buffers[name] = buffers[name].slice(idx + 1);
        emit(name, line);
      }
    };
    child.stdout.on('data', pump('stdout'));
    child.stderr.on('data', pump('stderr'));

    child.on('error', (err) => {
      emit('stderr', 'Process error: ' + (err && err.message || err));
    });
    child.on('close', (code) => {
      for (const name of ['stdout', 'stderr']) {
        if (buffers[name].length) emit(name, buffers[name].replace(/\r$/, ''));
      }
      resolve({ code: code == null ? -1 : code, cancelled, failed: cancelled || code !== 0 });
    });
  });

  function cancel() {
    if (!child || child.exitCode != null) return;
    cancelled = true;
    if (IS_WIN) {
      // Gradle spawns a daemon + child JVMs; kill the whole tree.
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } catch (_) {
        try { child.kill(); } catch (__) { /* ignore */ }
      }
    } else {
      try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
    }
  }

  return { promise, cancel };
}

module.exports = { run, stream, spawnProc, quoteWin, IS_WIN, EOL: os.EOL };
