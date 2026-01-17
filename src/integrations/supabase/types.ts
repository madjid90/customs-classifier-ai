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
      case_files: {
        Row: {
          case_id: string
          created_at: string
          file_type: Database["public"]["Enums"]["case_file_type"]
          file_url: string
          filename: string
          id: string
          size_bytes: number
        }
        Insert: {
          case_id: string
          created_at?: string
          file_type: Database["public"]["Enums"]["case_file_type"]
          file_url: string
          filename: string
          id?: string
          size_bytes: number
        }
        Update: {
          case_id?: string
          created_at?: string
          file_type?: Database["public"]["Enums"]["case_file_type"]
          file_url?: string
          filename?: string
          id?: string
          size_bytes?: number
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
          ref: string
          source: Database["public"]["Enums"]["ingestion_source"]
          text: string
          version_label: string
        }
        Insert: {
          created_at?: string
          doc_id: string
          embedding?: string | null
          id?: string
          ref: string
          source: Database["public"]["Enums"]["ingestion_source"]
          text: string
          version_label: string
        }
        Update: {
          created_at?: string
          doc_id?: string
          embedding?: string | null
          id?: string
          ref?: string
          source?: Database["public"]["Enums"]["ingestion_source"]
          text?: string
          version_label?: string
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
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_company_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["user_role"]
          _user_id: string
        }
        Returns: boolean
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
