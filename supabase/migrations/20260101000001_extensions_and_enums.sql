-- =========================================================================
-- JewelryFlow ERP — Migration 001
-- Extensions and Enum Types
-- =========================================================================
-- This migration establishes the foundational PostgreSQL extensions and the
-- enumerated types shared across every downstream module. Enums are used
-- (rather than free-text status columns) to guarantee referential integrity
-- at the database layer and to give TanStack Query / Zod a single source of
-- truth to generate matching TypeScript literal unions from.
-- =========================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";      -- fuzzy search on names / batch numbers
create extension if not exists "btree_gist";   -- exclusion constraints (e.g. one active operation per batch)
create extension if not exists "moddatetime"; -- generic updated_at trigger helper, used by every table below

-- -------------------------------------------------------------------------
-- Role-based access control
-- -------------------------------------------------------------------------
create type app_role as enum (
  'admin',              -- full system access
  'production_manager', -- manages batches, workflow, assigns employees
  'department_operator',-- works a single department queue
  'quality_inspector',  -- QC module only
  'inventory_manager',  -- inventory + gold tracking
  'sales',               -- orders + customers
  'viewer'               -- read-only / reporting
);

-- -------------------------------------------------------------------------
-- Orders
-- -------------------------------------------------------------------------
create type order_status as enum (
  'draft',
  'confirmed',
  'in_production',
  'quality_hold',
  'ready_to_ship',
  'shipped',
  'completed',
  'cancelled'
);

create type order_priority as enum ('low', 'normal', 'high', 'urgent');

-- -------------------------------------------------------------------------
-- Batches
-- -------------------------------------------------------------------------
create type batch_status as enum (
  'pending',      -- created, not yet started
  'queued',       -- waiting in a department queue
  'in_progress',  -- actively being worked
  'delayed',      -- flagged delayed (has an open delay reason)
  'on_hold',      -- manually paused (e.g. QC failure, missing material)
  'completed',
  'cancelled'
);

create type batch_priority as enum ('low', 'normal', 'high', 'urgent');

-- -------------------------------------------------------------------------
-- Manufacturing workflow
--
-- The factory floor follows one fixed sequence today, but stage codes are
-- data (see `workflow_stages` table in migration 002) rather than hardcoded
-- here, so the sequence can be reordered/extended without a schema change.
-- This enum only classifies the *operational state* of a given stage
-- instance on a batch, not which stage it is.
-- -------------------------------------------------------------------------
create type operation_status as enum (
  'queued',
  'in_progress',
  'paused',
  'completed',
  'delayed',
  'skipped',
  'rejected'      -- failed QC / rework required, sent back a stage
);

create type delay_reason_category as enum (
  'machine_breakdown',
  'material_shortage',
  'employee_unavailable',
  'power_outage',
  'quality_rework',
  'design_change',
  'other'
);

-- -------------------------------------------------------------------------
-- Quality control
-- -------------------------------------------------------------------------
create type qc_result as enum ('pass', 'fail', 'conditional_pass');

-- -------------------------------------------------------------------------
-- Inventory
-- -------------------------------------------------------------------------
create type inventory_unit as enum ('gram', 'kilogram', 'piece', 'carat', 'meter', 'box');

create type inventory_transaction_type as enum (
  'purchase_in',
  'production_consumption',
  'production_return',
  'adjustment_in',
  'adjustment_out',
  'transfer',
  'scrap_out'
);

-- -------------------------------------------------------------------------
-- Gold tracking
--
-- Gold is tracked separately from generic inventory because it requires
-- purity (karat), melting-loss accounting, and per-batch weight-in/weight-out
-- reconciliation, which is a jewelry-manufacturing-specific compliance need.
-- -------------------------------------------------------------------------
create type gold_purity as enum ('k9', 'k14', 'k18', 'k21', 'k22', 'k24');

create type gold_transaction_type as enum (
  'lot_received',       -- new gold lot into the factory
  'issued_to_batch',     -- weighed out to a batch/department
  'returned_from_batch', -- unused gold returned
  'melting_loss',        -- accounted loss during casting/burnout
  'scrap_recovered',      -- recovered from filings/polishing dust
  'adjustment'
);

-- -------------------------------------------------------------------------
-- Employees
-- -------------------------------------------------------------------------
create type employment_status as enum ('active', 'on_leave', 'terminated');
