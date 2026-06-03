import SwiftUI

struct FeedView: View {
    @StateObject private var vm = FeedViewModel()
    @EnvironmentObject var auth: AuthService

    private let filters = ["All", "Tier 1", "Tier 2", "BULL", "BEAR", "Gov Contracts", "FDA", "Partnerships"]

    var body: some View {
        NavigationStack {
            ZStack {
                DS.Color.background.ignoresSafeArea()

                VStack(spacing: 0) {
                    // ── Header
                    header

                    // ── Filter chips
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(filters, id: \.self) { f in
                                FilterChip(label: f, isSelected: vm.activeFilter == f) {
                                    vm.activeFilter = f
                                }
                            }
                        }
                        .padding(.horizontal, DS.paddingScreen)
                        .padding(.vertical, 10)
                    }

                    Divider().background(DS.Color.border)

                    // ── Feed
                    if vm.isLoading && vm.opportunities.isEmpty {
                        loadingState
                    } else if vm.opportunities.isEmpty {
                        emptyState
                    } else {
                        feedList
                    }
                }
            }
            .navigationBarHidden(true)
        }
        .task { await vm.loadFeed(isPremium: auth.currentUser?.subscriptionTier.hasFull ?? false) }
    }

    // MARK: — Sub-views

    private var header: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(DS.Color.bull)
                        .frame(width: 8, height: 8)
                        .scaleEffect(vm.isScanning ? 1.3 : 1.0)
                        .animation(.easeInOut(duration: 0.8).repeatForever(), value: vm.isScanning)
                    Text(vm.isScanning ? "Scanning markets…" : "Radar active")
                        .font(DS.Font.caption(11))
                        .foregroundColor(vm.isScanning ? DS.Color.bull : DS.Color.textSecondary)
                }
                Text("No Fomo")
                    .font(DS.Font.displayBold(28))
                    .foregroundColor(.white)
            }
            Spacer()
            Button(action: {}) {
                Image(systemName: "bell.fill")
                    .font(.system(size: 18))
                    .foregroundColor(DS.Color.textSecondary)
            }
        }
        .padding(.horizontal, DS.paddingScreen)
        .padding(.top, 16)
        .padding(.bottom, 8)
    }

    private var feedList: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                // Free tier delay banner
                if !(auth.currentUser?.subscriptionTier.hasFull ?? false) {
                    FreeDelayBanner()
                        .padding(.horizontal, DS.paddingScreen)
                }

                ForEach(vm.filtered) { opp in
                    NavigationLink(destination: OpportunityDetailView(opportunity: opp)) {
                        OpportunityCard(opportunity: opp) {
                            Task { await vm.toggleWatchlist(opp) }
                        }
                    }
                    .padding(.horizontal, DS.paddingScreen)
                }

                if vm.hasMore {
                    ProgressView()
                        .tint(DS.Color.accent)
                        .padding()
                        .onAppear {
                            Task { await vm.loadMore(isPremium: auth.currentUser?.subscriptionTier.hasFull ?? false) }
                        }
                }
            }
            .padding(.top, 8)
            .padding(.bottom, 100)
        }
        .refreshable { await vm.loadFeed(isPremium: auth.currentUser?.subscriptionTier.hasFull ?? false) }
    }

    private var loadingState: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView()
                .tint(DS.Color.accent)
                .scaleEffect(1.5)
            Text("Scanning catalysts…")
                .font(DS.Font.body())
                .foregroundColor(DS.Color.textSecondary)
            Spacer()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.system(size: 48))
                .foregroundColor(DS.Color.textMuted)
            Text("No signals today")
                .font(DS.Font.displayMedium(18))
                .foregroundColor(.white)
            Text("The AI council found no opportunities above the 75/100 threshold. Check back tomorrow.")
                .font(DS.Font.body(14))
                .foregroundColor(DS.Color.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
        }
    }
}

// MARK: — Filter chip

struct FilterChip: View {
    let label: String
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(label)
                .font(DS.Font.caption(12))
                .foregroundColor(isSelected ? .black : DS.Color.textSecondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(isSelected ? DS.Color.bull : DS.Color.cardElevated)
                .clipShape(Capsule())
        }
    }
}

// MARK: — Free delay banner

struct FreeDelayBanner: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "clock.fill")
                .font(.system(size: 13))
                .foregroundColor(DS.Color.neutral)
            VStack(alignment: .leading, spacing: 2) {
                Text("Free tier: 24h delayed alerts")
                    .font(DS.Font.caption(12))
                    .foregroundColor(.white)
                Text("Upgrade to Pro for real-time signals")
                    .font(DS.Font.caption(11))
                    .foregroundColor(DS.Color.textSecondary)
            }
            Spacer()
            Text("Upgrade")
                .font(DS.Font.caption(12))
                .foregroundColor(.black)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(DS.Color.tier1)
                .clipShape(Capsule())
        }
        .padding(12)
        .background(DS.Color.neutral.opacity(0.1))
        .overlay(RoundedRectangle(cornerRadius: DS.radiusSmall).stroke(DS.Color.neutral.opacity(0.3), lineWidth: 0.5))
        .clipShape(RoundedRectangle(cornerRadius: DS.radiusSmall))
    }
}
