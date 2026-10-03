#if os(macOS)
import SwiftUI
import ResearchCore

struct MacWorkspace: View {
    @EnvironmentObject var store: ResearchStore
    @State private var selection = "following"
    @State private var searchPresented = false
    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section("Library") {
                    Label("Following", systemImage: "star").tag("following")
                    Label("Research notes", systemImage: "note.text").tag("notes")
                    Label("What changed", systemImage: "clock.arrow.circlepath").tag("updates")
                }
                Section("Companies") {
                    ForEach(store.library.followed) { company in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(company.ticker).font(.headline)
                            Text(company.name).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }.padding(.vertical, 4).tag(company.cik)
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 225, max: 290)
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 5) {
                    if store.isDemo { Text("SAMPLE DATA").font(.caption.weight(.semibold)).foregroundStyle(.orange) }
                    Text("Historical filings · Local research").font(.caption2).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
            }
        } detail: {
            if selection == "notes" { NotesList() }
            else if selection == "updates" { UpdatesList() }
            else if let report = store.library.reports[selection] { MacCompany(report: report).id(report.cik) }
            else if selection == "following" { following }
            else if store.loading.contains(selection) { ProgressView("Reading SEC financials…").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else { ContentUnavailableView("Report unavailable", systemImage: "doc", description: Text("Open company search to try again. Saved research remains available.")) }
        }
        .navigationTitle("BenchmarkWatcher")
        .toolbar {
            ToolbarItem { Button { searchPresented = true } label: { Label("Find company", systemImage: "magnifyingglass") }.keyboardShortcut("f").help("Find a company (⌘F)") }
        }
        .sheet(isPresented: $searchPresented) {
            NavigationStack {
                CompanySearch { company in selection = company.cik; searchPresented = false; Task { await store.load(company) } }
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { searchPresented = false } } }
            }.frame(width: 560, height: 460)
        }
        .alert("Research could not be updated", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("OK") { store.error = nil }
        } message: { Text(store.error ?? "") }
        .onAppear { if store.isDemo, let company = store.library.followed.first { selection = company.cik } }
    }
    private var following: some View {
        List {
            if store.library.followed.isEmpty {
                ContentUnavailableView {
                    Label("Start a research notebook", systemImage: "books.vertical")
                } description: {
                    Text("Find a company, explore its historical financials, and keep notes linked to filing evidence.")
                } actions: { Button("Find a company") { searchPresented = true }.buttonStyle(.borderedProminent) }
            }
            ForEach(store.library.followed) { company in
                Button { selection = company.cik; Task { await store.load(company) } } label: {
                    HStack(spacing: 24) {
                        VStack(alignment: .leading, spacing: 4) { Text(company.name).font(.headline); Text(company.ticker + " · " + company.exchange).foregroundStyle(.secondary) }
                        Spacer()
                        if let report = store.library.reports[company.cik] { Text("Checked " + String(report.checked.prefix(10))).font(.caption).foregroundStyle(.secondary) }
                        Image(systemName: "chevron.right").foregroundStyle(.secondary)
                    }.padding(.vertical, 10)
                }.buttonStyle(.plain)
            }
        }.navigationTitle("Following")
    }
}

struct MacCompany: View {
    @EnvironmentObject var store: ResearchStore
    @Environment(\.openWindow) var openWindow
    let report: CompanyReport
    @State private var metricID = "revenue"
    @State private var frequency = "annual"
    @State private var selected: String?
    @State private var inspector = true
    @State private var notePresented = false
    private var metric: Metric { report.metrics.first(where: { $0.id == metricID }) ?? report.metrics[0] }
    private var points: [ChartPoint] { report.chart(metric: metric, frequency: frequency) }
    private var point: ChartPoint? { points.first { $0.id == selected } ?? points.last }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(report.ticker + " · " + report.exchange).font(.callout).foregroundStyle(.secondary)
                    Text(report.company).font(.title.bold()).textSelection(.enabled)
                    Text(report.industry).font(.callout).foregroundStyle(.secondary)
                }
                HStack(spacing: 32) {
                    ForEach(report.metrics.filter { ["revenue", "operating_income", "free_cash"].contains($0.id) }.prefix(3)) { metric in
                        let value = report.chart(metric: metric, frequency: "annual").last
                        VStack(alignment: .leading, spacing: 6) {
                            Text(metric.label).font(.caption).foregroundStyle(.secondary)
                            Text(value.map { FinancialFormat.compact($0.value.value, unit: metric.unit) } ?? "—").font(.title2.weight(.semibold)).monospacedDigit()
                            Text((value?.period.label ?? "Unavailable") + " · " + metric.unit).font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                Divider()
                HStack {
                    Picker("Metric", selection: $metricID) { ForEach(report.metrics) { Text($0.label).tag($0.id) } }.frame(maxWidth: 300)
                    Spacer()
                    Picker("Frequency", selection: $frequency) { Text("Annual").tag("annual"); Text("Quarterly").tag("quarterly"); Text("Trailing year").tag("ttm") }.pickerStyle(.segmented).frame(width: 290)
                }
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(point.map { FinancialFormat.compact($0.value.value, unit: metric.unit) } ?? "—").font(.title.weight(.semibold)).monospacedDigit()
                        Text(metric.unit).foregroundStyle(.secondary)
                        Spacer()
                        Text(point?.period.label ?? "No reported values").font(.callout).foregroundStyle(.secondary)
                    }
                    FinancialHistory(report: report, metric: metric, frequency: frequency, selected: $selected).frame(height: 235)
                    Text("Select a period below or scrub the chart to inspect its source. Missing periods remain gaps.").font(.caption).foregroundStyle(.secondary)
                }.padding(20).background(.background, in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.secondary.opacity(0.12)))
                Table(report.periods.filter { $0.frequency == frequency }.sorted { $0.end > $1.end }, selection: $selected) {
                    TableColumn("Period", value: \.label)
                    TableColumn(metric.label) { period in
                        Text(metric.values[period.id].map { FinancialFormat.compact($0.value, unit: metric.unit) } ?? "—").monospacedDigit()
                    }
                    TableColumn("Period end", value: \.end)
                }.frame(height: 185)
                DisclosureGroup("Coverage and reporting basis") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(report.basis)
                        ForEach(report.gaps, id: \.self) { Text($0) }
                    }.font(.caption).foregroundStyle(.secondary).padding(.top, 8)
                }
                Text((report.stale ? "Cached source · " : "") + "Checked " + String(report.checked.prefix(10)) + " · Saved on this Mac")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(28)
        }.background(Color(nsColor: .windowBackgroundColor))
        .toolbar {
            ToolbarItem { Button { store.follow(report) } label: { Label("Follow", systemImage: store.library.followed.contains { $0.cik == report.cik } ? "star.fill" : "star") }.help("Follow or unfollow company") }
            ToolbarItem { Button { Task { await store.load(report.identity, force: true) } } label: { Label("Refresh report", systemImage: "arrow.clockwise") }.disabled(store.loading.contains(report.cik) || store.isDemo).keyboardShortcut("r") }
            ToolbarItem { Button { notePresented = true } label: { Label("New note", systemImage: "square.and.pencil") }.keyboardShortcut("n") }
            ToolbarItem { Button { openWindow(id: "compare", value: report.cik) } label: { Label("Compare", systemImage: "rectangle.split.2x1") } }
            ToolbarItem { Button { inspector.toggle() } label: { Label("Source inspector", systemImage: "sidebar.right") } }
        }
        .inspector(isPresented: $inspector) {
            ScrollView { if let point { SourceDetail(metric: metric, point: point, demo: store.isDemo) } }
                .inspectorColumnWidth(min: 250, ideal: 280, max: 360)
        }
        .sheet(isPresented: $notePresented) { NoteComposer(report: report, metric: metric, point: point) }
        .onChange(of: metricID) { _, _ in selected = nil }
        .onChange(of: frequency) { _, _ in selected = nil }
    }
}

struct MacComparison: View {
    @EnvironmentObject var store: ResearchStore
    let initialCIK: String?
    @State private var left = ""
    @State private var right = ""
    @State private var metricID = "revenue"
    @State private var periodID: String?
    private var reports: [CompanyReport] { store.library.reports.values.sorted { $0.company < $1.company } }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Picker("Metric", selection: $metricID) {
                    Text("Revenue").tag("revenue"); Text("Operating income").tag("operating_income"); Text("Operating margin").tag("operating_margin"); Text("Free cash flow").tag("free_cash")
                }.frame(width: 280)
                Spacer()
                Text("Historical annual figures").font(.caption).foregroundStyle(.secondary)
            }
            HStack(alignment: .top, spacing: 24) { comparison($left); Divider(); comparison($right) }
        }.padding(28)
        .onAppear { left = initialCIK ?? reports.first?.cik ?? ""; right = reports.first(where: { $0.cik != left })?.cik ?? "" }
    }
    private func comparison(_ cik: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Picker("Company", selection: cik) { Text("Choose company").tag(""); ForEach(reports) { Text($0.company).tag($0.cik) } }
            if let report = store.library.reports[cik.wrappedValue], let metric = report.metrics.first(where: { $0.id == metricID }) {
                Text(report.company).font(.title2.bold())
                Text(metric.unit).font(.callout).foregroundStyle(.secondary)
                FinancialHistory(report: report, metric: metric, frequency: "annual", selected: $periodID).frame(height: 300)
                if let point = report.chart(metric: metric, frequency: "annual").first(where: { $0.id == periodID }) ?? report.chart(metric: metric, frequency: "annual").last {
                    Text(point.period.label + " · " + FinancialFormat.compact(point.value.value, unit: metric.unit)).font(.headline)
                    Text("Ended " + point.value.end).font(.caption).foregroundStyle(.secondary)
                }
                Text("\(report.currency) · Fiscal period ends may differ between companies.").font(.caption).foregroundStyle(.secondary)
            } else { ContentUnavailableView("Choose a saved company", systemImage: "rectangle.split.2x1", description: Text("Open another company in the main window to add it to this comparison.")) }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
#endif
