package mr.elourwa.parent

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import android.content.ContentValues
import android.os.Environment
import android.provider.MediaStore
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * LE CANAL « elourwa » — créé ICI, pas seulement nommé dans le manifeste.
 *
 * Android 8+ ne sonne et ne vibre que pour un canal que l'application a créé
 * avec cette importance et ce son ; nommer un canal dans le manifeste sans le
 * créer laissait Firebase ranger les notifications dans « Divers », muettes.
 * Le son est le nôtre (res/raw/elourwa_notif), la vibration un motif court et
 * net — comme WhatsApp, un parent doit savoir sans regarder qu'il vient de
 * recevoir quelque chose. Les réglages d'un canal sont figés à sa création :
 * pour en changer, changer l'identifiant (et le manifeste, et le serveur).
 */
class MainActivity : FlutterActivity() {
    companion object {
        const val CANAL = "elourwa_v2"
        private val VIBRATION = longArrayOf(0, 250, 120, 250)
    }

    private fun sonUri(): Uri = Uri.parse("android.resource://$packageName/raw/elourwa_notif")

    private fun nomApplication(): String = applicationInfo.loadLabel(packageManager).toString()

    private fun creerCanal() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // L'ancien canal (sans son propre) disparaît : deux canaux « El Ourwa »
        // dans les réglages du téléphone seraient une question sans réponse.
        try { manager.deleteNotificationChannel("elourwa") } catch (_: Throwable) {}
        // Le nom du canal est celui de l'application (`android:label`), quelle que soit l'enseigne.
        val canal = NotificationChannel(CANAL, nomApplication(), NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Notes, absences, exercices, messages et paiements"
            enableVibration(true)
            vibrationPattern = VIBRATION
            enableLights(true)
            setShowBadge(true)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            setSound(
                sonUri(),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
        }
        manager.createNotificationChannel(canal)
    }

    private fun vibrer() {
        val v: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        if (v == null || !v.hasVibrator()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createWaveform(VIBRATION, -1))
        } else {
            @Suppress("DEPRECATION")
            v.vibrate(VIBRATION, -1)
        }
    }

    /** Une notification locale (application ouverte) : le même canal, donc le même son. */
    private fun afficher(titre: String, corps: String, id: Int) {
        val ouvrir = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // Comme Snapchat : la notification SURGIT (heads-up) avec son texte,
        // le texte défile dans la barre d'état (ticker), l'icône est le glyphe
        // monochrome teinté aux couleurs de l'école, la grande icône celle de
        // l'application.
        val grande = try {
            android.graphics.BitmapFactory.decodeResource(resources, applicationInfo.icon)
        } catch (_: Throwable) { null }
        val n = NotificationCompat.Builder(this, CANAL)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(0xFF0891B2.toInt())
            .setLargeIcon(grande)
            .setContentTitle(titre)
            .setContentText(corps)
            .setTicker("$titre — $corps")
            .setStyle(NotificationCompat.BigTextStyle().bigText(corps))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_LIGHTS)
            .setSound(sonUri())
            .setVibrate(VIBRATION)
            .setAutoCancel(true)
            .setShowWhen(true)
            .setContentIntent(ouvrir)
            .build()
        try {
            NotificationManagerCompat.from(this).notify(id, n)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS refusée (Android 13+) : rien à afficher ; le
            // badge dans l'application reste.
        }
    }

    /**
     * DÉPOSER UN DOCUMENT DANS « TÉLÉCHARGEMENTS » ET L'OUVRIR (Android 10+).
     *
     * « The bulletins is not downloadable » (23/09/2026). Le MediaStore écrit
     * dans le dossier Téléchargements du téléphone sans aucune permission de
     * stockage (le manifeste garde ses deux permissions), puis le lecteur PDF
     * du téléphone l'ouvre. Avant Android 10, Dart écrit dans le cache et
     * ouvre par open_filex. Rend "telechargements", ou lève.
     */
    private fun enregistrerTelechargement(nom: String, mime: String, octets: ByteArray): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw IllegalStateException("MediaStore.Downloads exige Android 10")
        val resolver = contentResolver
        val valeurs = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, nom)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valeurs)
            ?: throw IllegalStateException("insertion refusée")
        resolver.openOutputStream(uri)?.use { it.write(octets) } ?: throw IllegalStateException("flux absent")
        valeurs.clear()
        valeurs.put(MediaStore.MediaColumns.IS_PENDING, 0)
        resolver.update(uri, valeurs, null, null)
        val ouvrir = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mime)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivity(Intent.createChooser(ouvrir, nom).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Throwable) {
            // Aucun lecteur : le fichier est tout de même dans Téléchargements.
        }
        return "telechargements"
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        creerCanal()
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "mr.elourwa.parent/notifs")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "afficher" -> {
                        afficher(
                            call.argument<String>("titre") ?: nomApplication(),
                            call.argument<String>("corps") ?: "",
                            call.argument<Int>("id") ?: 1,
                        )
                        vibrer()
                        result.success(null)
                    }
                    "enregistrerTelechargement" -> {
                        try {
                            result.success(
                                enregistrerTelechargement(
                                    call.argument<String>("nom") ?: "document.pdf",
                                    call.argument<String>("mime") ?: "application/pdf",
                                    call.argument<ByteArray>("octets") ?: ByteArray(0),
                                ),
                            )
                        } catch (e: Throwable) {
                            result.error("telechargement", e.message, null)
                        }
                    }
                    "vibrer" -> {
                        vibrer()
                        result.success(null)
                    }
                    // Android 13+ : sans POST_NOTIFICATIONS rien ne s'affiche ni ne sonne.
                    // Demandé à l'ouverture de l'application (main.dart), Firebase ou pas.
                    "demanderPermission" -> {
                        if (Build.VERSION.SDK_INT >= 33 &&
                            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
                                android.content.pm.PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 4242)
                            result.success("demandee")
                        } else {
                            result.success("accordee")
                        }
                    }
                    "permissionAccordee" -> {
                        result.success(
                            Build.VERSION.SDK_INT < 33 ||
                                checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
                                    android.content.pm.PackageManager.PERMISSION_GRANTED,
                        )
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
