package com.okonomiflyt.companion.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.okonomiflyt.companion.Account
import com.okonomiflyt.companion.Budget
import com.okonomiflyt.companion.BudgetItem
import com.okonomiflyt.companion.FirebaseService
import com.okonomiflyt.companion.receipts.ClaudeReceiptParser
import com.okonomiflyt.companion.receipts.ParsedReceipt
import com.okonomiflyt.companion.receipts.chainGroup
import com.okonomiflyt.companion.receipts.TransactionMatch
import com.okonomiflyt.companion.ui.theme.OkonomiFlytCompanionTheme
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * Share target for receipts (PDF or screenshot) from grocery chain apps.
 * Flow per receipt: parse with Claude -> review line items -> link to a
 * matching transaction (auto when exactly one candidate) -> save to Firestore.
 * Without a match the receipt is booked as a new transaction (reconciled:false)
 * by default — payment methods like Trumf Pay have no bank transaction until
 * the invoice arrives, but the receipt proves the purchase happened. The later
 * invoice/bank import matches the row against this transaction (date + amount
 * + name) and merges via the duplicate review.
 */
class ReceiptShareActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val uris: List<Uri> = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(getParcelable(intent))
            Intent.ACTION_SEND_MULTIPLE -> getParcelableList(intent)
            else -> emptyList()
        }

        // If we received a share without a usable file, show what we actually
        // got — this is the debugging surface for new chain apps
        val emptyMessage = if (uris.isEmpty()) {
            val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
            buildString {
                append("Delingen inneholdt ingen fil.\n\n")
                append("Action: ${intent.action}\n")
                append("Type: ${intent.type}")
                if (!sharedText.isNullOrEmpty()) {
                    append("\nTekst: ${sharedText.take(300)}")
                }
            }
        } else null

        setContent {
            OkonomiFlytCompanionTheme {
                ReceiptQueueScreen(
                    uris = uris,
                    emptyMessage = emptyMessage,
                    resolveMime = { uri -> contentResolver.getType(uri) },
                    readBytes = { uri ->
                        contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    },
                    onDone = { finish() }
                )
            }
        }
    }

    private fun getParcelable(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)

    private fun getParcelableList(intent: Intent): List<Uri> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) ?: emptyList()
        else @Suppress("DEPRECATION") intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
            ?: emptyList()
}

private sealed interface ReceiptState {
    data object Parsing : ReceiptState
    data class Failed(val message: String) : ReceiptState
    data class Review(
        val receipt: ParsedReceipt,
        val candidates: List<TransactionMatch>,
        val selectedTransactionId: String?,
        val isDuplicate: Boolean,
        val booking: BookingState
    ) : ReceiptState

    data object Saving : ReceiptState
}

/**
 * How the receipt is booked when no existing transaction is linked: as a new
 * transaction on the chosen budget/account/budget item. Defaults come from
 * the store's merchant preference, else shared budget + a "dagligvarer" def.
 */
private data class BookingState(
    val enabled: Boolean,
    val budgets: List<Budget>,
    val accounts: List<Account>,
    val defs: List<BudgetItem>,
    val budget: Budget?,
    val account: Account?,
    val def: BudgetItem?
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReceiptQueueScreen(
    uris: List<Uri>,
    emptyMessage: String?,
    resolveMime: (Uri) -> String?,
    readBytes: (Uri) -> ByteArray?,
    onDone: () -> Unit
) {
    val firebaseService = remember { FirebaseService() }
    val parser = remember { ClaudeReceiptParser() }
    val scope = rememberCoroutineScope()

    var currentIndex by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<ReceiptState>(ReceiptState.Parsing) }
    var savedCount by remember { mutableIntStateOf(0) }
    // Known product names per chain family + persistent corrections, fetched once per session
    var knownNames by remember { mutableStateOf<Map<String, List<String>>?>(null) }
    var parserLessons by remember { mutableStateOf<List<String>?>(null) }
    // Booking metadata, fetched once per share session
    var budgets by remember { mutableStateOf<List<Budget>?>(null) }
    var accounts by remember { mutableStateOf<List<Account>?>(null) }
    val defsCache = remember { mutableMapOf<String, List<BudgetItem>>() }

    val finished = uris.isEmpty() || currentIndex >= uris.size

    suspend fun defsFor(budgetType: String): List<BudgetItem> =
        defsCache[budgetType]
            ?: firebaseService.getBudgetItems(budgetType).also { defsCache[budgetType] = it }

    suspend fun buildReviewState(receipt: com.okonomiflyt.companion.receipts.ParsedReceipt): ReceiptState.Review {
        val candidates = firebaseService.findMatchingTransactions(receipt.total, receipt.date)
        val isDuplicate = firebaseService.receiptExists(receipt.date, receipt.total)

        // Booking defaults for when no transaction gets linked: the store's
        // merchant preference, else shared budget + a "dagligvarer" def.
        val allBudgets = budgets ?: firebaseService.getBudgets().also { budgets = it }
        val allAccounts = accounts ?: firebaseService.getAccounts().also { accounts = it }
        val pref = firebaseService.getMerchantPreference(receipt.store)
        val budget = pref?.budgetId?.let { id -> allBudgets.find { it.id == id } }
            ?: allBudgets.find { it.type == "shared" }
            ?: allBudgets.firstOrNull()
        val defs = budget?.let { defsFor(it.type) } ?: emptyList()
        val def = pref?.budgetItemId?.let { id -> defs.find { it.id == id } }
            ?: defs.find { it.name.contains("dagligvare", ignoreCase = true) }
        val account = pref?.accountId?.let { id -> allAccounts.find { it.id == id } }
            ?: allAccounts.firstOrNull()

        return ReceiptState.Review(
            receipt = receipt,
            candidates = candidates,
            selectedTransactionId = candidates.singleOrNull()?.id,
            isDuplicate = isDuplicate,
            booking = BookingState(
                enabled = true,
                budgets = allBudgets,
                accounts = allAccounts,
                defs = defs,
                budget = budget,
                account = account,
                def = def
            )
        )
    }

    suspend fun runParse(feedback: String? = null, previousRaw: String? = null) {
        state = ReceiptState.Parsing
        val uri = uris[currentIndex]
        val bytes = readBytes(uri)
        if (bytes == null) {
            state = ReceiptState.Failed("Kunne ikke lese filen")
            return
        }
        val vocabulary = knownNames ?: firebaseService.getKnownVareNames().also { knownNames = it }
        val lessons = parserLessons ?: firebaseService.getParserLessons().also { parserLessons = it }
        parser.parse(bytes, resolveMime(uri), vocabulary, lessons, feedback, previousRaw).fold(
            onSuccess = { receipt -> state = buildReviewState(receipt) },
            onFailure = { e -> state = ReceiptState.Failed(e.message ?: "Ukjent feil") }
        )
    }

    // Parse the current receipt whenever the index changes
    LaunchedEffect(currentIndex) {
        if (finished) return@LaunchedEffect
        runParse()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        if (uris.size > 1) "Kvittering ${currentIndex + 1} av ${uris.size}"
                        else "Kvittering",
                        fontWeight = FontWeight.Bold
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
        }
    ) { innerPadding ->
        Box(Modifier.padding(innerPadding).fillMaxSize()) {
            when {
                finished && emptyMessage != null -> FailedView(emptyMessage, onSkip = onDone)
                finished -> DoneView(savedCount, onDone)
                else -> when (val s = state) {
                    is ReceiptState.Parsing -> LoadingView("Analyserer kvittering …")
                    is ReceiptState.Saving -> LoadingView("Lagrer …")
                    is ReceiptState.Failed -> FailedView(
                        message = s.message,
                        onSkip = { currentIndex++ }
                    )
                    is ReceiptState.Review -> ReviewView(
                        state = s,
                        onSelectTransaction = { id ->
                            state = s.copy(selectedTransactionId = id)
                        },
                        onToggleBooking = { enabled ->
                            state = s.copy(booking = s.booking.copy(enabled = enabled))
                        },
                        onSelectBookingBudget = { budget ->
                            scope.launch {
                                // Defs are scoped by budget type — reload and keep
                                // the selection if it's still eligible
                                val defs = defsFor(budget.type)
                                val def = s.booking.def?.let { d -> defs.find { it.id == d.id } }
                                    ?: defs.find { it.name.contains("dagligvare", ignoreCase = true) }
                                state = s.copy(booking = s.booking.copy(budget = budget, defs = defs, def = def))
                            }
                        },
                        onSelectBookingAccount = { account ->
                            state = s.copy(booking = s.booking.copy(account = account))
                        },
                        onSelectBookingDef = { def ->
                            state = s.copy(booking = s.booking.copy(def = def))
                        },
                        onReanalyze = { comment, remember ->
                            scope.launch {
                                if (remember && comment.isNotBlank()) {
                                    firebaseService.addParserLesson(comment)
                                    parserLessons = (parserLessons ?: emptyList()) + comment
                                }
                                runParse(feedback = comment, previousRaw = s.receipt.rawJson)
                            }
                        },
                        onSave = {
                            scope.launch {
                                state = ReceiptState.Saving
                                val match = s.candidates.find { it.id == s.selectedTransactionId }
                                val booking = s.booking
                                var transactionId = match?.id
                                var budgetId = match?.budgetId

                                // No existing transaction (e.g. Trumf Pay — the
                                // invoice comes next month): book the receipt as
                                // a new companion transaction and link it.
                                if (match == null && booking.enabled &&
                                    booking.budget != null && booking.account != null
                                ) {
                                    transactionId = firebaseService.saveTransaction(
                                        date = s.receipt.date,
                                        merchant = s.receipt.store,
                                        amount = s.receipt.total.toString(),
                                        card = "",
                                        comment = "",
                                        budgetId = booking.budget.id,
                                        def = booking.def,
                                        accountId = booking.account.id
                                    )
                                    if (transactionId == null) {
                                        state = ReceiptState.Failed("Kunne ikke bokføre transaksjonen — prøv igjen")
                                        return@launch
                                    }
                                    budgetId = booking.budget.id
                                }

                                val ok = firebaseService.saveReceipt(
                                    receipt = s.receipt,
                                    transactionId = transactionId,
                                    budgetId = budgetId
                                )
                                if (ok) {
                                    // Make the new names available to the next
                                    // receipt in this share session, in the
                                    // right chain's vocabulary
                                    val group = chainGroup(s.receipt.chain)
                                    val current = knownNames ?: emptyMap()
                                    knownNames = current + (group to
                                        ((current[group] ?: emptyList()) +
                                            s.receipt.items.filter { !it.isDiscount && !it.isPant }
                                                .map { it.normalizedName }).distinct())
                                    savedCount++
                                    currentIndex++
                                } else {
                                    state = ReceiptState.Failed("Lagring feilet — prøv igjen")
                                }
                            }
                        },
                        onSkip = { currentIndex++ }
                    )
                }
            }
        }
    }
}

@Composable
private fun LoadingView(text: String) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        CircularProgressIndicator()
        Spacer(Modifier.height(16.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun FailedView(message: String, onSkip: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Filled.ErrorOutline, contentDescription = null,
            tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(48.dp)
        )
        Spacer(Modifier.height(12.dp))
        Text(message, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(20.dp))
        Button(onClick = onSkip) { Text("Hopp over") }
    }
}

@Composable
private fun DoneView(savedCount: Int, onDone: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Filled.CheckCircle, contentDescription = null,
            tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(56.dp)
        )
        Spacer(Modifier.height(12.dp))
        Text(
            if (savedCount == 1) "1 kvittering lagret"
            else "$savedCount kvitteringer lagret",
            style = MaterialTheme.typography.titleMedium
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = onDone) { Text("Ferdig") }
    }
}

@Composable
private fun ReviewView(
    state: ReceiptState.Review,
    onSelectTransaction: (String?) -> Unit,
    onToggleBooking: (Boolean) -> Unit,
    onSelectBookingBudget: (Budget) -> Unit,
    onSelectBookingAccount: (Account) -> Unit,
    onSelectBookingDef: (BudgetItem?) -> Unit,
    onReanalyze: (comment: String, remember: Boolean) -> Unit,
    onSave: () -> Unit,
    onSkip: () -> Unit
) {
    val receipt = state.receipt
    val itemSum = receipt.items.sumOf { it.totalPrice }
    val sumMismatch = kotlin.math.abs(itemSum - receipt.total) > 0.5

    Column(Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.weight(1f).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(vertical = 16.dp)
        ) {
            item {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer
                    )
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp).fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Filled.ReceiptLong, contentDescription = null)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(receipt.store, fontWeight = FontWeight.Bold)
                            Text(receipt.date, style = MaterialTheme.typography.bodySmall)
                            if (receipt.parseAttempts > 1) {
                                Text(
                                    "Tolket på ${receipt.parseAttempts}. forsøk" +
                                        if (receipt.parseModel.contains("sonnet")) " (kraftigere modell)" else "",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                                )
                            }
                        }
                        Text(
                            formatKr(receipt.total),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }

            if (state.isDuplicate) {
                item {
                    WarningCard("En kvittering med samme dato og beløp er allerede lagret. Lagre bare hvis dette faktisk er et nytt kjøp.")
                }
            }
            if (sumMismatch) {
                item {
                    WarningCard(
                        "Varelinjene summerer til ${formatKr(itemSum)}, men totalen er ${formatKr(receipt.total)}. Sjekk kvitteringen."
                    )
                }
            }

            item { TransactionMatchCard(state, onSelectTransaction) }

            if (state.selectedTransactionId == null) {
                item {
                    BookingCard(
                        booking = state.booking,
                        onToggle = onToggleBooking,
                        onSelectBudget = onSelectBookingBudget,
                        onSelectAccount = onSelectBookingAccount,
                        onSelectDef = onSelectBookingDef
                    )
                }
            }

            item { FeedbackCard(onReanalyze) }

            item {
                Text(
                    "Varelinjer (${receipt.items.size})",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )
            }
            items(receipt.items) { item ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            item.name,
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (item.isDiscount) MaterialTheme.colorScheme.tertiary
                            else MaterialTheme.colorScheme.onSurface
                        )
                        val detail = buildString {
                            if (item.unit == "stk" && item.quantity != 1.0) {
                                append("${item.quantity.toInt()} stk à ${formatKr(item.unitPrice)}")
                            } else if (item.unit != "stk") {
                                append("${item.quantity} ${item.unit} à ${formatKr(item.unitPrice)}")
                            }
                            if (item.isPant) append(if (isEmpty()) "Pant" else " · Pant")
                            if (item.discount > 0) {
                                append(if (isEmpty()) "" else " · ")
                                append("Rabatt −${formatKr(item.discount)}")
                            }
                        }
                        if (detail.isNotEmpty()) {
                            Text(
                                detail,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    Text(formatKr(item.totalPrice), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        // Bottom action bar
        Surface(tonalElevation = 3.dp) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedButton(onClick = onSkip, modifier = Modifier.weight(1f)) {
                    Text("Hopp over")
                }
                Button(onClick = onSave, modifier = Modifier.weight(2f)) {
                    Text(
                        when {
                            state.selectedTransactionId != null -> "Lagre og knytt"
                            state.booking.enabled && state.booking.budget != null &&
                                state.booking.account != null -> "Lagre og bokfør"
                            else -> "Lagre kvittering"
                        }
                    )
                }
            }
        }
    }
}

/**
 * User feedback on the parse: the comment is sent back to the model with the
 * receipt still in context. "Husk som varig regel" stores it as a persistent
 * lesson injected into all future parses.
 */
@Composable
private fun FeedbackCard(onReanalyze: (String, Boolean) -> Unit) {
    var comment by remember { mutableStateOf("") }
    var rememberLesson by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf(false) }

    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded },
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Noe feil i analysen?",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    if (expanded) "Skjul" else "Kommenter",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            if (expanded) {
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = comment,
                    onValueChange = { comment = it },
                    label = { Text("Hva er feil? F.eks. «UTS betyr uten sukker»") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Checkbox(
                        checked = rememberLesson,
                        onCheckedChange = { rememberLesson = it }
                    )
                    Column {
                        Text("Husk som varig regel", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "Brukes på alle fremtidige kvitteringer",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                Button(
                    onClick = { onReanalyze(comment.trim(), rememberLesson) },
                    enabled = comment.isNotBlank(),
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Analyser på nytt") }
            }
        }
    }
}

@Composable
private fun WarningCard(text: String) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer
        )
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Filled.Warning, contentDescription = null,
                tint = MaterialTheme.colorScheme.onErrorContainer,
                modifier = Modifier.size(20.dp)
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer
            )
        }
    }
}

@Composable
private fun TransactionMatchCard(
    state: ReceiptState.Review,
    onSelectTransaction: (String?) -> Unit
) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (state.selectedTransactionId != null) Icons.Filled.Link else Icons.Filled.LinkOff,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    when {
                        state.candidates.isEmpty() -> "Ingen matchende transaksjon funnet"
                        state.candidates.size == 1 -> "Knyttes til transaksjon"
                        else -> "Velg transaksjon (${state.candidates.size} kandidater)"
                    },
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold
                )
            }
            if (state.candidates.isEmpty()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    "Betalinger med f.eks. Trumf Pay dukker først opp når fakturaen importeres.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                Spacer(Modifier.height(8.dp))
                state.candidates.forEach { candidate ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = state.selectedTransactionId == candidate.id,
                            onClick = {
                                onSelectTransaction(
                                    if (state.selectedTransactionId == candidate.id) null
                                    else candidate.id
                                )
                            }
                        )
                        Column {
                            Text(candidate.name, style = MaterialTheme.typography.bodyMedium)
                            Text(
                                "${candidate.date} · ${formatKr(candidate.amount)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Booking of an unlinked receipt as a new transaction (reconciled:false, like
 * the notification logging flow). Defaults are prefilled from the store's
 * merchant preference; saving updates the preference for next time.
 */
@Composable
private fun BookingCard(
    booking: BookingState,
    onToggle: (Boolean) -> Unit,
    onSelectBudget: (Budget) -> Unit,
    onSelectAccount: (Account) -> Unit,
    onSelectDef: (BudgetItem?) -> Unit
) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "Bokfør som ny transaksjon",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        if (booking.enabled)
                            "Bokføres nå og knyttes automatisk mot bank/faktura ved senere import."
                        else
                            "Kvitteringen lagres som umatchet og kan knyttes i ØkonomiFlyt senere.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Switch(checked = booking.enabled, onCheckedChange = onToggle)
            }
            if (booking.enabled) {
                Spacer(Modifier.height(8.dp))
                BookingDropdown(
                    label = "Budsjett",
                    options = booking.budgets,
                    selected = booking.budget,
                    optionLabel = { it.name },
                    onSelect = { it?.let(onSelectBudget) }
                )
                Spacer(Modifier.height(8.dp))
                BookingDropdown(
                    label = "Konto",
                    options = booking.accounts,
                    selected = booking.account,
                    optionLabel = { it.name },
                    onSelect = { it?.let(onSelectAccount) }
                )
                Spacer(Modifier.height(8.dp))
                BookingDropdown(
                    label = "Budsjettpost",
                    options = booking.defs,
                    selected = booking.def,
                    optionLabel = { "${it.name} (${it.categoryName})" },
                    onSelect = onSelectDef,
                    noneLabel = "Ingen — avstemmes senere"
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T : Any> BookingDropdown(
    label: String,
    options: List<T>,
    selected: T?,
    optionLabel: (T) -> String,
    onSelect: (T?) -> Unit,
    noneLabel: String? = null
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = selected?.let(optionLabel) ?: noneLabel ?: "",
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable)
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (noneLabel != null) {
                DropdownMenuItem(
                    text = { Text(noneLabel) },
                    onClick = { onSelect(null); expanded = false }
                )
            }
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(optionLabel(option)) },
                    onClick = { onSelect(option); expanded = false }
                )
            }
        }
    }
}

private fun formatKr(value: Double): String =
    String.format(Locale.GERMAN, "%,.2f kr", value)
