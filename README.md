# Forge

A Windows desktop app for building and signing Expo / React Native projects
**entirely on your own machine** (Android) or on rented macOS CI (iOS) — no EAS,
no cloud build queue, no per-build cost.

**Android:** Built locally with your own key, on Windows.  
**iOS:** Compiled on a macOS GitHub Actions runner (bills in minutes, typically
$0–20/month), signed with your certificate, submitted to TestFlight from your
machine.

---

## Getting it running

```bat
cd C:\Users\evank\forge
npm install
npm start
```

To produce the distributable single-file exe:

```bat
npm run dist
```

…which writes `dist\Forge-1.0.0-portable.exe` (electron-builder, portable
target — no installer, no admin rights, runs from anywhere).

Run the unit tests with `npm test` (they need no Electron and no network).

---

## What it does, in order

1. **Pick a project** — any folder with a `package.json`. Forge reads the Expo
   / React Native versions, the `applicationId`, whether `android/` exists,
   and whether `node_modules` is installed.

2. **Check prerequisites** — Forge resolves the toolchain itself instead of
   demanding `JAVA_HOME` / `ANDROID_HOME` be set globally:

   | Tool | Where Forge looks, in order |
   |---|---|
   | JDK | override set in Forge → `JAVA_HOME` → `C:\Program Files\Android\Android Studio\jbr` → installed JDKs under Program Files → `~\.jdks\*` → `java` on PATH |
   | Android SDK | override → `ANDROID_HOME` → `ANDROID_SDK_ROOT` → `%LOCALAPPDATA%\Android\Sdk` → `C:\Android\Sdk` |

   A JDK candidate is only accepted if it has **both** `bin\java` and
   `bin\keytool` (a JRE gets rejected with a message saying why), and only
   after `java -version` actually runs. The SDK check reports the installed
   build-tools, the installed platforms, and whether the SDK licence has been
   accepted. Anything missing is named explicitly rather than failing later
   inside Gradle.

   Whatever Forge resolves is injected into the environment of every child
   process it launches — `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and
   the JDK's `bin` prepended to `PATH`.

3. **Prebuild — Expo-only escape hatch.** Forge does not depend on Expo:
   prereq detection, `keytool`, the Gradle signing injection, the `gradlew`
   runner and artifact discovery are all plain Android tooling. A React Native
   project created with the Community CLI already has `android/` committed, so
   this step does not exist for it.

   The one exception is a project that *already* declares `expo` and has never
   had a native folder generated (because it was only ever built in the cloud).
   For those, and only those, Forge offers `npx expo prebuild --platform
   android` as a one-time way to produce `android/`. The button is hidden
   entirely for non-Expo projects, and the IPC handler refuses the call.
   Once that folder exists and is committed, Forge builds it with Gradle alone
   and never invokes Expo again.

4. **Manage the signing key**
   - **Import an existing `.jks`** — the flow you want when Google Play
     already has an upload key. Forge reads the keystore with `keytool`,
     lists its aliases, and shows the **SHA-1 and SHA-256 fingerprints** so
     you can compare them against Play Console → Setup → App integrity →
     Upload key certificate *before* you build something Play will reject.
   - **Generate a new one** — `keytool -genkeypair`, RSA 2048, 30-year
     validity by default. Only appropriate for an app that has never been
     published.

   Passwords are encrypted with Electron's `safeStorage` (DPAPI on Windows)
   and written base64 into `%APPDATA%\Forge\keystores.json`. If the OS
   encryption backend is unavailable, Forge **refuses to persist them at
   all** and keeps them in memory for the session instead — it never falls
   back to plaintext. The keystore file itself is referenced in place, never
   copied.

5. **Patch Gradle** — Forge injects a `forgeRelease` signing config into
   `android/app/build.gradle` and points the `release` build type at it.

   The patch is **idempotent**: everything Forge adds sits between
   `// FORGE-SIGNING-START` / `// FORGE-SIGNING-END` markers, and every patch
   run strips the previous block before re-inserting, so
   `patch(patch(x)) === patch(x)` exactly (there's a test for that, plus one
   asserting `unpatch(patch(x)) === x` byte-for-byte). The pristine file is
   copied to `build.gradle.forge-backup` the first time Forge touches it.

   **No secret ever lands in `build.gradle`.** The injected config reads
   `FORGE_STORE_FILE`, `FORGE_STORE_PASSWORD`, `FORGE_KEY_ALIAS` and
   `FORGE_KEY_PASSWORD` from the environment, which Forge sets on the Gradle
   child process only. That means the patched file is safe to commit, and a
   `git diff` after a build shows nothing sensitive.

6. **Build** — `gradlew bundleRelease` (`.aab`, for Play) or
   `gradlew assembleRelease` (`.apk`, for direct install), run in
   `android/` with `--console=plain` so the log is readable, streamed line by
   line into the UI as it happens. `sdk.dir` is written into
   `android/local.properties` if it's missing.

7. **Find the output** — on success Forge locates the newest artifact in the
   expected output folder, shows its full path and size, and gives you a
   button that opens Explorer with the file selected.

---

## Notes on a couple of decisions

**`--no-daemon`.** Gradle's daemon is faster, but it's a separate process the
`gradlew` client only talks to — so "Cancel" couldn't actually stop a build.
Running without the daemon means killing the process tree genuinely stops
the build. For release builds (which are long and infrequent) that's the
right trade.

**JDK version warning.** The Android Gradle Plugin officially supports up to
JDK 21. Android Studio currently bundles a much newer JBR. It usually works,
but when it doesn't, the failure is an opaque *"Unsupported class file major
version"* deep in a Gradle stack trace — so Forge flags the mismatch up front
and tells you to point it at a JDK 17/21 if that error appears.

**Groovy only.** `expo prebuild` generates a Groovy `build.gradle`. If a
project has a Kotlin-DSL `build.gradle.kts`, Forge says so plainly instead of
mangling it.

---

## Layout

```
forge/
├── src/
│   ├── main.js       Electron lifecycle, window, single-instance lock
│   ├── preload.js    the entire renderer API surface (contextIsolation on)
│   ├── ipc.js        every main-process handler
│   ├── prereqs.js    JDK / Android SDK discovery + toolchain env
│   ├── project.js    project inspection, expo prebuild
│   ├── keystore.js   keytool: generate, inspect, fingerprints
│   ├── secrets.js    safeStorage-encrypted store + settings
│   ├── gradle.js     idempotent signingConfig injection
│   ├── build.js      gradlew runner, artifact discovery
│   └── exec.js       spawn/quoting/streaming/cancellation
├── renderer/         index.html, styles.css, app.js  (no framework)
└── test/             node:test — no network, no Electron needed
```

The renderer runs with `contextIsolation: true` and `nodeIntegration: false`
behind a strict CSP; it can only call the functions listed in `preload.js`.
