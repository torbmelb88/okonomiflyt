package com.okonomiflyt.companion.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okonomiflyt.companion.Account
import com.okonomiflyt.companion.Budget
import com.okonomiflyt.companion.BudgetItem
import com.okonomiflyt.companion.FirebaseService
import com.okonomiflyt.companion.Project
import com.okonomiflyt.companion.TriggerHistory
import com.okonomiflyt.companion.ui.theme.Amber300
import com.okonomiflyt.companion.ui.theme.Amber600
import com.okonomiflyt.companion.ui.theme.AmberDarkContainer
import com.okonomiflyt.companion.ui.theme.Amber50
import com.okonomiflyt.companion.ui.theme.Green300
import com.okonomiflyt.companion.ui.theme.Green50
import com.okonomiflyt.companion.ui.theme.Green700
import com.okonomiflyt.companion.ui.theme.GreenDarkContainer
import com.okonomiflyt.companion.ui.theme.OkonomiFlytCompanionTheme
import com.okonomiflyt.companion.ui.theme.Purple300
import com.okonomiflyt.companion.ui.theme.Purple600
import androidx.compose.foundation.isSystemInDarkTheme
import kotlinx.coroutines.launch

/**
 * Bokføring av et kjøp fanget opp fra Google Wallet (eller trykket på i
 * listen). Samme oppsett som web-appens avstemmingsdialog, minus «Hva er
 * dette?» — et kortkjøp er alltid et kjøp:
 *
 *   kjøpskortet · Detaljer (budsjett, konto, budsjettpost, prosjekt)
 *   · Flere valg (utenfor oppgjør, utlegg, unødvendig, venter refusjon,
 *   kommentar) · oppsummeringslinje · én Lagre-knapp.
 */
class LogTransactionActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val merchant = intent.getStringExtra("merchant") ?: "Ukjent"
        val amount = intent.getStringExtra("amount") ?: "0"
        val card = intent.getStringExtra("card") ?: ""
        val notifText = intent.getStringExtra("notifText") ?: ""
        val date = intent.getStringExtra("date") ?: java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())
        val currency = intent.getStringExtra("currency")?.takeIf { it.isNotEmpty() }
        val triggerId = intent.getLongExtra("triggerId", -1L)

        setContent {
            OkonomiFlytCompanionTheme {
                LogTransactionScreen(
                    merchant = merchant,
                    amount = amount,
                    card = card,
                    notifText = notifText,
                    date = date,
                    currency = currency,
                    onSaved = { if (triggerId != -1L) TriggerHistory.markSaved(this, triggerId) },
                    onDismiss = { finish() }
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun LogTransactionScreen(
    merchant: String,
    amount: String,
    card: String,
    notifText: String = "",
    date: String,
    currency: String? = null,
    onSaved: () -> Unit = {},
    onDismiss: () -> Unit
) {
    val firebaseService = remember { FirebaseService() }
    val scope = rememberCoroutineScope()

    var budgets by remember { mutableStateOf<List<Budget>>(emptyList()) }
    var selectedBudget by remember { mutableStateOf<Budget?>(null) }
    var items by remember { mutableStateOf<List<BudgetItem>>(emptyList()) }
    var selectedItem by remember { mutableStateOf<BudgetItem?>(null) }
    var accounts by remember { mutableStateOf<List<Account>>(emptyList()) }
    var selectedAccount by remember { mutableStateOf<Account?>(null) }
    var projects by remember { mutableStateOf<List<Project>>(emptyList()) }
    var selectedProject by remember { mutableStateOf<Project?>(null) }
    var selectedProjectSubcategory by remember { mutableStateOf<String?>(null) }

    var comment by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var isSaving by remember { mutableStateOf(false) }
    var savedBudgetItemId by remember { mutableStateOf<String?>(null) }
    var isUnnecessary by remember { mutableStateOf(false) }
    var excludeFromSharedCalc by remember { mutableStateOf(false) }
    var coveredByAccountId by remember { mutableStateOf<String?>(null) }
    var paidPrivately by remember { mutableStateOf(false) }
    var awaitingRefund by remember { mutableStateOf(false) }
    var expectedRefundAmount by remember { mutableStateOf("") }
    var cardAutoMatched by remember { mutableStateOf(false) }
    var showMore by remember { mutableStateOf(false) }
    var itemPickerOpen by remember { mutableStateOf(false) }
    var itemSearch by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        isLoading = true
        budgets = firebaseService.getBudgets()
        accounts = firebaseService.getAccounts()
        projects = firebaseService.getProjects()

        val preference = firebaseService.getMerchantPreference(merchant)

        // Match på kortnummer først; kort med kallenavn i Google Wallet har
        // ikke kortnummer i varselet, så da matcher vi kallenavnet mot
        // varselteksten i stedet.
        val cardMatchedAccount = accounts.find {
            it.cardLastFour != null && it.cardLastFour.isNotEmpty() && card.endsWith(it.cardLastFour)
        } ?: accounts.find {
            !it.cardNickname.isNullOrEmpty() && notifText.contains(it.cardNickname, ignoreCase = true)
        }
        cardAutoMatched = cardMatchedAccount != null
        val preferredAccount = preference?.accountId?.let { id -> accounts.find { it.id == id } }
        selectedAccount = cardMatchedAccount ?: preferredAccount ?: accounts.firstOrNull()

        // Default budget: merchant preference, else the account's default
        // budget (accounts are global now), else the first budget.
        val preferredBudget = preference?.budgetId?.let { id -> budgets.find { it.id == id } }
        val budgetFromAccount = selectedAccount?.defaultBudgetId?.let { id -> budgets.find { it.id == id } }
        selectedBudget = preferredBudget ?: budgetFromAccount ?: budgets.firstOrNull()

        savedBudgetItemId = preference?.budgetItemId
        isLoading = false
    }

    LaunchedEffect(selectedBudget) {
        if (selectedBudget != null) {
            // Library defs eligible for this budget's scope (account stays as picked).
            items = firebaseService.getBudgetItems(selectedBudget!!.type)
            selectedItem = if (savedBudgetItemId != null) items.find { it.id == savedBudgetItemId } else null
            itemPickerOpen = selectedItem == null
            // Clear project selection if it belongs to another budget
            val projBudgetId = selectedProject?.budgetId
            if (!projBudgetId.isNullOrEmpty() && projBudgetId != selectedBudget!!.id) {
                selectedProject = null
                selectedProjectSubcategory = null
            }
        } else {
            items = emptyList()
            selectedItem = null
        }
    }

    // Utlegg = shared expense paid with PRIVATE money. Only relevant when the
    // account is private (its default budget is personal) AND the chosen budget
    // is shared. Default off (explicit opt-in).
    val accountIsPrivate = selectedAccount?.defaultBudgetId
        ?.let { id -> budgets.find { it.id == id }?.type == "personal" } ?: false
    val showPaidPrivately = selectedBudget?.type == "shared" && accountIsPrivate
    LaunchedEffect(selectedBudget, selectedAccount) { paidPrivately = false }

    val visibleProjects = projects.filter {
        it.budgetId.isNullOrEmpty() || it.budgetId == selectedBudget?.id
    }
    val isSuggested = selectedItem != null && selectedItem?.id == savedBudgetItemId
    val canSave = !isSaving && selectedBudget != null && selectedAccount != null && selectedItem != null

    // What «Lagre» will do — the same one-liner as the web dialog.
    val summary = buildString {
        if (selectedItem == null) append("Kjøp → velg budsjettpost")
        else append("Kjøp → ${selectedBudget?.name ?: ""} › ${selectedItem!!.categoryName} › ${selectedItem!!.name}")
        selectedProject?.let { append(" · prosjekt ${it.name}"); selectedProjectSubcategory?.let { s -> append(" / $s") } }
        if (excludeFromSharedCalc) {
            append(" · utenfor oppgjør")
            coveredByAccountId?.let { id -> accounts.find { it.id == id }?.let { append(", betales fra ${it.name}") } }
        }
        if (showPaidPrivately && paidPrivately) append(" · utlegg")
        if (isUnnecessary) append(" · unødvendig")
        if (awaitingRefund) append(" · venter refusjon${if (expectedRefundAmount.isNotBlank()) " $expectedRefundAmount kr" else ""}")
        if (comment.isNotBlank()) append(" · kommentar")
        if (currency != null) append(" · beløp i $currency")
        append(" · bokføres, venter på bankens kopi")
    }
    val activeAdjustments = listOfNotNull(
        if (excludeFromSharedCalc) "Utenfor oppgjør" else null,
        if (showPaidPrivately && paidPrivately) "Utlegg" else null,
        if (isUnnecessary) "Unødvendig" else null,
        if (awaitingRefund) "Venter refusjon" else null,
        if (comment.isNotBlank()) "Kommentar" else null,
    )

    val save = {
        isSaving = true
        scope.launch {
            val transactionId = firebaseService.saveTransaction(
                date = date,
                merchant = merchant,
                amount = amount,
                card = card,
                comment = comment,
                budgetId = selectedBudget!!.id,
                def = selectedItem,
                accountId = selectedAccount!!.id,
                isUnnecessary = isUnnecessary,
                excludeFromSharedCalc = excludeFromSharedCalc,
                projectId = selectedProject?.id,
                projectSubcategory = if (selectedProject != null) selectedProjectSubcategory else null,
                paidPrivately = showPaidPrivately && paidPrivately,
                coveredByAccountId = coveredByAccountId,
                currency = currency,
                awaitingRefund = awaitingRefund,
                expectedRefundAmount = expectedRefundAmount.replace(",", ".").toDoubleOrNull()
            )
            isSaving = false
            if (transactionId != null) { onSaved(); onDismiss() }
        }
        Unit
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Bokfør kjøp", fontWeight = FontWeight.Bold)
                        Text(
                            "Lagres som bokført til bankens kopi kommer",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, contentDescription = "Lukk") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface)
            )
        },
        bottomBar = {
            Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    SummaryLine(text = summary, ready = canSave)
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = onDismiss) { Text("Avbryt") }
                        Spacer(Modifier.weight(1f))
                        Button(
                            onClick = save,
                            enabled = canSave,
                            shape = RoundedCornerShape(10.dp),
                            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp)
                        ) {
                            if (isSaving) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Lagre", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                            }
                        }
                    }
                }
            }
        }
    ) { padding ->
        if (isLoading) {
            Box(modifier = Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            TransactionCard(merchant = merchant, amount = amount, card = card, date = date, currency = currency, account = selectedAccount)

            // ---- Detaljer ----
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                SectionTitle("Detaljer")

                FieldLabel("Budsjett")
                ChipRow(
                    options = budgets.map { it.id to it.name },
                    selectedId = selectedBudget?.id,
                    onSelect = { id -> selectedBudget = budgets.find { it.id == id } },
                    selectedColor = { id -> if (budgets.find { it.id == id }?.type == "shared") purpleChip() else null }
                )

                FieldLabel("Konto", hint = if (cardAutoMatched) "foreslått fra kortet i varselet" else null)
                AccountDropdown(
                    label = "Konto",
                    accounts = accounts,
                    selectedId = selectedAccount?.id,
                    noneLabel = null,
                    onSelect = { id -> selectedAccount = accounts.find { it.id == id } }
                )

                FieldLabel("Budsjettpost")
                if (selectedItem != null && !itemPickerOpen) {
                    SelectedItemCard(
                        item = selectedItem!!,
                        suggested = isSuggested,
                        onChange = { itemPickerOpen = true; itemSearch = "" }
                    )
                } else {
                    ItemPicker(
                        items = items,
                        search = itemSearch,
                        onSearchChange = { itemSearch = it },
                        selectedId = selectedItem?.id,
                        onSelect = { selectedItem = it; itemPickerOpen = false; itemSearch = "" }
                    )
                }

                if (visibleProjects.isNotEmpty()) {
                    ProjectPicker(
                        projects = visibleProjects,
                        selectedProject = selectedProject,
                        onProjectSelect = { selectedProject = it; selectedProjectSubcategory = null },
                        selectedSubcategory = selectedProjectSubcategory,
                        onSubcategorySelect = { selectedProjectSubcategory = it }
                    )
                }
            }

            // ---- Flere valg ----
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth().clickable { showMore = !showMore },
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    SectionTitle("Flere valg")
                    Spacer(Modifier.width(8.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.weight(1f)) {
                        activeAdjustments.forEach { Badge(it) }
                    }
                    Icon(
                        if (showMore) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                if (showMore) {
                    Card(
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        elevation = CardDefaults.cardElevation(0.dp)
                    ) {
                        Column(modifier = Modifier.padding(vertical = 4.dp)) {
                            ToggleRow(
                                checked = excludeFromSharedCalc,
                                onCheckedChange = { excludeFromSharedCalc = it; if (!it) coveredByAccountId = null },
                                label = "Holdes utenfor oppgjør",
                                hint = "Telles mot budsjettposten, men ingen skylder noe for det i oppgjøret."
                            )
                            if (excludeFromSharedCalc) {
                                AccountDropdown(
                                    label = "Betales fra",
                                    accounts = accounts,
                                    selectedId = coveredByAccountId,
                                    noneLabel = "Ingen annen konto",
                                    onSelect = { coveredByAccountId = it },
                                    modifier = Modifier.padding(start = 48.dp, end = 16.dp, bottom = 8.dp)
                                )
                            }
                            if (showPaidPrivately) {
                                ToggleRow(
                                    checked = paidPrivately,
                                    onCheckedChange = { paidPrivately = it },
                                    label = "Utlegg — jeg la ut med egne penger",
                                    hint = "Felles utgift fra privat konto. Trekkes fra det du skal overføre til felleskontoen."
                                )
                            }
                            ToggleRow(
                                checked = isUnnecessary,
                                onCheckedChange = { isUnnecessary = it },
                                label = "Unødvendig kjøp",
                                hint = "Ren merkelapp for egen bevisstgjøring. Telles helt som normalt."
                            )
                            ToggleRow(
                                checked = awaitingRefund,
                                onCheckedChange = { awaitingRefund = it; if (!it) expectedRefundAmount = "" },
                                label = "Venter refusjon",
                                hint = "Noen skal betale deg tilbake (Vipps e.l.). Innbetalingen kobles i web-appen."
                            )
                            if (awaitingRefund) {
                                OutlinedTextField(
                                    value = expectedRefundAmount,
                                    onValueChange = { v -> if (v.isEmpty() || v.matches(Regex("^\\d*[.,]?\\d{0,2}$"))) expectedRefundAmount = v },
                                    label = { Text("Forventet beløp (tomt = hele kjøpet)") },
                                    suffix = { Text("kr") },
                                    singleLine = true,
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                    modifier = Modifier.fillMaxWidth().padding(start = 48.dp, end = 16.dp, bottom = 8.dp)
                                )
                            }
                            OutlinedTextField(
                                value = comment,
                                onValueChange = { comment = it },
                                label = { Text("Kommentar (valgfritt)") },
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                                maxLines = 3
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

// ---------------------------------------------------------------- pieces

@Composable
private fun TransactionCard(merchant: String, amount: String, card: String, date: String, currency: String?, account: Account?) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.25f)),
        elevation = CardDefaults.cardElevation(0.dp)
    ) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.CalendarToday, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(13.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(date, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
                }
                Spacer(Modifier.height(4.dp))
                Text(merchant, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.CreditCard, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(13.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(
                        listOfNotNull(account?.name, card.takeIf { it.isNotEmpty() }?.let { "•••• $it" }).joinToString(" · ").ifEmpty { "Konto ikke valgt" },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    "-$amount ${currency ?: "kr"}",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.ExtraBold,
                    color = MaterialTheme.colorScheme.error
                )
                if (currency != null) {
                    Text(
                        "Omtrentlig — banken fører NOK-beløpet",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.widthIn(max = 140.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
}

@Composable
private fun FieldLabel(text: String, hint: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (hint != null) {
            Spacer(Modifier.width(6.dp))
            Text("· $hint", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f))
        }
    }
}

private data class ChipColors(val container: Color, val label: Color)

@Composable
private fun purpleChip() = ChipColors(if (isSystemInDarkTheme()) Purple300.copy(alpha = 0.25f) else Purple600, if (isSystemInDarkTheme()) Purple300 else Color.White)

/** Pills like the web app's filter chips: one selected, the rest outlined. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChipRow(
    options: List<Pair<String, String>>,
    selectedId: String?,
    onSelect: (String) -> Unit,
    selectedColor: @Composable (String) -> ChipColors? = { null }
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (id, name) ->
            val selected = id == selectedId
            val custom = if (selected) selectedColor(id) else null
            val container = custom?.container ?: if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface
            val label = custom?.label ?: if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = container,
                border = BorderStroke(1.dp, if (selected) container else MaterialTheme.colorScheme.outline),
                modifier = Modifier.clickable { onSelect(id) }
            ) {
                Text(
                    name,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = label,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                )
            }
        }
    }
}

@Composable
private fun SelectedItemCard(item: BudgetItem, suggested: Boolean, onChange: () -> Unit) {
    val dark = isSystemInDarkTheme()
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onChange),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = if (suggested) (if (dark) Purple300.copy(alpha = 0.15f) else Color(0xFFFAF5FF)) else MaterialTheme.colorScheme.primaryContainer),
        border = BorderStroke(1.dp, if (suggested) (if (dark) Purple300.copy(alpha = 0.5f) else Color(0xFFE9D5FF)) else MaterialTheme.colorScheme.primary.copy(alpha = 0.3f)),
        elevation = CardDefaults.cardElevation(0.dp)
    ) {
        Row(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                if (suggested) Icons.Filled.AutoAwesome else Icons.Filled.Check,
                contentDescription = null,
                tint = if (suggested) (if (dark) Purple300 else Purple600) else MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp)
            )
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("${item.categoryName} › ${item.name}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                Text(
                    if (suggested) "Foreslått fra sist du bokførte denne butikken" else "Valgt budsjettpost",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Text("Endre", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun ItemPicker(
    items: List<BudgetItem>,
    search: String,
    onSearchChange: (String) -> Unit,
    selectedId: String?,
    onSelect: (BudgetItem) -> Unit
) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        elevation = CardDefaults.cardElevation(0.dp)
    ) {
        Column {
            OutlinedTextField(
                value = search,
                onValueChange = onSearchChange,
                placeholder = { Text("Søk i budsjettposter…") },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(12.dp)
            )
            val filtered = items.filter { search.isBlank() || it.name.contains(search, ignoreCase = true) || it.categoryName.contains(search, ignoreCase = true) }
            if (filtered.isEmpty()) {
                Text(
                    if (items.isEmpty()) "Ingen budsjettposter for valgt budsjett." else "Ingen treff.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp)
                )
            }
            filtered.groupBy { it.categoryName }.forEach { (category, group) ->
                Text(
                    category.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))
                        .padding(horizontal = 14.dp, vertical = 6.dp)
                )
                group.forEach { item ->
                    val selected = item.id == selectedId
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelect(item) }
                            .background(if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)
                            .padding(horizontal = 14.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(item.name, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
                        if (selected) Icon(Icons.Filled.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProjectPicker(
    projects: List<Project>,
    selectedProject: Project?,
    onProjectSelect: (Project?) -> Unit,
    selectedSubcategory: String?,
    onSubcategorySelect: (String?) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = selectedProject?.name ?: "Ingen prosjekt",
            onValueChange = {},
            readOnly = true,
            label = { Text("Prosjekt") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor()
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(text = { Text("Ingen prosjekt") }, onClick = { onProjectSelect(null); expanded = false })
            projects.forEach { project ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(project.name)
                            if (project.description.isNotEmpty()) {
                                Text(project.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    },
                    onClick = { onProjectSelect(project); expanded = false }
                )
            }
        }
    }
    val subcategories = selectedProject?.subcategories ?: emptyList()
    if (subcategories.isNotEmpty()) {
        var subExpanded by remember(selectedProject?.id) { mutableStateOf(false) }
        ExposedDropdownMenuBox(expanded = subExpanded, onExpandedChange = { subExpanded = it }) {
            OutlinedTextField(
                value = selectedSubcategory ?: "Ingen underkategori",
                onValueChange = {},
                readOnly = true,
                label = { Text("Underkategori i prosjektet") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = subExpanded) },
                modifier = Modifier.fillMaxWidth().menuAnchor()
            )
            ExposedDropdownMenu(expanded = subExpanded, onDismissRequest = { subExpanded = false }) {
                DropdownMenuItem(text = { Text("Ingen underkategori") }, onClick = { onSubcategorySelect(null); subExpanded = false })
                subcategories.forEach { s -> DropdownMenuItem(text = { Text(s) }, onClick = { onSubcategorySelect(s); subExpanded = false }) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AccountDropdown(
    label: String,
    accounts: List<Account>,
    selectedId: String?,
    noneLabel: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = accounts.find { it.id == selectedId }?.name ?: noneLabel ?: "Velg konto",
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor()
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (noneLabel != null) DropdownMenuItem(text = { Text(noneLabel) }, onClick = { onSelect(null); expanded = false })
            accounts.forEach { acc -> DropdownMenuItem(text = { Text(acc.name) }, onClick = { onSelect(acc.id); expanded = false }) }
        }
    }
}

@Composable
private fun Badge(text: String) {
    Surface(shape = RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.primaryContainer) {
        Text(
            text.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
        )
    }
}

@Composable
private fun SummaryLine(text: String, ready: Boolean) {
    val dark = isSystemInDarkTheme()
    val (bg, border, fg) = if (ready) Triple(if (dark) GreenDarkContainer else Green50, if (dark) Green300.copy(alpha = 0.4f) else Color(0xFFBBF7D0), if (dark) Green300 else Green700)
    else Triple(if (dark) AmberDarkContainer else Amber50, if (dark) Amber300.copy(alpha = 0.4f) else Color(0xFFFDE68A), if (dark) Amber300 else Amber600)
    Surface(shape = RoundedCornerShape(10.dp), color = bg, border = BorderStroke(1.dp, border), modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            Text("Blir: ", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = fg)
            Text(text, style = MaterialTheme.typography.bodySmall, color = fg)
        }
    }
}

@Composable
fun ToggleRow(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String,
    hint: String? = null
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(checked = checked, onCheckedChange = onCheckedChange)
        Column(modifier = Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
            if (hint != null) {
                Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
