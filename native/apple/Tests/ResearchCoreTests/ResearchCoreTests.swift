import XCTest
@testable import ResearchCore

final class ResearchCoreTests: XCTestCase {
    func fixtureData() throws -> Data {
        try Data(contentsOf: XCTUnwrap(Bundle.module.url(forResource: "report", withExtension: "json")))
    }
    func report() throws -> CompanyReport { try JSONDecoder().decode(CompanyReport.self, from: fixtureData()) }

    func testContractAndCumulativeSourcePreservation() throws {
        let report = try report()
        try report.validate()
        XCTAssertEqual(report.cik, "0000000001")
        let cash = try XCTUnwrap(report.metrics.first { $0.id == "operating_cash" })
        let quarter = try XCTUnwrap(cash.values["Q4-2025"])
        XCTAssertEqual(quarter.value, 126_000_000, accuracy: 0.01)
        XCTAssertEqual(quarter.sources.count, 2)
        XCTAssertTrue(quarter.method.contains("Derived quarter"))
        XCTAssertTrue(quarter.sources.allSatisfy { $0.safeURL != nil })
    }
    func testMissingPeriodBreaksChartAndZeroRemainsAValue() throws {
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: fixtureData()) as? [String: Any])
        var metrics = try XCTUnwrap(json["metrics"] as? [[String: Any]])
        let index = try XCTUnwrap(metrics.firstIndex { $0["id"] as? String == "revenue" })
        var values = try XCTUnwrap(metrics[index]["values"] as? [String: [String: Any]])
        values.removeValue(forKey: "FY2022")
        values["FY2024"]?["value"] = 0
        metrics[index]["values"] = values; json["metrics"] = metrics
        let report = try JSONDecoder().decode(CompanyReport.self, from: JSONSerialization.data(withJSONObject: json))
        let points = report.chart(metric: report.metrics[index], frequency: "annual")
        XCTAssertEqual(points.count, 5)
        XCTAssertNotEqual(points.first?.segment, points.last?.segment)
        XCTAssertEqual(points.first { $0.id == "FY2024" }?.value.value, 0)
    }
    func testSourceLinksRejectUnexpectedHostsAndSchemes() throws {
        for url in ["javascript:alert(1)", "https://www.sec.gov.evil.test/Archives/edgar/data/1/x.htm", "http://www.sec.gov/Archives/edgar/data/1/x.htm", "https://evil@www.sec.gov/Archives/edgar/data/1/x.htm"] {
            let source = FilingSource(url: url, accession: "x", form: "10-K", filed: "2026-01-01", tag: nil)
            XCTAssertNil(source.safeURL)
        }
    }
    func testLibraryRoundTripPreservesNoteEvidenceAndReviewBaseline() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = LibraryFile(url: directory.appendingPathComponent("research.json"))
        let report = try report(), metric = try XCTUnwrap(report.metrics.first)
        var state = LibraryState()
        state.reports[report.cik] = report; state.reviewedReports[report.cik] = report
        state.followed = [report.identity]
        state.notes = [ResearchNote(report: report, metric: metric, point: report.chart(metric: metric, frequency: "annual").last, text: "Check the cumulative inputs.")]
        try file.save(state)
        let loaded = try file.load()
        XCTAssertEqual(loaded.notes.first?.text, "Check the cumulative inputs.")
        XCTAssertFalse(try XCTUnwrap(loaded.notes.first).sourceURLs.isEmpty)
        XCTAssertEqual(loaded.reviewedReports[report.cik]?.version, report.version)
        XCTAssertTrue(ReportComparison.changes(from: report, to: report).isEmpty)
        let corrupt = Data("unreadable".utf8)
        try corrupt.write(to: file.url)
        XCTAssertThrowsError(try file.load())
        XCTAssertEqual(try Data(contentsOf: file.url), corrupt)
    }
    func testRevisionsCompareValuesRatherThanCheckedTimestamp() throws {
        let old = try report()
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: fixtureData()) as? [String: Any])
        var metrics = try XCTUnwrap(json["metrics"] as? [[String: Any]])
        let index = try XCTUnwrap(metrics.firstIndex { $0["id"] as? String == "revenue" })
        var values = try XCTUnwrap(metrics[index]["values"] as? [String: [String: Any]])
        values["FY2025"]?["value"] = 1_450_000_000
        metrics[index]["values"] = values; json["metrics"] = metrics
        let new = try JSONDecoder().decode(CompanyReport.self, from: JSONSerialization.data(withJSONObject: json))
        let changes = ReportComparison.changes(from: old, to: new)
        XCTAssertEqual(changes.count, 1)
        XCTAssertEqual(changes[0].previous, 1_400_000_000)
        XCTAssertEqual(changes[0].current, 1_450_000_000)
    }
    func testNumberFormattingDoesNotTurnNegativeOrZeroIntoMissing() {
        XCTAssertEqual(FinancialFormat.compact(0, unit: "USD"), "0.00")
        XCTAssertTrue(FinancialFormat.compact(-1_200_000, unit: "USD").contains("1.20M"))
        XCTAssertEqual(FinancialFormat.compact(74.7, unit: "%"), "74.7%")
        XCTAssertEqual(FinancialFormat.compact(.nan, unit: "USD"), "—")
    }
    func testDifferentUnitsAreNotComparedAsRevisionsOfTheSameAmount() throws {
        let old = try report()
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: fixtureData()) as? [String: Any])
        var metrics = try XCTUnwrap(json["metrics"] as? [[String: Any]])
        let index = try XCTUnwrap(metrics.firstIndex { $0["id"] as? String == "revenue" })
        var values = try XCTUnwrap(metrics[index]["values"] as? [String: [String: Any]])
        values["FY2025"]?["unit"] = "EUR"
        metrics[index]["values"] = values; json["metrics"] = metrics
        let new = try JSONDecoder().decode(CompanyReport.self, from: JSONSerialization.data(withJSONObject: json))
        let change = try XCTUnwrap(ReportComparison.changes(from: old, to: new).first)
        XCTAssertNil(change.previous)
        XCTAssertEqual(change.unit, "EUR")
    }
}
