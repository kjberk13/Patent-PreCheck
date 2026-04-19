# Railway/Heroku-style process file.
#
# Railway reads this to discover runnable processes. Two are defined:
#
#   ingest-delta : daily delta ingestion across every implemented worker
#   health-ping  : hits the Netlify analyze endpoint, asserts a 200
#
# Schedule these in the Railway dashboard (Settings → Cron):
#
#   ingest-delta : 0 9 * * *      (09:00 UTC = 02:00 Pacific daily)
#   health-ping  : */15 * * * *   (every 15 minutes)
#
# For one-off backfills, use `railway run npm run ingest -- --source=arxiv
# --mode=backfill --limit=N` from your local machine; the same env and
# DATABASE_URL will be applied.

ingest-delta: npm run ingest:delta
health-ping: npm run health-ping
