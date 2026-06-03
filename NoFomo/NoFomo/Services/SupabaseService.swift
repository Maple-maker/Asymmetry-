import Foundation

// Replace these with your actual Supabase project values
private let SUPABASE_URL = "https://jmtkygwvmrolfvwueggs.supabase.co"
private let SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"

final class SupabaseService {
    static let shared = SupabaseService()

    private let baseURL: URL
    private let session: URLSession

    private init() {
        baseURL = URL(string: SUPABASE_URL)!
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)
    }

    // MARK: - Feed

    func fetchFeed(isPremium: Bool, limit: Int = 20, offset: Int = 0) async throws -> [Opportunity] {
        var components = URLComponents(url: baseURL.appendingPathComponent("/rest/v1/opportunity_feed"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "order", value: "published_at.desc"),
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)"),
        ]
        if !isPremium {
            components.queryItems?.append(URLQueryItem(name: "is_premium", value: "eq.false"))
        }
        var req = URLRequest(url: components.url!)
        req.addCommonHeaders()
        let (data, _) = try await session.data(for: req)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode([Opportunity].self, from: data)
    }

    func fetchOpportunity(id: String) async throws -> Opportunity {
        var req = URLRequest(url: baseURL.appendingPathComponent("/rest/v1/opportunity_feed").appendingPathComponent("?id=eq.\(id)"))
        req.addCommonHeaders()
        let (data, _) = try await session.data(for: req)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let results = try decoder.decode([Opportunity].self, from: data)
        guard let first = results.first else { throw AppError.notFound }
        return first
    }

    // MARK: - Watchlist

    func fetchWatchlist(userId: String) async throws -> [Opportunity] {
        var req = URLRequest(url: baseURL.appendingPathComponent("/rest/v1/rpc/get_watchlist"))
        req.httpMethod = "POST"
        req.addCommonHeaders()
        req.httpBody = try JSONEncoder().encode(["user_id": userId])
        let (data, _) = try await session.data(for: req)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode([Opportunity].self, from: data)
    }

    func addToWatchlist(userId: String, opportunityId: String, ticker: String) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("/rest/v1/user_watchlist"))
        req.httpMethod = "POST"
        req.addCommonHeaders()
        req.httpBody = try JSONEncoder().encode([
            "user_id": userId,
            "opportunity_id": opportunityId,
            "ticker": ticker,
        ])
        _ = try await session.data(for: req)
    }

    func removeFromWatchlist(userId: String, ticker: String) async throws {
        var components = URLComponents(url: baseURL.appendingPathComponent("/rest/v1/user_watchlist"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "user_id", value: "eq.\(userId)"),
            URLQueryItem(name: "ticker", value: "eq.\(ticker)"),
        ]
        var req = URLRequest(url: components.url!)
        req.httpMethod = "DELETE"
        req.addCommonHeaders()
        _ = try await session.data(for: req)
    }

    // MARK: - Push token registration

    func registerPushToken(_ token: String, userId: String) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("/rest/v1/push_tokens"))
        req.httpMethod = "POST"
        req.addCommonHeaders()
        req.setValue("resolution=merge-duplicates", forHTTPHeaderField: "Prefer")
        req.httpBody = try JSONEncoder().encode([
            "user_id": userId,
            "apns_token": token,
        ])
        _ = try await session.data(for: req)
    }
}

// MARK: - Helpers

private extension URLRequest {
    mutating func addCommonHeaders() {
        setValue("application/json", forHTTPHeaderField: "Content-Type")
        setValue("application/json", forHTTPHeaderField: "Accept")
        setValue(SUPABASE_ANON_KEY, forHTTPHeaderField: "apikey")
        if let token = AuthService.shared.currentToken {
            setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else {
            setValue("Bearer \(SUPABASE_ANON_KEY)", forHTTPHeaderField: "Authorization")
        }
    }
}

enum AppError: Error {
    case notFound
    case unauthorized
    case networkError(String)
}
