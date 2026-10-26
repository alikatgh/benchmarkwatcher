import SwiftUI
import ResearchCore

@MainActor
final class ResearchStore: ObservableObject {
    @Published private(set) var library = LibraryState()
    @Published private(set) var loading: Set<String> = []
    @Published var error: String?
    let isDemo: Bool
    let api: ResearchAPI
    private let file: LibraryFile
    private var writable = true

    init() {
        let args = ProcessInfo.processInfo.arguments
        let demo = args.contains("--demo")
        isDemo = demo
        let path = args.first { $0.hasPrefix("--library=") }?.dropFirst(10)
        file = LibraryFile(url: path.map { URL(fileURLWithPath: String($0)) } ?? (demo ? FileManager.default.temporaryDirectory.appendingPathComponent("BenchmarkWatcher-preview-" + UUID().uuidString + ".json") : nil))
        #if DEBUG
        let base = args.first { $0.hasPrefix("--api=") }?.dropFirst(6)
        api = ResearchAPI(baseURL: base.flatMap { URL(string: String($0)) } ?? URL(string: "https://benchmarkwatcher.online")!)
        #else
        api = ResearchAPI()
        #endif
        do { library = try file.load() }
        catch { writable = false; self.error = "Your research library could not be read. It has been left intact. \(error.localizedDescription)" }
        if isDemo, let url = Bundle.main.url(forResource: "report", withExtension: "json"),
           let data = try? Data(contentsOf: url), let report = try? JSONDecoder().decode(CompanyReport.self, from: data) {
            library.reports[report.cik] = report
            library.followed = [report.identity]
            library.reviewedReports[report.cik] = report
        }
    }

    func commit(_ state: LibraryState) {
        guard writable else { error = "The library is unreadable. Restart after restoring access to your existing research file."; return }
        do { try file.save(state); library = state }
        catch { self.error = "Changes could not be saved. \(error.localizedDescription)" }
    }
    func follow(_ report: CompanyReport) {
        var next = library
        if next.followed.contains(where: { $0.cik == report.cik }) {
            next.followed.removeAll { $0.cik == report.cik }
        } else { next.followed.append(report.identity) }
        commit(next)
    }
    func load(_ company: Company, force: Bool = false) async {
        guard !loading.contains(company.cik), !isDemo else { return }
        if !force, library.reports[company.cik] != nil { return }
        loading.insert(company.cik)
        defer { loading.remove(company.cik) }
        do {
            let report = try await api.report(cik: company.cik)
            guard !Task.isCancelled else { return }
            var next = library
            if next.reviewedReports[company.cik] == nil { next.reviewedReports[company.cik] = report }
            next.reports[company.cik] = report
            commit(next)
        } catch is CancellationError {} catch {
            if (error as? URLError)?.code != .cancelled { self.error = error.localizedDescription }
        }
    }
    func changes(_ report: CompanyReport) -> [ReportChange] {
        guard let old = library.reviewedReports[report.cik] else { return [] }
        return ReportComparison.changes(from: old, to: report)
    }
    func reviewed(_ report: CompanyReport) {
        var next = library; next.reviewedReports[report.cik] = report; next.lastReviewed[report.cik] = report.version; commit(next)
    }
    func addNote(report: CompanyReport, metric: Metric?, point: ChartPoint?, text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 10000 else { return }
        var next = library
        next.notes.insert(ResearchNote(report: report, metric: metric, point: point, text: text), at: 0)
        commit(next)
    }
}
