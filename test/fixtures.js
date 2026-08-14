'use strict';

/** Shape of android/app/build.gradle as produced by `expo prebuild` (SDK 54 / RN 0.81). */
const EXPO_APP_BUILD_GRADLE = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()

react {
    entryFile = file(["node", "-e", "require('expo/scripts/resolveAppEntry')", projectRoot, "android", "absolute"].execute(null, rootDir).text.trim())
    reactNativeDir = new File(["node", "--print", "require.resolve('react-native/package.json')"].execute(null, rootDir).text.trim()).getParentFile().getAbsoluteFile()
    hermesCommand = new File(["node", "--print", "require.resolve('react-native/package.json')"].execute(null, rootDir).text.trim()).getParentFile().getAbsolutePath() + "/sdks/hermesc/%OS-BIN%/hermesc"
    autolinkLibrariesWithApp()
}

def enableProguardInReleaseBuilds = (findProperty('android.enableProguardInReleaseBuilds') ?: false).toBoolean()
def jscFlavor = 'org.webkit:android-jsc:+'

android {
    ndkVersion rootProject.ext.ndkVersion
    buildToolsVersion rootProject.ext.buildToolsVersion
    compileSdk rootProject.ext.compileSdkVersion

    namespace 'com.evanevoo.scanifiedandroid'
    defaultConfig {
        applicationId 'com.evanevoo.scanifiedandroid'
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            shrinkResources (findProperty('android.enableShrinkResourcesInReleaseBuilds')?.toBoolean() ?: false)
            minifyEnabled enableProguardInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
            crunchPngs (findProperty('android.enablePngCrunchInReleaseBuilds')?.toBoolean() ?: true)
        }
    }
    packagingOptions {
        jniLibs {
            useLegacyPackaging (findProperty('expo.useLegacyPackaging')?.toBoolean() ?: false)
        }
    }
}

dependencies {
    implementation("com.facebook.react:react-android")
    def isGifEnabled = (findProperty('expo.gif.enabled') ?: "") == "true";
    if (isGifEnabled) {
        implementation("com.facebook.fresco:animated-gif:\${expoLibs.versions.fresco.get()}")
    }
}
`;

/** A project with no signingConfigs block at all, and no release signingConfig. */
const BARE_APP_BUILD_GRADLE = `apply plugin: "com.android.application"

android {
    namespace "com.example.bare"
    defaultConfig {
        applicationId "com.example.bare"
        versionCode 1
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
    }
}
`;

/** Braces hiding inside strings and comments, to exercise the scanner. */
const TRICKY_APP_BUILD_GRADLE = `android {
    // a comment with a brace {
    defaultConfig {
        applicationId "com.example.tricky"
        resValue "string", "weird", "a { b } c"
    }
    /* block comment }
       still a comment { */
    buildTypes {
        release {
            buildConfigField "String", "X", "\\"{\\""
        }
    }
}
`;

module.exports = { EXPO_APP_BUILD_GRADLE, BARE_APP_BUILD_GRADLE, TRICKY_APP_BUILD_GRADLE };
