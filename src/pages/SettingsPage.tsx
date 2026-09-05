import { useState, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  User, Shield, Palette, Bell, Database,
  Eye, EyeOff, Check, AlertTriangle, Download,
  Trash2, LogOut, Moon, Sun, Monitor, Smartphone,
  Brain, Globe, Wallet, Loader2,
  CheckSquare, FileText, Camera, Sparkles,
  Cloud, Cpu, Bot, Server,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/common/StatCard';
import { useTasks } from '@/hooks/useTasks';
import { useDocuments } from '@/features/documents/useDocuments';
import { usePhotos } from '@/hooks/usePhotos';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/features/profile/useProfile';
import { setAvatar, clearAvatar } from '@/features/profile/profileService';
import { processAvatarImage, AvatarImageProcessingError, MAX_SOURCE_BYTES } from '@/features/profile/avatarImage';
import { usePreferences } from '@/hooks/usePreferences';
import {
  useAppearance, ACCENT_COLORS, DENSITY_OPTIONS,
  ORB_COLOR_VAR, ORB_OPACITY_STEPS,
  type Language, type OrbColor, type OrbSize,
} from '@/features/settings/appearanceStore';
import { useNotificationPrefs } from '@/features/settings/notificationSettings';
import { dataExportService } from '@/features/settings/dataExportService';
import { supabase } from '@/integrations/supabase/client';
import { safeGet, safeSet, storageKey } from '@/lib/storage';
import { LEARN_AI_SUGGESTED_TOPICS, type LearnAIMode } from '@/features/learn-ai/types';
import {
  getStoredAiResponseLanguage,
  normalizeAiResponseLanguage,
  type AiResponseLanguage,
} from '@/features/ai/responseLanguage';
import { AiMemoryTab } from '@/features/ai-memory/AiMemoryTab';
import { PersonalMemorySection } from '@/features/personal-memory/components/PersonalMemorySection';
import { browserPersonalMemoryRecordService } from '@/features/personal-memory/personalMemoryRecordBrowserService';
import { triggerPersonalMemoryExtraction } from '@/features/personal-memory/personalMemoryExtractionTriggerClient';
import { resolveDocumentChunkSources } from '@/features/documents/documentChunkSourceResolver';
import { GitHubIntegrationCard } from '@/features/integrations/github/GitHubIntegrationCard';
import {
  listBrowserFlowWritePermissions,
  upsertBrowserFlowWritePermission,
  type FlowWritePermissionMode,
  type FlowWritePermissionRow,
} from '@/features/agent/flowWritePermissions';
import { useT, type TranslationKey } from '@/i18n';
import { isolateBidiRunsInText, resolveMessageBaseDirection } from '@/lib/bidiText';
import { MICRO_BREAK_DURATION_PRESETS_SECONDS } from '@/features/micro-breaks/types';

// ── Types ──────────────────────────────────────────────────────────────────

type Tab = 'profile' | 'security' | 'appearance' | 'notifications' | 'data' | 'ai-memory' | 'integrations';

const TABS: { id: Tab; labelKey: TranslationKey; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'profile',       labelKey: 'settings_profile',       icon: User      },
  { id: 'security',      labelKey: 'settings_security',      icon: Shield    },
  { id: 'appearance',    labelKey: 'settings_appearance',    icon: Palette   },
  { id: 'notifications', labelKey: 'settings_notifications', icon: Bell      },
  { id: 'data',          labelKey: 'settings_data',          icon: Database  },
  { id: 'ai-memory',     labelKey: 'settings_ai_memory',     icon: Brain     },
  { id: 'integrations',  labelKey: 'settings_integrations',  icon: Globe     },
];

type AiDefaults = { mode: LearnAIMode; aiResponseLanguage: AiResponseLanguage; language?: AiResponseLanguage };

// Conversation Quality v1 (task 9): same four suggestions LearnAIPage.tsx
// offers, same labels users already saw on the old closed dropdown.
const SUGGESTED_TOPIC_LABELS: { value: LearnAIMode; label: string }[] = [
  { value: 'fiae_algorithms', label: 'FIAE Algorithms' },
  { value: 'wiso', label: 'WiSo' },
  { value: 'general_it', label: 'General IT' },
  { value: 'planner', label: 'Planner' },
];

// DESIGN-AUDIT 1: avatar palette from the flow tokens (primary/study/plan/
// career/analyze/blue/cyan/review). Stored picks keep their saved hex.
const AVATAR_COLORS = [
  '#7C4DFF', '#9B5CFF', '#F06AC6', '#F3A044',
  '#55E38A', '#4F73FF', '#62DDF4', '#5F91FF',
];

// Task 17h: pointer-glow colour choices, restricted to the existing
// --flow-* palette (ORB_COLOR_VAR maps each to its token) -- order here
// is display order only, matches the PO's own listing (primary/blue/cyan,
// then the six quick-action accents).
const ORB_COLOR_KEYS: OrbColor[] = ['primary', 'blue', 'cyan', 'study', 'plan', 'analyze', 'review', 'report', 'career'];
const ORB_SIZE_KEYS: OrbSize[] = ['small', 'medium', 'large', 'xl'];

function readAiDefaults(): AiDefaults {
  const stored = safeGet<Partial<AiDefaults>>(storageKey('ai-defaults'), {});
  return {
    mode: stored.mode ?? 'fiae_algorithms',
    aiResponseLanguage: normalizeAiResponseLanguage(stored.aiResponseLanguage ?? stored.language ?? getStoredAiResponseLanguage()),
  };
}

// ── Shared building blocks ─────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
      </div>
      <div className="px-5">{children}</div>
    </div>
  );
}

function SettingRow({ label, desc, children }: {
  label: string; desc?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-border last:border-0">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-sm font-medium">{label}</p>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
      className="relative w-10 h-6 rounded-full transition-colors flex-shrink-0"
      style={{ background: checked ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.3)' }}
    >
      <motion.div
        animate={{ x: checked ? 16 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow"
      />
    </button>
  );
}

function getInitials(name: string, email: string): string {
  const trimmed = name.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

// ── Tab: Profile ───────────────────────────────────────────────────────────

function ProfileTab() {
  const { t } = useT();
  const { user } = useAuth();
  const { profile, isLoading, isSaving, save, refresh } = useProfile();
  const [displayName, setDisplayName] = useState('');
  const [avatarColor, setAvatarColor] = useState<string>(() =>
    safeGet(storageKey('avatar-color'), '#4F73FF'), /* --flow-blue */
  );
  const [isAvatarBusy, setIsAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
  }, [profile]);

  const initials = getInitials(displayName, user?.email ?? '');
  const avatarUrl = profile?.avatarUrl ?? null;

  async function handleSave() {
    safeSet(storageKey('avatar-color'), avatarColor);
    const ok = await save({ displayName });
    if (ok) toast.success(t('settings_profile_saved'));
  }

  async function handleAvatarFile(file: File) {
    if (!user) return;
    setIsAvatarBusy(true);
    try {
      const image = await processAvatarImage(file);
      await setAvatar(user.id, image);
      await refresh();
      toast.success(t('settings_avatar_updated'));
    } catch (err) {
      if (err instanceof AvatarImageProcessingError && err.reason === 'not_an_image') {
        toast.error(t('settings_avatar_not_image'));
      } else if (err instanceof AvatarImageProcessingError && err.reason === 'too_large') {
        toast.error(t('settings_avatar_too_large', { mb: String(MAX_SOURCE_BYTES / (1024 * 1024)) }));
      } else {
        // Storage/DB failures carry the actionable reason (RLS violation,
        // bucket missing, mime rejected...) -- show it, or nobody can tell
        // a policy problem from a network blip.
        toast.error(t('settings_avatar_failed'), {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    } finally {
      setIsAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    if (!user) return;
    setIsAvatarBusy(true);
    try {
      await clearAvatar(user.id);
      await refresh();
      toast.success(t('settings_avatar_removed'));
    } catch (err) {
      toast.error(t('settings_avatar_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsAvatarBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-4 py-6">
        {/* The picked file never reaches the input's value; the input exists
            only to open the OS picker (clicking the avatar opens it too). */}
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) handleAvatarFile(file);
          }}
        />
        <button
          type="button"
          aria-label={t('settings_avatar_upload')}
          onClick={() => avatarInputRef.current?.click()}
          disabled={isAvatarBusy || isLoading}
          className="relative h-20 w-20 rounded-full border-4 border-background shadow-lg transition-transform hover:scale-105 disabled:opacity-70"
          style={avatarUrl ? undefined : { backgroundColor: avatarColor }}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-white">{initials}</span>
          )}
          {isAvatarBusy && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
              <Loader2 size={20} className="animate-spin text-white" />
            </span>
          )}
        </button>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={isAvatarBusy || isLoading}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-muted px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
          >
            <Camera size={15} /> {t('settings_avatar_upload')}
          </button>
          {avatarUrl && (
            <button
              type="button"
              onClick={handleAvatarRemove}
              disabled={isAvatarBusy || isLoading}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-muted px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 size={15} /> {t('settings_avatar_remove')}
            </button>
          )}
        </div>
        {!avatarUrl && (
          <div className="flex gap-2 flex-wrap justify-center">
            {AVATAR_COLORS.map(c => (
              <button
                key={c}
                type="button"
                aria-label={`Select color ${c}`}
                onClick={() => setAvatarColor(c)}
                className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  outline: avatarColor === c ? `3px solid ${c}` : 'none',
                  outlineOffset: '2px',
                }}
              />
            ))}
          </div>
        )}
        <p className="text-sm text-muted-foreground">{user?.email}</p>
      </div>

      <SectionCard title={t('settings_account_info')}>
        <div className="py-4 space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="displayName" className="text-xs text-muted-foreground">{t('settings_display_name')}</label>
            <input
              id="displayName"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder={t('settings_your_name')}
              disabled={isLoading}
              className="w-full bg-muted rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="settings-email" className="text-xs text-muted-foreground">{t('settings_email')}</label>
            <input
              id="settings-email"
              value={user?.email ?? ''}
              readOnly
              aria-label={t('settings_email')}
              className="w-full bg-muted rounded-xl px-4 py-2.5 text-sm outline-none opacity-60 cursor-not-allowed"
            />
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {isSaving ? <span className="flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> {t('settings_saving')}</span> : t('settings_save_profile')}
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Tab: Security ──────────────────────────────────────────────────────────

function SecurityTab() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [pwError, setPwError]     = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [strength, setStrength]   = useState(0);

  function calcStrength(pw: string) {
    let s = 0;
    if (pw.length >= 8)           s++;
    if (pw.length >= 12)          s++;
    if (/[A-Z]/.test(pw))         s++;
    if (/[0-9]/.test(pw))         s++;
    if (/[^A-Za-z0-9]/.test(pw))  s++;
    setStrength(s);
  }

  // DESIGN-AUDIT 1: flow-derived strength scale -- destructive red, then
  // career amber, cyan, blue, analyze green (weak -> strong).
  const strengthColors = ['hsl(var(--destructive))', 'var(--flow-career)', 'var(--flow-cyan)', 'var(--flow-blue)', 'var(--flow-analyze)'];
  const strengthLabels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

  async function handleChangePassword() {
    setPwError(null);
    if (newPw.length < 8)       { setPwError('New password must be at least 8 characters.'); return; }
    if (newPw !== confirmPw)     { setPwError('Passwords do not match.'); return; }
    if (!user?.email)            return;
    setIsPending(true);
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPw });
      if (authErr) { setPwError('Current password is incorrect.'); return; }
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPw });
      if (updateErr) throw updateErr;
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      toast.success('Password updated');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setIsPending(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/auth');
  }

  const canSubmit = !!currentPw && newPw.length >= 8 && newPw === confirmPw && !isPending;

  return (
    <div className="space-y-4">
      <SectionCard title="Change password">
        <div className="py-4 space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="curPw" className="text-xs text-muted-foreground">Current password</label>
            <div className="relative">
              <input
                id="curPw"
                type={showPw ? 'text' : 'password'}
                value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                autoComplete="current-password"
                className="w-full bg-muted rounded-xl px-4 py-2.5 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="••••••••"
              />
              <button
                type="button"
                aria-label={showPw ? 'Hide password' : 'Show password'}
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="newPw" className="text-xs text-muted-foreground">New password</label>
            <input
              id="newPw"
              type={showPw ? 'text' : 'password'}
              value={newPw}
              onChange={e => { setNewPw(e.target.value); calcStrength(e.target.value); }}
              autoComplete="new-password"
              className="w-full bg-muted rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="Minimum 8 characters"
            />
            {newPw && (
              <div className="space-y-1 mt-1">
                <div className="flex gap-1">
                  {Array.from({ length: 5 }, (_, i) => (
                    <div
                      key={i}
                      className="flex-1 h-1 rounded-full transition-colors"
                      style={{ background: i < strength ? strengthColors[strength - 1] : 'hsl(var(--muted))' }}
                    />
                  ))}
                </div>
                {strength > 0 && (
                  <p className="text-xs" style={{ color: strengthColors[strength - 1] }}>
                    {strengthLabels[strength - 1]}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirmPw" className="text-xs text-muted-foreground">Confirm new password</label>
            <input
              id="confirmPw"
              type={showPw ? 'text' : 'password'}
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              autoComplete="new-password"
              className="w-full bg-muted rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="••••••••"
            />
            {confirmPw && newPw !== confirmPw && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
          </div>

          {pwError && <p className="text-xs text-destructive">{pwError}</p>}

          <button
            type="button"
            onClick={handleChangePassword}
            disabled={!canSubmit}
            className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {isPending ? <span className="flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Updating…</span> : 'Change password'}
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Session">
        <SettingRow label="Signed in as" desc={user?.email}>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </SettingRow>
        {user?.created_at && (
          <SettingRow label="Member since">
            <span className="text-xs text-muted-foreground">
              {new Date(user.created_at).toLocaleDateString('en', { month: 'long', year: 'numeric' })}
            </span>
          </SettingRow>
        )}
      </SectionCard>
    </div>
  );
}

// ── Tab: Appearance ────────────────────────────────────────────────────────

function AppearanceTab() {
  const {
    density, accentColor, reducedMotion, language,
    orbEnabled, orbColor, orbSize, orbOpacity, microBreakDurationSeconds,
    setDensity, setAccentColor, setReducedMotion, setLanguage,
    setOrbEnabled, setOrbColor, setOrbSize, setOrbOpacity, setMicroBreakDurationSeconds,
  } = useAppearance();
  const { preferences, setTheme: setPrefTheme, setCurrency } = usePreferences();
  // DESIGN-AUDIT 0.6 (light mode): the selector reads/writes ONLY
  // usePreferences now -- next-themes' useTheme had no mounted
  // ThemeProvider, so its `theme` was always undefined (the selected tile
  // never highlighted) and its setTheme was a no-op.
  const theme = preferences.theme;
  const { t } = useT();

  const [aiDefaults, setAiDefaults] = useState<AiDefaults>(() => readAiDefaults());
  // Conversation Quality v1 (task 9): "Default mode" -> "Default topic
  // (optional)" -- the four suggestions plus a free-text topic, mirroring
  // LearnAIPage.tsx's own chip + input pattern for the same underlying
  // (now free-form) LearnAIMode field.
  const isSuggestedDefaultTopic = (LEARN_AI_SUGGESTED_TOPICS as readonly string[]).includes(aiDefaults.mode);
  const [customDefaultTopicDraft, setCustomDefaultTopicDraft] = useState(isSuggestedDefaultTopic ? '' : aiDefaults.mode);
  const [writePermissions, setWritePermissions] = useState<FlowWritePermissionRow[]>([]);
  const [writePermissionsLoading, setWritePermissionsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setWritePermissionsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setWritePermissionsLoading(false);
        return;
      }
      try {
        const rows = await listBrowserFlowWritePermissions(user.id);
        if (!cancelled) setWritePermissions(rows);
      } catch {
        if (!cancelled) toast.error('Unable to load Flow AI permissions');
      } finally {
        if (!cancelled) setWritePermissionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function setWritePermission(row: FlowWritePermissionRow, mode: FlowWritePermissionMode) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setWritePermissions(previous => previous.map(item =>
      item.domain === row.domain && item.action === row.action ? { ...item, mode, isUserSet: true } : item,
    ));
    try {
      await upsertBrowserFlowWritePermission(user.id, row.domain, row.action, mode);
      toast.success('Flow AI permission saved');
    } catch {
      toast.error('Unable to save Flow AI permission');
    }
  }

  const themes = [
    { id: 'dark',   label: 'Dark',   icon: Moon    },
    { id: 'light',  label: 'Light',  icon: Sun     },
    { id: 'system', label: 'System', icon: Monitor },
  ] as const;

  function handleTheme(t: string) {
    setPrefTheme(t as 'light' | 'dark' | 'system');
  }

  function saveAiDefaults() {
    safeSet(storageKey('ai-defaults'), {
      mode: aiDefaults.mode,
      aiResponseLanguage: aiDefaults.aiResponseLanguage,
    });
    toast.success('AI defaults saved');
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Theme">
        <div className="py-4 grid grid-cols-3 gap-2">
          {themes.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => handleTheme(id)}
              className="flex flex-col items-center gap-2 py-3 rounded-xl border-2 transition-all"
              style={{
                borderColor: theme === id ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                background:  theme === id ? 'hsl(var(--primary) / 0.08)' : 'transparent',
              }}
            >
              <Icon size={20} style={{ color: theme === id ? 'hsl(var(--primary))' : undefined }} />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Accent color">
        <div className="py-4 flex gap-3 flex-wrap">
          {(Object.entries(ACCENT_COLORS) as [typeof accentColor, { label: string; hex: string }][]).map(([key, cfg]) => (
            <button
              key={key}
              type="button"
              aria-label={`Set accent color to ${cfg.label}`}
              onClick={() => setAccentColor(key)}
              className="w-10 h-10 rounded-full transition-all hover:scale-110 flex items-center justify-center"
              style={{
                backgroundColor: cfg.hex,
                outline: accentColor === key ? `3px solid ${cfg.hex}` : 'none',
                outlineOffset: '2px',
                transform: accentColor === key ? 'scale(1.15)' : undefined,
              }}
            >
              {accentColor === key && <Check size={16} className="text-white" />}
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Layout density">
        <div className="py-2 space-y-1">
          {DENSITY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDensity(opt.value)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors hover:bg-muted"
              style={{ background: density === opt.value ? 'hsl(var(--primary) / 0.08)' : undefined }}
            >
              <div>
                <p className="text-sm font-medium text-left">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </div>
              {density === opt.value && <Check size={15} className="text-primary flex-shrink-0" />}
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Language & currency">
        <SettingRow label="Interface language">
          <Select value={language} onValueChange={v => {
            const lang = v as Language;
            setLanguage(lang);
            void (async () => {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) {
                console.warn('[Lang] No authenticated user — skipping upsert');
                return;
              }
              console.log('[Lang] Upserting language:', lang, 'user_id:', user.id);
              const { error } = await supabase
                .from('user_settings')
                .upsert({ user_id: user.id, language: lang }, { onConflict: 'user_id' });
              if (error) {
                console.error('[Lang] Upsert error:', error);
              } else {
                console.log('[Lang] Upsert OK — language saved to user_settings:', lang);
              }
            })();
          }}>
            <SelectTrigger className="w-32 h-8 text-xs" aria-label="Select language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="de">Deutsch</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="fa">فارسی</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow label="Currency">
          <Select value={preferences.currency ?? 'EUR'} onValueChange={setCurrency}>
            <SelectTrigger className="w-24 h-8 text-xs" aria-label="Select currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EUR">EUR €</SelectItem>
              <SelectItem value="USD">USD $</SelectItem>
              <SelectItem value="GBP">GBP £</SelectItem>
              <SelectItem value="IRR">IRR ﷼</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </SectionCard>

      <SectionCard title="Learn with AI defaults">
        <div className="py-3.5 border-b border-border space-y-2">
          <p className="text-sm font-medium">Default topic (optional)</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_TOPIC_LABELS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setAiDefaults(p => ({ ...p, mode: value }))}
                className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
                style={{
                  borderColor: aiDefaults.mode === value ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                  background: aiDefaults.mode === value ? 'hsl(var(--primary) / 0.08)' : 'transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={customDefaultTopicDraft}
              onChange={e => setCustomDefaultTopicDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const topic = customDefaultTopicDraft.trim();
                  if (topic) setAiDefaults(p => ({ ...p, mode: topic as LearnAIMode }));
                }
              }}
              placeholder="Or type any topic"
              className="w-40 h-8 text-xs"
              aria-label="Custom default topic"
            />
            <button
              type="button"
              onClick={() => {
                const topic = customDefaultTopicDraft.trim();
                if (topic) setAiDefaults(p => ({ ...p, mode: topic as LearnAIMode }));
              }}
              className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium"
            >
              Use topic
            </button>
          </div>
          {!isSuggestedDefaultTopic && (
            <p className="text-xs text-muted-foreground">Current default topic: {aiDefaults.mode}</p>
          )}
        </div>
        <SettingRow label="Response language">
          <Select
            value={aiDefaults.aiResponseLanguage}
            onValueChange={v => setAiDefaults(p => ({ ...p, aiResponseLanguage: normalizeAiResponseLanguage(v) }))}
          >
            <SelectTrigger className="w-40 h-8 text-xs" aria-label="Select AI response language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto - match my message</SelectItem>
              <SelectItem value="de">Deutsch</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="fa">فارسی</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <div className="py-3">
          <button
            type="button"
            onClick={saveAiDefaults}
            className="text-xs px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
          >
            Save AI defaults
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Flow AI permissions">
        <div className="py-2 space-y-1">
          {writePermissionsLoading && (
            <p className="py-3 text-xs text-muted-foreground">Loading permissions...</p>
          )}
          {writePermissions.map(row => (
            <div key={`${row.domain}:${row.action}`} className="flex items-center justify-between gap-3 py-3.5 border-b border-border last:border-0">
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.domain}.{row.action}</p>
                <p className="text-xs text-muted-foreground">
                  {row.isUserSet ? 'User-set' : `Default: ${row.mode}`}
                </p>
              </div>
              <div className="flex gap-1 rounded-lg border border-border p-1">
                {(['auto', 'ask', 'off'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => void setWritePermission(row, mode)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                    style={{
                      background: row.mode === mode ? 'hsl(var(--primary) / 0.16)' : 'transparent',
                      color: row.mode === mode ? 'hsl(var(--primary))' : undefined,
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Task 17h: settings for SmartflowPointerFollower, the app-wide
          cursor-following glow restored (and made configurable) by this
          task -- see AppLayout.tsx and smartflow-pointer-follower.tsx for
          the component itself, appearanceStore.ts's orb* fields/ORB_*
          constants for why this store owns it. */}
      <SectionCard title={t('settings_orb_title')}>
        <SettingRow label={t('settings_orb_enabled')} desc={t('settings_orb_enabled_desc')}>
          <Toggle checked={orbEnabled} onChange={setOrbEnabled} label={t('settings_orb_enabled')} />
        </SettingRow>
        {orbEnabled && (
          <>
            <div className="py-3.5 border-b border-border space-y-2">
              <p className="text-sm font-medium">{t('settings_orb_color')}</p>
              <div className="flex gap-2 flex-wrap">
                {ORB_COLOR_KEYS.map(key => (
                  <button
                    key={key}
                    type="button"
                    aria-label={t(`settings_orb_color_${key}` as TranslationKey)}
                    onClick={() => setOrbColor(key)}
                    className="w-8 h-8 rounded-full transition-all hover:scale-110 flex items-center justify-center"
                    style={{
                      backgroundColor: `var(${ORB_COLOR_VAR[key]})`,
                      outline: orbColor === key ? `3px solid var(${ORB_COLOR_VAR[key]})` : 'none',
                      outlineOffset: '2px',
                      transform: orbColor === key ? 'scale(1.15)' : undefined,
                    }}
                  >
                    {orbColor === key && <Check size={14} className="text-white" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="py-3.5 border-b border-border space-y-2">
              <p className="text-sm font-medium">{t('settings_orb_size')}</p>
              <div className="flex gap-2 flex-wrap">
                {ORB_SIZE_KEYS.map(key => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setOrbSize(key)}
                    className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
                    style={{
                      borderColor: orbSize === key ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                      background: orbSize === key ? 'hsl(var(--primary) / 0.08)' : 'transparent',
                    }}
                  >
                    {t(`settings_orb_size_${key}` as TranslationKey)}
                  </button>
                ))}
              </div>
            </div>

            <div className="py-3.5 space-y-2">
              <p className="text-sm font-medium">{t('settings_orb_opacity')}</p>
              <div className="flex gap-2 flex-wrap">
                {ORB_OPACITY_STEPS.map(step => (
                  <button
                    key={step}
                    type="button"
                    aria-label={`${t('settings_orb_opacity')} ${Math.round(step * 100)}%`}
                    onClick={() => setOrbOpacity(step)}
                    className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
                    style={{
                      borderColor: orbOpacity === step ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                      background: orbOpacity === step ? 'hsl(var(--primary) / 0.08)' : 'transparent',
                    }}
                  >
                    {Math.round(step * 100)}%
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </SectionCard>

      {/* MB-03, ADR-0014 §7: the frozen 60/90/120s duration preset -- read
          once by MicroBreakOverlay at game start (never reactively; see
          that component's own comment for why a mid-game change here must
          not affect a running session). Persisted via THIS store, the same
          pattern as every other appearance preference -- not the
          session-only microBreaksStore.ts runtime store. */}
      <SectionCard title={t('settings_micro_breaks_title')}>
        <div className="py-3.5 space-y-2">
          <p className="text-sm font-medium">{t('settings_micro_breaks_duration_label')}</p>
          <div className="flex gap-2 flex-wrap">
            {MICRO_BREAK_DURATION_PRESETS_SECONDS.map(seconds => {
              const optionText = t('micro_breaks_duration_option', { seconds });
              return (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => setMicroBreakDurationSeconds(seconds)}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
                  style={{
                    borderColor: microBreakDurationSeconds === seconds ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                    background: microBreakDurationSeconds === seconds ? 'hsl(var(--primary) / 0.08)' : 'transparent',
                  }}
                >
                  <span dir={resolveMessageBaseDirection(optionText)}>{isolateBidiRunsInText(optionText, `mb-duration-${seconds}`)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Accessibility">
        <SettingRow label="Reduce motion" desc="Disable animations for motion-sensitive users">
          <Toggle checked={reducedMotion} onChange={setReducedMotion} label="Toggle reduced motion" />
        </SettingRow>
      </SectionCard>
    </div>
  );
}

// ── Tab: Notifications ─────────────────────────────────────────────────────

function NotificationsTab() {
  const prefs = useNotificationPrefs();
  const [permState, setPermState] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  );

  async function requestPermission() {
    const result = await Notification.requestPermission();
    setPermState(result);
    if (result === 'granted') toast.success('Notifications enabled');
    else toast.error('Permission denied');
  }

  return (
    <div className="space-y-4">
      {permState !== 'granted' && (
        <div className="bg-career/10 border border-career/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle size={16} className="text-career flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Browser notifications disabled</p>
            <p className="text-xs text-muted-foreground">Grant permission to receive reminders</p>
          </div>
          <button
            type="button"
            onClick={requestPermission}
            className="text-xs px-3 py-1.5 rounded-lg bg-career text-white hover:opacity-90 transition-opacity flex-shrink-0"
          >
            Enable
          </button>
        </div>
      )}

      <SectionCard title="Tasks">
        <SettingRow label="Task reminders" desc="Notify before due tasks">
          <Toggle checked={prefs.taskReminders} onChange={prefs.setTaskReminders} label="Toggle task reminders" />
        </SettingRow>
        {prefs.taskReminders && (
          <SettingRow label="Reminder time">
            <input
              type="time"
              value={prefs.taskReminderTime}
              onChange={e => prefs.setTaskReminderTime(e.target.value)}
              className="bg-muted rounded-lg px-3 py-1.5 text-sm outline-none"
              aria-label="Task reminder time"
            />
          </SettingRow>
        )}
      </SectionCard>

      <SectionCard title="Habits">
        <SettingRow label="Daily habit reminder" desc="Nudge to check in on habits">
          <Toggle checked={prefs.habitReminder} onChange={prefs.setHabitReminder} label="Toggle habit reminder" />
        </SettingRow>
        {prefs.habitReminder && (
          <SettingRow label="Reminder time">
            <input
              type="time"
              value={prefs.habitReminderTime}
              onChange={e => prefs.setHabitReminderTime(e.target.value)}
              className="bg-muted rounded-lg px-3 py-1.5 text-sm outline-none"
              aria-label="Habit reminder time"
            />
          </SettingRow>
        )}
      </SectionCard>

      <SectionCard title="Calendar">
        <SettingRow label="Event reminders">
          <Toggle checked={prefs.calendarReminders} onChange={prefs.setCalendarReminders} label="Toggle calendar reminders" />
        </SettingRow>
        {prefs.calendarReminders && (
          <SettingRow label="Minutes before event">
            <select
              value={prefs.calendarReminderMinutes}
              onChange={e => prefs.setCalendarReminderMinutes(Number(e.target.value))}
              aria-label="Minutes before event"
              className="bg-muted rounded-lg px-3 py-1.5 text-sm outline-none"
            >
              {[5, 10, 15, 30, 60].map(m => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </SettingRow>
        )}
      </SectionCard>

      <SectionCard title="Daily summary">
        <SettingRow label="Morning briefing" desc="Tasks and events for the day">
          <Toggle checked={prefs.dailySummary} onChange={prefs.setDailySummary} label="Toggle daily summary" />
        </SettingRow>
        {prefs.dailySummary && (
          <SettingRow label="Delivery time">
            <input
              type="time"
              value={prefs.dailySummaryTime}
              onChange={e => prefs.setDailySummaryTime(e.target.value)}
              className="bg-muted rounded-lg px-3 py-1.5 text-sm outline-none"
              aria-label="Daily summary time"
            />
          </SettingRow>
        )}
      </SectionCard>
    </div>
  );
}

// ── Tab: Data ──────────────────────────────────────────────────────────────

function DataTab() {
  const { t } = useT();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const installPromptRef = useRef<(Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const isStandalone = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const stats = dataExportService.getStorageStats();

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      installPromptRef.current = e as typeof installPromptRef.current;
      setCanInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!installPromptRef.current) return;
    await installPromptRef.current.prompt();
    const { outcome } = await installPromptRef.current.userChoice;
    if (outcome === 'accepted') { installPromptRef.current = null; setCanInstall(false); }
  }

  const { mutate: exportData, isPending: exporting } = useMutation({
    mutationFn: dataExportService.exportAll,
    onSuccess: () => toast.success('Data exported successfully'),
    onError:   () => toast.error('Export failed'),
  });

  const { mutate: deleteAll, isPending: deleting } = useMutation({
    mutationFn: dataExportService.deleteAllUserData,
    onSuccess: async () => {
      dataExportService.clearLocalStorage();
      toast.success('All data deleted');
      await signOut();
      navigate('/auth');
    },
    onError: () => toast.error('Failed to delete data'),
  });

  function handleClearCache() {
    dataExportService.clearLocalStorage();
    toast.success('Local cache cleared');
  }

  return (
    <div className="space-y-4">
      <SectionCard title={t('settings_install_app')}>
        <div className="py-4">
          {isStandalone ? (
            <p className="text-sm text-[var(--flow-analyze)]">{t('settings_installed')}</p>
          ) : canInstall ? (
            <button
              type="button"
              onClick={handleInstall}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Smartphone size={15} />
              {t('settings_install_btn')}
            </button>
          ) : isIos ? (
            <p className="text-sm text-muted-foreground">{t('settings_install_ios')}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('settings_install_browser')}</p>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Export">
        <SettingRow label="Download all data" desc="Tasks, events, finance, journal — as JSON">
          <button
            type="button"
            onClick={() => exportData()}
            disabled={exporting}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <Download size={13} />
            {exporting ? 'Exporting…' : 'Download JSON'}
          </button>
        </SettingRow>
      </SectionCard>

      <SectionCard title="Local storage">
        <SettingRow label="Browser cache" desc={`${stats.keyCount} keys · ${stats.used}`}>
          <button
            type="button"
            onClick={handleClearCache}
            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Clear cache
          </button>
        </SettingRow>
      </SectionCard>

      <SectionCard title="About">
        <SettingRow label="Version" desc="smartFlow — Personal Life Organizer">
          <span className="text-xs text-muted-foreground">1.0.0</span>
        </SettingRow>
        <SettingRow label="Built by">
          <span className="text-xs text-muted-foreground">Barakzai.Cloud © 2024</span>
        </SettingRow>
      </SectionCard>

      <SectionCard title="Infrastructure">
        <SettingRow label="Supabase" desc="Database & Auth">
          <span className="text-xs text-[var(--flow-analyze)] flex items-center gap-1"><Check size={12} /> {t('settings_connected')}</span>
        </SettingRow>
        <SettingRow label="Cloudflare" desc="Workers & CDN">
          <span className="text-xs text-[var(--flow-analyze)] flex items-center gap-1"><Check size={12} /> {t('settings_connected')}</span>
        </SettingRow>
        <SettingRow label="Gemini AI" desc="AI analysis & suggestions">
          <span className="text-xs text-[var(--flow-analyze)] flex items-center gap-1"><Check size={12} /> {t('settings_connected')}</span>
        </SettingRow>
      </SectionCard>

      <div className="bg-destructive/5 border border-destructive/20 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-destructive/20 bg-destructive/10">
          <h3 className="text-xs font-semibold text-destructive uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle size={12} />
            Danger zone
          </h3>
        </div>
        <div className="px-5">
          <SettingRow label="Delete all data" desc="Permanently removes all tasks, events, files, and history. Irreversible.">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 size={13} />
              Delete all
            </button>
          </SettingRow>
        </div>
      </div>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={20} className="text-destructive" />
                </div>
                <div>
                  <h3 className="font-semibold">Are you sure?</h3>
                  <p className="text-xs text-muted-foreground">This action cannot be undone</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Type <span className="font-mono text-destructive font-semibold">DELETE</span> to confirm:
              </p>

              <input
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                placeholder="DELETE"
                className="w-full bg-muted rounded-xl px-4 py-2.5 text-sm outline-none font-mono focus:ring-2 focus:ring-destructive/40"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                  className="flex-1 py-2.5 rounded-xl border border-border text-sm hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => deleteAll()}
                  disabled={deleteInput !== 'DELETE' || deleting}
                  className="flex-1 py-2.5 rounded-xl bg-destructive text-white text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {deleting ? <span className="flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Deleting…</span> : 'Delete everything'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const { user, isLoading } = useAuth();
  const { profile: heroProfile } = useProfile();
  const { t, isRTL } = useT();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !user) navigate('/auth');
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const { tasks } = useTasks();
  const { documents } = useDocuments();
  const { photos } = usePhotos();

  const [memoryCount, setMemoryCount] = useState(0);
  useEffect(() => {
    if (!user) return;
    supabase.from('user_context').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      .then(({ count }) => setMemoryCount(count ?? 0));
  }, [user]);

  const [latestBriefing, setLatestBriefing] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    // Task 13 fix: agent_briefings has never had an updated_at column (see
    // supabase/migrations/20260613000000_agent_briefings.sql -- insert-only,
    // no update path anywhere in this codebase) -- created_at is both the
    // real column and the semantically correct "when was this briefing
    // generated" marker, already the convention
    // agent/worker/personal-memory-extraction-endpoint.ts's own "latest
    // briefing" read uses (order=created_at.desc).
    supabase.from('agent_briefings').select('created_at').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (data?.[0]) setLatestBriefing(data[0].created_at);
      });
  }, [user]);

  const storageBytes = useMemo(() =>
    (documents as { sizeBytes: number | null }[]).reduce((s, d) => s + (d.sizeBytes ?? 0), 0)
  , [documents]);

  const displayName = heroProfile?.displayName?.trim() || (user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? '');
  const initials = getInitials(displayName, user?.email ?? '');
  const avatarColor = safeGet(storageKey('avatar-color'), '#7C4DFF'); /* --flow-primary */
  const heroAvatarUrl = heroProfile?.avatarUrl ?? null;
  const memberSince = user?.created_at ? new Date(user.created_at).toLocaleDateString('en', { month: 'long', year: 'numeric' }) : '';

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  const TAB_CONTENT: Record<Tab, React.ReactNode> = {
    profile:       <ProfileTab />,
    security:      <SecurityTab />,
    appearance:    <AppearanceTab />,
    notifications: <NotificationsTab />,
    data:          <DataTab />,
    'ai-memory':   <div className="space-y-6"><PersonalMemorySection service={browserPersonalMemoryRecordService} triggerExtraction={triggerPersonalMemoryExtraction} resolveDocumentSources={resolveDocumentChunkSources} /><AiMemoryTab /></div>,
    integrations:  <GitHubIntegrationCard />,
  };

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="px-4 sm:px-6 lg:px-8 pb-6 space-y-5">
      {/* Hero Profile Card */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="glass-card card-accent overflow-hidden">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
              {heroAvatarUrl ? (
                <img
                  src={heroAvatarUrl}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover border-4 border-background shadow-lg shrink-0"
                />
              ) : (
                <div className="w-20 h-20 rounded-full flex items-center justify-center text-white font-bold text-2xl border-4 border-background shadow-lg shrink-0"
                  style={{ backgroundColor: avatarColor }}>
                  {initials}
                </div>
              )}
              <div className="flex-1 min-w-0 text-center sm:text-left">
                <h1 className="text-xl font-bold">{displayName || 'SmartFlow User'}</h1>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
                <span className="inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Life OS</span>
              </div>
              <div className="text-xs text-muted-foreground space-y-1 text-right shrink-0 hidden sm:block">
                <p>Storage: {storageBytes < 1024 * 1024 ? `${(storageBytes / 1024).toFixed(0)} KB` : `${(storageBytes / (1024 * 1024)).toFixed(1)} MB`} / 1 GB</p>
                {latestBriefing && <p>Last briefing: {timeAgo(latestBriefing)}</p>}
                {memberSince && <p>Member since: {memberSince}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={CheckSquare}
          label={t('nav_tasks')}
          tileClassName="bg-[var(--flow-analyze-bg)]"
          iconClassName="text-[var(--flow-analyze)]"
          value={tasks.length}
        />
        <StatCard
          icon={FileText}
          label={t('nav_documents')}
          tileClassName="bg-[var(--flow-review-bg)]"
          iconClassName="text-[var(--flow-review)]"
          value={(documents as unknown[]).length}
        />
        <StatCard
          icon={Camera}
          label={t('nav_photos')}
          tileClassName="bg-[var(--flow-career-bg)]"
          iconClassName="text-[var(--flow-career)]"
          value={photos.length}
        />
        <StatCard
          icon={Brain}
          label={t('settings_ai_memory')}
          tileClassName="bg-[var(--flow-study-bg)]"
          iconClassName="text-[var(--flow-study)]"
          value={memoryCount}
          sub={t('settings_memory_items')}
        />
      </div>

      <div className="flex gap-1 bg-muted rounded-xl p-1 overflow-x-auto scrollbar-hide">
        {TABS.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex-shrink-0"
            style={{
              background:  activeTab === id ? 'hsl(var(--card))' : 'transparent',
              color:       activeTab === id ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
              boxShadow:   activeTab === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            <Icon size={13} />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {TAB_CONTENT[activeTab]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
