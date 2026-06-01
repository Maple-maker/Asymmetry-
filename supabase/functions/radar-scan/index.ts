// Deployed via Supabase MCP — see deploy history in AEGIS project
// Function: radar-scan | Project: lmgphebvungyqsnqitcg
// Schedule: every 6 hours via pg_cron (0 0,6,12,18 * * *)
//
// To redeploy: use Supabase MCP deploy_edge_function tool
// To view logs: Supabase dashboard → AEGIS → Edge Functions → radar-scan → Logs
// To add tickers: INSERT INTO radar_watchlist (ticker, notes) VALUES ('TICK', 'reason');
// To view opportunities: SELECT * FROM radar_opportunities ORDER BY created_at DESC;
