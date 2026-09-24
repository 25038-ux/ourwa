pluginManagement {
    repositories {
        google()
        // Google's official mirror of Maven Central first (Central itself may rate-limit CI/sandboxes).
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        // Google's official mirror of Maven Central first (Central itself may rate-limit CI/sandboxes).
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
        mavenCentral()
    }
}
rootProject.name = "FORSA"
include(":app")
