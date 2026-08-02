# Postgres 16 with PostGIS, pgvector, pg_trgm, citext and pgcrypto
# (PRD §16.3/§21.5) — the DDL in Phase 2 depends on all five extensions
# existing before any migration runs.
FROM postgis/postgis:16-3.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvector postgresql-contrib-16 \
    && rm -rf /var/lib/apt/lists/*

COPY init.sql /docker-entrypoint-initdb.d/01-init.sql
