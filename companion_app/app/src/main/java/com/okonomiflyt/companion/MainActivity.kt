package com.okonomiflyt.companion

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.okonomiflyt.companion.ui.theme.OkonomiFlytCompanionTheme

class MainActivity : ComponentActivity() {
    // Bumped on every resume so the home screen re-reads local state (e.g.
    // trigger history) after returning from the logging flow.
    private var resumeTick by mutableStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        com.okonomiflyt.companion.receipts.ReceiptReminderWorker.schedule(this)
        setContent {
            OkonomiFlytCompanionTheme {
                MainScreen(resumeTick)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        resumeTick++
    }
}

@Composable
fun MainScreen(resumeTick: Int) {
    var showSettings by remember { mutableStateOf(false) }
    if (showSettings) {
        SettingsScreen(onBack = { showSettings = false })
    } else {
        HomeScreen(resumeTick = resumeTick, onOpenSettings = { showSettings = true })
    }
}

// ============================ HOME ============================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(resumeTick: Int, onOpenSettings: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var recentReceipts by remember { mutableStateOf<List<ReceiptSummary>>(emptyList()) }
    var triggers by remember { mutableStateOf<List<TriggerEvent>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }

    fun reload() {
        triggers = TriggerHistory.list(context)
        scope.launch {
            loading = true
            recentReceipts = FirebaseService().getRecentReceipts()
            loading = false
        }
    }
    LaunchedEffect(Unit) { reload() }
    // Re-read trigger history when returning from the logging flow
    LaunchedEffect(resumeTick) { triggers = TriggerHistory.list(context) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Oversikt", fontWeight = FontWeight.Bold) },
                actions = {
                    IconButton(onClick = { reload() }) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Oppdater")
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = "Info og innstillinger")
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
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
        ) {
            if (triggers.isNotEmpty()) {
                Text(
                    "Siste kjøp",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 8.dp)
                )
                Text(
                    "Betalinger appen har fanget opp — trykk for å kategorisere.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 8.dp)
                )
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    triggers.forEach { event ->
                        TriggerRow(
                            event = event,
                            onRemove = {
                                TriggerHistory.remove(context, event.id)
                                triggers = TriggerHistory.list(context)
                            },
                            onClick = {
                                context.startActivity(
                                    Intent(context, com.okonomiflyt.companion.ui.LogTransactionActivity::class.java).apply {
                                        putExtra("merchant", event.merchant)
                                        putExtra("amount", event.amount)
                                        putExtra("card", event.card)
                                        putExtra("date", event.date)
                                        putExtra("currency", event.currency.ifEmpty { null })
                                        putExtra("triggerId", event.id)
                                    }
                                )
                            }
                        )
                    }
                }
                Spacer(Modifier.height(20.dp))
            }

            Text(
                "De siste loggede kvitteringene dine",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp, bottom = 12.dp)
            )

            when {
                loading && recentReceipts.isEmpty() ->
                    Box(Modifier.fillMaxWidth().padding(top = 48.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                recentReceipts.isEmpty() -> EmptyReceipts()
                else -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    recentReceipts.forEach { ReceiptRow(it) }
                }
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
fun TriggerRow(event: TriggerEvent, onRemove: () -> Unit, onClick: () -> Unit) {
    val time = java.text.SimpleDateFormat("dd.MM 'kl.' HH:mm", java.util.Locale.getDefault())
        .format(java.util.Date(event.timestamp))
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHighest),
        elevation = CardDefaults.cardElevation(0.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Surface(
                shape = CircleShape,
                color = if (event.saved) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.errorContainer,
                modifier = Modifier.size(44.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        if (event.saved) Icons.Filled.CheckCircle else Icons.Filled.ShoppingCart,
                        contentDescription = null,
                        tint = if (event.saved) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(event.merchant, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text(
                    time + if (event.card.isNotEmpty()) " · •••• ${event.card}" else "",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("${event.amount} ${event.currency.ifEmpty { "kr" }}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text(
                    if (event.saved) "Lagret" else "Ikke lagret",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (event.saved) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
                )
            }
            IconButton(onClick = onRemove, modifier = Modifier.size(32.dp)) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = "Fjern fra listen",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}

@Composable
fun EmptyReceipts() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 56.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.size(72.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.AutoMirrored.Filled.ReceiptLong,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.size(34.dp)
                )
            }
        }
        Spacer(Modifier.height(16.dp))
        Text("Ingen kvitteringer ennå", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(4.dp))
        Text(
            "Del en kvittering fra Coop-appen til ØkonomiFlyt, så dukker den opp her.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
fun ReceiptRow(receipt: ReceiptSummary) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHighest),
        elevation = CardDefaults.cardElevation(0.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(44.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.AutoMirrored.Filled.ReceiptLong,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(receipt.store, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text(
                    "${receipt.date} · ${receipt.itemCount} varer",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    "${String.format(java.util.Locale.forLanguageTag("nb-NO"), "%,.2f", receipt.total)} kr",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )
                StatusPill(matched = receipt.matched)
            }
        }
    }
}

@Composable
fun StatusPill(matched: Boolean) {
    val bg = if (matched) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (matched) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
    Surface(shape = RoundedCornerShape(50), color = bg) {
        Text(
            if (matched) "Koblet" else "Ukoblet",
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            color = fg,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
        )
    }
}

// ======================== SETTINGS / INFO ========================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val notificationPermissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission()
    ) { }

    var geofenceStatus by remember { mutableStateOf<String?>(null) }

    val backgroundLocationLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission()
    ) { granted ->
        geofenceStatus = if (granted) "Posisjonstilgang gitt — aktiver varslingen under."
        else "Bakgrunnsposisjon avslått — velg «Tillat hele tiden» i innstillingene."
    }
    val fineLocationLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        if (result[android.Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                backgroundLocationLauncher.launch(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            } else {
                geofenceStatus = "Posisjonstilgang gitt — aktiver varslingen under."
            }
        } else {
            geofenceStatus = "Posisjonstilgang avslått."
        }
    }

    fun activateGeofencing() {
        scope.launch {
            geofenceStatus = "Aktiverer …"
            val count = com.okonomiflyt.companion.receipts.StoreGeofencing.registerAll(context)
            geofenceStatus = when {
                count < 0 -> "Mangler posisjonstilgang («Tillat hele tiden»)."
                count == 0 -> "Klarte ikke å registrere soner — prøv igjen."
                else -> "Aktiv for $count butikker."
            }
        }
    }

    @SuppressLint("MissingPermission")
    fun registerCurrentLocationAsStore(name: String) {
        scope.launch {
            geofenceStatus = "Henter posisjon …"
            try {
                val location = com.google.android.gms.location.LocationServices
                    .getFusedLocationProviderClient(context)
                    .getCurrentLocation(
                        com.google.android.gms.location.Priority.PRIORITY_HIGH_ACCURACY,
                        null
                    )
                    .await()
                if (location == null) {
                    geofenceStatus = "Fant ikke posisjon — prøv igjen utendørs."
                    return@launch
                }
                val ok = FirebaseService().saveStoreLocation(name, location.latitude, location.longitude)
                if (ok) {
                    activateGeofencing()
                    geofenceStatus = "«$name» registrert her. Soner oppdatert."
                } else {
                    geofenceStatus = "Lagring feilet."
                }
            } catch (e: Exception) {
                geofenceStatus = "Feil: ${e.message}"
            }
        }
    }

    var showStoreNameDialog by remember { mutableStateOf(false) }
    var storeName by remember { mutableStateOf("Extra ") }

    if (showStoreNameDialog) {
        AlertDialog(
            onDismissRequest = { showStoreNameDialog = false },
            title = { Text("Registrer butikk her") },
            text = {
                Column {
                    Text(
                        "Stå i eller rett utenfor butikken. Samme navn overskriver eksisterende posisjon.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = storeName, onValueChange = { storeName = it },
                        label = { Text("Butikknavn") }, modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(onClick = {
                    showStoreNameDialog = false
                    registerCurrentLocationAsStore(storeName.trim())
                }, enabled = storeName.isNotBlank()) { Text("Lagre") }
            },
            dismissButton = {
                TextButton(onClick = { showStoreNameDialog = false }) { Text("Avbryt") }
            }
        )
    }

    var testMerchant by remember { mutableStateOf("Testbutikk") }
    var testAmount by remember { mutableStateOf("150,00") }
    var testCard by remember { mutableStateOf("1234") }
    var showTestConfig by remember { mutableStateOf(false) }

    if (showTestConfig) {
        AlertDialog(
            onDismissRequest = { showTestConfig = false },
            title = { Text("Konfigurer testvarsel") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = testMerchant, onValueChange = { testMerchant = it }, label = { Text("Butikk") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = testAmount, onValueChange = { testAmount = it }, label = { Text("Beløp") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = testCard, onValueChange = { testCard = it }, label = { Text("Siste 4 kortsifre") }, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                Button(onClick = {
                    val serviceIntent = Intent(context, NotificationService::class.java).apply {
                        action = "TEST_NOTIFICATION"
                        putExtra("test_merchant", testMerchant)
                        putExtra("test_amount", testAmount)
                        putExtra("test_card", testCard)
                    }
                    context.startService(serviceIntent)
                    showTestConfig = false
                }) { Text("Send") }
            },
            dismissButton = { TextButton(onClick = { showTestConfig = false }) { Text("Avbryt") } }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Info og innstillinger", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Tilbake")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface)
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .padding(innerPadding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("Slik fungerer det", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            HowItWorksStep(Icons.Filled.CreditCard, "1", "Betal med Google Wallet", "Kjøp utløser automatisk et varsel fra banken på telefonen din.")
            HowItWorksStep(Icons.Filled.Notifications, "2", "Appen fanger varselet", "Companion-appen leser varselet og trekker ut butikk, beløp og kortnummer.")
            HowItWorksStep(Icons.Filled.CheckCircle, "3", "Du kategoriserer", "En dialog åpnes der du velger budsjett og budsjettpost. Appen husker valget til neste gang!")
            HowItWorksStep(Icons.Filled.Cloud, "4", "Lagres i ØkonomiFlyt", "Transaksjonen lagres direkte i databasen og er klar for avstemming.")

            HorizontalDivider()

            Text("Kvitteringer", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            HowItWorksStep(Icons.AutoMirrored.Filled.ReceiptLong, "1", "Del kvitteringen", "Åpne Coop-appen, finn kvitteringen og velg Del → ØkonomiFlyt. Du kan dele flere på en gang.")
            HowItWorksStep(Icons.Filled.AutoAwesome, "2", "KI leser varelinjene", "Kvitteringen analyseres vare for vare — inkludert pant og rabatter — og knyttes automatisk til riktig transaksjon.")
            HowItWorksStep(Icons.Filled.Insights, "3", "Se hvor pengene går", "Over tid bygges statistikk over matforbruk per kategori og prisutvikling per vare. En ukentlig påminnelse hjelper deg å huske delingen.")

            // Geofence card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                elevation = CardDefaults.cardElevation(0.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.Filled.LocationOn, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                        Text("Varsling etter handel", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Får du varsel ca. 20 min etter at du har handlet på en registrert butikk. Krever posisjonstilgang «Tillat hele tiden». Stå i butikken og bruk «Registrer butikk her» for å registrere eller finjustere sonene.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    geofenceStatus?.let {
                        Spacer(Modifier.height(6.dp))
                        Text(it, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                    }
                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(
                        onClick = {
                            fineLocationLauncher.launch(arrayOf(
                                android.Manifest.permission.ACCESS_FINE_LOCATION,
                                android.Manifest.permission.ACCESS_COARSE_LOCATION
                            ))
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("1. Gi posisjonstilgang") }
                    Spacer(Modifier.height(6.dp))
                    OutlinedButton(onClick = { activateGeofencing() }, modifier = Modifier.fillMaxWidth()) { Text("2. Aktiver butikkvarsling") }
                    Spacer(Modifier.height(6.dp))
                    OutlinedButton(onClick = { showStoreNameDialog = true }, modifier = Modifier.fillMaxWidth()) { Text("Registrer butikk her") }
                }
            }

            HorizontalDivider()

            Text("Tilganger", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            SettingsCard(
                icon = Icons.Filled.NotificationsActive,
                title = "Les varsler",
                description = "Nødvendig for å fange opp Google Wallet-varsler automatisk.",
                buttonText = "Åpne tilgangsinnstillinger",
                onClick = { context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
            )
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                SettingsCard(
                    icon = Icons.Filled.Campaign,
                    title = "Vis varsler",
                    description = "Nødvendig for å vise kategori-dialogen når et kjøp er registrert.",
                    buttonText = "Gi tillatelse",
                    onClick = { notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS) }
                )
            }

            HorizontalDivider()

            Text("Testing", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            SettingsCard(
                icon = Icons.Filled.BugReport,
                title = "Send testvarsel",
                description = "Simuler et Google Wallet-varsel med egendefinert butikk, beløp og kort for å teste flyten.",
                buttonText = "Konfigurer og send",
                onClick = { showTestConfig = true }
            )

            HorizontalDivider()

            Text(
                "Bygget ${BuildConfig.VERSION_NAME} (versjonskode ${BuildConfig.VERSION_CODE})",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .fillMaxWidth()
                    .wrapContentWidth(Alignment.CenterHorizontally)
            )

            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
fun HowItWorksStep(icon: ImageVector, step: String, title: String, description: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.size(44.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.size(22.dp))
            }
        }
        Column {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun SettingsCard(icon: ImageVector, title: String, description: String, buttonText: String, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        elevation = CardDefaults.cardElevation(0.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(4.dp))
            Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(10.dp))
            OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(buttonText) }
        }
    }
}
