package com.okonomiflyt.companion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class TriggerEvent(
    val id: Long,
    val merchant: String,
    val amount: String,
    val card: String,
    val date: String,      // YYYY-MM-DD, the day the payment was captured
    val timestamp: Long,   // epoch millis of the trigger
    val saved: Boolean,    // true once the transaction was logged to Firestore
    val currency: String,  // ISO code for foreign purchases ("SEK"); empty = NOK
)

/**
 * Local memory of the payment notifications the app has reacted to, so an
 * accidentally dismissed logging flow can be reopened from the home screen.
 * Newest first, capped — stored as a small JSON array in SharedPreferences.
 */
object TriggerHistory {
    private const val PREFS = "trigger_history"
    private const val KEY = "events"
    private const val MAX = 10

    fun record(context: Context, merchant: String, amount: String, card: String, date: String, currency: String = ""): Long {
        val id = System.currentTimeMillis()
        val events = load(context).toMutableList()
        events.add(0, TriggerEvent(id, merchant, amount, card, date, id, saved = false, currency = currency))
        store(context, events.take(MAX))
        return id
    }

    fun markSaved(context: Context, id: Long) {
        store(context, load(context).map { if (it.id == id) it.copy(saved = true) else it })
    }

    fun remove(context: Context, id: Long) {
        store(context, load(context).filter { it.id != id })
    }

    fun list(context: Context): List<TriggerEvent> = load(context)

    private fun load(context: Context): List<TriggerEvent> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
            ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                TriggerEvent(
                    id = o.getLong("id"),
                    merchant = o.optString("merchant", "Ukjent"),
                    amount = o.optString("amount", "0"),
                    card = o.optString("card", ""),
                    date = o.optString("date", ""),
                    timestamp = o.optLong("timestamp", o.getLong("id")),
                    saved = o.optBoolean("saved", false),
                    currency = o.optString("currency", ""),
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun store(context: Context, events: List<TriggerEvent>) {
        val arr = JSONArray()
        for (e in events) {
            arr.put(JSONObject().apply {
                put("id", e.id)
                put("merchant", e.merchant)
                put("amount", e.amount)
                put("card", e.card)
                put("date", e.date)
                put("timestamp", e.timestamp)
                put("saved", e.saved)
                put("currency", e.currency)
            })
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, arr.toString()).apply()
    }
}
