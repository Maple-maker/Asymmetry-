import Foundation

// MARK: - Core opportunity model (maps to opportunity_feed Supabase table)

struct Opportunity: Identifiable, Codable {
    let id: String
    let ticker: String
    let companyName: String
    let tier: Int
    let overallScore: Double
    let bluf: String
    let thesis: String
    let bullCase: String?
    let bearCase: String?
    let buyZoneAggressive: Double?
    let buyZoneBase: Double?
    let buyZoneConservative: Double?
    let catalyst: String
    let sourceCompany: String
    let sourceQuote: String?
    let debateVerdict: Verdict
    let geminiVerdict: Verdict
    let deepseekVerdict: Verdict
    let probabilityScore: Double
    let marketMiss: String
    let invalidationTrigger: String
    let snap: FinancialSnapshot?
    let fullReportMd: String?
    let isPremium: Bool
    let publishedAt: Date

    // Conviction dimensions
    let asymmetryScore: Int
    let convictionScore: Int
    let catalystScore: Int
    let managementScore: Int
    let targetPrice: Double?
    let floorPrice: Double?
    let upsidePct: Double?
    let downsidePct: Double?

    // Triple Signal
    let isTripleSignal: Bool
    let smartMoneyScore: Int?
    let marketCapScore: Int?

    enum CodingKeys: String, CodingKey {
        case id, ticker
        case companyName = "company_name"
        case tier
        case overallScore = "overall_score"
        case bluf, thesis
        case bullCase = "bull_case"
        case bearCase = "bear_case"
        case buyZoneAggressive = "buy_zone_aggressive"
        case buyZoneBase = "buy_zone_base"
        case buyZoneConservative = "buy_zone_conservative"
        case catalyst
        case sourceCompany = "source_company"
        case sourceQuote = "source_quote"
        case debateVerdict = "debate_verdict"
        case geminiVerdict = "gemini_verdict"
        case deepseekVerdict = "deepseek_verdict"
        case probabilityScore = "probability_score"
        case marketMiss = "market_miss"
        case invalidationTrigger = "invalidation_trigger"
        case snap, fullReportMd = "full_report_md"
        case isPremium = "is_premium"
        case publishedAt = "published_at"
        case asymmetryScore = "asymmetry_score"
        case convictionScore = "conviction_score"
        case catalystScore = "catalyst_score"
        case managementScore = "management_score"
        case targetPrice = "target_price"
        case floorPrice = "floor_price"
        case upsidePct = "upside_pct"
        case downsidePct = "downside_pct"
        case isTripleSignal = "is_triple_signal"
        case smartMoneyScore = "smart_money_score"
        case marketCapScore = "market_cap_score"
    }
}

enum Verdict: String, Codable {
    case bull = "BULL"
    case bear = "BEAR"
    case neutral = "NEUTRAL"
}

struct FinancialSnapshot: Codable {
    let price: Double?
    let mktCap: Double?
    let pe: Double?
    let evToEbitda: Double?
    let psRatioTTM: Double?
    let pfcfRatioTTM: Double?
    let grossMarginTTM: Double?
    let revenueGrowthTTM: Double?
    let beta: Double?
    let sector: String?
    let industry: String?

    var formattedMarketCap: String {
        guard let cap = mktCap else { return "N/A" }
        if cap >= 1_000_000_000 { return "$\(String(format: "%.1f", cap / 1_000_000_000))B" }
        return "$\(String(format: "%.0f", cap / 1_000_000))M"
    }
}

// MARK: - Mock data for previews

extension Opportunity {
    static let mock = Opportunity(
        id: "mock-1",
        ticker: "IREN",
        companyName: "Iris Energy Limited",
        tier: 2,
        overallScore: 80.5,
        bluf: "The market prices IREN as a bitcoin miner. It's becoming an AI compute infrastructure play with 510 MW of secured power — the rarest commodity in the AI buildout.",
        thesis: "IREN's pivot to GPU cloud compute is underpriced. The market still assigns a miner multiple while AI compute revenue is scaling rapidly.",
        bullCase: "IREN's 510 MW power portfolio is a strategic moat in the AI era. As hyperscalers exhaust co-location options, companies with secured utility-scale power become critical infrastructure.",
        bearCase: "Bitcoin price dependency remains high. A BTC drawdown could force capital reallocation away from AI expansion. GPU cloud contracts are short-term and non-exclusive.",
        buyZoneAggressive: 8.50,
        buyZoneBase: 10.20,
        buyZoneConservative: 12.00,
        catalyst: "Q3 2026 earnings — AI compute revenue expected to cross 30% of total, forcing re-rating from miner to AI infrastructure multiple",
        sourceCompany: "NVIDIA",
        sourceQuote: "Jensen Huang: 'Every country, every company needs its own AI factory.'",
        debateVerdict: .bull,
        geminiVerdict: .bull,
        deepseekVerdict: .bull,
        probabilityScore: 72,
        marketMiss: "The market is fundamentally undervaluing IREN's scalable low-cost power as an enabling asset for AI compute.",
        invalidationTrigger: "AI compute revenue fails to cross 20% of total by Q4 2025 OR GPU cloud gross margins fall below 35% for 2 consecutive quarters.",
        snap: FinancialSnapshot(
            price: 11.40,
            mktCap: 1_200_000_000,
            pe: nil,
            evToEbitda: 14.2,
            psRatioTTM: 3.1,
            pfcfRatioTTM: nil,
            grossMarginTTM: 0.42,
            revenueGrowthTTM: 0.87,
            beta: 2.4,
            sector: "Technology",
            industry: "Data Centers"
        ),
        fullReportMd: nil,
        isPremium: false,
        publishedAt: Date(),
        asymmetryScore: 9,
        convictionScore: 8,
        catalystScore: 8,
        managementScore: 7,
        targetPrice: 32.0,
        floorPrice: 6.50,
        upsidePct: 181,
        downsidePct: 43,
        isTripleSignal: true,
        smartMoneyScore: 8,
        marketCapScore: 8
    )
}
