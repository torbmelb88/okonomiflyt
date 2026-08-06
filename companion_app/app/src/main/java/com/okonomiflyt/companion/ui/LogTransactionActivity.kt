package com.okonomiflyt.companion.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okonomiflyt.companion.Account
import com.okonomiflyt.companion.Budget
import com.okonomiflyt.companion.BudgetItem
import com.okonomiflyt.companion.FirebaseService
import com.okonomiflyt.companion.Project
import com.okonomiflyt.companion.TriggerHistory
import kotlinx.coroutines.launch
import com.okonomiflyt.companion.ui.theme.OkonomiFlytCompanionTheme

class LogTransactionActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val merchant = intent.getStringExtra("merchant") ?: "Ukjent"
        val amount = intent.getStringExtra("amount") ?: "0"
        val card = intent.getStringExtra("card") ?: ""
        val date = intent.getStringExtra("date") ?: java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())
        val triggerId = intent.getLongExtra("triggerId", -1L)

        setContent {
            OkonomiFlytCompanionTheme {
                LogTransactionScreen(
                    merchant = merchant,
                    amount = amount,
                    card = card,
                    date = date,
                    onSaved = { if (triggerId != -1L) TriggerHistory.markSaved(this, triggerId) },
                    onDismiss = { finish() }
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogTransactionScreen(
    merchant: String,
    amount: String,
    card: String,
    date: String,
    onSaved: () -> Unit = {},
    onDismiss: () -> Unit
) {
    val firebaseService = remember { FirebaseService() }
    val scope = rememberCoroutineScope()

    var currentStep by remember { mutableStateOf(1) }
    val totalSteps = 4

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
    var cardAutoMatched by remember { mutableStateOf(false) }
    var projectExpanded by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        isLoading = true
        budgets = firebaseService.getBudgets()
        accounts = firebaseService.getAccounts()
        projects = firebaseService.getProjects()

        val preference = firebaseService.getMerchantPreference(merchant)

        val cardMatchedAccount = accounts.find {
            it.cardLastFour != null && it.cardLastFour.isNotEmpty() && card.endsWith(it.cardLastFour)
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

    // Projects scoped to the selected budget; legacy projects without a
    // budgetId are visible everywhere (mirrors the web app)
    val visibleProjects = projects.filter {
        it.budgetId.isNullOrEmpty() || it.budgetId == selectedBudget?.id
    }

    val stepTitles = listOf("Velg budsjett", "Velg konto", "Velg budsjettpost", "Detaljer")

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(stepTitles[currentStep - 1], fontWeight = FontWeight.Bold)
                        Text(
                            "Steg $currentStep av $totalSteps",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = {
                        if (currentStep > 1) currentStep-- else onDismiss()
                    }) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "Tilbake")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
        ) {
            LinearProgressIndicator(
                progress = { currentStep.toFloat() / totalSteps },
                modifier = Modifier.fillMaxWidth()
            )

            // Transaction header — always visible
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                ),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Filled.ShoppingCart,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = merchant,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "$amount kr",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.ExtraBold,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        if (card.isNotEmpty()) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Filled.CreditCard,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f),
                                    modifier = Modifier.size(13.dp)
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    text = "•••• $card",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                                )
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Filled.CalendarToday,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f),
                                modifier = Modifier.size(13.dp)
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                text = date,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                            )
                        }
                    }
                }
            }

            if (isLoading) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                when (currentStep) {
                    1 -> StepBudget(
                        budgets = budgets,
                        selected = selectedBudget,
                        onSelect = { budget ->
                            selectedBudget = budget
                            currentStep = 2
                        }
                    )
                    2 -> StepAccount(
                        accounts = accounts,
                        selected = selectedAccount,
                        cardAutoMatched = cardAutoMatched,
                        onSelect = { account ->
                            selectedAccount = account
                            currentStep = 3
                        }
                    )
                    3 -> StepBudgetItem(
                        items = items,
                        selected = selectedItem,
                        onSelect = { item ->
                            selectedItem = item
                            currentStep = 4
                        }
                    )
                    4 -> StepDetails(
                        comment = comment,
                        onCommentChange = { comment = it },
                        isUnnecessary = isUnnecessary,
                        onIsUnnecessaryChange = { isUnnecessary = it },
                        excludeFromSharedCalc = excludeFromSharedCalc,
                        onExcludeChange = { excludeFromSharedCalc = it; if (!it) coveredByAccountId = null },
                        accounts = accounts,
                        coveredByAccountId = coveredByAccountId,
                        onCoveredByChange = { coveredByAccountId = it },
                        showPaidPrivately = showPaidPrivately,
                        paidPrivately = paidPrivately,
                        onPaidPrivatelyChange = { paidPrivately = it },
                        projects = visibleProjects,
                        selectedProject = selectedProject,
                        onProjectSelect = { selectedProject = it; selectedProjectSubcategory = null },
                        projectExpanded = projectExpanded,
                        onProjectExpandedChange = { projectExpanded = it },
                        selectedProjectSubcategory = selectedProjectSubcategory,
                        onProjectSubcategorySelect = { selectedProjectSubcategory = it },
                        isSaving = isSaving,
                        onSave = {
                            isSaving = true
                            scope.launch {
                                val success = firebaseService.saveTransaction(
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
                                    coveredByAccountId = coveredByAccountId
                                )
                                isSaving = false
                                if (success) { onSaved(); onDismiss() }
                            }
                        },
                        onDismiss = onDismiss
                    )
                }
            }
        }
    }
}

@Composable
fun StepBudget(
    budgets: List<Budget>,
    selected: Budget?,
    onSelect: (Budget) -> Unit
) {
    if (budgets.isEmpty()) {
        EmptyState("Ingen budsjetter funnet")
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(budgets) { budget ->
            SelectionCard(
                title = budget.name,
                subtitle = budget.type.takeIf { it.isNotEmpty() },
                isSelected = budget.id == selected?.id,
                onClick = { onSelect(budget) }
            )
        }
    }
}

@Composable
fun StepAccount(
    accounts: List<Account>,
    selected: Account?,
    cardAutoMatched: Boolean,
    onSelect: (Account) -> Unit
) {
    if (accounts.isEmpty()) {
        EmptyState("Ingen kontoer funnet")
        return
    }
    Column(modifier = Modifier.fillMaxSize()) {
        if (cardAutoMatched) {
            Text(
                text = "Konto er automatisk foreslått fra kortets siste 4 siffer",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
            )
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(accounts) { account ->
                SelectionCard(
                    title = account.name,
                    isSelected = account.id == selected?.id,
                    onClick = { onSelect(account) }
                )
            }
        }
    }
}

@Composable
fun StepBudgetItem(
    items: List<BudgetItem>,
    selected: BudgetItem?,
    onSelect: (BudgetItem) -> Unit
) {
    if (items.isEmpty()) {
        EmptyState("Ingen budsjettposte funnet for valgt budsjett")
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(items) { item ->
            SelectionCard(
                title = item.name,
                isSelected = item.id == selected?.id,
                onClick = { onSelect(item) }
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StepDetails(
    comment: String,
    onCommentChange: (String) -> Unit,
    isUnnecessary: Boolean,
    onIsUnnecessaryChange: (Boolean) -> Unit,
    excludeFromSharedCalc: Boolean,
    onExcludeChange: (Boolean) -> Unit,
    accounts: List<Account>,
    coveredByAccountId: String?,
    onCoveredByChange: (String?) -> Unit,
    showPaidPrivately: Boolean,
    paidPrivately: Boolean,
    onPaidPrivatelyChange: (Boolean) -> Unit,
    projects: List<Project>,
    selectedProject: Project?,
    onProjectSelect: (Project?) -> Unit,
    projectExpanded: Boolean,
    onProjectExpandedChange: (Boolean) -> Unit,
    selectedProjectSubcategory: String?,
    onProjectSubcategorySelect: (String?) -> Unit,
    isSaving: Boolean,
    onSave: () -> Unit,
    onDismiss: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        OutlinedTextField(
            value = comment,
            onValueChange = onCommentChange,
            label = { Text("Kommentar (valgfritt)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = false,
            maxLines = 4
        )

        if (projects.isNotEmpty()) {
            ExposedDropdownMenuBox(
                expanded = projectExpanded,
                onExpandedChange = { onProjectExpandedChange(it) }
            ) {
                OutlinedTextField(
                    value = selectedProject?.name ?: "Ingen prosjekt",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Prosjekt (valgfritt)") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = projectExpanded) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .menuAnchor()
                )
                ExposedDropdownMenu(
                    expanded = projectExpanded,
                    onDismissRequest = { onProjectExpandedChange(false) }
                ) {
                    DropdownMenuItem(
                        text = { Text("Ingen prosjekt") },
                        onClick = {
                            onProjectSelect(null)
                            onProjectExpandedChange(false)
                        }
                    )
                    projects.forEach { project ->
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(project.name)
                                    if (project.description.isNotEmpty()) {
                                        Text(
                                            project.description,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                                        )
                                    }
                                }
                            },
                            onClick = {
                                onProjectSelect(project)
                                onProjectExpandedChange(false)
                            }
                        )
                    }
                }
            }

            val subcategories = selectedProject?.subcategories ?: emptyList()
            if (subcategories.isNotEmpty()) {
                var subcatExpanded by remember(selectedProject?.id) { mutableStateOf(false) }
                ExposedDropdownMenuBox(
                    expanded = subcatExpanded,
                    onExpandedChange = { subcatExpanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedProjectSubcategory ?: "Ingen underkategori",
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Underkategori (valgfritt)") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = subcatExpanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor()
                    )
                    ExposedDropdownMenu(
                        expanded = subcatExpanded,
                        onDismissRequest = { subcatExpanded = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("Ingen underkategori") },
                            onClick = {
                                onProjectSubcategorySelect(null)
                                subcatExpanded = false
                            }
                        )
                        subcategories.forEach { subcat ->
                            DropdownMenuItem(
                                text = { Text(subcat) },
                                onClick = {
                                    onProjectSubcategorySelect(subcat)
                                    subcatExpanded = false
                                }
                            )
                        }
                    }
                }
            }
        }

        ToggleRow(
            checked = isUnnecessary,
            onCheckedChange = onIsUnnecessaryChange,
            label = "Marker som unødvendig"
        )

        ToggleRow(
            checked = excludeFromSharedCalc,
            onCheckedChange = onExcludeChange,
            label = "Ekskluder fra fellesregnskap"
        )

        if (excludeFromSharedCalc) {
            var coveredExpanded by remember { mutableStateOf(false) }
            val selectedAccName = accounts.find { it.id == coveredByAccountId }?.name ?: "Nei / ikke spesifisert"
            ExposedDropdownMenuBox(
                expanded = coveredExpanded,
                onExpandedChange = { coveredExpanded = it }
            ) {
                OutlinedTextField(
                    value = selectedAccName,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Dekkes fra konto?") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = coveredExpanded) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .menuAnchor()
                )
                ExposedDropdownMenu(
                    expanded = coveredExpanded,
                    onDismissRequest = { coveredExpanded = false }
                ) {
                    DropdownMenuItem(
                        text = { Text("Nei / ikke spesifisert") },
                        onClick = { onCoveredByChange(null); coveredExpanded = false }
                    )
                    accounts.forEach { acc ->
                        DropdownMenuItem(
                            text = { Text(acc.name) },
                            onClick = { onCoveredByChange(acc.id); coveredExpanded = false }
                        )
                    }
                }
            }
        }

        if (showPaidPrivately) {
            Column {
                ToggleRow(
                    checked = paidPrivately,
                    onCheckedChange = onPaidPrivatelyChange,
                    label = "Utlegg – betalt med privat konto"
                )
                Text(
                    text = "Beløpet trekkes fra din overføring til felleskontoen. La stå av hvis kjøpet ble gjort med felleskort.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        Button(
            onClick = onSave,
            modifier = Modifier.fillMaxWidth(),
            enabled = !isSaving,
            shape = RoundedCornerShape(12.dp),
            contentPadding = PaddingValues(16.dp)
        ) {
            if (isSaving) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp
                )
            } else {
                Text("Lagre transaksjon", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }

        TextButton(
            onClick = onDismiss,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Avbryt")
        }
    }
}

@Composable
fun SelectionCard(
    title: String,
    subtitle: String? = null,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected)
                MaterialTheme.colorScheme.primaryContainer
            else
                MaterialTheme.colorScheme.surfaceVariant
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                    color = if (isSelected)
                        MaterialTheme.colorScheme.onPrimaryContainer
                    else
                        MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (subtitle != null) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (isSelected)
                            MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                        else
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                    )
                }
            }
            if (isSelected) {
                Icon(
                    Icons.Filled.Check,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}

@Composable
fun EmptyState(message: String) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
        )
    }
}

@Composable
fun ToggleRow(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(
            checked = checked,
            onCheckedChange = onCheckedChange
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium
        )
    }
}
