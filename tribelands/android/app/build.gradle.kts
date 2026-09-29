plugins {
    id("com.android.application")
}

// The version follows the pull request number, like the one in the game's Settings.
val gameVersion = Regex("const VERSION = 'v(\\d+)'")
    .find(rootDir.resolve("../src/core.js").readText())!!.groupValues[1].toInt()

android {
    namespace = "com.tempshantaram.tribelands"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tempshantaram.tribelands"
        minSdk = 26
        targetSdk = 34
        versionCode = gameVersion
        versionName = "v$gameVersion"
    }

    // One fixed key, so every new APK installs over the last and keeps your saved game.
    signingConfigs {
        create("tribelands") {
            storeFile = file("tribelands.keystore")
            storePassword = "tribelands"
            keyAlias = "tribelands"
            keyPassword = "tribelands"
        }
    }

    buildTypes {
        debug { signingConfig = signingConfigs.getByName("tribelands") }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("tribelands")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("game"))
}

// The game itself is the one built index.html, copied in at build time.
val copyGame by tasks.registering(Copy::class) {
    from(rootDir.resolve("../index.html"))
    into(layout.buildDirectory.dir("game"))
}
tasks.named("preBuild") { dependsOn(copyGame) }
