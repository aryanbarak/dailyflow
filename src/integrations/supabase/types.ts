export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_briefings: {
        Row: {
          content: string
          context: Json | null
          created_at: string
          id: string
          language: string
          mode: string
          triggered_by: string
          user_id: string
        }
        Insert: {
          content: string
          context?: Json | null
          created_at?: string
          id?: string
          language?: string
          mode?: string
          triggered_by?: string
          user_id: string
        }
        Update: {
          content?: string
          context?: Json | null
          created_at?: string
          id?: string
          language?: string
          mode?: string
          triggered_by?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          session_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          session_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      alarms: {
        Row: {
          created_at: string | null
          id: string
          is_dismissed: boolean | null
          is_fired: boolean | null
          remind_before_minutes: number
          source_id: string
          source_title: string
          source_type: string
          trigger_at: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_dismissed?: boolean | null
          is_fired?: boolean | null
          remind_before_minutes?: number
          source_id: string
          source_title: string
          source_type: string
          trigger_at: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_dismissed?: boolean | null
          is_fired?: boolean | null
          remind_before_minutes?: number
          source_id?: string
          source_title?: string
          source_type?: string
          trigger_at?: string
          user_id?: string
        }
        Relationships: []
      }
      budget_goals: {
        Row: {
          category: string
          color: string | null
          created_at: string | null
          id: string
          monthly_limit: number
          period: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          category: string
          color?: string | null
          created_at?: string | null
          id?: string
          monthly_limit: number
          period?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          category?: string
          color?: string | null
          created_at?: string | null
          id?: string
          monthly_limit?: number
          period?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      budget_limits: {
        Row: {
          category: string
          created_at: string | null
          id: string
          limit_amount: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          limit_amount: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          limit_amount?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      calendar_events: {
        Row: {
          all_day: boolean | null
          color: string | null
          created_at: string | null
          date: string
          description: string | null
          end_time: string | null
          id: string
          location: string | null
          recurrence_end_date: string | null
          recurrence_rule: string | null
          start_time: string | null
          title: string
          type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          all_day?: boolean | null
          color?: string | null
          created_at?: string | null
          date: string
          description?: string | null
          end_time?: string | null
          id?: string
          location?: string | null
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          start_time?: string | null
          title: string
          type?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          all_day?: boolean | null
          color?: string | null
          created_at?: string | null
          date?: string
          description?: string | null
          end_time?: string | null
          id?: string
          location?: string | null
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          start_time?: string | null
          title?: string
          type?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      chat_sessions: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      checklist_completions: {
        Row: {
          child_id: string
          completed_at: string | null
          date: string
          id: string
          template_id: string
        }
        Insert: {
          child_id: string
          completed_at?: string | null
          date: string
          id?: string
          template_id: string
        }
        Update: {
          child_id?: string
          completed_at?: string | null
          date?: string
          id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_completions_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "family_children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_completions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          child_id: string
          created_at: string | null
          icon: string | null
          id: string
          order_index: number | null
          title: string
          user_id: string
        }
        Insert: {
          child_id: string
          created_at?: string | null
          icon?: string | null
          id?: string
          order_index?: number | null
          title: string
          user_id: string
        }
        Update: {
          child_id?: string
          created_at?: string | null
          icon?: string | null
          id?: string
          order_index?: number | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "family_children"
            referencedColumns: ["id"]
          },
        ]
      }
      child_exams: {
        Row: {
          child_id: string
          created_at: string | null
          exam_date: string
          grade: string | null
          id: string
          notes: string | null
          subject: string
          user_id: string
        }
        Insert: {
          child_id: string
          created_at?: string | null
          exam_date: string
          grade?: string | null
          id?: string
          notes?: string | null
          subject: string
          user_id: string
        }
        Update: {
          child_id?: string
          created_at?: string | null
          exam_date?: string
          grade?: string | null
          id?: string
          notes?: string | null
          subject?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "child_exams_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "family_children"
            referencedColumns: ["id"]
          },
        ]
      }
      child_homework: {
        Row: {
          child_id: string
          completed: boolean | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          due_date: string
          id: string
          priority: string | null
          subject: string
          title: string
          user_id: string
        }
        Insert: {
          child_id: string
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          due_date: string
          id?: string
          priority?: string | null
          subject: string
          title: string
          user_id: string
        }
        Update: {
          child_id?: string
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string
          id?: string
          priority?: string | null
          subject?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "child_homework_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "family_children"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          ai_summary: string | null
          ai_summary_points: string[]
          created_at: string
          description: string | null
          extracted_tasks_count: number
          extracted_text: string | null
          file_name: string
          id: string
          key_points: string[] | null
          last_opened_at: string | null
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          summary: string | null
          summary_generated_at: string | null
          summary_language: string | null
          tags: string[]
          title: string | null
          updated_at: string
          user_id: string
          word_count: number | null
        }
        Insert: {
          ai_summary?: string | null
          ai_summary_points?: string[]
          created_at?: string
          description?: string | null
          extracted_tasks_count?: number
          extracted_text?: string | null
          file_name: string
          id?: string
          key_points?: string[] | null
          last_opened_at?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          summary?: string | null
          summary_generated_at?: string | null
          summary_language?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
          user_id: string
          word_count?: number | null
        }
        Update: {
          ai_summary?: string | null
          ai_summary_points?: string[]
          created_at?: string
          description?: string | null
          extracted_tasks_count?: number
          extracted_text?: string | null
          file_name?: string
          id?: string
          key_points?: string[] | null
          last_opened_at?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          summary?: string | null
          summary_generated_at?: string | null
          summary_language?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
          user_id?: string
          word_count?: number | null
        }
        Relationships: []
      }
      family_children: {
        Row: {
          age: number | null
          avatar_color: string | null
          birth_date: string | null
          color: string
          created_at: string
          events: Json
          grade: string | null
          id: string
          initials: string
          name: string
          notes: Json
          role: string | null
          schedule: Json
          school: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          age?: number | null
          avatar_color?: string | null
          birth_date?: string | null
          color?: string
          created_at?: string
          events?: Json
          grade?: string | null
          id?: string
          initials: string
          name: string
          notes?: Json
          role?: string | null
          schedule?: Json
          school?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          age?: number | null
          avatar_color?: string | null
          birth_date?: string | null
          color?: string
          created_at?: string
          events?: Json
          grade?: string | null
          id?: string
          initials?: string
          name?: string
          notes?: Json
          role?: string | null
          schedule?: Json
          school?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finance_transactions: {
        Row: {
          amount: number
          category: string
          created_at: string
          date: string
          id: string
          notes: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          date: string
          id?: string
          notes?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      flashcard_decks: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      flashcards: {
        Row: {
          back: string
          created_at: string | null
          deck_id: string
          ease_factor: number
          front: string
          id: string
          interval_days: number
          last_rating: number | null
          next_review: string
          review_count: number
          user_id: string
        }
        Insert: {
          back: string
          created_at?: string | null
          deck_id: string
          ease_factor?: number
          front: string
          id?: string
          interval_days?: number
          last_rating?: number | null
          next_review?: string
          review_count?: number
          user_id: string
        }
        Update: {
          back?: string
          created_at?: string | null
          deck_id?: string
          ease_factor?: number
          front?: string
          id?: string
          interval_days?: number
          last_rating?: number | null
          next_review?: string
          review_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flashcards_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "flashcard_decks"
            referencedColumns: ["id"]
          },
        ]
      }
      github_connection_attempts: {
        Row: {
          claimed_installation_id: number | null
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          oauth_consumed_at: string | null
          oauth_state_hash: string | null
          setup_consumed_at: string | null
          setup_state_hash: string
          user_id: string
        }
        Insert: {
          claimed_installation_id?: number | null
          completed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          oauth_consumed_at?: string | null
          oauth_state_hash?: string | null
          setup_consumed_at?: string | null
          setup_state_hash: string
          user_id: string
        }
        Update: {
          claimed_installation_id?: number | null
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          oauth_consumed_at?: string | null
          oauth_state_hash?: string | null
          setup_consumed_at?: string | null
          setup_state_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      github_connections: {
        Row: {
          created_at: string
          github_account_id: number
          github_account_login: string
          id: string
          installation_id: number
          status: string
          updated_at: string
          user_id: string
          verified_at: string
        }
        Insert: {
          created_at?: string
          github_account_id: number
          github_account_login: string
          id?: string
          installation_id: number
          status?: string
          updated_at?: string
          user_id: string
          verified_at: string
        }
        Update: {
          created_at?: string
          github_account_id?: number
          github_account_login?: string
          id?: string
          installation_id?: number
          status?: string
          updated_at?: string
          user_id?: string
          verified_at?: string
        }
        Relationships: []
      }
      habit_completions: {
        Row: {
          completed_date: string
          created_at: string | null
          habit_id: string
          id: string
          user_id: string
        }
        Insert: {
          completed_date: string
          created_at?: string | null
          habit_id: string
          id?: string
          user_id: string
        }
        Update: {
          completed_date?: string
          created_at?: string | null
          habit_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_completions_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          achieved_at: string | null
          color: string | null
          created_at: string | null
          description: string | null
          frequency: string | null
          habit_type: string
          icon: string | null
          id: string
          is_active: boolean | null
          target_days: number | null
          target_unit: string | null
          target_value: number | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          achieved_at?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          frequency?: string | null
          habit_type?: string
          icon?: string | null
          id?: string
          is_active?: boolean | null
          target_days?: number | null
          target_unit?: string | null
          target_value?: number | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          achieved_at?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          frequency?: string | null
          habit_type?: string
          icon?: string | null
          id?: string
          is_active?: boolean | null
          target_days?: number | null
          target_unit?: string | null
          target_value?: number | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      journal_entries: {
        Row: {
          content: string
          created_at: string
          date: string
          id: string
          mood: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          date: string
          id?: string
          mood?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          date?: string
          id?: string
          mood?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      learn_ai_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          language: string
          mode: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          language: string
          mode: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          language?: string
          mode?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      liked_tracks: {
        Row: {
          artist: string | null
          duration_seconds: number | null
          id: string
          liked_at: string
          thumbnail_url: string | null
          title: string
          user_id: string
          youtube_id: string
        }
        Insert: {
          artist?: string | null
          duration_seconds?: number | null
          id?: string
          liked_at?: string
          thumbnail_url?: string | null
          title: string
          user_id: string
          youtube_id: string
        }
        Update: {
          artist?: string | null
          duration_seconds?: number | null
          id?: string
          liked_at?: string
          thumbnail_url?: string | null
          title?: string
          user_id?: string
          youtube_id?: string
        }
        Relationships: []
      }
      links: {
        Row: {
          created_at: string
          description: string
          favicon_url: string | null
          id: string
          is_favorite: boolean
          tags: string[]
          title: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          favicon_url?: string | null
          id?: string
          is_favorite?: boolean
          tags?: string[]
          title?: string
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          favicon_url?: string | null
          id?: string
          is_favorite?: boolean
          tags?: string[]
          title?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      mood_logs: {
        Row: {
          created_at: string | null
          date: string
          id: string
          mood: number
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          mood: number
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          mood?: number
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      photo_albums: {
        Row: {
          cover_photo_id: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          cover_photo_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          cover_photo_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_albums_cover_photo"
            columns: ["cover_photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          album_id: string | null
          caption: string | null
          created_at: string
          file_name: string
          file_size: number | null
          height: number | null
          id: string
          is_favorite: boolean
          location: string | null
          memory_date: string | null
          mime_type: string | null
          r2_key: string
          tags: string[]
          taken_at: string | null
          thumb_key: string | null
          user_id: string
          width: number | null
        }
        Insert: {
          album_id?: string | null
          caption?: string | null
          created_at?: string
          file_name: string
          file_size?: number | null
          height?: number | null
          id?: string
          is_favorite?: boolean
          location?: string | null
          memory_date?: string | null
          mime_type?: string | null
          r2_key: string
          tags?: string[]
          taken_at?: string | null
          thumb_key?: string | null
          user_id: string
          width?: number | null
        }
        Update: {
          album_id?: string | null
          caption?: string | null
          created_at?: string
          file_name?: string
          file_size?: number | null
          height?: number | null
          id?: string
          is_favorite?: boolean
          location?: string | null
          memory_date?: string | null
          mime_type?: string | null
          r2_key?: string
          tags?: string[]
          taken_at?: string | null
          thumb_key?: string | null
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "photo_albums"
            referencedColumns: ["id"]
          },
        ]
      }
      play_history: {
        Row: {
          artist: string | null
          duration_seconds: number | null
          id: string
          played_at: string
          thumbnail_url: string | null
          title: string
          user_id: string
          youtube_id: string
        }
        Insert: {
          artist?: string | null
          duration_seconds?: number | null
          id?: string
          played_at?: string
          thumbnail_url?: string | null
          title: string
          user_id: string
          youtube_id: string
        }
        Update: {
          artist?: string | null
          duration_seconds?: number | null
          id?: string
          played_at?: string
          thumbnail_url?: string | null
          title?: string
          user_id?: string
          youtube_id?: string
        }
        Relationships: []
      }
      playlist_tracks: {
        Row: {
          added_at: string
          artist: string | null
          duration_seconds: number | null
          id: string
          playlist_id: string
          position: number
          thumbnail_url: string | null
          title: string
          youtube_id: string
        }
        Insert: {
          added_at?: string
          artist?: string | null
          duration_seconds?: number | null
          id?: string
          playlist_id: string
          position?: number
          thumbnail_url?: string | null
          title: string
          youtube_id: string
        }
        Update: {
          added_at?: string
          artist?: string | null
          duration_seconds?: number | null
          id?: string
          playlist_id?: string
          position?: number
          thumbnail_url?: string | null
          title?: string
          youtube_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_tracks_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      playlists: {
        Row: {
          cover_url: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pocket_money: {
        Row: {
          amount: number
          child_id: string
          created_at: string | null
          id: string
          month: string
          notes: string | null
          paid: boolean | null
          paid_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          child_id: string
          created_at?: string | null
          id?: string
          month: string
          notes?: string | null
          paid?: boolean | null
          paid_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          child_id?: string
          created_at?: string | null
          id?: string
          month?: string
          notes?: string | null
          paid?: boolean | null
          paid_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pocket_money_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "family_children"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          preferences: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          preferences?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          preferences?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_evidence: {
        Row: {
          acquisition_attempt_id: string | null
          adapter_identity: string
          adapter_version: string
          candidate_fingerprint: string
          classification: string
          collected_at: string
          confidence: number | null
          created_at: string
          id: string
          notes: string | null
          project_id: string
          reference: string
          source_kind: string
          source_revision: string | null
          supersedes_id: string | null
          title: string
          uncertainty: string | null
          user_id: string
          verification_method: string
        }
        Insert: {
          acquisition_attempt_id?: string | null
          adapter_identity: string
          adapter_version: string
          candidate_fingerprint: string
          classification: string
          collected_at: string
          confidence?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          project_id: string
          reference: string
          source_kind: string
          source_revision?: string | null
          supersedes_id?: string | null
          title: string
          uncertainty?: string | null
          user_id: string
          verification_method: string
        }
        Update: {
          acquisition_attempt_id?: string | null
          adapter_identity?: string
          adapter_version?: string
          candidate_fingerprint?: string
          classification?: string
          collected_at?: string
          confidence?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          project_id?: string
          reference?: string
          source_kind?: string
          source_revision?: string | null
          supersedes_id?: string | null
          title?: string
          uncertainty?: string | null
          user_id?: string
          verification_method?: string
        }
        Relationships: []
      }
      project_evidence_observations: {
        Row: {
          byte_length: number
          content_hash: string
          created_at: string
          evidence_id: string
          git_revision: string | null
          id: string
          mime_type: string
          payload_kind: string
          project_id: string
          text_content: string
          user_id: string
        }
        Insert: {
          byte_length: number
          content_hash: string
          created_at?: string
          evidence_id: string
          git_revision?: string | null
          id?: string
          mime_type: string
          payload_kind?: string
          project_id: string
          text_content: string
          user_id: string
        }
        Update: {
          byte_length?: number
          content_hash?: string
          created_at?: string
          evidence_id?: string
          git_revision?: string | null
          id?: string
          mime_type?: string
          payload_kind?: string
          project_id?: string
          text_content?: string
          user_id?: string
        }
        Relationships: []
      }
      project_records: {
        Row: {
          created_at: string
          description: string | null
          enabled_evidence_source_kinds: string[]
          id: string
          name: string
          project_type: string
          repo_name: string | null
          repo_owner: string | null
          repo_provider: string | null
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled_evidence_source_kinds?: string[]
          id?: string
          name: string
          project_type: string
          repo_name?: string | null
          repo_owner?: string | null
          repo_provider?: string | null
          status?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled_evidence_source_kinds?: string[]
          id?: string
          name?: string
          project_type?: string
          repo_name?: string | null
          repo_owner?: string | null
          repo_provider?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      recurring_transactions: {
        Row: {
          amount: number
          category: string
          created_at: string | null
          day_of_month: number
          id: string
          last_applied: string | null
          title: string
          type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string | null
          day_of_month: number
          id?: string
          last_applied?: string | null
          title: string
          type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string | null
          day_of_month?: number
          id?: string
          last_applied?: string | null
          title?: string
          type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reward_points: {
        Row: {
          child_id: string
          created_at: string | null
          id: string
          month: string
          points: number
          reason: string
          user_id: string
        }
        Insert: {
          child_id: string
          created_at?: string | null
          id?: string
          month: string
          points: number
          reason: string
          user_id: string
        }
        Update: {
          child_id?: string
          created_at?: string | null
          id?: string
          month?: string
          points?: number
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_points_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "family_children"
            referencedColumns: ["id"]
          },
        ]
      }
      savings_goals: {
        Row: {
          color: string | null
          created_at: string | null
          deadline: string | null
          id: string
          name: string
          saved_amount: number
          target_amount: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          deadline?: string | null
          id?: string
          name: string
          saved_amount?: number
          target_amount: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          deadline?: string | null
          id?: string
          name?: string
          saved_amount?: number
          target_amount?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shopping_items: {
        Row: {
          category: string
          checked: boolean
          created_at: string | null
          id: string
          name: string
          quantity: number | null
          unit: string | null
          user_id: string
        }
        Insert: {
          category?: string
          checked?: boolean
          created_at?: string | null
          id?: string
          name: string
          quantity?: number | null
          unit?: string | null
          user_id: string
        }
        Update: {
          category?: string
          checked?: boolean
          created_at?: string | null
          id?: string
          name?: string
          quantity?: number | null
          unit?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          completed: boolean
          completed_at: string | null
          created_at: string
          due_date: string | null
          id: string
          notes: string | null
          recurrence_end_date: string | null
          recurrence_rule: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_context: {
        Row: {
          created_at: string | null
          id: string
          key: string
          source: string
          updated_at: string | null
          user_id: string
          value: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          key: string
          source?: string
          updated_at?: string | null
          user_id: string
          value: string
        }
        Update: {
          created_at?: string | null
          id?: string
          key?: string
          source?: string
          updated_at?: string | null
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          id: string
          language: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_project_evidence_with_observation: {
        Args: {
          p_acquisition_attempt_id?: string | null
          p_adapter_identity: string
          p_adapter_version: string
          p_byte_length: number
          p_candidate_fingerprint: string
          p_classification: string
          p_collected_at: string
          p_confidence?: number | null
          p_content_hash: string
          p_git_revision?: string | null
          p_mime_type: string
          p_notes?: string | null
          p_project_id: string
          p_reference: string
          p_source_kind: string
          p_source_revision?: string | null
          p_supersedes_id?: string | null
          p_text_content: string
          p_title: string
          p_uncertainty?: string | null
          p_verification_method: string
        }
        Returns: Json
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
