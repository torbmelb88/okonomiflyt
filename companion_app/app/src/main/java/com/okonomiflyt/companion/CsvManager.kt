package com.okonomiflyt.companion

import android.content.Context
import android.os.Environment
import android.util.Log
import java.io.File
import java.io.FileWriter
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class CsvManager(private val context: Context) {

    private val fileName = "transactions.csv"

    fun logTransaction(date: String, merchant: String, amount: String, card: String, comment: String) {
        val file = getFile()
        val isNew = !file.exists()

        try {
            val writer = FileWriter(file, true)
            if (isNew) {
                writer.append("Date,Merchant,Amount,Card,Comment\n")
            }
            // Simple CSV escaping: quote fields if they contain comma
            val line = "${escape(date)},${escape(merchant)},${escape(amount)},${escape(card)},${escape(comment)}\n"
            writer.append(line)
            writer.flush()
            writer.close()
            Log.d("CsvManager", "Logged: $line")
        } catch (e: IOException) {
            Log.e("CsvManager", "Error writing CSV", e)
        }
    }

    fun getFile(): File {
        // Use internal storage or scoped external storage
        val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
        if (!dir!!.exists()) {
            dir.mkdirs()
        }
        return File(dir, fileName)
    }

    fun readTransactions(): List<Transaction> {
        val file = getFile()
        if (!file.exists()) return emptyList()

        val transactions = mutableListOf<Transaction>()
        try {
            file.forEachLine { line ->
                if (!line.startsWith("Date")) { // Skip header
                    val parts = line.split(",(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)".toRegex())
                    // Handle migration: if we read old format (4 columns), card is empty
                    if (parts.size >= 3) {
                        val date = unescape(parts[0])
                        val merchant = unescape(parts[1])
                        val amount = unescape(parts[2])
                        var card = ""
                        var comment = ""
                        
                        if (parts.size >= 5) {
                            // New format: Date, Merchant, Amount, Card, Comment
                            card = unescape(parts[3])
                            comment = unescape(parts[4])
                        } else if (parts.size == 4) {
                            // Old format: Date, Merchant, Amount, Comment
                            // OR Intermediate format? Assuming Card column is missing
                            comment = unescape(parts[3])
                        }
                        
                        transactions.add(Transaction(date, merchant, amount, card, comment))
                    }
                }
            }
        } catch (e: IOException) {
            Log.e("CsvManager", "Error reading CSV", e)
        }
        // Return reversed to show newest first
        return transactions.asReversed()
    }

    fun overwriteCsv(transactions: List<Transaction>) {
        val file = getFile()
        try {
            val writer = FileWriter(file, false) // false = overwrite
            writer.append("Date,Merchant,Amount,Card,Comment\n")
            
            // The list passed in is likely Newest-First (UI order).
            // We want to write Chronologically (Oldest-First) so new appends make sense.
            // So we reverse it back.
            val chronological = transactions.asReversed()
            
            for (t in chronological) {
                val line = "${escape(t.date)},${escape(t.merchant)},${escape(t.amount)},${escape(t.card)},${escape(t.comment)}\n"
                writer.append(line)
            }
            writer.flush()
            writer.close()
        } catch (e: IOException) {
            Log.e("CsvManager", "Error overwriting CSV", e)
        }
    }

    fun createTempExportFile(transactions: List<Transaction>): File {
        val dir = context.cacheDir
        val file = File(dir, "export_transactions.csv")
        try {
            val writer = FileWriter(file, false) // Overwrite temp file
            writer.append("Date,Merchant,Amount,Card,Comment\n")
            
            // Export in chronological order (oldest first) usually better for accounting
            val chronological = transactions.asReversed()
            
            for (t in chronological) {
                val line = "${escape(t.date)},${escape(t.merchant)},${escape("-${t.amount}")},${escape(t.card)},${escape(t.comment)}\n"
                writer.append(line)
            }
            writer.flush()
            writer.close()
        } catch (e: IOException) {
            Log.e("CsvManager", "Error creating temp export CSV", e)
        }
        return file
    }

    private fun escape(value: String): String {
        var result = value
        if (result.contains(",") || result.contains("\"") || result.contains("\n")) {
            result = result.replace("\"", "\"\"")
            result = "\"$result\""
        }
        return result
    }

    private fun unescape(value: String): String {
        var result = value.trim()
        if (result.startsWith("\"") && result.endsWith("\"")) {
            result = result.substring(1, result.length - 1)
            result = result.replace("\"\"", "\"")
        }
        return result
    }
}

data class Transaction(
    val date: String,
    val merchant: String,
    val amount: String,
    val card: String,
    val comment: String
)
