import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  try {
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'No Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const parts = token.split('.');
    
    if (parts.length !== 3) {
      return new Response(
        JSON.stringify({ error: 'Invalid JWT format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload = JSON.parse(atob(parts[1]));
    
    // Supabaseクライアントを作成してRLS認証テスト
    const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
      auth: {
        persistSession: false,
      },
    });

    // RLS認証テスト: manualsテーブルにアクセス
    const { data: manualsData, error: manualsError } = await supabase
      .from('manuals')
      .select('id, file_name, original_file_name, user_id')
      .limit(5);

    // 特定のrecordIdでのテスト
    const testRecordId = 'b15dedf7-c30c-4398-b32b-93bd062bee87';
    const { data: specificRecord, error: specificError } = await supabase
      .from('manuals')
      .select('id, file_name, original_file_name, user_id, summary')
      .eq('id', testRecordId)
      .single();

    return new Response(
      JSON.stringify({
        jwt_payload: {
          sub: payload.sub,
          sub_type: typeof payload.sub,
          sub_length: payload.sub?.length,
          is_uuid_format: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub),
          user_metadata: payload.user_metadata,
          full_payload: payload
        },
        rls_test: {
          manuals_access: {
            success: !manualsError,
            error: manualsError,
            data_count: manualsData?.length || 0,
            sample_data: manualsData?.slice(0, 2) || []
          },
          specific_record_access: {
            success: !specificError,
            error: specificError,
            data: specificRecord || null
          }
        }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}); 