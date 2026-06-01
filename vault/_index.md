# Asymmetry Opportunity Radar

## Active Opportunities

```dataview
TABLE tier, overall_score, target_price, floor_price
FROM "opportunities"
WHERE status = "active"
SORT overall_score DESC
```

*Run `python3 tools/sync_vault.py` to update from Supabase.*
