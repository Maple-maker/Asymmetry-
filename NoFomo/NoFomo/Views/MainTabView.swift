import SwiftUI

struct MainTabView: View {
    @State private var selectedTab = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $selectedTab) {
                FeedView()
                    .tag(0)
                WatchlistView()
                    .tag(1)
                SettingsView()
                    .tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            // Custom tab bar
            customTabBar
        }
        .ignoresSafeArea(edges: .bottom)
    }

    private var customTabBar: some View {
        HStack(spacing: 0) {
            tabItem(icon: "antenna.radiowaves.left.and.right", label: "Radar", tag: 0)
            tabItem(icon: "bookmark.fill", label: "Watchlist", tag: 1)
            tabItem(icon: "person.fill", label: "Account", tag: 2)
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 28)
        .background(.ultraThinMaterial)
        .overlay(Divider().background(DS.Color.border), alignment: .top)
    }

    private func tabItem(icon: String, label: String, tag: Int) -> some View {
        Button(action: { withAnimation { selectedTab = tag } }) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: selectedTab == tag ? .bold : .regular))
                    .foregroundColor(selectedTab == tag ? DS.Color.bull : DS.Color.textMuted)
                Text(label)
                    .font(DS.Font.caption(10))
                    .foregroundColor(selectedTab == tag ? DS.Color.bull : DS.Color.textMuted)
            }
            .frame(maxWidth: .infinity)
        }
    }
}
