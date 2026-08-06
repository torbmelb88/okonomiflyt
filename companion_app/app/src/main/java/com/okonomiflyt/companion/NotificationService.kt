package com.okonomiflyt.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

class NotificationService : NotificationListenerService() {

    private val TAG = "NotificationService"
    private lateinit var csvManager: CsvManager

    override fun onCreate() {
        super.onCreate()
        csvManager = CsvManager(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "TEST_NOTIFICATION") {
            Log.d(TAG, "Test notification triggered manually")
            val merchant = intent.getStringExtra("test_merchant") ?: "Kiwi Testbutikk"
            val amount = intent.getStringExtra("test_amount") ?: "6677,00"
            val card = intent.getStringExtra("test_card") ?: "6819"
            promptForComment(merchant, amount, card)
        }
        return super.onStartCommand(intent, flags, startId)
    }

    private val processedNotifications = java.util.Collections.synchronizedMap(object : java.util.LinkedHashMap<String, Long>(20, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?): Boolean {
            return size > 20
        }
    })

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName
        val extras = sbn.notification.extras
        val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
        val text = extras.getString(Notification.EXTRA_TEXT) ?: ""

        // FILTER: Only care about Google Wallet
        // We removed "wallet" and "vipps" generic checks to avoid false positives from BankID etc.
        val isWallet = packageName == "com.google.android.apps.walletnfcrel"
        val hasMoney = title.contains("Beløp") || text.contains("kr") || text.matches(Regex(".*\\d+.*"))

        if (isWallet && hasMoney) {
            val currentTime = System.currentTimeMillis()
            // Key for deduplication: Title + Text + (approx time 5 sec window?)
            // Google Wallet updates the same notification often. 
            // We'll use title + text as uniqueness. If we saw this exact content recently (5s), skip.
            val contentKey = "$title|$text"
            val lastSeen = processedNotifications[contentKey]
            
            if (lastSeen != null && (currentTime - lastSeen < 5000)) {
                Log.d(TAG, "DUPLICATE: Skipping recently processed notification: $contentKey")
                return
            }

            Log.d(TAG, "MATCH! Processing wallet notification: $contentKey")
            // Update cache
            processedNotifications[contentKey] = currentTime
            
            // Extract Amount (Regex for "kr 123", "123 kr", "123.00", "123,00", "6 677,00")
            // Strategy: Remove spaces first to handle "6 677,00", then look for number.
            val amount = extractAmount(text) ?: extractAmount(title)
            
            if (amount != null) {
                // If we found an amount, likely a transaction.
                // Trigger our own "Ask for comment" notification
                
                // Allow card info update even if we saw it before?
                // The deduplication logic above prevents spamming the user.
                val cardInfo = extractCardInfo(text) ?: extractCardInfo(title) ?: ""
                promptForComment(title, amount, cardInfo)
            } else {
                 Log.d(TAG, "Could not extract amount from: $text")
            }
        }
    }

    private fun extractAmount(text: String): String? {
        // Remove spaces (thousand separators) and non-breaking spaces
        val cleanText = text.replace(" ", "").replace("\u00A0", "")
        
        // Regex for numbers with optional comma/dot decimals
        // Matches "123", "123.45", "123,45"
        val matcher = Pattern.compile("(\\d+[.,]?\\d*)").matcher(cleanText)
        if (matcher.find()) {
            return matcher.group(1)
        }
        return null
    }

    private fun extractCardInfo(text: String): String? {
        // Matches "•••• 1234", "••1234", "Visa 1234", "*** 1234"
        // Key fix: Allow 2 to 4 dots/bullets
        val matcher = Pattern.compile("(?:\\*{2,4}|•{2,4})\\s*(\\d{4})").matcher(text)
        if (matcher.find()) {
            return matcher.group(1)
        }
        return null
    }

    private fun promptForComment(merchant: String, amount: String, cardInfo: String) {
        val notificationId = System.currentTimeMillis().toInt()
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
        // Remember the trigger locally so a dismissed logging flow can be
        // reopened from the home screen ("Siste kjøp").
        val triggerId = TriggerHistory.record(this, merchant, amount, cardInfo, today)

        val intent = Intent(this, com.okonomiflyt.companion.ui.LogTransactionActivity::class.java).apply {
            putExtra("merchant", merchant)
            putExtra("amount", amount)
            putExtra("card", cardInfo)
            putExtra("date", today)
            putExtra("triggerId", triggerId)
            putExtra("notificationId", notificationId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        
        val pendingIntent = PendingIntent.getActivity(
            this,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        val contentText = if (cardInfo.isNotEmpty()) "Beløp: $amount. Kort: •••• $cardInfo" else "Beløp: $amount"

        val action = NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_edit,
            "Kategoriser kjøpet",
            pendingIntent
        ).build()

        val notification = NotificationCompat.Builder(this, "okonomiflyt_channel")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setContentTitle("Nytt kjøp: $merchant")
            .setContentText(contentText)
            .addAction(action)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(notificationId, notification)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Transactions"
            val descriptionText = "Transaction logging"
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel("okonomiflyt_channel", name, importance).apply {
                description = descriptionText
            }
            val notificationManager: NotificationManager =
                getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }
}
