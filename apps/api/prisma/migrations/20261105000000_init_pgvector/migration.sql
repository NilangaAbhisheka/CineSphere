-- ==============================================================================
-- Migration: 20261105000000_init_pgvector
-- Purpose: Enable pgvector extension and establish foundation tables
-- ==============================================================================

-- 1. Enable PostgreSQL Vector Similarity Search Extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create Initial Foundation Tables
CREATE TABLE IF NOT EXISTS "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "displayName" VARCHAR(100) NOT NULL DEFAULT 'CineSphere User',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "system_configs" (
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("key")
);
