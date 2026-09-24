package mr.forsa.app

import android.content.Context
import android.net.Uri

/** The FORSA server this app talks to. Set once at first launch (or baked in with -PforsaUrl). */
object Prefs {
    private const val FILE = "forsa"
    private const val KEY_SERVER = "server_url"

    fun server(context: Context): String? {
        val saved = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY_SERVER, null)
        return saved ?: BuildConfig.DEFAULT_SERVER.takeIf { it.isNotBlank() }
    }

    fun setServer(context: Context, url: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY_SERVER, url).apply()
    }

    /** Normalises user input to "https://host[:port]" (http allowed only in debug builds). */
    fun normalise(input: String): String? {
        var text = input.trim().trimEnd('/')
        if (text.isEmpty()) return null
        if (!text.startsWith("http://") && !text.startsWith("https://")) text = "https://$text"
        val uri = Uri.parse(text)
        if (uri.host.isNullOrBlank()) return null
        if (uri.scheme == "http" && !BuildConfig.DEBUG) return null
        return "${uri.scheme}://${uri.host}${if (uri.port > 0) ":${uri.port}" else ""}"
    }
}
