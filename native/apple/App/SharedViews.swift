import SwiftUI
import Charts
import ResearchCore

struct FinancialHistory: View {
    let report: CompanyReport
    let metric: Metric
    let frequency: String
    @Binding var selected: String?
    private var points: [ChartPoint] { report.chart(metric: metric, frequency: frequency) }
    @State private var selectedIndex: Int?

    var body: some View {
        if points.isEmpty {
            ContentUnavailableView("No values for this period", systemImage: "chart.xyaxis.line", description: Text("Choose another reporting frequency or metric. Missing disclosures remain unavailable."))
        } else {
            Chart(points) { point in
                LineMark(x: .value("Period", point.index), y: .value(metric.label, point.value.value), series: .value("Available sequence", point.segment))
                    .foregroundStyle(Color.accentColor).lineStyle(StrokeStyle(lineWidth: 2))
                if point.id == selected || point.id == points.last?.id {
                    PointMark(x: .value("Period", point.index), y: .value(metric.label, point.value.value))
                        .foregroundStyle(Color.accentColor).symbolSize(point.id == selected ? 48 : 24)
                }
                if point.id == selected {
                    RuleMark(x: .value("Selected", point.index)).foregroundStyle(.secondary.opacity(0.35))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3]))
                }
            }
            .chartXSelection(value: $selectedIndex)
            .chartXAxis {
                AxisMarks(values: points.count > 6 ? points.enumerated().filter { $0.offset % max(1, points.count / 5) == 0 }.map { $0.element.index } : points.map(\.index)) { value in
                    AxisValueLabel { if let index = value.as(Int.self), let point = points.first(where: { $0.index == index }) { Text(point.period.label).font(.caption2) } }
                }
            }
            .chartYAxis {
                AxisMarks(position: .trailing) { value in
                    AxisGridLine().foregroundStyle(.secondary.opacity(0.12))
                    AxisValueLabel { if let number = value.as(Double.self) { Text(FinancialFormat.compact(number, unit: metric.unit)).font(.caption2) } }
                }
            }
            .onChange(of: selectedIndex) { _, value in
                if let value, let point = points.min(by: { abs($0.index-value) < abs($1.index-value) }) { selected = point.id }
            }
            .accessibilityLabel("\(metric.label), \(frequency) history, \(points.count) reported values")
        }
    }
}

struct SourceDetail: View {
    let metric: Metric
    let point: ChartPoint
    let demo: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Source evidence").font(.headline)
            VStack(alignment: .leading, spacing: 5) {
                Text(metric.label).font(.subheadline)
                Text(FinancialFormat.exact(point.value.value, unit: point.value.unit)).font(.title3).monospacedDigit().textSelection(.enabled)
                Text(point.period.label + " · Ended " + point.value.end).font(.caption).foregroundStyle(.secondary)
            }
            Divider()
            LabeledContent("Method", value: point.value.method).font(.callout)
            if let start = point.value.start { LabeledContent("Start", value: start).font(.caption) }
            LabeledContent("End", value: point.value.end).font(.caption)
            ForEach(Array(point.value.sources.enumerated()), id: \.offset) { _, source in
                VStack(alignment: .leading, spacing: 6) {
                    Text(source.form + " · Filed " + source.filed).font(.subheadline.weight(.medium))
                    if let tag = source.tag { Text(tag).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                    if !demo, let url = source.safeURL { Link(destination: url) { Label("Open SEC filing", systemImage: "arrow.up.right") }.font(.callout) }
                    if demo { Text("Synthetic evidence for interface preview").font(.caption).foregroundStyle(.secondary) }
                }.padding(.vertical, 6)
            }
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct CompanySearch: View {
    @EnvironmentObject var store: ResearchStore
    var onSelect: (Company) -> Void
    @State private var query = ""
    @State private var companies: [Company] = []
    @State private var searching = false
    @State private var issue: String?
    @State private var stale = false
    var body: some View {
        List {
            if stale { Text("Saved SEC directory · Service temporarily unavailable").font(.caption).foregroundStyle(.secondary) }
            if let issue { Text(issue).foregroundStyle(.secondary) }
            if searching { ProgressView("Searching companies…") }
            ForEach(companies) { company in
                Button {
                    onSelect(company)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(company.ticker).font(.headline)
                            Text(company.name).font(.callout).foregroundStyle(.secondary)
                            if company.suggested == true { Text("Possible match · Confirm company").font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer(); Text(company.exchange).font(.caption).foregroundStyle(.secondary)
                    }.padding(.vertical, 4).contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
            if !searching, companies.isEmpty, issue == nil {
                ContentUnavailableView(query.count < 2 ? "Find a company" : "No matching company", systemImage: "magnifyingglass",
                                       description: Text(query.count < 2 ? "Enter a ticker or company name. Reports use historical SEC disclosures." : "Try a company name or its SEC identifier."))
            }
        }
        .searchable(text: $query, prompt: "Ticker or company name")
        .navigationTitle("Find a company")
        .task(id: query) {
            companies = []; issue = nil; stale = false; searching = false
            guard query.trimmingCharacters(in: .whitespaces).count >= 2 else { return }
            searching = true
            do {
                try await Task.sleep(for: .milliseconds(350))
                if store.isDemo {
                    companies = store.library.followed.filter { $0.name.localizedCaseInsensitiveContains(query) || $0.ticker.localizedCaseInsensitiveContains(query) }
                } else {
                    let result = try await store.api.search(query)
                    try Task.checkCancellation()
                    companies = result.companies; stale = result.stale
                }
                searching = false
            } catch {
                if Task.isCancelled || (error as? URLError)?.code == .cancelled { return }
                issue = error.localizedDescription; searching = false
            }
        }
    }
}

struct NoteComposer: View {
    @EnvironmentObject var store: ResearchStore
    @Environment(\.dismiss) var dismiss
    let report: CompanyReport
    let metric: Metric?
    let point: ChartPoint?
    @State private var text = ""
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text(report.company).font(.headline)
                if let metric, let point {
                    Text("\(metric.label) · \(point.period.label) · \(FinancialFormat.compact(point.value.value, unit: metric.unit)) \(metric.unit)")
                        .font(.callout).foregroundStyle(.secondary)
                }
                TextEditor(text: $text).font(.body).frame(minHeight: 150)
                    .accessibilityLabel("Research note")
                Text("Saved on this device with the report version and selected filing sources.").font(.caption).foregroundStyle(.secondary)
            }.padding(20)
            .navigationTitle("New research note")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let count = store.library.notes.count
                        store.addNote(report: report, metric: metric, point: point, text: text)
                        if store.library.notes.count > count { dismiss() }
                    }.disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || text.count > 10000)
                }
            }
        }
        #if os(macOS)
        .frame(width: 520, height: 350)
        #endif
    }
}

struct NotesList: View {
    @EnvironmentObject var store: ResearchStore
    var cik: String? = nil
    var notes: [ResearchNote] { store.library.notes.filter { cik == nil || $0.cik == cik } }
    var body: some View {
        List {
            if notes.isEmpty { ContentUnavailableView("Your research notes", systemImage: "note.text", description: Text("Open a company and save a note beside a metric or filing source. Notes stay on this device.")) }
            ForEach(notes) { note in
                VStack(alignment: .leading, spacing: 8) {
                    Text(note.company).font(.headline)
                    if let metric = note.metricLabel { Text(metric + (note.period.map { " · " + $0 } ?? "")).font(.caption).foregroundStyle(.secondary) }
                    Text(note.text).textSelection(.enabled)
                    Text(note.created, style: .date).font(.caption).foregroundStyle(.secondary)
                    if !store.isDemo {
                        ForEach(note.sourceURLs, id: \.self) { value in
                            if let url = URL(string: value), url.scheme == "https", url.host == "www.sec.gov" { Link("Filing evidence ↗", destination: url).font(.caption) }
                        }
                    }
                }.padding(.vertical, 8)
            }
        }.navigationTitle("Research notes")
    }
}

struct UpdatesList: View {
    @EnvironmentObject var store: ResearchStore
    private var reports: [CompanyReport] { store.library.followed.compactMap { store.library.reports[$0.cik] }.filter { !store.changes($0).isEmpty } }
    var body: some View {
        List {
            if reports.isEmpty {
                ContentUnavailableView("You're caught up", systemImage: "checkmark.circle", description: Text("Refresh a followed company to check for newly reported or revised figures. Updates compare against the report you last reviewed."))
            }
            ForEach(reports) { report in
                Section(report.company) {
                    ForEach(store.changes(report)) { change in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(change.metric).font(.headline)
                            Text(change.period + " · " + (change.previous.map { FinancialFormat.compact($0, unit: change.unit) + " → " } ?? "New value · ") + FinancialFormat.compact(change.current, unit: change.unit) + " " + change.unit)
                                .font(.callout).monospacedDigit()
                        }.padding(.vertical, 3)
                    }
                    Button("Mark reviewed") { store.reviewed(report) }
                }
            }
        }.navigationTitle("What changed")
    }
}
