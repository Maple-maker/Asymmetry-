import Foundation
import Combine

@MainActor
final class FeedViewModel: ObservableObject {
    @Published var opportunities: [Opportunity] = []
    @Published var watchlisted: Set<String> = []
    @Published var activeFilter = "All"
    @Published var isLoading = false
    @Published var isScanning = false
    @Published var hasMore = true

    private var page = 0
    private let pageSize = 15

    var filtered: [Opportunity] {
        switch activeFilter {
        case "Tier 1":    return opportunities.filter { $0.tier == 1 }
        case "Tier 2":    return opportunities.filter { $0.tier == 2 }
        case "BULL":      return opportunities.filter { $0.debateVerdict == .bull }
        case "BEAR":      return opportunities.filter { $0.debateVerdict == .bear }
        case "Gov Contracts": return opportunities.filter { $0.catalyst.lowercased().contains("contract") || $0.sourceCompany.lowercased().contains("dod") }
        case "FDA":       return opportunities.filter { $0.catalyst.lowercased().contains("fda") || $0.catalyst.lowercased().contains("drug") }
        case "Partnerships": return opportunities.filter { $0.catalyst.lowercased().contains("partner") }
        default:          return opportunities
        }
    }

    func loadFeed(isPremium: Bool) async {
        isLoading = true
        page = 0
        hasMore = true
        do {
            let results = try await SupabaseService.shared.fetchFeed(isPremium: isPremium, limit: pageSize, offset: 0)
            opportunities = results
            hasMore = results.count == pageSize
        } catch {
            print("[feed] load error: \(error)")
        }
        isLoading = false
    }

    func loadMore(isPremium: Bool) async {
        guard hasMore, !isLoading else { return }
        page += 1
        isLoading = true
        do {
            let more = try await SupabaseService.shared.fetchFeed(isPremium: isPremium, limit: pageSize, offset: page * pageSize)
            opportunities.append(contentsOf: more)
            hasMore = more.count == pageSize
        } catch {
            print("[feed] load more error: \(error)")
        }
        isLoading = false
    }

    func toggleWatchlist(_ opportunity: Opportunity) async {
        guard let userId = AuthService.shared.currentUser?.id else { return }
        if watchlisted.contains(opportunity.ticker) {
            watchlisted.remove(opportunity.ticker)
            try? await SupabaseService.shared.removeFromWatchlist(userId: userId, ticker: opportunity.ticker)
        } else {
            watchlisted.insert(opportunity.ticker)
            try? await SupabaseService.shared.addToWatchlist(userId: userId, opportunityId: opportunity.id, ticker: opportunity.ticker)
        }
    }
}
