import SwiftUI

// MARK: — Circular score gauge

struct ScoreGauge: View {
    let score: Double
    let size: CGFloat

    private var color: Color {
        if score >= 80 { return DS.Color.bull }
        if score >= 65 { return DS.Color.neutral }
        return DS.Color.bear
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(DS.Color.border, lineWidth: size * 0.08)

            Circle()
                .trim(from: 0, to: score / 100)
                .stroke(color, style: StrokeStyle(lineWidth: size * 0.08, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.spring(response: 0.6, dampingFraction: 0.7), value: score)

            VStack(spacing: 0) {
                Text("\(Int(score))")
                    .font(DS.Font.mono(size * 0.32))
                    .foregroundColor(.white)
                Text("/100")
                    .font(DS.Font.caption(size * 0.14))
                    .foregroundColor(DS.Color.textSecondary)
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: — Horizontal score bar (for individual dimensions)

struct DimensionBar: View {
    let label: String
    let score: Int

    var body: some View {
        HStack(spacing: 10) {
            Text(label)
                .font(DS.Font.caption())
                .foregroundColor(DS.Color.textSecondary)
                .frame(width: 80, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(DS.Color.border)
                        .frame(height: 6)

                    RoundedRectangle(cornerRadius: 3)
                        .fill(scoreColor)
                        .frame(width: geo.size.width * CGFloat(score) / 10, height: 6)
                        .animation(.spring(response: 0.5), value: score)
                }
            }
            .frame(height: 6)

            Text("\(score)/10")
                .font(DS.Font.mono(12))
                .foregroundColor(.white)
                .frame(width: 36, alignment: .trailing)
        }
    }

    private var scoreColor: Color {
        if score >= 8 { return DS.Color.bull }
        if score >= 6 { return DS.Color.neutral }
        return DS.Color.bear
    }
}

// MARK: — Probability pill

struct ProbabilityBadge: View {
    let probability: Double

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "chart.bar.fill")
                .font(.system(size: 10))
            Text("\(Int(probability))% probability")
                .font(DS.Font.caption(11))
        }
        .foregroundColor(color)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(color.opacity(0.15))
        .clipShape(Capsule())
    }

    private var color: Color {
        if probability >= 70 { return DS.Color.bull }
        if probability >= 50 { return DS.Color.neutral }
        return DS.Color.bear
    }
}

#Preview {
    VStack(spacing: 20) {
        ScoreGauge(score: 80.5, size: 100)
        DimensionBar(label: "Asymmetry", score: 9)
        DimensionBar(label: "Conviction", score: 8)
        ProbabilityBadge(probability: 72)
    }
    .padding()
    .background(DS.Color.background)
}
