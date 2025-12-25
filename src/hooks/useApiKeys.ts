import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ApiKeyStatus {
  hasKey: boolean;
  isValid: boolean;
  lastValidatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface UseApiKeysReturn {
  status: ApiKeyStatus | null;
  isLoading: boolean;
  isSaving: boolean;
  isTesting: boolean;
  isRevoking: boolean;
  error: string | null;
  fetchStatus: (serviceName?: string) => Promise<void>;
  saveApiKey: (apiKey: string, serviceName?: string) => Promise<boolean>;
  testConnection: (serviceName?: string) => Promise<boolean>;
  revokeApiKey: (serviceName?: string) => Promise<boolean>;
}

export function useApiKeys(): UseApiKeysReturn {
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const getAccessToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }
    return session.access_token;
  }, []);

  const getAuthHeaders = useCallback(async (includeContentType: boolean) => {
    const accessToken = await getAccessToken();
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
    };
    if (includeContentType) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }, [getAccessToken]);

  const readErrorText = useCallback(async (response: Response) => {
    try {
      return (await response.text()).trim();
    } catch {
      return '';
    }
  }, []);

  const assertOk = useCallback(async (response: Response) => {
    if (response.ok) return;
    const text = await readErrorText(response);
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }, [readErrorText]);

  const fetchStatus = useCallback(async (serviceName = 'default') => {
    setIsLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders(false);
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-keys?action=status&service=${serviceName}`,
        { method: 'GET', headers }
      );
      
      await assertOk(response);
      await response.json().catch(() => null);
      setStatus(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      if (errorMessage === 'Not authenticated') {
        setStatus(null);
        setError(null);
        return;
      }
      setError(errorMessage);
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders, assertOk]);

  const saveApiKey = useCallback(async (apiKey: string, serviceName = 'default'): Promise<boolean> => {
    if (!apiKey || apiKey.length < 10) {
      toast({
        variant: 'destructive',
        title: 'Invalid API Key',
        description: 'API key must be at least 10 characters long',
      });
      return false;
    }

    setIsSaving(true);
    setError(null);
    try {
      const headers = await getAuthHeaders(true);
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-keys?action=save&service=${serviceName}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ apiKey }),
        }
      );
      
      await assertOk(response);
      const data = await response.json();
      
      toast({
        title: 'Success',
        description: 'API key saved securely',
      });
      
      await fetchStatus(serviceName);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMessage,
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [getAuthHeaders, fetchStatus, toast, assertOk]);

  const testConnection = useCallback(async (serviceName = 'default'): Promise<boolean> => {
    setIsTesting(true);
    setError(null);
    try {
      const headers = await getAuthHeaders(true);
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-keys?action=test&service=${serviceName}`,
        { method: 'POST', headers }
      );
      
      await assertOk(response);
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: 'Connection Successful',
          description: 'Your API key is valid and working',
        });
        await fetchStatus(serviceName);
        return true;
      } else {
        throw new Error(data.error || 'Connection test failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      toast({
        variant: 'destructive',
        title: 'Connection Failed',
        description: errorMessage,
      });
      return false;
    } finally {
      setIsTesting(false);
    }
  }, [getAuthHeaders, fetchStatus, toast, assertOk]);

  const revokeApiKey = useCallback(async (serviceName = 'default'): Promise<boolean> => {
    setIsRevoking(true);
    setError(null);
    try {
      const headers = await getAuthHeaders(true);
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-keys?action=revoke&service=${serviceName}`,
        { method: 'DELETE', headers }
      );
      
      await assertOk(response);
      
      toast({
        title: 'API Key Revoked',
        description: 'Your API key has been permanently deleted',
      });
      
      setStatus(null);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMessage,
      });
      return false;
    } finally {
      setIsRevoking(false);
    }
  }, [getAuthHeaders, toast, assertOk]);

  return {
    status,
    isLoading,
    isSaving,
    isTesting,
    isRevoking,
    error,
    fetchStatus,
    saveApiKey,
    testConnection,
    revokeApiKey,
  };
}
