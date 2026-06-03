import SwiftUI

struct FinancialsView: View {
    let snap: FinancialSnapshot?
    let opportunity: Opportunity

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let snap = snap {
                metricsGrid(snap: snap)
            }
        }
    }

    private func metricsGrid(snap: FinancialSnapshot) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            metricCell("Price",       value: snap.price.map { "$\(String(format: "%.2f", $0))" })
            metricCell("Market Cap",  value: snap.formattedMarketCap)
            metricCell("P/E (TTM)",   value: snap.pe.map { String(format: "%.1f", $0) })
            metricCell("EV/EBITDA",   value: snap.evToEbitda.map { String(format: "%.1f", $0) })
            metricCell("P/S (TTM)",   value: snap.psRatioTTM.map { String(format: "%.1f", $0) })
            metricCell("P/FCF",       value: snap.pfcfRatioTTM.map { String(format: "%.1f", $0) })
            metricCell("Gross Margin",value: snap.grossMarginTTM.map { "\(String(format: "%.1f", $0 * 100))%" },
                       highlight: highlightGross(snap.grossMarginTTM))
            metricCell("Rev Growth",  value: snap.revenueGrowthTTM.map { "\(String(format: "%.1f", $0 * 100))%" },
                       highlight: highlightGrowth(snap.revenueGrowthTTM))
            metricCell("Beta",        value: snap.beta.map { String(format: "%.2f", $0) })
            metricCell("Sector",      value: snap.sector)
        }
    }

    private func metricCell(_ label: String, value: String?, highlight: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(DS.Font.caption(10))
                .foregroundColor(DS.Color.textMuted)
            Text(value ?? "N/A")
                .font(DS.Font.mono(15))
                .foregroundColor(highlight ?? .white)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DS.Color.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func highlightGross(_ v: Double?) -> Color? {
        guard let v else { return nil }
        if v >= 0.6 { return DS.Color.bull }
        if v <= 0.2 { return DS.Color.bear }
        return nil
    }

    private func highlightGrowth(_ v: Double?) -> Color? {
        guard let v else { return nil }
        if v >= 0.3 { return DS.Color.bull }
        if v < 0 { return DS.Color.bear }
        return nil
    }
}
