package mr.forsa.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * WebView shell used when no Trusted-Web-Activity browser is available. Keeps the web app's experience:
 * microphone for dictation, file uploads, .ics downloads, pull-to-refresh, offline screen, native back gesture.
 */
class WebAppActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var refresh: SwipeRefreshLayout
    private lateinit var progress: ProgressBar
    private lateinit var offline: View
    private var server: Uri = Uri.EMPTY
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray())
        fileCallback = null
    }

    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val request = pendingPermission ?: return@registerForActivityResult
        if (granted) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            request.deny()
            Toast.makeText(this, R.string.mic_denied, Toast.LENGTH_LONG).show()
        }
        pendingPermission = null
    }

    /** Minimal bridge so the web app can detect the shell and use native haptics. */
    inner class Bridge {
        @JavascriptInterface
        fun isShell(): Boolean = true

        @JavascriptInterface
        fun haptic(ms: Int) {
            runOnUiThread { web.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP) }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        server = Uri.parse(Prefs.server(this) ?: run { startActivity(Intent(this, SetupActivity::class.java)); finish(); return })

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.userAgentString = "${settings.userAgentString} FORSA-Android/${BuildConfig.VERSION_NAME}"
            isVerticalScrollBarEnabled = false
            addJavascriptInterface(Bridge(), "ForsaAndroid")
            webViewClient = Client()
            webChromeClient = Chrome()
            setDownloadListener { url, userAgent, disposition, mime, _ -> download(url, userAgent, disposition, mime) }
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)

        refresh = SwipeRefreshLayout(this).apply {
            setColorSchemeColors(ContextCompat.getColor(context, R.color.forsa_accent))
            addView(web, MATCH_PARENT, MATCH_PARENT)
            setOnChildScrollUpCallback { _, _ -> web.scrollY > 0 }
            setOnRefreshListener { web.reload() }
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progressTintList = android.content.res.ColorStateList.valueOf(ContextCompat.getColor(context, R.color.forsa_accent))
        }
        offline = offlineView()

        setContentView(FrameLayout(this).apply {
            addView(refresh, MATCH_PARENT, MATCH_PARENT)
            addView(progress, FrameLayout.LayoutParams(MATCH_PARENT, 6, Gravity.TOP))
            addView(offline, MATCH_PARENT, MATCH_PARENT)
        })

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl((intent?.data ?: server).toString())
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.takeIf { it.host == server.host }?.let { web.loadUrl(it.toString()) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    private fun offlineView(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(ContextCompat.getColor(context, R.color.forsa_bg))
        setPadding(64, 64, 64, 64)
        visibility = View.GONE
        addView(TextView(context).apply {
            text = getString(R.string.offline_title)
            textSize = 24f
            setTextColor(ContextCompat.getColor(context, R.color.forsa_ink))
            gravity = Gravity.CENTER
        })
        addView(TextView(context).apply {
            text = getString(R.string.offline_body)
            textSize = 15f
            setTextColor(ContextCompat.getColor(context, R.color.forsa_muted))
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 32)
        })
        addView(Button(context).apply {
            text = getString(R.string.retry)
            setOnClickListener {
                this@apply.isEnabled = true
                offline.visibility = View.GONE
                web.reload()
            }
        }, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
    }

    private fun download(url: String, userAgent: String, disposition: String?, mime: String?) {
        val uri = Uri.parse(url)
        if (uri.host != server.host) return openExternal(uri)
        val name = URLUtil.guessFileName(url, disposition, mime)
        val request = DownloadManager.Request(uri)
            .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
            .addRequestHeader("User-Agent", userAgent)
            .setMimeType(mime)
            .setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        getSystemService(DownloadManager::class.java).enqueue(request)
        Toast.makeText(this, R.string.download_started, Toast.LENGTH_SHORT).show()
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            // no app can open it: ignore
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (uri.host == server.host && uri.scheme == server.scheme) return false
            openExternal(uri) // WhatsApp share, official notices, e-mail… open in their own apps
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            progress.visibility = View.VISIBLE
        }

        override fun onPageFinished(view: WebView, url: String?) {
            refresh.isRefreshing = false
            progress.visibility = View.GONE
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                refresh.isRefreshing = false
                offline.visibility = View.VISIBLE
            }
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progress.progress = newProgress
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            val wantsMic = PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources
            if (!wantsMic || request.origin.host != server.host) return request.deny()
            if (ContextCompat.checkSelfPermission(this@WebAppActivity, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
            ) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            } else {
                pendingPermission = request
                askMic.launch(Manifest.permission.RECORD_AUDIO)
            }
        }

        override fun onShowFileChooser(
            webView: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val type = params.acceptTypes.firstOrNull { it.isNotBlank() }?.let { if (it.startsWith(".")) "*/*" else it } ?: "*/*"
            pickFiles.launch(type)
            return true
        }
    }
}
