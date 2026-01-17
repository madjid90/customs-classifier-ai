-- Enable vector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Create enums for the application
CREATE TYPE public.user_role AS ENUM ('admin', 'agent', 'manager');
CREATE TYPE public.import_export_type AS ENUM ('import', 'export');
CREATE TYPE public.case_status AS ENUM ('IN_PROGRESS', 'RESULT_READY', 'VALIDATED', 'ERROR');
CREATE TYPE public.case_file_type AS ENUM ('tech_sheet', 'invoice', 'packing_list', 'certificate', 'dum', 'photo_product', 'photo_label', 'photo_plate', 'other', 'admin_ingestion');
CREATE TYPE public.classify_status AS ENUM ('NEED_INFO', 'DONE', 'ERROR', 'LOW_CONFIDENCE');
CREATE TYPE public.confidence_level AS ENUM ('high', 'medium', 'low');
CREATE TYPE public.evidence_source AS ENUM ('omd', 'maroc', 'lois', 'dum');
CREATE TYPE public.question_type AS ENUM ('yesno', 'select', 'text');
CREATE TYPE public.audit_action AS ENUM ('created', 'file_uploaded', 'classify_called', 'question_answered', 'result_ready', 'validated', 'exported');
CREATE TYPE public.ingestion_source AS ENUM ('omd', 'maroc', 'lois', 'dum');
CREATE TYPE public.ingestion_status AS ENUM ('NEW', 'EXTRACTING', 'PARSING', 'INDEXING', 'DONE', 'ERROR', 'DISABLED');
CREATE TYPE public.ingestion_log_level AS ENUM ('info', 'warning', 'error');
CREATE TYPE public.ingestion_step AS ENUM ('extract', 'parse', 'index');

-- Create companies table
CREATE TABLE public.companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.user_role NOT NULL DEFAULT 'agent',
  UNIQUE(user_id, role)
);

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create cases table
CREATE TABLE public.cases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  type_import_export public.import_export_type NOT NULL,
  origin_country TEXT NOT NULL CHECK (char_length(origin_country) = 2),
  product_name TEXT NOT NULL CHECK (char_length(product_name) >= 3 AND char_length(product_name) <= 500),
  status public.case_status NOT NULL DEFAULT 'IN_PROGRESS',
  created_by UUID NOT NULL REFERENCES auth.users(id),
  validated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  validated_at TIMESTAMP WITH TIME ZONE
);

-- Create case_files table
CREATE TABLE public.case_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  file_type public.case_file_type NOT NULL,
  file_url TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create classification_results table
CREATE TABLE public.classification_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  status public.classify_status NOT NULL,
  recommended_code TEXT,
  confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  confidence_level public.confidence_level,
  justification_short TEXT CHECK (char_length(justification_short) <= 500),
  alternatives JSONB DEFAULT '[]'::jsonb,
  evidence JSONB DEFAULT '[]'::jsonb,
  next_question JSONB,
  error_message TEXT,
  answers JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create audit_logs table
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  action public.audit_action NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  user_phone TEXT NOT NULL,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create ingestion_files table (admin)
CREATE TABLE public.ingestion_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source public.ingestion_source NOT NULL,
  version_label TEXT NOT NULL,
  file_url TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_hash TEXT,
  status public.ingestion_status NOT NULL DEFAULT 'NEW',
  error_message TEXT,
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create ingestion_logs table
CREATE TABLE public.ingestion_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ingestion_id UUID NOT NULL REFERENCES public.ingestion_files(id) ON DELETE CASCADE,
  step public.ingestion_step NOT NULL,
  level public.ingestion_log_level NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create kb_chunks table for knowledge base
CREATE TABLE public.kb_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source public.ingestion_source NOT NULL,
  doc_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  text TEXT NOT NULL,
  version_label TEXT NOT NULL,
  embedding extensions.vector(1536),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_cases_company ON public.cases(company_id);
CREATE INDEX idx_cases_status ON public.cases(status);
CREATE INDEX idx_cases_created_by ON public.cases(created_by);
CREATE INDEX idx_case_files_case ON public.case_files(case_id);
CREATE INDEX idx_classification_results_case ON public.classification_results(case_id);
CREATE INDEX idx_audit_logs_case ON public.audit_logs(case_id);
CREATE INDEX idx_ingestion_files_status ON public.ingestion_files(status);
CREATE INDEX idx_kb_chunks_source ON public.kb_chunks(source);

-- Enable RLS on all tables
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classification_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_chunks ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check user role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.user_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create function to get user's company_id
CREATE OR REPLACE FUNCTION public.get_user_company_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE user_id = _user_id
$$;

-- RLS Policies for companies
CREATE POLICY "Users can view their own company"
ON public.companies FOR SELECT
TO authenticated
USING (id = public.get_user_company_id(auth.uid()));

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- RLS Policies for cases
CREATE POLICY "Users can view cases from their company"
ON public.cases FOR SELECT
TO authenticated
USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Users can create cases for their company"
ON public.cases FOR INSERT
TO authenticated
WITH CHECK (company_id = public.get_user_company_id(auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Users can update cases from their company"
ON public.cases FOR UPDATE
TO authenticated
USING (company_id = public.get_user_company_id(auth.uid()));

-- RLS Policies for case_files
CREATE POLICY "Users can view files from their company cases"
ON public.case_files FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id = case_id
    AND c.company_id = public.get_user_company_id(auth.uid())
  )
);

CREATE POLICY "Users can add files to their company cases"
ON public.case_files FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id = case_id
    AND c.company_id = public.get_user_company_id(auth.uid())
  )
);

-- RLS Policies for classification_results
CREATE POLICY "Users can view results from their company cases"
ON public.classification_results FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id = case_id
    AND c.company_id = public.get_user_company_id(auth.uid())
  )
);

CREATE POLICY "Users can insert results for their company cases"
ON public.classification_results FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id = case_id
    AND c.company_id = public.get_user_company_id(auth.uid())
  )
);

-- RLS Policies for audit_logs
CREATE POLICY "Users can view audit logs from their company cases"
ON public.audit_logs FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id = case_id
    AND c.company_id = public.get_user_company_id(auth.uid())
  )
);

CREATE POLICY "Users can insert audit logs for their company cases"
ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id = case_id
    AND c.company_id = public.get_user_company_id(auth.uid())
  )
);

-- RLS Policies for ingestion_files (admin only)
CREATE POLICY "Admins can view all ingestion files"
ON public.ingestion_files FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert ingestion files"
ON public.ingestion_files FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update ingestion files"
ON public.ingestion_files FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for ingestion_logs (admin only)
CREATE POLICY "Admins can view all ingestion logs"
ON public.ingestion_logs FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert ingestion logs"
ON public.ingestion_logs FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for kb_chunks (accessible for classification)
CREATE POLICY "Authenticated users can search kb_chunks"
ON public.kb_chunks FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can insert kb_chunks"
ON public.kb_chunks FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update kb_chunks"
ON public.kb_chunks FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete kb_chunks"
ON public.kb_chunks FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_ingestion_files_updated_at
BEFORE UPDATE ON public.ingestion_files
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for files
INSERT INTO storage.buckets (id, name, public)
VALUES ('case-files', 'case-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Authenticated users can upload case files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'case-files');

CREATE POLICY "Authenticated users can view case files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'case-files');