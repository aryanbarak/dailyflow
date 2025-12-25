import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { getOrCreateProfile, updateProfile, Profile } from "@/features/profile/profileService";

export function useProfile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await getOrCreateProfile(user.id);
      setProfile(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast({
        variant: "destructive",
        title: "Failed to load profile",
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    refresh();
  }, [refresh, user]);

  const save = useCallback(
    async (data: { displayName?: string; bio?: string }) => {
      if (!user) return false;
      setIsSaving(true);
      setError(null);
      try {
        const updated = await updateProfile(user.id, data);
        setProfile(updated);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast({
          variant: "destructive",
          title: "Failed to update profile",
          description: message,
        });
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [user, toast],
  );

  return {
    profile,
    isLoading,
    isSaving,
    error,
    refresh,
    save,
  };
}
