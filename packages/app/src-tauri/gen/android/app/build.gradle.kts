import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Read signing config from `<repo>/secrets/keystore.properties` (local dev) or env vars (CI).
// File takes precedence; CI sets ANDROID_KEYSTORE_PATH/PASSWORD/KEY_ALIAS/KEY_PASSWORD.
val ksFile = rootProject.file("../../../../../secrets/keystore.properties")
val keystoreProperties = Properties().apply {
    if (ksFile.exists()) {
        ksFile.inputStream().use { load(it) }
    }
}
fun signingProp(fileKey: String, envKey: String): String? =
    keystoreProperties.getProperty(fileKey)?.takeIf { it.isNotBlank() }
        ?: System.getenv(envKey)?.takeIf { it.isNotBlank() }

android {
    compileSdk = 36
    namespace = "com.sbot.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "true"
        applicationId = "com.sbot.app"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        create("release") {
            val storeFilePath = signingProp("storeFile", "ANDROID_KEYSTORE_PATH")
            if (!storeFilePath.isNullOrBlank()) {
                // File-based path resolves relative to keystore.properties; env-based path is absolute.
                storeFile = if (keystoreProperties.getProperty("storeFile").isNullOrBlank())
                    file(storeFilePath)
                else
                    ksFile.parentFile.resolve(storeFilePath)
                storePassword = signingProp("storePassword", "ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingProp("keyAlias", "ANDROID_KEY_ALIAS")
                keyPassword = signingProp("keyPassword", "ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null) {
                signingConfig = releaseSigning
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
