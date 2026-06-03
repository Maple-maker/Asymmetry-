import SwiftUI

struct WatchlistView: View {
    @StateObject private var vm = WatchlistViewModel()
    @EnvironmentObject var auth: AuthService

    var body: some View {
        NavigationStack {
            ZStack {
                DS.Color.background.ignoresSafeArea()
                VStack(spacing: 0) {
                    header
                    if vm.items.isEmpty {
                        emptyState
                    } else {
                        list
                    }
                }
            }
            .navigationBarHidden(true)
        }
        .task { await vm.load(userId: auth.currentUser?.id ?? "") }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Watchlist")
                    .font(DS.Font.displayBold(28))
                    .foregroundColor(.white)
                Text("\(vm.items.count) positions tracked")
                    .font(DS.Font.caption(12))
                    .foregroundColor(DS.Color.textSecondary)
            }
            Spacer()
        }
        .padding(.horizontal, DS.paddingScreen)
        .padding(.top, 16)
        .padding(.bottom, 12)
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(vm.items) { opp in
                    NavigationLink(destination: OpportunityDetailView(opportunity: opp)) {
                        WatchlistRow(opportunity: opp)
                    }
                    .padding(.horizontal, DS.paddingScreen)
                }
            }
            .padding(.top, 8)
            .padding(.bottom, 100)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "bookmark")
                .font(.system(size: 48))
                .foregroundColor(DS.Color.textMuted)
            Text("No positions tracked")
                .font(DS.Font.displayMedium(18))
                .foregroundColor(.white)
            Text("Bookmark opportunities from the radar to track them here.")
                .font(DS.Font.body(14))
                .foregroundColor(DS.Color.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
        }
    }
}

struct WatchlistRow: View {
    let opportunity: Opportunity

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("$\(opportunity.ticker)")
                        .font(DS.Font.displayBold(16))
                        .foregroundColor(.white)
                    Text(opportunity.tier.tierShort)
                        .font(DS.Font.caption(10))
                        .foregroundColor(opportunity.tier.tierColor)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(opportunity.tier.tierColor.opacity(0.15))
                        .clipShape(Capsule())
                }
                Text(opportunity.companyName)
                    .font(DS.Font.caption(12))
                    .foregroundColor(DS.Color.textSecondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                if let price = opportunity.snap?.price {
                    Text("$\(String(format: "%.2f", price))")
                        .font(DS.Font.mono(15))
                        .foregroundColor(.white)
                }
                VerdictChip(label: "", verdict: opportunity.debateVerdict)
            }
            ScoreGauge(score: opportunity.overallScore, size: 44)
        }
        .padding(DS.paddingCard)
        .background(DS.Color.card)
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusCard))
    }
}

@MainActor
final class WatchlistViewModel: ObservableObject {
    @Published var items: [Opportunity] = []

    func load(userId: String) async {
        guard !userId.isEmpty else { return }
        items = (try? await SupabaseService.shared.fetchWatchlist(userId: userId)) ?? []
    }
}
