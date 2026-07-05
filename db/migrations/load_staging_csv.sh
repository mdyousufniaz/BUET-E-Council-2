#!/bin/sh
# Loads the CSVs produced by acq_parse.py into the legacy_* staging tables
# created by 001_legacy_staging.sql. Run against the running db container, e.g.:
#   docker compose exec -T db psql ... (adjust connection flags as needed)
set -e
CSVDIR="$(dirname "$0")/legacy_csv"
PSQL_CMD="${PSQL_CMD:-docker compose exec -T db psql -U admin -d ecouncil_db}"

for f in "$CSVDIR"/*.csv; do
  name=$(basename "$f" .csv)
  echo "Loading legacy_$name ..."
  $PSQL_CMD -c "\\copy legacy_$name FROM '/dev/stdin' WITH (FORMAT csv, NULL '')" < "$f"
done
