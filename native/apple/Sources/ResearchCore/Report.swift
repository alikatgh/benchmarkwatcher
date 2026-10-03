import Foundation

public struct Company: Codable, Identifiable, Hashable, Sendable {
    public var id: String { cik }
    public let cik: String
    public let ticker: String
    public let name: String
    public let exchange: String
    public var suggested: Bool?
    public init(cik: String, ticker: String, name: String, exchange: String, suggested: Bool? = nil) {
        self.cik = cik; self.ticker = ticker; self.name = name; self.exchange = exchange; self.suggested = suggested
    }
}

public struct FilingSource: Codable, Hashable, Sendable {
    public let url: String
    public let accession: String
    public let form: String
    public let filed: String
    public var tag: String?
    public var safeURL: URL? {
        guard let value = URL(string: url), value.scheme == "https",
              value.host == "www.sec.gov", value.user == nil, value.password == nil,
              value.port == nil, value.path.hasPrefix("/Archives/edgar/data/") else { return nil }
        return value
    }
}

public struct FinancialValue: Codable, Hashable, Sendable {
    public let value: Double
    public let unit: String
    public let start: String?
    public let end: String
    public let method: String
    public let sources: [FilingSource]
}

public struct Period: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let label: String
    public let frequency: String
    public let year: Int
    public let end: String
}

public struct Metric: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let label: String
    public let section: String
    public let behavior: String
    public let unit: String
    public let values: [String: FinancialValue]
}

public struct ChartPoint: Identifiable, Hashable, Sendable {
    public var id: String { period.id }
    public let period: Period
    public let value: FinancialValue
    public let index: Int
    public let segment: Int
}

public struct CompanyReport: Codable, Identifiable, Hashable, Sendable {
    public var id: String { cik }
    public let cik: String
    public let company: String
    public let ticker: String
    public let exchange: String
    public let industry: String
    public let currency: String
    public let checked: String
    public var stale: Bool
    public let version: String
    public let periods: [Period]
    public let metrics: [Metric]
    public let sources: [FilingSource]
    public let gaps: [String]
    public let basis: String
    public var identity: Company { Company(cik: cik, ticker: ticker, name: company, exchange: exchange) }

    public func chart(metric: Metric, frequency: String) -> [ChartPoint] {
        let periods = periods.filter { $0.frequency == frequency }.sorted { $0.end < $1.end }
        var result = [ChartPoint](), segment = 0, previous: Period?
        for (index, period) in periods.enumerated() {
            if let old = previous, frequency == "annual", period.year - old.year > 1 { segment += 1 }
            if let old = previous, frequency != "annual",
               let a = ISO8601DateFormatter.day.date(from: old.end),
               let b = ISO8601DateFormatter.day.date(from: period.end), b.timeIntervalSince(a) > 120 * 86400 { segment += 1 }
            previous = period
            guard let value = metric.values[period.id], value.value.isFinite else { segment += 1; continue }
            result.append(ChartPoint(period: period, value: value, index: index, segment: segment))
        }
        return result
    }

    public func validate() throws {
        guard cik.range(of: "^[0-9]{10}$", options: .regularExpression) != nil,
              !company.isEmpty, !periods.isEmpty, !metrics.isEmpty,
              Set(periods.map(\.id)).count == periods.count,
              Set(metrics.map(\.id)).count == metrics.count,
              metrics.allSatisfy({ $0.values.values.allSatisfy { $0.value.isFinite } }) else {
            throw ResearchError.invalidReport
        }
    }
}

extension ISO8601DateFormatter {
    static var day: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withFullDate]; return formatter
    }
}

public enum FinancialFormat {
    public static func compact(_ value: Double, unit: String) -> String {
        guard value.isFinite else { return "—" }
        if unit == "%" { return value.formatted(.number.precision(.fractionLength(1))) + "%" }
        if unit.contains("/share") { return value.formatted(.number.precision(.fractionLength(2))) }
        for (divisor, suffix) in [(1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")] where abs(value) >= divisor {
            return (value / divisor).formatted(.number.precision(.fractionLength(2))) + suffix
        }
        return value.formatted(.number.precision(.fractionLength(2)))
    }
    public static func exact(_ value: Double, unit: String) -> String {
        value.formatted(.number.precision(.fractionLength(0...15))) + " " + unit
    }
}

public enum ResearchError: LocalizedError {
    case invalidReport, server(String), tooLarge
    public var errorDescription: String? {
        switch self {
        case .invalidReport: return "This report could not be verified. Your saved research is unchanged."
        case .server(let message): return message
        case .tooLarge: return "This response exceeds the supported size."
        }
    }
}
