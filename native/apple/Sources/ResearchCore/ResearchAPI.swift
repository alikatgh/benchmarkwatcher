import Foundation

public struct SearchResponse: Decodable {
    public let schema_version: Int
    public let companies: [Company]
    public let stale: Bool
}
public struct ReportResponse: Decodable {
    public let schema_version: Int
    public let report: CompanyReport
}
private struct ErrorBody: Decodable { let error: String }

public final class ResearchAPI: @unchecked Sendable {
    private let baseURL: URL
    private let session: URLSession
    public init(baseURL: URL = URL(string: "https://benchmarkwatcher.online")!, session: URLSession? = nil) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 45; config.timeoutIntervalForResource = 60
        config.httpCookieStorage = nil
        self.session = session ?? URLSession(configuration: config)
    }
    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.queryItems = query.isEmpty ? nil : query
        var request = URLRequest(url: components.url!)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (stream, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw ResearchError.invalidReport }
        var data = Data()
        for try await byte in stream {
            guard data.count < 4 * 1024 * 1024 else { throw ResearchError.tooLarge }
            data.append(byte)
        }
        guard response.statusCode == 200 else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data).error) ?? "The research service is unavailable. Try again later."
            throw ResearchError.server(message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    public func search(_ query: String) async throws -> SearchResponse {
        let result: SearchResponse = try await get("api/v1/research/companies", query: [.init(name: "q", value: query)])
        guard result.schema_version == 1 else { throw ResearchError.invalidReport }
        return result
    }
    public func report(cik: String) async throws -> CompanyReport {
        guard cik.range(of: "^[0-9]{10}$", options: .regularExpression) != nil else { throw ResearchError.invalidReport }
        let result: ReportResponse = try await get("api/v1/research/companies/" + cik)
        guard result.schema_version == 1, result.report.cik == cik else { throw ResearchError.invalidReport }
        try result.report.validate()
        return result.report
    }
}
