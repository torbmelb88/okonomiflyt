package com.okonomiflyt.companion

import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ReplyReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val remoteInput = RemoteInput.getResultsFromIntent(intent) ?: return
        val comment = remoteInput.getCharSequence("key_text_reply")?.toString() ?: ""
        val merchant = intent.getStringExtra("merchant") ?: "Ukjent"
        val amount = intent.getStringExtra("amount") ?: "0"
        val card = intent.getStringExtra("card") ?: ""

        val csvManager = CsvManager(context)
        val date = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date())

        csvManager.logTransaction(date, merchant, amount, card, comment)

        // Feedback to user: Update notification to show it was saved
        val notificationId = intent.getIntExtra("notificationId", -1)
        if (notificationId != -1) {
            val repliedNotification = androidx.core.app.NotificationCompat.Builder(context, "okonomiflyt_channel")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Transaksjon lagret! \u2705") // Checkmark
                .setContentText("$merchant: $amount ($comment)")
                .setTimeoutAfter(3000) // Auto-cancel after 3 seconds
                .build()

            try {
                NotificationManagerCompat.from(context).notify(notificationId, repliedNotification)
            } catch (e: SecurityException) {
                // If we lost permission (unlikely), fallback to toast
                e.printStackTrace()
            }
        }
        
        // Toast as backup
        Toast.makeText(context, "Logget: $merchant", Toast.LENGTH_SHORT).show()
    }
}
