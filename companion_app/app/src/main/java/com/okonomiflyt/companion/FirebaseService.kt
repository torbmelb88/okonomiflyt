package com.okonomiflyt.companion

import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.okonomiflyt.companion.receipts.ParsedReceipt
import com.okonomiflyt.companion.receipts.TransactionMatch
import kotlinx.coroutines.tasks.await
import kotlin.math.abs

data class Budget(
    val id: String,
    val name: String,
    val type: String
)

// A library budget-item definition (budgetItemDefs). The per-budget instance
// (an `expenses` doc with defId) is materialized lazily when a transaction is
// logged against it.
data class BudgetItem(
    val id: String,            // budgetItemDef id
    val name: String,
    val categoryId: String?,
    val categoryName: String,
    val scope: String          // "shared" | "private" | "both"
)

// Accounts are global; the chosen budget is stored as defaultBudgetId.
data class Account(
    val id: String,
    val name: String,
    val defaultBudgetId: String,
    val cardLastFour: String?
)

data class Project(
    val id: String,
    val name: String,
    val description: String,
    val budgetId: String? = null, // null/empty = legacy project, visible in all budgets
    val subcategories: List<String> = emptyList()
)

data class StoreLocation(
    val id: String,
    val name: String,
    val lat: Double,
    val lng: Double,
    val radiusMeters: Double
)

data class MerchantPreference(
    val budgetId: String,
    val budgetItemId: String?,
    val accountId: String?
)

/** Summary of a logged receipt for the "recent receipts" list (no line items). */
data class ReceiptSummary(
    val id: String,
    val store: String,
    val date: String,
    val total: Double,
    val itemCount: Int,
    val matched: Boolean
)

class FirebaseService {
    private val db = FirebaseFirestore.getInstance()
    private val auth = FirebaseAuth.getInstance()
    private val TAG = "FirebaseService"

    // Firestore security rules only allow known UIDs, so every access goes
    // through this gate: sign in with the dedicated device account first.
    private suspend fun firestore(): FirebaseFirestore {
        if (auth.currentUser == null) {
            try {
                auth.signInWithEmailAndPassword(
                    BuildConfig.COMPANION_AUTH_EMAIL,
                    BuildConfig.COMPANION_AUTH_PASSWORD
                ).await()
            } catch (e: Exception) {
                Log.e(TAG, "Firebase sign-in failed — check COMPANION_AUTH_* in local.properties", e)
            }
        }
        return db
    }

    suspend fun getBudgets(): List<Budget> {
        return try {
            val snapshot = firestore().collection("budgets").get().await()
            snapshot.documents.mapNotNull { doc ->
                val name = doc.getString("name") ?: return@mapNotNull null
                val type = doc.getString("type") ?: "personal"
                Budget(doc.id, name, type)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching budgets", e)
            emptyList()
        }
    }

    suspend fun getAccounts(): List<Account> {
        return try {
            val snapshot = firestore().collection("accounts").get().await()
            snapshot.documents.mapNotNull { doc ->
                val name = doc.getString("name") ?: return@mapNotNull null
                val cardLastFour = doc.getString("cardLastFour")
                // Accounts are global now: read defaultBudgetId (legacy budgetId as fallback).
                val accBudgetId = doc.getString("defaultBudgetId") ?: doc.getString("budgetId") ?: ""
                Account(doc.id, name, accBudgetId, cardLastFour)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching accounts", e)
            emptyList()
        }
    }

    suspend fun getProjects(): List<Project> {
        return try {
            val snapshot = firestore().collection("projects").get().await()
            snapshot.documents.mapNotNull { doc ->
                val name = doc.getString("name") ?: return@mapNotNull null
                val description = doc.getString("description") ?: ""
                val budgetId = doc.getString("budgetId")
                val subcategories = (doc.get("subcategories") as? List<*>)
                    ?.filterIsInstance<String>() ?: emptyList()
                Project(doc.id, name, description, budgetId, subcategories)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching projects", e)
            emptyList()
        }
    }

    /** Category id -> name, to resolve the category shown for each def. */
    private suspend fun getCategoriesMap(): Map<String, String> {
        return try {
            firestore().collection("categories").get().await()
                .documents.associate { it.id to (it.getString("name") ?: "Annet") }
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching categories", e)
            emptyMap()
        }
    }

    /**
     * Library budget items (budgetItemDefs) eligible for the given budget type,
     * by scope: a def shows when its scope is "both" or matches the budget
     * (shared <-> "shared", personal <-> "private").
     */
    suspend fun getBudgetItems(budgetType: String): List<BudgetItem> {
        return try {
            val cats = getCategoriesMap()
            firestore().collection("budgetItemDefs").get().await().documents.mapNotNull { doc ->
                val name = doc.getString("name") ?: return@mapNotNull null
                val scope = doc.getString("scope") ?: "both"
                val eligible = scope == "both" ||
                    (scope == "shared" && budgetType == "shared") ||
                    (scope == "private" && budgetType == "personal")
                if (!eligible) return@mapNotNull null
                val categoryId = doc.getString("categoryId")
                BudgetItem(doc.id, name, categoryId, cats[categoryId] ?: "Annet", scope)
            }.sortedWith(compareBy({ it.categoryName }, { it.name }))
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching budget item defs", e)
            emptyList()
        }
    }

    /** Returns the saved preference for a merchant name, or null if none exists. */
    suspend fun getMerchantPreference(merchant: String): MerchantPreference? {
        return try {
            val key = merchant.trim().lowercase()
            val doc = firestore().collection("merchantPreferences").document(key).get().await()
            if (doc.exists()) {
                MerchantPreference(
                    budgetId = doc.getString("budgetId") ?: return null,
                    budgetItemId = doc.getString("budgetItemId"),
                    accountId = doc.getString("accountId")
                )
            } else null
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching merchant preference", e)
            null
        }
    }

    /** Saves/updates the preference for a merchant name. */
    suspend fun saveMerchantPreference(
        merchant: String,
        budgetId: String,
        budgetItemId: String?,
        accountId: String?
    ) {
        try {
            val key = merchant.trim().lowercase()
            val data = hashMapOf<String, Any?>(
                "merchant" to merchant,
                "budgetId" to budgetId,
                "budgetItemId" to budgetItemId,
                "accountId" to accountId,
                "updatedAt" to java.util.Date()
            )
            firestore().collection("merchantPreferences").document(key).set(data).await()
        } catch (e: Exception) {
            Log.e(TAG, "Error saving merchant preference", e)
        }
    }

    /**
     * Find-or-create the per-budget instance (an `expenses` doc with defId) for
     * a library def in the given budget, and return its id. Mirrors the web
     * app's ensureInstanceForDef so the transaction links to a real instance.
     */
    private suspend fun ensureInstanceForDef(def: BudgetItem, budgetId: String): String? {
        return try {
            // Single-field query (no composite index); filter budgetId client-side.
            val existing = firestore().collection("expenses").whereEqualTo("defId", def.id).get().await()
            val match = existing.documents.find { it.getString("budgetId") == budgetId }
            if (match != null) return match.id
            val data = hashMapOf(
                "budgetId" to budgetId,
                "defId" to def.id,
                "name" to def.name,
                "category" to def.categoryName,
                "amount" to 0.0,
                "monthlyAmount" to 0.0,
                "frequency" to "monthly",
                "createdAt" to java.util.Date()
            )
            firestore().collection("expenses").add(data).await().id
        } catch (e: Exception) {
            Log.e(TAG, "Error materializing budget item instance", e)
            null
        }
    }

    suspend fun saveTransaction(
        date: String,
        merchant: String,
        amount: String,
        card: String,
        comment: String,
        budgetId: String,
        def: BudgetItem?,
        accountId: String? = null,
        isUnnecessary: Boolean = false,
        excludeFromSharedCalc: Boolean = false,
        projectId: String? = null,
        projectSubcategory: String? = null,
        paidPrivately: Boolean = false,
        coveredByAccountId: String? = null
    ): Boolean {
        return try {
            val amountNum = amount.replace(Regex("[^\\d,.-]"), "").replace(",", ".").toDoubleOrNull() ?: 0.0
            val month = if (date.length >= 7) date.substring(0, 7) else ""

            // Resolve the account: explicit selection, else match by card across
            // all (global) accounts, else the first one.
            var finalAccountId = accountId ?: ""
            if (finalAccountId.isEmpty()) {
                try {
                    val accountsSnapshot = firestore().collection("accounts").get().await()
                    if (!accountsSnapshot.isEmpty) {
                        val matchingAccount = accountsSnapshot.documents.find {
                            val c = it.getString("cardLastFour")
                            c != null && c.isNotEmpty() && card.endsWith(c)
                        }
                        finalAccountId = matchingAccount?.id ?: accountsSnapshot.documents.first().id
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error fetching account for transaction", e)
                }
            }

            // Materialize the per-budget instance for the chosen library def.
            val budgetItemId: String? = def?.let { ensureInstanceForDef(it, budgetId) }

            val transactionData = hashMapOf(
                "date" to date,
                "month" to month,
                "name" to merchant, // React expects 'name' instead of 'merchant'
                "amount" to amountNum,
                "card" to card,
                "comment" to comment,
                "type" to "expense",
                "category" to (def?.categoryName ?: ""),
                "budgetId" to budgetId,
                "accountId" to finalAccountId,
                "budgetItemId" to budgetItemId,
                "isUnnecessary" to isUnnecessary,
                "excludeFromSharedCalc" to excludeFromSharedCalc,
                // Only meaningful together with excludeFromSharedCalc: the account
                // this cost should be covered from (shown under Oppgjør).
                "coveredByAccountId" to if (excludeFromSharedCalc) coveredByAccountId else null,
                "projectId" to projectId,
                // Mirrors the web app: subcategory only meaningful with a project
                "projectSubcategory" to if (projectId != null) projectSubcategory else null,
                // Outlay: shared cost paid with private money — the web app
                // deducts this from the payer's transfer to the joint account
                "paidPrivatelyBy" to if (paidPrivately) "self" else null,
                "reconciled" to false,
                "source" to "companion_app",
                "createdAt" to java.util.Date()
            )

            firestore().collection("transactions").add(transactionData).await()

            // Remember choices for next time — store the DEF id so recall re-selects it.
            saveMerchantPreference(
                merchant = merchant,
                budgetId = budgetId,
                budgetItemId = def?.id,
                accountId = finalAccountId.ifEmpty { null }
            )

            true
        } catch (e: Exception) {
            Log.e(TAG, "Error saving transaction", e)
            false
        }
    }

    // ===== Receipts (grocery line-item logging) =====

    /**
     * Finds transactions that could correspond to a receipt: date within
     * [daysWindow] days and |amount| equal to the receipt total. Date is a
     * single-field range query (no composite index needed); the amount check
     * happens client-side so the sign convention of imports doesn't matter.
     */
    suspend fun findMatchingTransactions(
        total: Double,
        date: String,
        daysWindow: Long = 3
    ): List<TransactionMatch> {
        return try {
            val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            val parsed = fmt.parse(date) ?: return emptyList()
            val dayMs = 24 * 60 * 60 * 1000L
            val from = fmt.format(java.util.Date(parsed.time - daysWindow * dayMs))
            val to = fmt.format(java.util.Date(parsed.time + daysWindow * dayMs))

            val snapshot = firestore().collection("transactions")
                .whereGreaterThanOrEqualTo("date", from)
                .whereLessThanOrEqualTo("date", to)
                .get()
                .await()

            snapshot.documents.mapNotNull { doc ->
                val amount = doc.getDouble("amount") ?: return@mapNotNull null
                if (abs(abs(amount) - total) > 0.01) return@mapNotNull null
                TransactionMatch(
                    id = doc.id,
                    name = doc.getString("name") ?: "",
                    date = doc.getString("date") ?: "",
                    amount = amount,
                    budgetId = doc.getString("budgetId") ?: ""
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error finding matching transactions", e)
            emptyList()
        }
    }

    // ===== Store locations (geofence-based receipt nudge) =====

    suspend fun getStoreLocations(): List<StoreLocation> {
        return try {
            val snapshot = firestore().collection("storeLocations").get().await()
            snapshot.documents.mapNotNull { doc ->
                StoreLocation(
                    id = doc.id,
                    name = doc.getString("name") ?: return@mapNotNull null,
                    lat = doc.getDouble("lat") ?: return@mapNotNull null,
                    lng = doc.getDouble("lng") ?: return@mapNotNull null,
                    radiusMeters = doc.getDouble("radiusMeters") ?: 400.0
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching store locations", e)
            emptyList()
        }
    }

    /**
     * Saves/updates a store position (doc id = name, so re-registering on
     * site overwrites the approximate seed coordinates).
     */
    suspend fun saveStoreLocation(name: String, lat: Double, lng: Double, radiusMeters: Double = 250.0): Boolean {
        return try {
            firestore().collection("storeLocations").document(name).set(hashMapOf(
                "name" to name,
                "lat" to lat,
                "lng" to lng,
                "radiusMeters" to radiusMeters,
                "updatedAt" to java.util.Date()
            )).await()
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error saving store location", e)
            false
        }
    }

    /**
     * Known normalizedNames from earlier receipts, kept in a single doc so the
     * parser can anchor its naming without reading the whole items collection.
     * Grouped per chain family — chains name identical products differently,
     * so the parser must only reuse names from the receipt's own chain.
     */
    suspend fun getKnownVareNames(): Map<String, List<String>> {
        return try {
            val doc = firestore().collection("meta").document("groceryVocabulary").get().await()
            val byChain = (doc.get("namesByChain") as? Map<*, *>)?.entries
                ?.associate { (chain, names) ->
                    chain.toString() to
                        ((names as? List<*>)?.filterIsInstance<String>()?.sorted() ?: emptyList())
                }
                ?: emptyMap()
            // The flat "names" list predates the per-chain split; everything in
            // it is Coop-era data
            val legacy = (doc.get("names") as? List<*>)?.filterIsInstance<String>() ?: emptyList()
            if (legacy.isEmpty()) byChain
            else byChain + ("coop" to ((byChain["coop"] ?: emptyList()) + legacy).distinct().sorted())
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching grocery vocabulary", e)
            emptyMap()
        }
    }

    /** Most recently logged receipts (summary only), newest shopping date first. */
    suspend fun getRecentReceipts(limit: Long = 15): List<ReceiptSummary> {
        return try {
            firestore().collection("receipts")
                .orderBy("date", com.google.firebase.firestore.Query.Direction.DESCENDING)
                .limit(limit)
                .get()
                .await()
                .documents.mapNotNull { doc ->
                    ReceiptSummary(
                        id = doc.id,
                        store = doc.getString("store") ?: doc.getString("chain") ?: "Ukjent butikk",
                        date = doc.getString("date") ?: "",
                        total = doc.getDouble("total") ?: 0.0,
                        itemCount = (doc.getLong("itemCount") ?: 0L).toInt(),
                        matched = doc.getString("status") == "matched"
                    )
                }
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching recent receipts", e)
            emptyList()
        }
    }

    // ===== Parser lessons (persistent user corrections) =====

    suspend fun getParserLessons(): List<String> {
        return try {
            val doc = firestore().collection("meta").document("parserLessons").get().await()
            (doc.get("lessons") as? List<*>)?.filterIsInstance<String>() ?: emptyList()
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching parser lessons", e)
            emptyList()
        }
    }

    suspend fun addParserLesson(lesson: String): Boolean {
        return try {
            firestore().collection("meta").document("parserLessons").set(
                mapOf("lessons" to com.google.firebase.firestore.FieldValue.arrayUnion(lesson.trim())),
                com.google.firebase.firestore.SetOptions.merge()
            ).await()
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error saving parser lesson", e)
            false
        }
    }

    /** True if a receipt with the same date and total is already stored. */
    suspend fun receiptExists(date: String, total: Double): Boolean {
        return try {
            val snapshot = firestore().collection("receipts")
                .whereEqualTo("date", date)
                .whereEqualTo("total", total)
                .get()
                .await()
            !snapshot.isEmpty
        } catch (e: Exception) {
            Log.e(TAG, "Error checking for existing receipt", e)
            false
        }
    }

    /**
     * Stores a receipt and its line items in one batch. If [transactionId] is
     * set, the receipt is marked matched and the transaction gets a receiptId
     * back-reference for the web app.
     */
    suspend fun saveReceipt(
        receipt: ParsedReceipt,
        transactionId: String?,
        budgetId: String?
    ): Boolean {
        return try {
            val batch = firestore().batch()
            val receiptRef = firestore().collection("receipts").document()

            batch.set(receiptRef, hashMapOf(
                "store" to receipt.store,
                "chain" to receipt.chain,
                "date" to receipt.date,
                "month" to if (receipt.date.length >= 7) receipt.date.substring(0, 7) else "",
                "total" to receipt.total,
                "itemCount" to receipt.items.count { !it.isDiscount && !it.isPant },
                "transactionId" to transactionId,
                "budgetId" to budgetId,
                "status" to if (transactionId != null) "matched" else "unmatched",
                "source" to "companion_app",
                "parseAttempts" to receipt.parseAttempts,
                "parseModel" to receipt.parseModel,
                "createdAt" to java.util.Date()
            ))

            receipt.items.forEach { item ->
                val itemRef = firestore().collection("receiptItems").document()
                batch.set(itemRef, hashMapOf(
                    "receiptId" to receiptRef.id,
                    "name" to item.name,
                    "normalizedName" to item.normalizedName,
                    "category" to item.category,
                    "quantity" to item.quantity,
                    "unit" to item.unit,
                    "unitPrice" to item.unitPrice,
                    "totalPrice" to item.totalPrice,
                    "discount" to item.discount,
                    "isDiscount" to item.isDiscount,
                    "isPant" to item.isPant,
                    "chain" to receipt.chain,
                    "date" to receipt.date
                ))
            }

            if (transactionId != null) {
                batch.update(
                    firestore().collection("transactions").document(transactionId),
                    "receiptId", receiptRef.id
                )
            }

            batch.commit().await()

            // Grow the chain's name vocabulary (best effort — receipt is saved)
            try {
                val newNames = receipt.items
                    .filter { !it.isDiscount && !it.isPant }
                    .map { it.normalizedName }
                    .distinct()
                if (newNames.isNotEmpty()) {
                    val group = com.okonomiflyt.companion.receipts.chainGroup(receipt.chain)
                    firestore().collection("meta").document("groceryVocabulary").set(
                        mapOf("namesByChain" to mapOf(
                            group to com.google.firebase.firestore.FieldValue.arrayUnion(*newNames.toTypedArray())
                        )),
                        com.google.firebase.firestore.SetOptions.merge()
                    ).await()
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not update grocery vocabulary", e)
            }

            true
        } catch (e: Exception) {
            Log.e(TAG, "Error saving receipt", e)
            false
        }
    }
}
