import SwiftUI

struct BuyZoneView: View {
    let opportunity: Opportunity

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Price ladder visual
            if let price = opportunity.snap?.price {
                priceLadder(currentPrice: price)
            }

            // Zone cards
            HStack(spacing: 10) {
                if let z = opportunity.buyZoneAggressive {
                    zoneCard("Aggressive", price: z, note: "High risk / high reward entry", color: DS.Color.bull)
                }
                if let z = opportunity.buyZoneBase {
                    zoneCard("Base Case", price: z, note: "Standard thesis entry", color: DS.Color.neutral)
                }
                if let z = opportunity.buyZoneConservative {
                    zoneCard("Conservative", price: z, note: "Confirmed breakout entry", color: DS.Color.textSecondary)
                }
            }

            // Floor vs target
            if let floor = opportunity.floorPrice, let target = opportunity.targetPrice {
                VStack(spacing: 6) {
                    HStack {
                        label("Bear floor", value: "$\(String(format: "%.2f", floor))", color: DS.Color.bear)
                        Spacer()
                        label("Bull target", value: "$\(String(format: "%.2f", target))", color: DS.Color.bull)
                    }
                    if let price = opportunity.snap?.price {
                        let totalRange = target - floor
                        let currentPos = max(0, min(1, (price - floor) / totalRange))
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                LinearGradient(
                                    colors: [DS.Color.bear.opacity(0.4), DS.Color.neutral.opacity(0.4), DS.Color.bull.opacity(0.4)],
                                    startPoint: .leading, endPoint: .trailing
                                )
                                .frame(height: 8)
                                .clipShape(Capsule())

                                // Current price marker
                                Circle()
                                    .fill(.white)
                                    .frame(width: 12, height: 12)
                                    .shadow(color: .black.opacity(0.3), radius: 2)
                                    .offset(x: geo.size.width * currentPos - 6)
                            }
                        }
                        .frame(height: 12)

                        HStack {
                            Text("Current: $\(String(format: "%.2f", price))")
                                .font(DS.Font.caption(11))
                                .foregroundColor(DS.Color.textSecondary)
                            Spacer()
                            if let upside = opportunity.upsidePct {
                                Text("+\(Int(upside))% to target")
                                    .font(DS.Font.caption(11))
                                    .foregroundColor(DS.Color.bull)
                            }
                        }
                    }
                }
                .padding(12)
                .background(DS.Color.cardElevated)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func priceLadder(currentPrice: Double) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("RISK/REWARD LADDER")
                .font(DS.Font.caption(10))
                .foregroundColor(DS.Color.textSecondary)

            if let target = opportunity.targetPrice, let floor = opportunity.floorPrice {
                let upside = ((target - currentPrice) / currentPrice * 100)
                let downside = ((currentPrice - floor) / currentPrice * 100)
                let ratio = upside / max(downside, 1)

                HStack(spacing: 16) {
                    VStack(spacing: 2) {
                        Text("Upside")
                            .font(DS.Font.caption(10))
                            .foregroundColor(DS.Color.textMuted)
                        Text("+\(String(format: "%.0f", upside))%")
                            .font(DS.Font.mono(20))
                            .foregroundColor(DS.Color.bull)
                    }
                    Text(":")
                        .font(DS.Font.displayBold(20))
                        .foregroundColor(DS.Color.textMuted)
                    VStack(spacing: 2) {
                        Text("Downside")
                            .font(DS.Font.caption(10))
                            .foregroundColor(DS.Color.textMuted)
                        Text("-\(String(format: "%.0f", downside))%")
                            .font(DS.Font.mono(20))
                            .foregroundColor(DS.Color.bear)
                    }
                    Spacer()
                    VStack(spacing: 2) {
                        Text("R:R Ratio")
                            .font(DS.Font.caption(10))
                            .foregroundColor(DS.Color.textMuted)
                        Text("\(String(format: "%.1f", ratio))x")
                            .font(DS.Font.mono(20))
                            .foregroundColor(ratio >= 3 ? DS.Color.bull : DS.Color.neutral)
                    }
                }
            }
        }
        .padding(12)
        .background(DS.Color.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func zoneCard(_ title: String, price: Double, note: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(DS.Font.caption(10))
                .foregroundColor(color)
            Text("$\(String(format: "%.2f", price))")
                .font(DS.Font.mono(18))
                .foregroundColor(.white)
            Text(note)
                .font(DS.Font.caption(10))
                .foregroundColor(DS.Color.textMuted)
                .lineLimit(2)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.08))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(color.opacity(0.3), lineWidth: 0.5))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func label(_ title: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(DS.Font.caption(10))
                .foregroundColor(DS.Color.textMuted)
            Text(value)
                .font(DS.Font.mono(14))
                .foregroundColor(color)
        }
    }
}
