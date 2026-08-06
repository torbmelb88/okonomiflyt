package com.okonomiflyt.companion.receipts

/**
 * Chain family used to key the name vocabulary: chains name identical
 * products differently on their receipts, so vocabularies must never mix.
 * All Coop variants (and Coop-owned Matkroken) share one family. Must match
 * chainGroupOf() in the web app's groceryCategories.js.
 */
fun chainGroup(chain: String): String =
    if (chain.startsWith("coop") || chain == "matkroken") "coop" else chain

/** A single line item parsed from a grocery receipt. */
data class ParsedReceiptItem(
    val name: String,            // As printed on the receipt, e.g. "TINE LETTMELK 1L"
    val normalizedName: String,  // Normalized for price statistics, e.g. "lettmelk tine 1l"
    val category: String,        // One of the fixed categories in ClaudeReceiptParser.CATEGORIES
    val quantity: Double,
    val unit: String,            // "stk", "kg" or "l"
    val unitPrice: Double,
    val totalPrice: Double,      // Net line sum as it contributes to the total; negative for pure discount lines
    val discount: Double,        // Discount in NOK already deducted from totalPrice (Coop prints net + info line)
    val isDiscount: Boolean,
    val isPant: Boolean
)

/** A fully parsed receipt, before it is stored/matched. */
data class ParsedReceipt(
    val store: String,
    val chain: String,
    val date: String,            // YYYY-MM-DD
    val total: Double,
    val items: List<ParsedReceiptItem>,
    // Which attempt in the self-correction loop produced this parse —
    // telemetry for tuning the primary/fallback model choice
    val parseAttempts: Int = 1,
    val parseModel: String = "",
    // Raw JSON from the model — kept so user feedback can continue the
    // conversation ("analyser på nytt"). Never persisted to Firestore.
    val rawJson: String = ""
)

/** A transaction in Firestore that could correspond to a receipt. */
data class TransactionMatch(
    val id: String,
    val name: String,
    val date: String,
    val amount: Double,
    val budgetId: String
)
