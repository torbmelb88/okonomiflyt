package com.okonomiflyt.companion.receipts

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.okonomiflyt.companion.FirebaseService
import kotlinx.coroutines.tasks.await
import java.util.concurrent.TimeUnit

/**
 * Post-purchase receipt nudge: geofences around the household's regular
 * grocery stores. A DWELL transition (in the zone for a few minutes — filters
 * out drive-bys) schedules a delayed notification reminding to share the
 * receipt from the chain app. Used because Coopay purchases produce no
 * notification the listener could react to.
 */
object StoreGeofencing {

    private const val TAG = "StoreGeofencing"
    const val COOP_PACKAGE = "no.coop.medlem"
    private const val LOITERING_DELAY_MS = 4 * 60 * 1000 // in the zone this long = shopping

    /**
     * Registers geofences for all stores in Firestore (seeding the two
     * defaults on first run). Returns the number of active zones, or -1 when
     * permission is missing.
     */
    @SuppressLint("MissingPermission")
    suspend fun registerAll(context: Context): Int {
        if (!hasLocationPermission(context)) return -1

        val firebaseService = FirebaseService()
        val stores = firebaseService.getStoreLocations()
        if (stores.isEmpty()) return 0

        val geofences = stores.map { store ->
            Geofence.Builder()
                .setRequestId(store.name)
                .setCircularRegion(store.lat, store.lng, store.radiusMeters.toFloat())
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_DWELL)
                .setLoiteringDelay(LOITERING_DELAY_MS)
                .build()
        }
        val request = GeofencingRequest.Builder()
            .setInitialTrigger(0) // don't fire for zones we're already inside
            .addGeofences(geofences)
            .build()

        val pendingIntent = PendingIntent.getBroadcast(
            context, 0,
            Intent(context, GeofenceBroadcastReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )

        return try {
            val client = LocationServices.getGeofencingClient(context)
            client.addGeofences(request, pendingIntent).await()
            Log.d(TAG, "Registered ${geofences.size} geofences")
            geofences.size
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register geofences", e)
            0
        }
    }

    fun hasLocationPermission(context: Context): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val background = android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
        return fine && background
    }
}

/** Fires on geofence DWELL; schedules the delayed nudge notification. */
class GeofenceBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) {
            Log.e("StoreGeofencing", "Geofence error: ${event.errorCode}")
            return
        }
        if (event.geofenceTransition != Geofence.GEOFENCE_TRANSITION_DWELL) return

        event.triggeringGeofences?.forEach { geofence ->
            ReceiptNudgeWorker.schedule(context, geofence.requestId)
        }
    }
}

/** Re-registers geofences after reboot (they don't survive restarts). */
class GeofenceBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        WorkManager.getInstance(context).enqueue(
            OneTimeWorkRequestBuilder<RegisterGeofencesWorker>().build()
        )
    }
}

class RegisterGeofencesWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        StoreGeofencing.registerAll(applicationContext)
        return Result.success()
    }
}

/**
 * Posts the "share your receipt" notification ~20 min after the shopping
 * trip was detected, so the receipt has had time to appear in the chain app.
 */
class ReceiptNudgeWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val DELAY_MINUTES = 20L
        private const val DEDUPE_WINDOW_MS = 2 * 60 * 60 * 1000 // one nudge per store per 2h
        private const val PREFS = "receipt_nudge"

        fun schedule(context: Context, storeName: String) {
            val request = OneTimeWorkRequestBuilder<ReceiptNudgeWorker>()
                .setInitialDelay(DELAY_MINUTES, TimeUnit.MINUTES)
                .setInputData(Data.Builder().putString("store", storeName).build())
                .build()
            // KEEP: a second DWELL while one nudge is pending doesn't add another
            WorkManager.getInstance(context).enqueueUniqueWork(
                "receipt_nudge_$storeName",
                ExistingWorkPolicy.KEEP,
                request
            )
        }
    }

    override suspend fun doWork(): Result {
        val storeName = inputData.getString("store") ?: "butikken"

        // Belt-and-suspenders dedupe across work instances
        val prefs = applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val last = prefs.getLong(storeName, 0)
        val now = System.currentTimeMillis()
        if (now - last < DEDUPE_WINDOW_MS) return Result.success()
        prefs.edit().putLong(storeName, now).apply()

        // Tap opens the Coop app (where the receipt lives), fallback to our app
        val launchIntent = applicationContext.packageManager
            .getLaunchIntentForPackage(StoreGeofencing.COOP_PACKAGE)
            ?: Intent(applicationContext, com.okonomiflyt.companion.MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            applicationContext, storeName.hashCode(), launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(applicationContext, "okonomiflyt_channel")
            .setSmallIcon(android.R.drawable.ic_menu_agenda)
            .setContentTitle("Handlet du på $storeName?")
            .setContentText("Kvitteringen ligger nå i Coop-appen — del den til ØkonomiFlyt.")
            .setStyle(NotificationCompat.BigTextStyle().bigText(
                "Kvitteringen ligger nå i Coop-appen. Åpne den, trykk del-ikonet og send til ØkonomiFlyt — så logges varelinjene automatisk."
            ))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        val manager = applicationContext
            .getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(("nudge_$storeName").hashCode(), notification)
        return Result.success()
    }
}
