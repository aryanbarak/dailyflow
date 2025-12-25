import { motion } from "framer-motion";
import {
  Moon,
  Sun,
  Download,
  Globe,
  Shield,
  Database,
  Palette,
  Key,
  Loader2,
  Eye,
  EyeOff,
  AlertTriangle,
  LogOut,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/features/profile/useProfile";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function SettingsPage() {
  const API_KEYS_ENABLED = false;
  const navigate = useNavigate();
  const { preferences, setTheme, setLanguage, setCurrency } = usePreferences();
  const { user, isLoading: authLoading, signOut } = useAuth();
  const { profile, isLoading: profileLoading, isSaving, error: profileError, refresh, save } = useProfile();
  const { toast } = useToast();

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? "");
    setBio(profile?.bio ?? "");
  }, [profile]);

  const handleSaveApiKey = async () => {
    if (!API_KEYS_ENABLED) return;
  };

  const handleTestConnection = async () => {
    if (!API_KEYS_ENABLED) return;
  };

  const handleRevokeApiKey = async () => {
    if (!API_KEYS_ENABLED) return;
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const handleSaveProfile = async () => {
    const saved = await save({ displayName, bio });
    if (saved) {
      toast({
        title: "Profile updated",
        description: "Your changes have been saved.",
      });
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-2xl lg:text-3xl font-semibold mb-1">Settings</h1>
        <p className="text-muted-foreground">Customize your experience</p>
      </motion.div>

      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="space-y-6"
      >
        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Profile</CardTitle>
            <CardDescription>Manage your public profile details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {profileLoading ? (
              <div className="text-sm text-muted-foreground">Loading profile...</div>
            ) : (
              <>
                {profileError && (
                  <Alert variant="destructive">
                    <AlertDescription>{profileError}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Display name</label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    disabled={profileLoading}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Bio</label>
                  <Textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="A short note about you"
                    rows={3}
                    disabled={profileLoading}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={handleSaveProfile} disabled={isSaving || profileLoading}>
                    Save changes
                  </Button>
                  {profileError && (
                    <Button variant="secondary" onClick={refresh} disabled={profileLoading}>
                      Retry
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* API Key Management */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Key className="w-5 h-5 text-primary" />
              API Key Management
            </CardTitle>
            <CardDescription>
              Securely manage your API keys. Keys are encrypted and stored server-side.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                API key management is temporarily disabled and will be enabled in a future update.
              </AlertDescription>
            </Alert>

            {/* Status Display */}
            <div className="p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              API key management is currently unavailable.
            </div>

            {/* API Key Input */}
            <div className="space-y-3">
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  placeholder="Enter your API key..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  disabled={!API_KEYS_ENABLED}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setShowApiKey(!showApiKey)}
                  disabled={!API_KEYS_ENABLED}
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
              
              <div className="flex flex-wrap gap-2">
                <Button 
                  onClick={handleSaveApiKey} 
                  disabled
                  className="gap-2"
                >
                  Save API Key
                </Button>
                
                <Button 
                  variant="secondary"
                  onClick={handleTestConnection} 
                  disabled
                  className="gap-2"
                >
                  Test Connection
                </Button>
                
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button 
                      variant="destructive"
                      disabled
                      className="gap-2"
                    >
                      Revoke Key
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. The API key will be permanently deleted
                        and any integrations using it will stop working.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleRevokeApiKey}>
                        Revoke Key
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Palette className="w-5 h-5 text-primary" />
              Appearance
            </CardTitle>
            <CardDescription>Customize how the app looks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {preferences.theme === "dark" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                <div>
                  <p className="text-sm font-medium">Theme</p>
                  <p className="text-xs text-muted-foreground">Light, dark, or system</p>
                </div>
              </div>
              <Select value={preferences.theme} onValueChange={(value) => setTheme(value as "light" | "dark" | "system")}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">System</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Language */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              Language
            </CardTitle>
            <CardDescription>Choose your preferred language</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={preferences.language ?? "en"} onValueChange={setLanguage}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="de">Deutsch</SelectItem>
                <SelectItem value="pt">Português</SelectItem>
                <SelectItem value="fa">فارسی</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Currency */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" />
              Currency
            </CardTitle>
            <CardDescription>Default currency for totals</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={preferences.currency ?? "USD"} onValueChange={setCurrency}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Select currency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
                <SelectItem value="GBP">GBP</SelectItem>
                <SelectItem value="IRR">IRR</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Data */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              Data Management
            </CardTitle>
            <CardDescription>Backup and export your data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="secondary" className="gap-2">
                <Download className="w-4 h-4" />
                Export Data
              </Button>
              <Button variant="secondary" className="gap-2">
                <Download className="w-4 h-4" />
                Backup to File
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Export all your data as JSON or create a backup file
            </p>
          </CardContent>
        </Card>

        {/* Privacy */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Privacy & Security
            </CardTitle>
            <CardDescription>Your data security matters</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
              <h4 className="text-sm font-medium mb-2">Secure by Design</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• API keys are encrypted and stored server-side</li>
                <li>• Frontend never has access to raw API keys</li>
                <li>• All API requests go through secure backend proxy</li>
                <li>• Preferences stored locally, sensitive data in secure storage</li>
              </ul>
            </div>
            
            {user && (
              <div className="pt-2">
                <p className="text-sm text-muted-foreground mb-3">
                  Signed in as: {user.email}
                </p>
                <Button variant="outline" onClick={handleSignOut} className="gap-2">
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">About</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Version</span>
              <span className="text-sm">1.0.0</span>
            </div>
            <Separator />
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                DailyFlow - Your Personal Life Organizer
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Built with security in mind
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
