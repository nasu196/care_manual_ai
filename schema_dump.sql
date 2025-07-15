

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."job_status" AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed'
);


ALTER TYPE "public"."job_status" OWNER TO "postgres";


CREATE TYPE "public"."processing_stage" AS ENUM (
    'ocr',
    'embedding',
    'summary',
    'storage'
);


ALTER TYPE "public"."processing_stage" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_expired_share_configs"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    DELETE FROM share_configs 
    WHERE is_active = FALSE;
END;
$$;


ALTER FUNCTION "public"."cleanup_expired_share_configs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_manual_chunks"("query_embedding" "public"."vector", "similarity_threshold" double precision DEFAULT 0.3, "match_count" integer DEFAULT 5) RETURNS TABLE("id" "uuid", "manual_id" "uuid", "chunk_text" "text", "page_number" integer, "chunk_order" integer, "similarity" double precision)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    mc.id,
    mc.manual_id,
    mc.chunk_text,
    mc.page_number,
    mc.chunk_order,
    1 - (mc.embedding <=> query_embedding) AS similarity
  FROM manual_chunks mc
  WHERE 1 - (mc.embedding <=> query_embedding) > similarity_threshold
  ORDER BY mc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."match_manual_chunks"("query_embedding" "public"."vector", "similarity_threshold" double precision, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_manual_chunks"("query_embedding" "public"."vector", "match_threshold" double precision DEFAULT 0.1, "match_count" integer DEFAULT 3, "p_user_id" "text" DEFAULT NULL::"text", "p_selected_manual_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_share_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "manual_id" "uuid", "chunk_text" "text", "chunk_order" integer, "page_number" integer, "similarity" double precision, "manual_filename" "text", "original_manual_filename" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mc.id,
        mc.manual_id,
        mc.chunk_text,
        mc.chunk_order,
        mc.page_number,
        1 - (mc.embedding <=> query_embedding) AS similarity,
        m.file_name AS manual_filename,
        m.original_file_name AS original_manual_filename
    FROM manual_chunks mc
    JOIN manuals m ON mc.manual_id = m.id
    WHERE 
        mc.embedding IS NOT NULL
        AND (1 - (mc.embedding <=> query_embedding)) > match_threshold
        AND (
            p_share_id IS NOT NULL OR 
            (p_user_id IS NOT NULL AND m.user_id = p_user_id)
        )
        AND (
            p_selected_manual_ids IS NULL OR 
            m.id = ANY(p_selected_manual_ids)
        )
    ORDER BY mc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."match_manual_chunks"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "p_user_id" "text", "p_selected_manual_ids" "uuid"[], "p_share_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_processing_jobs_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_processing_jobs_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."manual_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "manual_id" "uuid" NOT NULL,
    "chunk_text" "text" NOT NULL,
    "embedding" "public"."vector"(1536),
    "page_number" integer,
    "chunk_order" integer,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."manual_chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."manuals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "metadata" "jsonb",
    "is_latest_version" boolean DEFAULT true NOT NULL,
    "summary" "text",
    "original_file_name" "text",
    "user_id" "text"
);


ALTER TABLE "public"."manuals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."memos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "user_id" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "tags" "text"[],
    "is_important" boolean DEFAULT false NOT NULL,
    "is_ai_generated" boolean DEFAULT false NOT NULL,
    "ai_generation_sources" "jsonb"
);


ALTER TABLE "public"."memos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."processing_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "original_file_name" "text",
    "status" "public"."job_status" DEFAULT 'pending'::"public"."job_status",
    "current_stage" "public"."processing_stage" DEFAULT 'ocr'::"public"."processing_stage",
    "progress_percentage" integer DEFAULT 0,
    "manual_id" "text",
    "summary" "text",
    "chunks_count" integer DEFAULT 0,
    "total_pages" integer,
    "ocr_completed_at" timestamp with time zone,
    "embedding_completed_at" timestamp with time zone,
    "summary_completed_at" timestamp with time zone,
    "storage_completed_at" timestamp with time zone,
    "error_message" "text",
    "error_details" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."processing_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settings" (
    "key" "text" NOT NULL,
    "value" "jsonb"
);


ALTER TABLE "public"."settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."share_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "selected_record_ids" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."share_configs" OWNER TO "postgres";


COMMENT ON TABLE "public"."share_configs" IS '共有設定テーブル - レコードIDベースに変換済み';



COMMENT ON COLUMN "public"."share_configs"."selected_record_ids" IS '共有対象のマニュアルレコードID配列';



ALTER TABLE ONLY "public"."manual_chunks"
    ADD CONSTRAINT "manual_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."manuals"
    ADD CONSTRAINT "manuals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."memos"
    ADD CONSTRAINT "memos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."processing_jobs"
    ADD CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."share_configs"
    ADD CONSTRAINT "share_configs_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_manual_chunks_embedding" ON "public"."manual_chunks" USING "ivfflat" ("embedding" "public"."vector_cosine_ops") WITH ("lists"='100');



CREATE INDEX "idx_manual_chunks_manual_id" ON "public"."manual_chunks" USING "btree" ("manual_id");



CREATE INDEX "idx_manuals_storage_path" ON "public"."manuals" USING "btree" ("storage_path");



CREATE INDEX "idx_manuals_user_id" ON "public"."manuals" USING "btree" ("user_id");



CREATE INDEX "idx_memos_user_id" ON "public"."memos" USING "btree" ("user_id");



CREATE INDEX "idx_processing_jobs_created_at" ON "public"."processing_jobs" USING "btree" ("created_at");



CREATE INDEX "idx_processing_jobs_status" ON "public"."processing_jobs" USING "btree" ("status");



CREATE INDEX "idx_processing_jobs_user_id" ON "public"."processing_jobs" USING "btree" ("user_id");



CREATE INDEX "idx_share_configs_record_ids" ON "public"."share_configs" USING "gin" ("selected_record_ids");



CREATE INDEX "idx_share_configs_user_id" ON "public"."share_configs" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "trigger_update_processing_jobs_updated_at" BEFORE UPDATE ON "public"."processing_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."update_processing_jobs_updated_at"();



ALTER TABLE ONLY "public"."manual_chunks"
    ADD CONSTRAINT "manual_chunks_manual_id_fkey" FOREIGN KEY ("manual_id") REFERENCES "public"."manuals"("id") ON DELETE CASCADE;



CREATE POLICY "Settings access policy" ON "public"."settings" USING (((( SELECT "auth"."role"() AS "role") = 'service_role'::"text") OR (( SELECT "auth"."role"() AS "role") = ANY (ARRAY['authenticated'::"text", 'anon'::"text"])))) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Users can manage own processing jobs" ON "public"."processing_jobs" USING ((("user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))) OR (( SELECT "auth"."role"() AS "role") = 'service_role'::"text"))) WITH CHECK ((("user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))) OR (( SELECT "auth"."role"() AS "role") = 'service_role'::"text")));



CREATE POLICY "Users can manage their own share configs" ON "public"."share_configs" USING (("user_id" = COALESCE((("auth"."jwt"() -> 'user_metadata'::"text") ->> 'user_id'::"text"), ("auth"."jwt"() ->> 'sub'::"text"))));



CREATE POLICY "Users can only access their own manual chunks" ON "public"."manual_chunks" USING ((EXISTS ( SELECT 1
   FROM "public"."manuals"
  WHERE (("manuals"."id" = "manual_chunks"."manual_id") AND ("manuals"."user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text")))))));



CREATE POLICY "Users can only access their own manuals" ON "public"."manuals" USING (("user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))));



CREATE POLICY "Users can only access their own memos" ON "public"."memos" USING (("user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))));



ALTER TABLE "public"."manual_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."manuals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."memos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."processing_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."share_configs" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_expired_share_configs"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_share_configs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_share_configs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."match_manual_chunks"("query_embedding" "public"."vector", "similarity_threshold" double precision, "match_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."match_manual_chunks"("query_embedding" "public"."vector", "similarity_threshold" double precision, "match_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_manual_chunks"("query_embedding" "public"."vector", "similarity_threshold" double precision, "match_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."match_manual_chunks"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "p_user_id" "text", "p_selected_manual_ids" "uuid"[], "p_share_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."match_manual_chunks"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "p_user_id" "text", "p_selected_manual_ids" "uuid"[], "p_share_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_manual_chunks"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "p_user_id" "text", "p_selected_manual_ids" "uuid"[], "p_share_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_processing_jobs_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_processing_jobs_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_processing_jobs_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."manual_chunks" TO "anon";
GRANT ALL ON TABLE "public"."manual_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."manual_chunks" TO "service_role";



GRANT ALL ON TABLE "public"."manuals" TO "anon";
GRANT ALL ON TABLE "public"."manuals" TO "authenticated";
GRANT ALL ON TABLE "public"."manuals" TO "service_role";



GRANT ALL ON TABLE "public"."memos" TO "anon";
GRANT ALL ON TABLE "public"."memos" TO "authenticated";
GRANT ALL ON TABLE "public"."memos" TO "service_role";



GRANT ALL ON TABLE "public"."processing_jobs" TO "anon";
GRANT ALL ON TABLE "public"."processing_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."processing_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."settings" TO "anon";
GRANT ALL ON TABLE "public"."settings" TO "authenticated";
GRANT ALL ON TABLE "public"."settings" TO "service_role";



GRANT ALL ON TABLE "public"."share_configs" TO "anon";
GRANT ALL ON TABLE "public"."share_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."share_configs" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






RESET ALL;
