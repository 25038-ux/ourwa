# WebView JavaScript bridge (FORSA Android shell)
-keepclassmembers class mr.forsa.app.WebAppActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
