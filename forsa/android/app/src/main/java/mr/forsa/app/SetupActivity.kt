package mr.forsa.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.ComponentActivity
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** First launch: which FORSA server? Verified by reading its web-app manifest before saving. */
class SetupActivity : ComponentActivity() {
    private val io = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = getColor(R.color.forsa_deep)
        window.navigationBarColor = getColor(R.color.forsa_deep)
        window.decorView.systemUiVisibility = 0
        setContentView(R.layout.activity_setup)
        val input = findViewById<EditText>(R.id.server)
        val error = findViewById<TextView>(R.id.error)
        val go = findViewById<Button>(R.id.go)
        Prefs.server(this)?.let { input.setText(it) }

        // Entrance motion: logo pops, text rises.
        listOf(R.id.logo, R.id.title, R.id.subtitle, R.id.server, R.id.go).forEachIndexed { i, id ->
            findViewById<View>(id).apply {
                alpha = 0f
                translationY = 40f
                animate().alpha(1f).translationY(0f).setStartDelay(80L * i).setDuration(520)
                    .setInterpolator(android.view.animation.PathInterpolator(0.22f, 1f, 0.36f, 1f)).start()
            }
        }

        fun submit() {
            val url = Prefs.normalise(input.text.toString())
            if (url == null) {
                error.text = getString(R.string.setup_invalid)
                error.visibility = View.VISIBLE
                return
            }
            go.isEnabled = false
            go.text = getString(R.string.setup_checking)
            error.visibility = View.GONE
            io.execute {
                val ok = isForsa(url)
                runOnUiThread {
                    go.isEnabled = true
                    go.text = getString(R.string.setup_continue)
                    if (ok) {
                        Prefs.setServer(this, url)
                        startActivity(Intent(this, LauncherActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
                        finish()
                    } else {
                        error.text = getString(R.string.setup_unreachable)
                        error.visibility = View.VISIBLE
                        error.animate().translationX(12f).setDuration(60).withEndAction {
                            error.animate().translationX(0f).setDuration(120).start()
                        }.start()
                    }
                }
            }
        }
        go.setOnClickListener { submit() }
        input.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_GO) submit()
            true
        }
    }

    private fun isForsa(url: String): Boolean = try {
        val conn = URL("$url/manifest.webmanifest").openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        conn.instanceFollowRedirects = true
        val body = conn.inputStream.bufferedReader().use { it.readText().take(4000) }
        conn.responseCode == 200 && body.contains("FORSA")
    } catch (e: Exception) {
        false
    }

    override fun onDestroy() {
        io.shutdown()
        super.onDestroy()
    }
}
