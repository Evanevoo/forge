# How to Use Forge

Welcome! Forge is a Windows desktop app that builds and signs React Native releases locally — both Android (on your machine) and iOS (via macOS CI runners).

This guide covers the entire workflow from project setup through app store submission.

---

## Before you start

**Requirements:**
- Windows 10 or later
- A React Native or Expo project with `package.json`
- ~2 GB free disk space

**What you'll need for submissions:**
- **Android:** Your existing Google Play upload key (`.jks` keystore)
- **iOS:** Apple Developer account (for certificates & provisioning profiles)

---

## Installation

1. **Download** `Forge-1.0.0-portable.exe` from the releases page
2. **Run it** — no installer needed, no admin rights required
3. **First launch:** Forge auto-discovers Java JDK and Android SDK
   - If not found, you'll see instructions to install them
   - Forge will never ask you to set `JAVA_HOME` or `ANDROID_HOME` manually

---

## The 6 Steps to Build & Submit

### Card 1: Project

**What it does:** Forge reads your React Native/Expo project and prepares the Android and iOS folders.

**Steps:**
1. Click **"Choose folder…"** and select your project root (the one with `package.json`)
2. Forge displays:
   - Project name, version, and application ID
   - Whether `android/` and `ios/` folders exist
   - Any warnings (e.g., "node_modules is missing")

**If `android/` is missing:**
- Click **"Run prebuild"** → Forge runs `expo prebuild --platform android`
- This generates the Android Gradle project (~2 min, first time)
- Use "Prebuild (clean)" to regenerate from scratch

**If `ios/` is missing:**
- Click **"Generate ios/"** → Forge runs `expo prebuild --platform ios`
- This generates the iOS Xcode project (you won't compile it on Windows; that happens on macOS CI)
- Or click **"Add iOS CI workflow"** to skip local generation and let GitHub Actions handle it

**If you see "Metaspace" warning:**
- Click **"Fix build memory"** → Forge adjusts Gradle JVM settings (one-time fix)

---

### Card 2: Prerequisites

**What it does:** Confirms your JDK and Android SDK are ready.

**Status indicators:**
- 🟢 Green = ready
- 🔴 Red = missing or incomplete

**If something is red:**
1. **No JDK?** Install Android Studio (bundles JDK) or download Temurin 17+
2. **No Android SDK?** Install Android Studio or run `sdkmanager install "build-tools;36.0.0" "platforms;android-37"`
3. **Incomplete SDK?** Click "Set Android SDK folder…" to point Forge at the right location

**Buttons:**
- **"Re-check"** — Scans again (in case you just installed something)
- **"Set JDK folder"** — Override auto-discovery (rarely needed)
- **"Set Android SDK folder"** — Override auto-discovery (rarely needed)

---

### Card 3: Signing Key

**What it does:** Manages the private key that signs your release builds.

#### If you already have a key (published apps)

1. Click **"Import .jks…"**
2. Select your keystore file (e.g., `upload-key.jks`)
3. Enter the **keystore password**
4. Click **"Read keystore"** → Forge displays:
   - SHA-1 fingerprint (compare against Google Play Console → Setup → App integrity → Upload key certificate)
   - Expiration date
   - All aliases (signing keys) in the file
5. Select the **alias** (usually just one)
6. Enter the **key password** (if different from keystore password; often the same)
7. Click **"Save keystore"**

✅ Your keystore password is now encrypted with Windows DPAPI and stored locally (never sent anywhere).

#### If you're building a brand-new app

1. Click **"Generate new…"**
2. Choose where to save the `.jks` file
3. Fill in:
   - **Alias:** Usually `upload` (the name of this signing key)
   - **Validity:** 10,950 days (30 years, fine)
   - **Common name:** Your name or app name
   - **Organization, City, Country:** Optional
   - **Keystore password & confirm:** Your choice (8+ characters recommended)
4. Click **"Generate"** → Forge creates the key using `keytool` (~5 sec)
5. Save the `.jks` file somewhere safe (external backup recommended)

⚠️ **Important:** If you already published an app on Play, generate a NEW key only if you're ready to publish under a NEW app listing. The same `packageId` cannot accept builds signed with different keys.

---

### Card 4: Build

**What it does:** Compiles your React Native project and signs the release artifact.

#### Before building

1. **Check your version**
   - Current version displays at the top (from `app.json` or `build.gradle`)
   - Use **"Bump build number"** to increment:
     - **Patch** (1.2.0 → 1.2.1)
     - **Minor** (1.2.0 → 1.3.0)
     - **Major** (1.2.0 → 2.0.0)
   - Version code auto-increments (each build gets a new code)

2. **Choose build target**
   - **App Bundle (.aab)** — for Google Play (required for new apps)
   - **APK (.apk)** — for direct install or older Play listings

3. **Optional: Skip crash-reporter uploads**
   - If your app uses Sentry, Crashlytics, or Datadog, those plugins often upload source maps during the build
   - This step fails without cloud auth tokens
   - Check **"Skip crash-reporter symbol uploads"** to disable (recommended for local builds)

#### Running the build

1. Make sure a keystore is selected (Card 3)
2. Click **"Build release"**
3. Watch the log stream in real-time (Gradle output, line by line)
4. Wait for **"BUILD SUCCESSFUL"** (typical: 1–3 minutes for warm cache)

✅ **Build complete** → Forge displays:
- Full path to the artifact (`.aab` or `.apk`)
- Size and build duration
- Button to open the containing folder in Explorer

#### If the build fails

- Check the log for errors (search for "ERROR" or "FAILED")
- Common issues:
  - **Sentry/Crashlytics upload fails** → Use the checkbox to skip uploads
  - **Metaspace error** → Click "Fix build memory" (Card 1) and rebuild
  - **Key password wrong** → Unlock the keystore again (Card 3, "Unlock" button)

#### Cleaning up

- Click **"Gradle clean"** to delete old build artifacts and cached dependencies (use if builds are cached weirdly)

---

### Card 5: Submit to Google Play

**What it does:** Uploads your signed `.aab` to Google Play Console.

#### First time: Set up service account

1. Go to **Google Play Console** → **Setup** → **API access**
2. Create a **Service account** (follow Google's wizard, takes ~2 min)
3. Generate a **JSON key** file and download it
4. In Forge, click **"Service account JSON…"** and select the file

✅ Forge now has permission to upload to your Play listing.

#### Uploading a build

1. Choose a **track** (where the build goes):
   - **Internal testing** — only you, live in minutes
   - **Closed testing (alpha)** — limited testers
   - **Open testing (beta)** — public beta
   - **Production** — live to all users

2. Optionally:
   - Check **"Upload as draft"** (upload but don't publish yet; you review in Play Console)
   - Add **release notes** (what changed in this build)

3. Click **"Upload latest .aab"**
4. Watch the log → success or error message

✅ Build is now on Play (or queued as draft if you checked that box).

**Next:** Go to Play Console to review, add screenshots, pricing, etc. before publishing to users.

---

### Card 6: iOS Build & TestFlight

**What it does:** Sets up iOS signing and triggers builds on a macOS GitHub Actions runner (no Mac required on Windows).

⚠️ **Important:** This requires:
- A GitHub repository (public or private)
- GitHub Actions enabled (free tier allows ~200 macOS minutes/month)
- An Apple Developer account

#### Step 1: Bundle Identifier

1. Enter your app's **bundle ID** (e.g., `com.company.appname`)
   - Must match what you register in Apple's portal
   - Forge stores it in `app.json` for future builds

2. Click **"Save"**

#### Step 2: Signing Certificate

This is the **unique part:** You create the signing certificate on Windows (no Mac needed).

1. Click **"Create request…"**
   - Forge opens a modal
   - Enter your name, Apple ID email, country code
   - Enter a certificate password (you'll paste this into GitHub later)
   - Click **"Create request"**

2. Forge creates:
   - A private key (stored encrypted locally)
   - A certificate request (`.csr` file) in a folder

3. You upload the `.csr` to Apple:
   - Go to **developer.apple.com** → **Certificates** → **+ Create**
   - Choose **"Apple Distribution"** (for App Store / TestFlight)
   - Upload the `.csr` file
   - Download the `.cer` file Apple gives back

4. Back in Forge, click **"Install Apple's .cer…"** and select the `.cer` file
   - Forge validates it matches your private key
   - Forge exports it as a `.p12` file (encrypted with your certificate password)

✅ Your certificate is now ready. Private key stays on your machine; Apple has the public half.

#### Step 3: Provisioning Profile

1. Go to **developer.apple.com** → **Profiles** → **+ Create**
   - Choose **"App Store Connect"** (for TestFlight)
   - Select your app ID and the certificate you just created
   - Download the `.mobileprovision` file

2. Back in Forge, click **"Select .mobileprovision…"** and choose the file

3. **Optional:** If you want Forge to automatically send builds to TestFlight:
   - Go to **App Store Connect** → **Users & Access** → **Keys**
   - Create an **"App Store Connect API Key"** (not App ID key)
   - Download the `.p8` file
   - In Forge, click **"App Store Connect key (.p8)…"** and select it

#### Step 4: GitHub Secrets

Forge generates secrets you need to paste into your GitHub repo settings (one time only).

1. Click **"Show values to copy"** → Forge displays:
   - `IOS_CERTIFICATE_PASSWORD` (the password you created in Step 2)
   - `IOS_PROFILE_DATA` (your provisioning profile, base64-encoded)
   - `IOS_CERTIFICATE_DATA` (your `.p12`, base64-encoded)
   - `ASC_KEY_ID` (optional, if you added the `.p8` in Step 3)
   - `ASC_KEY_DATA` (optional, the `.p8` key, base64-encoded)

2. Click **"Open the secrets page"** → GitHub opens in your browser
3. Add each secret:
   - Click **"New repository secret"**
   - Paste the name and value
   - Repeat for all secrets

✅ GitHub now has the credentials to sign and submit builds.

#### Step 5: Build on macOS

1. Enter your **GitHub token**:
   - Go to **github.com** → **Settings** → **Developer settings** → **Personal access tokens**
   - Create a token with **Actions: read/write**
   - Paste it in Forge and click **"Save"**

2. Choose a **git branch** (default: `main`) and **build config** (Release or Debug)

3. **Optional:** Check **"Send to TestFlight"** to automatically submit after the build

4. Click **"Build on macOS runner"**
   - Forge triggers a GitHub Actions workflow
   - Waits for the build to start on a rented macOS machine (~2–3 min)
   - Shows real-time status

5. Once the build completes:
   - Click **"Download .ipa"** to save the signed app to your machine
   - Or check your TestFlight app in App Store Connect to see the build

**Cost:** GitHub's free tier includes ~200 macOS minutes per month. Typical iOS build takes 5–8 minutes, so ~25–40 builds/month free.

---

## Troubleshooting

| Error | Solution |
|-------|----------|
| "No JDK found" | Install Android Studio or Temurin 17+. Point Forge at the folder. |
| "No Android SDK" | Install Android Studio or run `sdkmanager install "build-tools;36.0.0"`. |
| "Keystore password incorrect" | Recheck the password. If locked, click "Unlock" and re-enter. |
| "Certificate mismatch" | The `.cer` Apple gave back doesn't match your key. Regenerate the request (checkbox: "Replace the existing key"). |
| "GitHub Actions rate limit" | Free tier allows ~200 macOS minutes/month. Wait until next billing cycle or upgrade. |
| "@sentry/react-native build fails" | Check "Skip crash-reporter symbol uploads" before building. |
| "Version code already used" | Increment the version code (Card 4) and rebuild. Play won't accept duplicate codes. |

---

## Tips & Best Practices

**Android:**
- Always compare SHA-1 in Forge against Play Console before first upload
- Use "Prebuild (clean)" if you change Expo/RN version
- Android builds are fastest on second+ run (warm Gradle cache)

**iOS:**
- Test locally first: `npx expo prebuild --platform ios` to check for compile errors
- Certificate password is kept encrypted locally; GitHub never sees the raw private key
- TestFlight builds take 5–8 minutes on the macOS runner (normal; Xcode is slow)
- ASC key (`.p8`) is optional but enables TestFlight automation

**General:**
- Bump version after every release (prevents Play/App Store rejects)
- Keep your keystore `.jks` backed up offline
- Test on a device before submitting to stores
- Read release notes in Forge's log in case of warnings

---

## Support

**Errors?** Check the log (red text = warnings/errors).  
**Questions?** Email [your email] with:
- The error message
- What you were trying to do
- Your OS version + JDK version (visible in Forge prerequisites)

---

## Advanced

**Manual Gradle command:** If you want to build from the terminal instead of Forge's GUI:
```bash
cd android
./gradlew bundleRelease -DFORGE_STORE_FILE=/path/to/key.jks -DFORGE_STORE_PASSWORD=yourpass -DFORGE_KEY_ALIAS=upload -DFORGE_KEY_PASSWORD=yourpass
```

**Manual GitHub Actions:** If Forge's iOS workflow doesn't fit your needs, you can write your own in `.github/workflows/custom-ios-build.yml`.

---

**Happy building! 🚀**
