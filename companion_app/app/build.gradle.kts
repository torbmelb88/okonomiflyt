import java.time.Duration
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.google.services)
}

// API key lives in local.properties (not in VCS): ANTHROPIC_API_KEY=sk-ant-...
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

// Auto-versjonering: versionCode = minutter siden 2020-01-01 (stigende for hvert
// bygg), slik at Android nekter å installere en eldre APK over en nyere.
// versionName = byggtidspunktet, synlig i appens innstillinger.
val buildTime: ZonedDateTime = ZonedDateTime.now(ZoneId.of("Europe/Oslo"))
val autoVersionCode: Int = Duration.between(
    ZonedDateTime.of(2020, 1, 1, 0, 0, 0, 0, ZoneId.of("Europe/Oslo")),
    buildTime
).toMinutes().toInt()
val autoVersionName: String = buildTime.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))

android {
    namespace = "com.okonomiflyt.companion"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.okonomiflyt.companion"
        minSdk = 24
        targetSdk = 36
        versionCode = autoVersionCode
        versionName = autoVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField(
            "String",
            "ANTHROPIC_API_KEY",
            "\"${localProperties.getProperty("ANTHROPIC_API_KEY") ?: ""}\""
        )

        // Dedicated Firebase device account (Firestore rules only allow known
        // UIDs). Same pattern as the API key: values live in local.properties.
        buildConfigField(
            "String",
            "COMPANION_AUTH_EMAIL",
            "\"${localProperties.getProperty("COMPANION_AUTH_EMAIL") ?: ""}\""
        )
        buildConfigField(
            "String",
            "COMPANION_AUTH_PASSWORD",
            "\"${localProperties.getProperty("COMPANION_AUTH_PASSWORD") ?: ""}\""
        )
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.auth)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.okhttp)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.play.services.location)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}