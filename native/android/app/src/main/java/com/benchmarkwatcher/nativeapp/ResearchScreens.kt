package com.benchmarkwatcher.nativeapp

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlin.math.abs

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResearchApp(vm: ResearchViewModel) {
    val state by vm.state.collectAsState()
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = "library") {
        composable("library") { LibraryScreen(state, vm) { nav.navigate("company/$it") } }
        composable("company/{cik}") { entry ->
            val cik = entry.arguments?.getString("cik") ?: return@composable
            Scaffold(topBar = { TopAppBar(title = { Text(state.library.reports[cik]?.ticker ?: "Company") }, navigationIcon = {
                IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") }
            }) }) { padding -> CompanyBrief(cik, state, vm, Modifier.padding(padding)) }
        }
    }
    state.error?.let { error ->
        AlertDialog(onDismissRequest = vm::dismissError, title = { Text("Research could not be updated") }, text = { Text(error) }, confirmButton = { TextButton(onClick = vm::dismissError) { Text("OK") } })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(state: ResearchState, vm: ResearchViewModel, open: (String) -> Unit) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    val titles = listOf("Following", "Search", "Research", "Updates")
    val icons = listOf(Icons.Outlined.StarOutline, Icons.Outlined.Search, Icons.Outlined.Notes, Icons.Outlined.Update)
    Scaffold(
        topBar = { TopAppBar(title = { Text(titles[tab]) }) },
        bottomBar = {
            NavigationBar {
                titles.forEachIndexed { index, title ->
                    NavigationBarItem(selected = tab == index, onClick = { tab = index }, icon = { Icon(icons[index], title) }, label = { Text(title) })
                }
            }
        }
    ) { padding ->
        BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
            val expanded = maxWidth >= 840.dp && tab in 0..1
            Row(Modifier.fillMaxSize()) {
                AnimatedContent(tab, modifier = if (expanded) Modifier.width(340.dp) else Modifier.fillMaxWidth(), label = "Library destination") { page ->
                    when (page) {
                        0 -> FollowingList(state) { cik -> if (expanded) selected = cik else open(cik) }
                        1 -> CompanySearchScreen(state, vm) { cik -> if (expanded) selected = cik else open(cik) }
                        2 -> ResearchNotes(state.library.notes)
                        else -> ResearchUpdates(state, vm)
                    }
                }
                if (expanded) {
                    VerticalDivider()
                    val cik = selected
                    if (cik == null) EmptyState("Select a company", "Its financial history and source evidence will appear here.", Modifier.weight(1f))
                    else CompanyBrief(cik, state, vm, Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
fun FollowingList(state: ResearchState, open: (String) -> Unit) {
    if (!state.initialized) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return }
    if (state.library.followed.isEmpty()) { EmptyState("Follow your research", "Find a company in Search, then follow it to keep its financial brief here."); return }
    LazyColumn {
        items(state.library.followed, key = { it.cik }) { company ->
            CompanyListRow(company, state.library.reports[company.cik]) { open(company.cik) }
            HorizontalDivider(Modifier.padding(horizontal = 16.dp))
        }
    }
}

@Composable
fun CompanyListRow(company: Company, report: Report? = null, onClick: () -> Unit) {
    ListItem(modifier = Modifier.clickable(onClick = onClick).heightIn(min = 72.dp), headlineContent = { Text(company.ticker, fontWeight = FontWeight.SemiBold) },
        supportingContent = { Column { Text(company.name); if (company.suggested) Text("Possible match · Confirm company", style = MaterialTheme.typography.labelSmall) } },
        trailingContent = {
            val metric = report?.metrics?.firstOrNull { it.id == "revenue" }
            val point = if (report != null && metric != null) report.chart(metric, "annual").lastOrNull() else null
            if (point != null) Column(horizontalAlignment = Alignment.End) {
                Text(compact(point.value.value, point.value.unit), fontWeight = FontWeight.SemiBold)
                Text(point.period.label + " · Revenue", style = MaterialTheme.typography.labelSmall)
            } else Text(company.exchange, style = MaterialTheme.typography.labelSmall)
        })
}

@Composable
fun CompanySearchScreen(state: ResearchState, vm: ResearchViewModel, open: (String) -> Unit) {
    Column {
        OutlinedTextField(value = state.query, onValueChange = vm::search, label = { Text("Ticker or company name") }, leadingIcon = { Icon(Icons.Outlined.Search, null) },
            modifier = Modifier.fillMaxWidth().padding(16.dp), singleLine = true)
        if (state.searching) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (state.searchStale) Text("Saved SEC directory", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.labelSmall)
        state.searchError?.let { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error) }
        if (state.matches.isEmpty() && !state.searching && state.searchError == null) EmptyState(if (state.query.length < 2) "Find a company" else "No matching company", "Reports use historical SEC disclosures. Try a ticker, company name, or SEC identifier.")
        LazyColumn { items(state.matches, key = { it.cik }) { company -> CompanyListRow(company) { open(company.cik) } } }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CompanyBrief(cik: String, state: ResearchState, vm: ResearchViewModel, modifier: Modifier = Modifier) {
    LaunchedEffect(cik, state.initialized) { vm.load(cik) }
    val report = state.library.reports[cik]
    if (report == null) {
        Column(modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            if (cik in state.loading) { CircularProgressIndicator(); Text("Reading SEC financials…", Modifier.padding(16.dp)) }
            else { Text("Report unavailable"); TextButton(onClick = { vm.load(cik) }) { Text("Try again") } }
        }; return
    }
    var metricID by rememberSaveable(cik) { mutableStateOf("revenue") }
    var frequency by rememberSaveable(cik) { mutableStateOf("annual") }
    var selected by rememberSaveable(cik, metricID, frequency) { mutableStateOf<String?>(null) }
    var sourceOpen by remember { mutableStateOf(false) }
    var noteOpen by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var basisOpen by remember { mutableStateOf(false) }
    val metric = report.metrics.firstOrNull { it.id == metricID } ?: report.metrics.first()
    val points = report.chart(metric, frequency)
    val point = points.firstOrNull { it.period.id == selected } ?: points.lastOrNull()
    val followed = state.library.followed.any { it.cik == cik }
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(report.company, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text(report.industry, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text((if (report.stale) "Cached source · " else "") + "Checked " + report.checked.take(10), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 8.dp))
                }
                IconButton(onClick = { vm.follow(report) }) { Icon(if (followed) Icons.Outlined.Star else Icons.Outlined.StarOutline, if (followed) "Unfollow company" else "Follow company") }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    OutlinedButton(onClick = { menuOpen = true }) { Text(metric.label); Icon(Icons.Outlined.ArrowDropDown, null) }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        report.metrics.forEach { value -> DropdownMenuItem(text = { Text(value.label) }, onClick = { metricID = value.id; menuOpen = false }) }
                    }
                }
                IconButton(onClick = { vm.load(cik, true) }, enabled = cik !in state.loading) { Icon(Icons.Outlined.Refresh, "Refresh report") }
                IconButton(onClick = { noteOpen = true }) { Icon(Icons.Outlined.EditNote, "New research note") }
            }
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("annual" to "Annual", "quarterly" to "Quarterly", "ttm" to "Trailing year").forEach { (id, label) ->
                    FilterChip(selected = frequency == id, onClick = { frequency = id }, label = { Text(label) })
                }
            }
        }
        item {
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(point?.let { compact(it.value.value, metric.unit) } ?: "—", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold)
                    Text(metric.unit + " · " + (point?.period?.label ?: "Unavailable"), style = MaterialTheme.typography.bodySmall)
                    NativeHistory(points, metric.unit, selected) { selected = it }
                    if (point != null) TextButton(onClick = { sourceOpen = true }) { Icon(Icons.Outlined.FindInPage, null); Spacer(Modifier.width(8.dp)); Text("Inspect filing source") }
                }
            }
        }
        item { Text("Reporting periods", style = MaterialTheme.typography.titleMedium) }
        items(report.periods.filter { it.frequency == frequency }.sortedByDescending { it.end }, key = { it.id }) { period ->
            val value = metric.values[period.id]
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = value != null) { selected = period.id; sourceOpen = true }, verticalAlignment = Alignment.CenterVertically) {
                Text(period.label, Modifier.weight(1f))
                Text(value?.let { compact(it.value, metric.unit) } ?: "—")
            }
        }
        item {
            TextButton(onClick = { basisOpen = !basisOpen }) { Text("Reporting basis"); Icon(if (basisOpen) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null) }
            if (basisOpen) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Text(report.basis, style = MaterialTheme.typography.bodySmall); report.gaps.forEach { Text(it, style = MaterialTheme.typography.bodySmall) } }
            Text("Historical financials · Saved on this device", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (sourceOpen && point != null) ModalBottomSheet(onDismissRequest = { sourceOpen = false }) { SourceEvidence(metric, point) }
    if (noteOpen) ModalBottomSheet(onDismissRequest = { noteOpen = false }) { NoteEditor(report, metric, point, vm) { noteOpen = false } }
}

@Composable
fun NativeHistory(points: List<ChartPoint>, unit: String, selected: String?, select: (String) -> Unit) {
    val color = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    if (points.isEmpty()) { Text("No reported values for this frequency", Modifier.padding(vertical = 32.dp)); return }
    val minimum = points.minOf { it.value.value }
    val maximum = points.maxOf { it.value.value }
    val margin = maxOf((maximum - minimum) * 0.1, abs(maximum) * 0.025, 0.01)
    val low = minimum - margin
    val high = maximum + margin
    val lastIndex = maxOf(points.last().index, 1)
    Column {
        Row(Modifier.fillMaxWidth()) {
            Canvas(Modifier.weight(1f).height(190.dp)
                .semantics { contentDescription = "Financial history. " + points.joinToString("; ") { it.period.label + ": " + compact(it.value.value, unit) } }
                .pointerInput(points) { detectTapGestures { location -> val index = location.x / size.width * lastIndex; points.minByOrNull { abs(it.index - index) }?.let { select(it.period.id) } } }
                .pointerInput(points) { detectDragGestures { change, _ -> change.consume(); val index = change.position.x / size.width * lastIndex; points.minByOrNull { abs(it.index - index) }?.let { select(it.period.id) } } }) {
                fun position(point: ChartPoint) = Offset(point.index.toFloat() / lastIndex * size.width, (1 - (point.value.value - low) / (high - low)).toFloat() * size.height)
                listOf(0f, 0.5f, 1f).forEach { fraction -> drawLine(grid, Offset(0f, size.height * fraction), Offset(size.width, size.height * fraction), 1.dp.toPx()) }
                points.groupBy { it.segment }.values.forEach { group ->
                    val path = Path()
                    group.forEachIndexed { index, point -> val p = position(point); if (index == 0) path.moveTo(p.x, p.y) else path.lineTo(p.x, p.y) }
                    drawPath(path, color, style = Stroke(2.dp.toPx()))
                    if (group.size == 1) drawCircle(color, 3.dp.toPx(), position(group.first()))
                }
                (points.firstOrNull { it.period.id == selected } ?: points.last()).let { drawCircle(color, 4.dp.toPx(), position(it)) }
            }
            Column(Modifier.height(190.dp).padding(start = 8.dp), verticalArrangement = Arrangement.SpaceBetween) {
                Text(compact(high, unit), style = MaterialTheme.typography.labelSmall)
                Text(compact((low + high) / 2, unit), style = MaterialTheme.typography.labelSmall)
                Text(compact(low, unit), style = MaterialTheme.typography.labelSmall)
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(points.first().period.label, style = MaterialTheme.typography.labelSmall)
            Text(points.last().period.label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
fun SourceEvidence(metric: Metric, point: ChartPoint) {
    val uri = LocalUriHandler.current
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Source evidence", style = MaterialTheme.typography.titleLarge)
        Text(metric.label, style = MaterialTheme.typography.titleMedium)
        Text(java.text.NumberFormat.getNumberInstance().apply { maximumFractionDigits = 15 }.format(point.value.value) + " " + point.value.unit, style = MaterialTheme.typography.headlineSmall)
        Text(point.period.label + " · Ended " + point.value.end)
        HorizontalDivider()
        Text("Method: " + point.value.method)
        point.value.start?.let { Text("Start: $it", style = MaterialTheme.typography.bodySmall) }
        point.value.sources.forEach { source ->
            Text(source.form + " · Filed " + source.filed, fontWeight = FontWeight.SemiBold)
            source.tag?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            source.safeUrl?.let { url -> TextButton(onClick = { uri.openUri(url) }) { Text("Open SEC filing ↗") } }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
fun NoteEditor(report: Report, metric: Metric, point: ChartPoint?, vm: ResearchViewModel, dismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().imePadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("New research note", style = MaterialTheme.typography.titleLarge)
        Text(report.company + " · " + metric.label + (point?.let { " · " + it.period.label } ?: ""), style = MaterialTheme.typography.bodySmall)
        OutlinedTextField(text, { if (it.length <= 10000) text = it }, Modifier.fillMaxWidth(), label = { Text("Research note") }, minLines = 3, maxLines = 8)
        Text("Saved on this device with the report version and filing sources.", style = MaterialTheme.typography.labelSmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = dismiss) { Text("Cancel") }
            Button(onClick = { saving = true; vm.note(report, metric, point, text) { success -> saving = false; if (success) dismiss() } }, enabled = text.trim().isNotEmpty() && !saving) { Text("Save note") }
        }
    }
}

@Composable
fun ResearchNotes(notes: List<ResearchNote>) {
    val uri = LocalUriHandler.current
    if (notes.isEmpty()) { EmptyState("Your research notes", "Open a company and save a note beside a metric or filing source. Notes stay on this device."); return }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(notes, key = { it.id }) { note ->
            Surface(shape = MaterialTheme.shapes.medium) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(note.company, style = MaterialTheme.typography.titleMedium)
                    Text(listOfNotNull(note.metric, note.period).joinToString(" · "), style = MaterialTheme.typography.labelSmall)
                    Text(note.text)
                    Text(note.created.take(10), style = MaterialTheme.typography.labelSmall)
                    note.sources.forEach { url -> if (runCatching { java.net.URI(url).let { it.scheme == "https" && it.host == "www.sec.gov" } }.getOrDefault(false)) TextButton(onClick = { uri.openUri(url) }) { Text("Filing evidence ↗") } }
                }
            }
        }
    }
}

@Composable
fun ResearchUpdates(state: ResearchState, vm: ResearchViewModel) {
    val reports = state.library.followed.mapNotNull { state.library.reports[it.cik] }.mapNotNull { report ->
        val old = state.library.reviewed[report.cik] ?: return@mapNotNull null
        val changes = reportChanges(old, report)
        if (changes.isEmpty()) null else report to changes
    }
    if (reports.isEmpty()) { EmptyState("You're caught up", "Refresh a followed company to check for newly reported or revised figures. Updates compare against the report you last reviewed."); return }
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        reports.forEach { (report, changes) ->
            item { Text(report.company, style = MaterialTheme.typography.titleLarge) }
            items(changes) { change ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(change.metric, fontWeight = FontWeight.SemiBold)
                    Text(change.period + " · " + (change.previous?.let { compact(it, change.unit) + " → " } ?: "New value · ") + compact(change.current, change.unit) + " " + change.unit)
                }
            }
            item { TextButton(onClick = { vm.reviewed(report) }) { Text("Mark reviewed") }; HorizontalDivider() }
        }
    }
}

@Composable
fun EmptyState(title: String, message: String, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(12.dp))
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
