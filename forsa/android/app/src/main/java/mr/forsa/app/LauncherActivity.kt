package mr.forsa.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.google.androidbrowserhelper.trusted.TwaLauncher

/**
 * Entry point. FORSA is a PWA: the best Android experience is a Trusted Web Activity (Chrome renders the web app
 * full-screen with Web Push, voice dictation and uploads). If no TWA-capable browser is installed, the app falls back
 * to its own WebView shell ([WebAppActivity]).
 */
class LauncherActivity : ComponentActivity() {
    private var launcher: TwaLauncher? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        val server = Prefs.server(this)
        if (server == null) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
        val target = intent?.data?.takeIf { it.host == Uri.parse(server).host } ?: Uri.parse("$server/?source=android")
        val colors = CustomTabColorSchemeParams.Builder()
            .setToolbarColor(ContextCompat.getColor(this, R.color.forsa_bg))
            .setNavigationBarColor(ContextCompat.getColor(this, R.color.forsa_bg))
            .build()
        val builder = TrustedWebActivityIntentBuilder(target).setDefaultColorSchemeParams(colors)
        launcher = TwaLauncher(this).also {
            it.launch(builder, null, null, { finish() }) { context, twaBuilder, _, completion ->
                context.startActivity(
                    Intent(context, WebAppActivity::class.java).setData(twaBuilder.uri)
                )
                completion?.run()
            }
        }
    }

    override fun onDestroy() {
        launcher?.destroy()
        super.onDestroy()
    }
}
