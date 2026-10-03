import Foundation

public struct ResearchNote: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let cik: String
    public let company: String
    public let metricID: String?
    public let metricLabel: String?
    public let period: String?
    public let reportVersion: String
    public let sourceURLs: [String]
    public var text: String
    public let created: Date
    public init(report: CompanyReport, metric: Metric?, point: ChartPoint?, text: String) {
        id = UUID(); cik = report.cik; company = report.company; metricID = metric?.id
        metricLabel = metric?.label; period = point?.period.label; reportVersion = report.version
        sourceURLs = point?.value.sources.compactMap { $0.safeURL?.absoluteString } ?? []
        self.text = text; created = Date()
    }
}

public struct LibraryState: Codable, Sendable {
    public var followed: [Company] = []
    public var reports: [String: CompanyReport] = [:]
    public var reviewedReports: [String: CompanyReport] = [:]
    public var notes: [ResearchNote] = []
    public var lastReviewed: [String: String] = [:]
    public init() {}
}

public struct ReportChange: Identifiable, Sendable {
    public var id: String { metricID + ":" + periodID }
    public let metricID: String
    public let metric: String
    public let periodID: String
    public let period: String
    public let previous: Double?
    public let current: Double
    public let unit: String
}

public enum ReportComparison {
    public static func changes(from old: CompanyReport, to new: CompanyReport) -> [ReportChange] {
        guard old.cik == new.cik else { return [] }
        let lookup = Dictionary(uniqueKeysWithValues: old.metrics.map { ($0.id, $0) })
        let periods = Dictionary(uniqueKeysWithValues: new.periods.map { ($0.id, $0.label) })
        return new.metrics.flatMap { metric in
            metric.values.compactMap { id, value -> ReportChange? in
                let prior = lookup[metric.id]?.values[id]
                let previous = prior?.unit == value.unit ? prior : nil
                guard previous?.value != value.value, periods[id] != nil else { return nil }
                return ReportChange(metricID: metric.id, metric: metric.label, periodID: id,
                                    period: periods[id]!, previous: previous?.value, current: value.value, unit: value.unit)
            }
        }.sorted { ($0.periodID, $0.metric) > ($1.periodID, $1.metric) }
    }
}

public final class LibraryFile {
    public let url: URL
    public init(url: URL? = nil) {
        self.url = url ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("BenchmarkWatcher", isDirectory: true).appendingPathComponent("research.json")
    }
    public func load() throws -> LibraryState {
        guard FileManager.default.fileExists(atPath: url.path) else { return LibraryState() }
        // Corrupt data is reported, never overwritten with a fresh library.
        let state = try JSONDecoder().decode(LibraryState.self, from: Data(contentsOf: url))
        for report in Array(state.reports.values) + Array(state.reviewedReports.values) { try report.validate() }
        return state
    }
    public func save(_ state: LibraryState) throws {
        let data = try JSONEncoder().encode(state)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
    }
}
