export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          case_id: string
          created_at: string
          id: string
          meta: Json | null
          user_id: string
          user_phone: string
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          case_id: string
          created_at?: string
          id?: string
          meta?: Json | null
          user_id: string
          user_phone: string
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          case_id?: string
          created_at?: string
          id?: string
          meta?: Json | null
          user_id?: string
          user_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      background_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          items_processed: number | null
          items_total: number | null
          source_id: string | null
          started_at: string | null
          status: string
          task_type: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          items_processed?: number | null
          items_total?: number | null
          source_id?: string | null
          started_at?: string | null
          status?: string
          task_type: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          items_processed?: number | null
          items_total?: number | null
          source_id?: string | null
          started_at?: string | null
          status?: string
          task_type?: string
        }
        Relationships: []
      }
      case_files: {
        Row: {
          case_id: string
          created_at: string
          file_type: Database["public"]["Enums"]["case_file_type"]
          file_url: string
          filename: string
          id: string
          size_bytes: number
          storage_path: string | null
        }
        Insert: {
          case_id: string
          created_at?: string
          file_type: Database["public"]["Enums"]["case_file_type"]
          file_url: string
          filename: string
          id?: string
          size_bytes: number
          storage_path?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string
          file_type?: Database["public"]["Enums"]["case_file_type"]
          file_url?: string
          filename?: string
          id?: string
          size_bytes?: number
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_files_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          id: string
          origin_country: string
          product_name: string
          status: Database["public"]["Enums"]["case_status"]
          type_import_export: Database["public"]["Enums"]["import_export_type"]
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          origin_country: string
          product_name: string
          status?: Database["public"]["Enums"]["case_status"]
          type_import_export: Database["public"]["Enums"]["import_export_type"]
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          origin_country?: string
          product_name?: string
          status?: Database["public"]["Enums"]["case_status"]
          type_import_export?: Database["public"]["Enums"]["import_export_type"]
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      classification_feedback: {
        Row: {
          case_id: string
          comment: string | null
          created_at: string
          feedback_type: string
          id: string
          meta: Json | null
          rating: number | null
          result_id: string | null
          suggested_code: string | null
          updated_at: string
          use_for_training: boolean | null
          user_id: string
        }
        Insert: {
          case_id: string
          comment?: string | null
          created_at?: string
          feedback_type: string
          id?: string
          meta?: Json | null
          rating?: number | null
          result_id?: string | null
          suggested_code?: string | null
          updated_at?: string
          use_for_training?: boolean | null
          user_id: string
        }
        Update: {
          case_id?: string
          comment?: string | null
          created_at?: string
          feedback_type?: string
          id?: string
          meta?: Json | null
          rating?: number | null
          result_id?: string | null
          suggested_code?: string | null
          updated_at?: string
          use_for_training?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classification_feedback_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_feedback_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "classification_results"
            referencedColumns: ["id"]
          },
        ]
      }
      classification_results: {
        Row: {
          alternatives: Json | null
          answers: Json | null
          case_id: string
          confidence: number | null
          confidence_level:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          created_at: string
          error_message: string | null
          evidence: Json | null
          id: string
          justification_short: string | null
          next_question: Json | null
          recommended_code: string | null
          status: Database["public"]["Enums"]["classify_status"]
        }
        Insert: {
          alternatives?: Json | null
          answers?: Json | null
          case_id: string
          confidence?: number | null
          confidence_level?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          created_at?: string
          error_message?: string | null
          evidence?: Json | null
          id?: string
          justification_short?: string | null
          next_question?: Json | null
          recommended_code?: string | null
          status: Database["public"]["Enums"]["classify_status"]
        }
        Update: {
          alternatives?: Json | null
          answers?: Json | null
          case_id?: string
          confidence?: number | null
          confidence_level?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          created_at?: string
          error_message?: string | null
          evidence?: Json | null
          id?: string
          justification_short?: string | null
          next_question?: Json | null
          recommended_code?: string | null
          status?: Database["public"]["Enums"]["classify_status"]
        }
        Relationships: [
          {
            foreignKeyName: "classification_results_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      data_sources: {
        Row: {
          base_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          error_count: number
          error_message: string | null
          id: string
          kb_source: Database["public"]["Enums"]["ingestion_source"]
          last_scrape_at: string | null
          name: string
          next_scrape_at: string | null
          schedule_cron: string | null
          scrape_config: Json
          source_type: Database["public"]["Enums"]["data_source_type"]
          stats: Json
          status: Database["public"]["Enums"]["data_source_status"]
          updated_at: string
          url: string
          version_label: string
        }
        Insert: {
          base_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          error_count?: number
          error_message?: string | null
          id?: string
          kb_source: Database["public"]["Enums"]["ingestion_source"]
          last_scrape_at?: string | null
          name: string
          next_scrape_at?: string | null
          schedule_cron?: string | null
          scrape_config?: Json
          source_type: Database["public"]["Enums"]["data_source_type"]
          stats?: Json
          status?: Database["public"]["Enums"]["data_source_status"]
          updated_at?: string
          url: string
          version_label?: string
        }
        Update: {
          base_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          error_count?: number
          error_message?: string | null
          id?: string
          kb_source?: Database["public"]["Enums"]["ingestion_source"]
          last_scrape_at?: string | null
          name?: string
          next_scrape_at?: string | null
          schedule_cron?: string | null
          scrape_config?: Json
          source_type?: Database["public"]["Enums"]["data_source_type"]
          stats?: Json
          status?: Database["public"]["Enums"]["data_source_status"]
          updated_at?: string
          url?: string
          version_label?: string
        }
        Relationships: []
      }
      dum_records: {
        Row: {
          attachments: Json | null
          company_id: string
          created_at: string
          destination_country: string | null
          dum_date: string
          dum_number: string | null
          hs_code_10: string
          id: string
          origin_country: string
          product_description: string
          quantity: number | null
          reliability_score: number | null
          source: string | null
          unit: string | null
          updated_at: string | null
          validated: boolean | null
          validated_at: string | null
          validated_by: string | null
          value_mad: number | null
        }
        Insert: {
          attachments?: Json | null
          company_id: string
          created_at?: string
          destination_country?: string | null
          dum_date: string
          dum_number?: string | null
          hs_code_10: string
          id?: string
          origin_country: string
          product_description: string
          quantity?: number | null
          reliability_score?: number | null
          source?: string | null
          unit?: string | null
          updated_at?: string | null
          validated?: boolean | null
          validated_at?: string | null
          validated_by?: string | null
          value_mad?: number | null
        }
        Update: {
          attachments?: Json | null
          company_id?: string
          created_at?: string
          destination_country?: string | null
          dum_date?: string
          dum_number?: string | null
          hs_code_10?: string
          id?: string
          origin_country?: string
          product_description?: string
          quantity?: number | null
          reliability_score?: number | null
          source?: string | null
          unit?: string | null
          updated_at?: string | null
          validated?: boolean | null
          validated_at?: string | null
          validated_by?: string | null
          value_mad?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dum_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_law_articles: {
        Row: {
          created_at: string
          effective_date: string | null
          id: string
          keywords: Json | null
          ref: string
          text: string
          title: string | null
          version_label: string
        }
        Insert: {
          created_at?: string
          effective_date?: string | null
          id?: string
          keywords?: Json | null
          ref: string
          text: string
          title?: string | null
          version_label: string
        }
        Update: {
          created_at?: string
          effective_date?: string | null
          id?: string
          keywords?: Json | null
          ref?: string
          text?: string
          title?: string | null
          version_label?: string
        }
        Relationships: []
      }
      hs_codes: {
        Row: {
          active: boolean
          active_version_label: string
          chapter_2: string
          code_10: string
          code_4: string | null
          code_6: string
          created_at: string
          embedding: string | null
          enrichment: Json | null
          label_ar: string | null
          label_fr: string
          restrictions: string[] | null
          taxes: Json | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          active_version_label: string
          chapter_2: string
          code_10: string
          code_4?: string | null
          code_6: string
          created_at?: string
          embedding?: string | null
          enrichment?: Json | null
          label_ar?: string | null
          label_fr: string
          restrictions?: string[] | null
          taxes?: Json | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          active_version_label?: string
          chapter_2?: string
          code_10?: string
          code_4?: string | null
          code_6?: string
          created_at?: string
          embedding?: string | null
          enrichment?: Json | null
          label_ar?: string | null
          label_fr?: string
          restrictions?: string[] | null
          taxes?: Json | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      hs_omd_notes: {
        Row: {
          created_at: string
          hs_code: string
          hs_level: string
          id: string
          ref: string
          text: string
          version_label: string
        }
        Insert: {
          created_at?: string
          hs_code: string
          hs_level: string
          id?: string
          ref: string
          text: string
          version_label: string
        }
        Update: {
          created_at?: string
          hs_code?: string
          hs_level?: string
          id?: string
          ref?: string
          text?: string
          version_label?: string
        }
        Relationships: []
      }
      hs_references: {
        Row: {
          created_at: string
          id: string
          note: string | null
          reference_type: string
          source_code: string
          target_code: string
          version_label: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          reference_type: string
          source_code: string
          target_code: string
          version_label: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          reference_type?: string
          source_code?: string
          target_code?: string
          version_label?: string
        }
        Relationships: []
      }
      hs_sync_history: {
        Row: {
          created_at: string
          created_by: string | null
          details: Json | null
          id: string
          laws_analyzed: number
          updates_applied: number
          updates_found: number
          version_label: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          details?: Json | null
          id?: string
          laws_analyzed?: number
          updates_applied?: number
          updates_found?: number
          version_label: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          details?: Json | null
          id?: string
          laws_analyzed?: number
          updates_applied?: number
          updates_found?: number
          version_label?: string
        }
        Relationships: []
      }
      ingestion_ambiguities: {
        Row: {
          ambiguity_type: string
          created_at: string
          description: string
          id: string
          ingestion_id: string | null
          resolution_notes: string | null
          resolved: boolean
          source_row: string
        }
        Insert: {
          ambiguity_type: string
          created_at?: string
          description: string
          id?: string
          ingestion_id?: string | null
          resolution_notes?: string | null
          resolved?: boolean
          source_row: string
        }
        Update: {
          ambiguity_type?: string
          created_at?: string
          description?: string
          id?: string
          ingestion_id?: string | null
          resolution_notes?: string | null
          resolved?: boolean
          source_row?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_ambiguities_ingestion_id_fkey"
            columns: ["ingestion_id"]
            isOneToOne: false
            referencedRelation: "ingestion_files"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_files: {
        Row: {
          created_at: string
          error_message: string | null
          file_hash: string | null
          file_url: string
          filename: string
          id: string
          progress_percent: number
          source: Database["public"]["Enums"]["ingestion_source"]
          status: Database["public"]["Enums"]["ingestion_status"]
          updated_at: string
          version_label: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          file_hash?: string | null
          file_url: string
          filename: string
          id?: string
          progress_percent?: number
          source: Database["public"]["Enums"]["ingestion_source"]
          status?: Database["public"]["Enums"]["ingestion_status"]
          updated_at?: string
          version_label: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          file_hash?: string | null
          file_url?: string
          filename?: string
          id?: string
          progress_percent?: number
          source?: Database["public"]["Enums"]["ingestion_source"]
          status?: Database["public"]["Enums"]["ingestion_status"]
          updated_at?: string
          version_label?: string
        }
        Relationships: []
      }
      ingestion_logs: {
        Row: {
          created_at: string
          id: string
          ingestion_id: string
          level: Database["public"]["Enums"]["ingestion_log_level"]
          message: string
          step: Database["public"]["Enums"]["ingestion_step"]
        }
        Insert: {
          created_at?: string
          id?: string
          ingestion_id: string
          level: Database["public"]["Enums"]["ingestion_log_level"]
          message: string
          step: Database["public"]["Enums"]["ingestion_step"]
        }
        Update: {
          created_at?: string
          id?: string
          ingestion_id?: string
          level?: Database["public"]["Enums"]["ingestion_log_level"]
          message?: string
          step?: Database["public"]["Enums"]["ingestion_step"]
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_logs_ingestion_id_fkey"
            columns: ["ingestion_id"]
            isOneToOne: false
            referencedRelation: "ingestion_files"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_chunks: {
        Row: {
          created_at: string
          doc_id: string
          embedding: string | null
          id: string
          metadata: Json | null
          page_number: number | null
          ref: string
          section_path: string | null
          source: Database["public"]["Enums"]["ingestion_source"]
          source_url: string | null
          text: string
          version_label: string
        }
        Insert: {
          created_at?: string
          doc_id: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          page_number?: number | null
          ref: string
          section_path?: string | null
          source: Database["public"]["Enums"]["ingestion_source"]
          source_url?: string | null
          text: string
          version_label: string
        }
        Update: {
          created_at?: string
          doc_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          page_number?: number | null
          ref?: string
          section_path?: string | null
          source?: Database["public"]["Enums"]["ingestion_source"]
          source_url?: string | null
          text?: string
          version_label?: string
        }
        Relationships: []
      }
      otp_codes: {
        Row: {
          attempts: number
          code: string
          created_at: string
          expires_at: string
          id: string
          phone: string
          verified: boolean
        }
        Insert: {
          attempts?: number
          code: string
          created_at?: string
          expires_at: string
          id?: string
          phone: string
          verified?: boolean
        }
        Update: {
          attempts?: number
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          verified?: boolean
        }
        Relationships: []
      }
      profiles: {
        Row: {
          company_id: string
          created_at: string
          id: string
          phone: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          phone: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          phone?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          request_count?: number
          user_id: string
          window_start?: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      scrape_logs: {
        Row: {
          chunks_created: number
          completed_at: string | null
          created_at: string
          details: Json
          error_message: string | null
          errors_count: number
          id: string
          pages_scraped: number
          source_id: string
          started_at: string
          status: string
        }
        Insert: {
          chunks_created?: number
          completed_at?: string | null
          created_at?: string
          details?: Json
          error_message?: string | null
          errors_count?: number
          id?: string
          pages_scraped?: number
          source_id: string
          started_at?: string
          status?: string
        }
        Update: {
          chunks_created?: number
          completed_at?: string | null
          created_at?: string
          details?: Json
          error_message?: string | null
          errors_count?: number
          id?: string
          pages_scraped?: number
          source_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "scrape_logs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      security_logs: {
        Row: {
          attempted_path: string
          created_at: string
          event_type: string
          id: string
          ip_address: string | null
          meta: Json | null
          user_agent: string | null
          user_id: string | null
          user_phone: string | null
        }
        Insert: {
          attempted_path: string
          created_at?: string
          event_type: string
          id?: string
          ip_address?: string | null
          meta?: Json | null
          user_agent?: string | null
          user_id?: string | null
          user_phone?: string | null
        }
        Update: {
          attempted_path?: string
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          meta?: Json | null
          user_agent?: string | null
          user_id?: string | null
          user_phone?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired_otps: { Args: never; Returns: undefined }
      cleanup_rate_limits: { Args: never; Returns: undefined }
      get_chunks_without_embeddings: {
        Args: { batch_size?: number }
        Returns: {
          id: string
          text: string
        }[]
      }
      get_classification_stats: {
        Args: never
        Returns: {
          avg_confidence: number
          avg_confidence_done: number
          classifications_this_month: number
          classifications_this_week: number
          classifications_today: number
          high_confidence_count: number
          low_confidence_count: number
          medium_confidence_count: number
          status_done: number
          status_error: number
          status_low_confidence: number
          status_need_info: number
          total_classifications: number
        }[]
      }
      get_classification_trend: {
        Args: { days_back?: number }
        Returns: {
          day: string
          done_count: number
          error_count: number
          low_confidence_count: number
          need_info_count: number
        }[]
      }
      get_dum_signal: {
        Args: { p_company_id: string; p_keywords: string[]; p_limit?: number }
        Returns: {
          avg_reliability: number
          hs_code_10: string
          latest_date: string
          match_count: number
        }[]
      }
      get_evidence_stats: {
        Args: never
        Returns: {
          source_name: string
          usage_count: number
        }[]
      }
      get_feedback_stats: {
        Args: never
        Returns: {
          avg_rating: number
          correct_count: number
          incorrect_count: number
          partial_count: number
          total_feedback: number
          training_examples: number
        }[]
      }
      get_ingestion_stats: { Args: never; Returns: Json }
      get_training_examples: {
        Args: { limit_count?: number }
        Returns: {
          case_id: string
          comment: string
          feedback_type: string
          origin_country: string
          original_code: string
          product_name: string
          rating: number
          suggested_code: string
        }[]
      }
      get_user_company_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["user_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_hs_codes: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          chapter_2: string
          code_10: string
          code_6: string
          enrichment: Json
          label_ar: string
          label_fr: string
          similarity: number
          taxes: Json
          unit: string
        }[]
      }
      match_kb_chunks: {
        Args: {
          filter_sources?: string[]
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          doc_id: string
          id: string
          metadata: Json
          ref: string
          similarity: number
          source: string
          text: string
          version_label: string
        }[]
      }
      search_hs_codes: {
        Args: { match_limit?: number; search_query: string }
        Returns: {
          chapter_2: string
          code_10: string
          code_4: string
          code_6: string
          label_ar: string
          label_fr: string
          rank: number
          taxes: Json
          unit: string
        }[]
      }
      search_kb_hybrid: {
        Args: {
          filter_sources?: string[]
          match_count?: number
          query_embedding?: string
          query_text: string
        }
        Returns: {
          doc_id: string
          id: string
          match_type: string
          ref: string
          similarity: number
          source: Database["public"]["Enums"]["ingestion_source"]
          text: string
          version_label: string
        }[]
      }
      update_chunk_embedding: {
        Args: { chunk_id: string; embedding_vector: string }
        Returns: undefined
      }
    }
    Enums: {
      audit_action:
        | "created"
        | "file_uploaded"
        | "classify_called"
        | "question_answered"
        | "result_ready"
        | "validated"
        | "exported"
      case_file_type:
        | "tech_sheet"
        | "invoice"
        | "packing_list"
        | "certificate"
        | "dum"
        | "photo_product"
        | "photo_label"
        | "photo_plate"
        | "other"
        | "admin_ingestion"
      case_status: "IN_PROGRESS" | "RESULT_READY" | "VALIDATED" | "ERROR"
      classify_status: "NEED_INFO" | "DONE" | "ERROR" | "LOW_CONFIDENCE"
      confidence_level: "high" | "medium" | "low"
      data_source_status: "active" | "paused" | "error" | "disabled"
      data_source_type: "website" | "api" | "rss" | "pdf_url" | "sitemap"
      evidence_source: "omd" | "maroc" | "lois" | "dum"
      import_export_type: "import" | "export"
      ingestion_log_level: "info" | "warning" | "error"
      ingestion_source: "omd" | "maroc" | "lois" | "dum"
      ingestion_status:
        | "NEW"
        | "EXTRACTING"
        | "PARSING"
        | "INDEXING"
        | "DONE"
        | "ERROR"
        | "DISABLED"
      ingestion_step: "extract" | "parse" | "index"
      question_type: "yesno" | "select" | "text"
      user_role: "admin" | "agent" | "manager"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      audit_action: [
        "created",
        "file_uploaded",
        "classify_called",
        "question_answered",
        "result_ready",
        "validated",
        "exported",
      ],
      case_file_type: [
        "tech_sheet",
        "invoice",
        "packing_list",
        "certificate",
        "dum",
        "photo_product",
        "photo_label",
        "photo_plate",
        "other",
        "admin_ingestion",
      ],
      case_status: ["IN_PROGRESS", "RESULT_READY", "VALIDATED", "ERROR"],
      classify_status: ["NEED_INFO", "DONE", "ERROR", "LOW_CONFIDENCE"],
      confidence_level: ["high", "medium", "low"],
      data_source_status: ["active", "paused", "error", "disabled"],
      data_source_type: ["website", "api", "rss", "pdf_url", "sitemap"],
      evidence_source: ["omd", "maroc", "lois", "dum"],
      import_export_type: ["import", "export"],
      ingestion_log_level: ["info", "warning", "error"],
      ingestion_source: ["omd", "maroc", "lois", "dum"],
      ingestion_status: [
        "NEW",
        "EXTRACTING",
        "PARSING",
        "INDEXING",
        "DONE",
        "ERROR",
        "DISABLED",
      ],
      ingestion_step: ["extract", "parse", "index"],
      question_type: ["yesno", "select", "text"],
      user_role: ["admin", "agent", "manager"],
    },
  },
} as const
