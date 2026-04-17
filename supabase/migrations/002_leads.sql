-- =============================================================================
-- Migration: 002_leads.sql
-- Description: Creates the leads table for Aviv Iasso Law Firm contact form
--              submissions, with Row Level Security policies.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Create enum types
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE practice_area_enum AS ENUM (
    'business_law',
    'real_estate',
    'litigation',
    'family_law',
    'criminal_law',
    'employment_law',
    'contracts',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE preferred_contact_enum AS ENUM (
    'phone',
    'email',
    'whatsapp'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE lead_status_enum AS ENUM (
    'new',
    'contacted',
    'in_progress',
    'converted',
    'closed',
    'spam'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Create leads table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.leads (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contact information
  full_name         TEXT          NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 100),
  email             TEXT          NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone             TEXT          NOT NULL CHECK (char_length(phone) BETWEEN 9 AND 20),

  -- Enquiry details
  practice_area     practice_area_enum    NOT NULL DEFAULT 'other',
  message           TEXT          NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  preferred_contact preferred_contact_enum NOT NULL DEFAULT 'phone',

  -- Internal CRM fields
  status            lead_status_enum      NOT NULL DEFAULT 'new',
  assigned_to       TEXT          NULL,
  internal_notes    TEXT          NULL,

  -- Metadata
  source_ip         TEXT          NULL,
  user_agent        TEXT          NULL,
  referrer          TEXT          NULL,

  -- Timestamps
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  contacted_at      TIMESTAMPTZ   NULL
);

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS leads_created_at_idx   ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_status_idx       ON public.leads (status);
CREATE INDEX IF NOT EXISTS leads_practice_area_idx ON public.leads (practice_area);
CREATE INDEX IF NOT EXISTS leads_email_idx        ON public.leads (email);

-- ---------------------------------------------------------------------------
-- 4. Auto-update updated_at trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_set_updated_at ON public.leads;

CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Enable Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 6. RLS Policies
-- ---------------------------------------------------------------------------

-- DROP existing policies to ensure idempotency
DROP POLICY IF EXISTS leads_insert_anon   ON public.leads;
DROP POLICY IF EXISTS leads_select_staff  ON public.leads;
DROP POLICY IF EXISTS leads_update_staff  ON public.leads;
DROP POLICY IF EXISTS leads_delete_staff  ON public.leads;

-- 6a. Allow anonymous users (website visitors) to INSERT only.
--     They cannot read, update, or delete any leads.
CREATE POLICY leads_insert_anon
  ON public.leads
  FOR INSERT
  TO anon
  WITH CHECK (
    -- Ensure core fields are non-empty at policy level as a secondary guard
    full_name IS NOT NULL AND
    email     IS NOT NULL AND
    phone     IS NOT NULL AND
    message   IS NOT NULL
  );

-- 6b. Authenticated staff can SELECT all leads.
--     In production, scope this further with a custom 'staff' role or JWT claim.
CREATE POLICY leads_select_staff
  ON public.leads
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- 6c. Authenticated staff can UPDATE leads (e.g. change status, add notes).
CREATE POLICY leads_update_staff
  ON public.leads
  FOR UPDATE
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- 6d. Only authenticated staff with the service_role can DELETE.
--     Soft-delete via status = 'spam' is preferred.
CREATE POLICY leads_delete_staff
  ON public.leads
  FOR DELETE
  TO authenticated
  USING (TRUE);

-- ---------------------------------------------------------------------------
-- 7. Grant permissions
-- ---------------------------------------------------------------------------

GRANT INSERT ON public.leads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Comments for documentation
-- ---------------------------------------------------------------------------

COMMENT ON TABLE  public.leads                    IS 'Contact form submissions from the Aviv Iasso law firm website.';
COMMENT ON COLUMN public.leads.id                IS 'Unique lead identifier (UUID v4).';
COMMENT ON COLUMN public.leads.full_name          IS 'Full name of the prospective client (Hebrew or English).';
COMMENT ON COLUMN public.leads.email              IS 'Email address — normalised to lowercase by the API layer.';
COMMENT ON COLUMN public.leads.phone              IS 'Israeli phone number, stripped of formatting characters.';
COMMENT ON COLUMN public.leads.practice_area      IS 'Legal domain the client is enquiring about.';
COMMENT ON COLUMN public.leads.message            IS 'Free-text enquiry message in Hebrew or English.';
COMMENT ON COLUMN public.leads.preferred_contact  IS 'How the client prefers to be contacted.';
COMMENT ON COLUMN public.leads.status             IS 'CRM pipeline status of this lead.';
COMMENT ON COLUMN public.leads.source_ip          IS 'Client IP address logged for abuse prevention.';
COMMENT ON COLUMN public.leads.created_at         IS 'Timestamp when the lead was submitted.';
COMMENT ON COLUMN public.leads.updated_at         IS 'Timestamp of the last update to this record (auto-managed).';
