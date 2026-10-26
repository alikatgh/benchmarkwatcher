#if os(iOS)
import SwiftUI
import ResearchCore

struct PhoneRoot: View {
    @EnvironmentObject var store: ResearchStore
    @State private var searchPath = [Company]()
    var body: some View {
        TabView {
            NavigationStack {
                List {
                    if store.isDemo { Text("Sample data · Not a real company").font(.caption).foregroundStyle(.orange) }
                    if store.library.followed.isEmpty { ContentUnavailableView("Follow your research", systemImage: "star", description: Text("Find a company in Search, then follow it to keep its financial brief here.")) }
                    ForEach(store.library.followed) { company in
                        NavigationLink(value: company) { CompanyRow(company: company, report: store.library.reports[company.cik]) }
                    }
                }.navigationTitle("Following")
                    .navigationDestination(for: Company.self) { PhoneCompany(company: $0) }
            }.tabItem { Label("Following", systemImage: "star") }
            NavigationStack(path: $searchPath) {
                CompanySearch { searchPath.append($0) }
                    .navigationDestination(for: Company.self) { PhoneCompany(company: $0) }
            }.tabItem { Label("Search", systemImage: "magnifyingglass") }
            NavigationStack { NotesList() }.tabItem { Label("Research", systemImage: "note.text") }
            NavigationStack { UpdatesList() }.tabItem { Label("Updates", systemImage: "clock.arrow.circlepath") }
        }
        .alert("Research could not be updated", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("OK") { store.error = nil }
        } message: { Text(store.error ?? "") }
    }
}

struct CompanyRow: View {
    let company: Company
    let report: CompanyReport?
    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 5) {
                Text(company.ticker).font(.headline)
                Text(company.name).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 16)
            if let report, let metric = report.metrics.first(where: { $0.id == "revenue" }), let point = report.chart(metric: metric, frequency: "annual").last {
                VStack(alignment: .trailing, spacing: 5) {
                    Text(FinancialFormat.compact(point.value.value, unit: metric.unit)).font(.headline).monospacedDigit()
                    Text("Revenue · " + point.period.label).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }.padding(.vertical, 5)
    }
}

struct PhoneCompany: View {
    @EnvironmentObject var store: ResearchStore
    let company: Company
    @State private var metricID = "revenue"
    @State private var frequency = "annual"
    @State private var selected: String?
    @State private var sourcePresented = false
    @State private var notePresented = false
    var body: some View {
        Group {
            if let report = store.library.reports[company.cik] { brief(report) }
            else if store.loading.contains(company.cik) { ProgressView("Reading SEC financials…") }
            else {
                ContentUnavailableView { Label("Report unavailable", systemImage: "doc") } description: { Text("Check your connection and try again. Saved research is available offline.") } actions: { Button("Try again") { Task { await store.load(company) } } }
            }
        }
        .navigationTitle(company.ticker).navigationBarTitleDisplayMode(.inline)
        .task { await store.load(company) }
    }
    private func brief(_ report: CompanyReport) -> some View {
        let metric = report.metrics.first(where: { $0.id == metricID }) ?? report.metrics[0]
        let points = report.chart(metric: metric, frequency: frequency)
        let point = points.first(where: { $0.id == selected }) ?? points.last
        return List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(report.company).font(.title2.bold())
                    Text(report.industry).font(.subheadline).foregroundStyle(.secondary)
                    Text((store.isDemo ? "Sample data · " : report.stale ? "Cached source · " : "") + "Checked " + String(report.checked.prefix(10))).font(.caption).foregroundStyle(.secondary)
                }.padding(.vertical, 6)
            }
            Section {
                Picker("Metric", selection: $metricID) { ForEach(report.metrics) { Text($0.label).tag($0.id) } }
                Picker("Frequency", selection: $frequency) { Text("Annual").tag("annual"); Text("Quarterly").tag("quarterly"); Text("Trailing year").tag("ttm") }.pickerStyle(.segmented)
                VStack(alignment: .leading, spacing: 12) {
                    Text(point.map { FinancialFormat.compact($0.value.value, unit: metric.unit) } ?? "—").font(.largeTitle.weight(.semibold)).monospacedDigit()
                    Text(metric.unit + " · " + (point?.period.label ?? "Unavailable")).font(.caption).foregroundStyle(.secondary)
                    FinancialHistory(report: report, metric: metric, frequency: frequency, selected: $selected).frame(height: 200)
                    if point != nil { Button { sourcePresented = true } label: { Label("Inspect filing source", systemImage: "doc.text.magnifyingglass") } }
                }.padding(.vertical, 10)
            }
            Section("Reporting periods") {
                ForEach(report.periods.filter { $0.frequency == frequency }.sorted { $0.end > $1.end }) { period in
                    Button { selected = period.id; sourcePresented = metric.values[period.id] != nil } label: {
                        HStack { Text(period.label); Spacer(); Text(metric.values[period.id].map { FinancialFormat.compact($0.value, unit: metric.unit) } ?? "—").monospacedDigit() }.foregroundStyle(.primary)
                    }
                }
            }
            Section {
                NavigationLink("Research notes") { NotesList(cik: report.cik) }
                DisclosureGroup("Reporting basis") { Text(report.basis).font(.caption); ForEach(report.gaps, id: \.self) { Text($0).font(.caption) } }
            } footer: { Text("Historical financials · Saved on this iPhone") }
        }
        .refreshable { await store.load(company, force: true) }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { store.follow(report) } label: { Image(systemName: store.library.followed.contains { $0.cik == report.cik } ? "star.fill" : "star") }.accessibilityLabel("Follow or unfollow company")
                Button { notePresented = true } label: { Image(systemName: "square.and.pencil") }.accessibilityLabel("New research note")
            }
        }
        .sheet(isPresented: $sourcePresented) {
            NavigationStack {
                ScrollView { if let point { SourceDetail(metric: metric, point: point, demo: store.isDemo) } }
                    .navigationTitle("Source").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { sourcePresented = false } } }
            }.presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $notePresented) { NoteComposer(report: report, metric: metric, point: point) }
        .onChange(of: metricID) { _, _ in selected = nil }
        .onChange(of: frequency) { _, _ in selected = nil }
    }
}
#endif
