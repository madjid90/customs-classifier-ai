-- First, make created_by nullable for system-created sources
ALTER TABLE public.data_sources ALTER COLUMN created_by DROP NOT NULL;

-- Insert pre-configured official customs data sources
-- Status is 'paused' by default so admin can verify and activate manually
INSERT INTO public.data_sources (
  name,
  url,
  base_url,
  description,
  source_type,
  kb_source,
  scrape_config,
  schedule_cron,
  version_label,
  status
) VALUES 
(
  'ADII - Tarif Douanier Maroc',
  'https://www.douane.gov.ma/web/guest/tarif-douanier',
  'https://www.douane.gov.ma',
  'Nomenclature tarifaire officielle de la douane marocaine (ADII)',
  'website',
  'maroc',
  '{
    "selectors": {
      "content": ".portlet-body, .journal-content-article",
      "title": "h1",
      "links": "a[href*=''/tarif/'']",
      "exclude": ["nav", "footer", "header", ".sidebar"]
    },
    "max_pages": 100,
    "max_depth": 3,
    "delay_ms": 2000,
    "follow_links": true,
    "min_content_length": 100
  }'::jsonb,
  '0 3 * * 0',
  'auto',
  'paused'
),
(
  'ADII - Circulaires',
  'https://www.douane.gov.ma/web/guest/circulaires',
  'https://www.douane.gov.ma',
  'Circulaires et notes de service de la douane marocaine',
  'website',
  'lois',
  '{
    "selectors": {
      "content": ".journal-content-article",
      "title": "h1, .portlet-title",
      "links": "a[href*=''/circulaire'']",
      "exclude": ["nav", "footer", "header"]
    },
    "max_pages": 50,
    "max_depth": 2,
    "delay_ms": 2000,
    "follow_links": true,
    "min_content_length": 100
  }'::jsonb,
  '0 4 * * 1',
  'auto',
  'paused'
),
(
  'SGG - Lois de Finance',
  'https://www.sgg.gov.ma/Legislation/LoisDeFinances.aspx',
  'https://www.sgg.gov.ma',
  'Lois de finances publiées par le Secrétariat Général du Gouvernement',
  'website',
  'lois',
  '{
    "selectors": {
      "content": ".content, #MainContent, article",
      "title": "h1, h2.title",
      "links": "a[href*=''Finance''], a[href$=''.pdf'']",
      "exclude": ["nav", "footer", "header", ".menu"]
    },
    "max_pages": 30,
    "max_depth": 2,
    "delay_ms": 2000,
    "follow_links": true,
    "min_content_length": 100
  }'::jsonb,
  '0 2 1 * *',
  'auto',
  'paused'
)
ON CONFLICT DO NOTHING;