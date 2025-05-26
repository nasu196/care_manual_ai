import { useMemoStore } from '@/store/memoStore';
import { toast } from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useClerk } from '@/contexts/ClerkContext';

const MemoTemplateSuggestions: React.FC = () => {
  const { selectedFileNames, setSuggestions, setIsLoadingSuggestions, setErrorSuggestions, suggestions } = useMemoStore();
  const { user } = useAuth();
  const clerk = useClerk();

  const fetchSuggestions = async () => {
    if (!clerk || !clerk.session) {
        console.error("Clerk session not available");
        toast.error("認証セッションが見つかりません。");
        return;
    }

    if (user) {
        console.log('Current Clerk User ID (frontend):', user.id);
    } else {
        console.log('Clerk user object is not available via useAuth.');
    }

    setIsLoadingSuggestions(true);
    setErrorSuggestions(null);

    try {
      const token = await clerk.session.getToken({ template: 'supabase' });
      if (!token) {
        throw new Error("Failed to get auth token");
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error("Supabase URL is not defined in environment variables.");
      }

      console.log('Fetching suggestions for files:', selectedFileNames);
      const response = await fetch(`${supabaseUrl}/functions/v1/suggest-next-actions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ selectedFileNames: selectedFileNames || [] }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to parse error response' }));
        console.error('Error response from suggest-next-actions:', errorData);
        throw new Error(`Failed to fetch suggestions: ${response.status} ${response.statusText}. ${errorData.error || errorData.message || ''}`);
      }

      const rawResponse = await response.text();
      console.log('Raw response from suggest-next-actions:', rawResponse);

      let jsonData;
      if (rawResponse.startsWith("```json") && rawResponse.endsWith("```")) {
        const jsonString = rawResponse.substring(7, rawResponse.length - 3).trim();
        jsonData = JSON.parse(jsonString);
      } else {
        jsonData = JSON.parse(rawResponse);
      }
      
      console.log('Parsed suggestions:', jsonData);

      if (Array.isArray(jsonData)) {
          setSuggestions(jsonData);
      } else if (jsonData && typeof jsonData === 'object' && Array.isArray(jsonData.suggestions)) {
          setSuggestions(jsonData.suggestions);
          if (jsonData.message && jsonData.suggestions.length === 0) { 
              toast.success(jsonData.message);
          }
      } else {
          console.error("Unexpected response format from suggest-next-actions. Expected an array or { suggestions: [...] }.", jsonData);
          setSuggestions([]);
          throw new Error("予期しない形式のレスポンスを受け取りました。");
      }

    } catch (error: unknown) {
      let errorMessage = '提案の取得中にエラーが発生しました。';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      console.error('Error fetching suggestions:', error);
      setErrorSuggestions(errorMessage);
      toast.error(errorMessage);
      setSuggestions([]);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  return (
    <div className="space-y-4 p-4 bg-white rounded-lg shadow">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-700">資料の活用アイデア</h3>
        <button
          onClick={fetchSuggestions}
          disabled={selectedFileNames.length === 0}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          アイディアを更新
        </button>
      </div>
      {suggestions && suggestions.length > 0 ? (
        <ul className="space-y-3">
          {suggestions.map((suggestion, index) => (
            <li key={index} className="p-3 bg-gray-50 rounded-md shadow-sm">
              <h4 className="font-semibold text-blue-600">{suggestion.title}</h4>
              <p className="text-sm text-gray-600 mt-1">{suggestion.description}</p>
              {suggestion.source_files && suggestion.source_files.length > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  関連ファイル: {suggestion.source_files.join(', ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">適切な提案が見つかりませんでした。ファイルを選択して「アイディアを更新」ボタンを押してください。</p>
      )}
    </div>
  );
};

export default MemoTemplateSuggestions; 