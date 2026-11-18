#!/usr/bin/env bash
# Go tests. Unit tests need nothing; the integration test needs a scratch PostgreSQL: TEST_DATABASE_URL=postgres://user@host/db
set -euo pipefail
cd "$(dirname "$0")/.."
go vet ./...
go test ./... "$@"
