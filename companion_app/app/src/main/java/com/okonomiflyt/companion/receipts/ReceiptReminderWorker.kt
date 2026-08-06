package com.okonomiflyt.companion.receipts

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.okonomiflyt.companion.MainActivity
import java.util.concurrent.TimeUnit

/**
 * Posts a weekly reminder to share receipts from the grocery chain apps
 * (currently Coop) into the companion app.
 */
class ReceiptReminderWorker(
    context: Context,
    params: WorkerParameters
) : Worker(context, params) {

    companion object {
        private const val WORK_NAME = "receipt_reminder"
        private const val NOTIFICATION_ID = 991199

        /** Idempotent — safe to call on every app start. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<ReceiptReminderWorker>(7, TimeUnit.DAYS)
                .setInitialDelay(7, TimeUnit.DAYS)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }
    }

    override fun doWork(): Result {
        // Ensure the channel exists even if the notification listener service
        // hasn't been bound yet (it normally creates this channel)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            val channel = android.app.NotificationChannel(
                "okonomiflyt_channel", "Transactions", NotificationManager.IMPORTANCE_HIGH
            )
            (applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }

        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Channel "okonomiflyt_channel" is created by NotificationService on app start
        val notification = NotificationCompat.Builder(applicationContext, "okonomiflyt_channel")
            .setSmallIcon(android.R.drawable.ic_menu_agenda)
            .setContentTitle("Kvitteringstid!")
            .setContentText("Har du handlet denne uken? Del kvitteringene fra Coop-appen til ØkonomiFlyt.")
            .setStyle(
                NotificationCompat.BigTextStyle().bigText(
                    "Har du handlet denne uken? Åpne Coop-appen, finn kvitteringene og del dem til ØkonomiFlyt — så logges varelinjene automatisk."
                )
            )
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        val manager =
            applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
        return Result.success()
    }
}
