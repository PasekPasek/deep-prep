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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      card_offers: {
        Row: {
          card_id: string
          offer_id: string
        }
        Insert: {
          card_id: string
          offer_id: string
        }
        Update: {
          card_id?: string
          offer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_offers_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_offers_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      cards: {
        Row: {
          back: string
          created_at: string | null
          embedding: string | null
          front: string
          id: string
          kind: string
          provenance: Json
          status: string
          topic_id: string | null
        }
        Insert: {
          back: string
          created_at?: string | null
          embedding?: string | null
          front: string
          id?: string
          kind: string
          provenance: Json
          status?: string
          topic_id?: string | null
        }
        Update: {
          back?: string
          created_at?: string | null
          embedding?: string | null
          front?: string
          id?: string
          kind?: string
          provenance?: Json
          status?: string
          topic_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cards_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          id: string
          ord: number | null
          path: string
          source_id: string | null
          title: string | null
        }
        Insert: {
          id?: string
          ord?: number | null
          path: string
          source_id?: string | null
          title?: string | null
        }
        Update: {
          id?: string
          ord?: number | null
          path?: string
          source_id?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          company: string | null
          created_at: string | null
          extracted: Json | null
          id: string
          input_kind: string
          raw_input: string | null
          role: string | null
          seniority: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string | null
          extracted?: Json | null
          id?: string
          input_kind: string
          raw_input?: string | null
          role?: string | null
          seniority?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string | null
          extracted?: Json | null
          id?: string
          input_kind?: string
          raw_input?: string | null
          role?: string | null
          seniority?: string | null
        }
        Relationships: []
      }
      review_log: {
        Row: {
          card_id: string | null
          elapsed_days: number | null
          id: number
          rating: number
          reviewed_at: string | null
          scheduled_days: number | null
        }
        Insert: {
          card_id?: string | null
          elapsed_days?: number | null
          id?: number
          rating: number
          reviewed_at?: string | null
          scheduled_days?: number | null
        }
        Update: {
          card_id?: string | null
          elapsed_days?: number | null
          id?: number
          rating?: number
          reviewed_at?: string | null
          scheduled_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "review_log_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      review_state: {
        Row: {
          card_id: string
          difficulty: number | null
          due: string
          elapsed_days: number
          lapses: number | null
          last_review: string | null
          learning_steps: number
          reps: number | null
          scheduled_days: number
          stability: number | null
          state: number
        }
        Insert: {
          card_id: string
          difficulty?: number | null
          due: string
          elapsed_days?: number
          lapses?: number | null
          last_review?: string | null
          learning_steps?: number
          reps?: number | null
          scheduled_days?: number
          stability?: number | null
          state?: number
        }
        Update: {
          card_id?: string
          difficulty?: number | null
          due?: string
          elapsed_days?: number
          lapses?: number | null
          last_review?: string | null
          learning_steps?: number
          reps?: number | null
          scheduled_days?: number
          stability?: number | null
          state?: number
        }
        Relationships: [
          {
            foreignKeyName: "review_state_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: true
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          cost_usd: number | null
          created_at: string | null
          current_step: Json | null
          draft_cards: Json | null
          error: string | null
          id: string
          offer_id: string | null
          plan: Json | null
          status: string
          updated_at: string | null
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string | null
          current_step?: Json | null
          draft_cards?: Json | null
          error?: string | null
          id?: string
          offer_id?: string | null
          plan?: Json | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          cost_usd?: number | null
          created_at?: string | null
          current_step?: Json | null
          draft_cards?: Json | null
          error?: string | null
          id?: string
          offer_id?: string | null
          plan?: Json | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "runs_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      scratchpad: {
        Row: {
          content: string
          created_at: string | null
          id: number
          provenance: Json
          run_id: string | null
          topic_slug: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: number
          provenance: Json
          run_id?: string | null
          topic_slug: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: number
          provenance?: Json
          run_id?: string | null
          topic_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "scratchpad_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          content: string
          document_id: string | null
          embedding: string | null
          heading_path: string[]
          id: string
          ord: number | null
          part: number
        }
        Insert: {
          content: string
          document_id?: string | null
          embedding?: string | null
          heading_path: string[]
          id?: string
          ord?: number | null
          part?: number
        }
        Update: {
          content?: string
          document_id?: string | null
          embedding?: string | null
          heading_path?: string[]
          id?: string
          ord?: number | null
          part?: number
        }
        Relationships: [
          {
            foreignKeyName: "sections_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          created_at: string | null
          id: string
          kind: string
          license: string
          name: string
          url: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          kind: string
          license: string
          name: string
          url?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          kind?: string
          license?: string
          name?: string
          url?: string | null
        }
        Relationships: []
      }
      topics: {
        Row: {
          id: string
          name: string
          slug: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_cards: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          back: string
          card_id: string
          front: string
          similarity: number
        }[]
      }
      match_sections: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          content: string
          document_path: string
          document_title: string
          heading_path: string[]
          section_id: string
          similarity: number
          source_name: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
