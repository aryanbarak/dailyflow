import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mail, Lock, AlertTriangle, CheckCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { AppLoader } from "@/components/AppLoader";
import { SmartFlowIcon } from "@/components/SmartFlowLogo";
import { useT } from "@/i18n";

export default function AuthPage() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading, signIn, signUp } = useAuth();
  const { toast } = useToast();
  const { t } = useT();

  // DESIGN-AUDIT 3: schema built per render so zod messages follow the
  // active UI language (the module-level schema froze them in English).
  const authSchema = z.object({
    email: z.string().email(t("auth_validation_email")),
    password: z.string().min(6, t("auth_validation_password")),
  });

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && user) {
      navigate("/");
    }
  }, [user, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Validate input
    const validation = authSchema.safeParse({ email, password });
    if (!validation.success) {
      setError(validation.error.errors[0].message);
      return;
    }

    setIsSubmitting(true);

    try {
      if (isSignUp) {
        const { error } = await signUp(email, password);
        if (error) {
          setError(error.message);
        } else {
          setSuccess(t("auth_success_created"));
          toast({
            title: t("auth_toast_welcome"),
            description: t("auth_toast_signed_in"),
          });
          navigate("/");
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          setError(error.message);
        } else {
          navigate("/");
        }
      }
    } catch (err) {
      setError(t("auth_error_unexpected"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading) {
    return <AppLoader />;
  }

  return (
    <div className="min-h-screen auth-shell flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <Card className="border-border/50 shadow-card-lg overflow-hidden">
          <div className="auth-card-banner px-6 py-5 border-b border-border/60">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  SmartFlow
                </p>
                <h2 className="text-lg font-semibold font-display">
                  {t("auth_banner_tagline")}
                </h2>
              </div>
              <SmartFlowIcon size={40} />
            </div>
          </div>
          <CardHeader className="text-start space-y-2">
            <CardTitle className="text-2xl font-bold font-display">
              {isSignUp ? t("auth_create_account") : t("auth_welcome_back")}
            </CardTitle>
            <CardDescription>
              {isSignUp ? t("auth_signup_subtitle") : t("auth_signin_subtitle")}
            </CardDescription>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border/60 px-2 py-1">
                {t("auth_chip_plan")}
              </span>
              <span className="rounded-full border border-border/60 px-2 py-1">
                {t("auth_chip_money")}
              </span>
              <span className="rounded-full border border-border/60 px-2 py-1">
                {t("auth_chip_learn")}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {success && (
                <Alert className="border-success/50 bg-success/10 text-success">
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>{success}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <div className="relative">
                  <Mail className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder={t("auth_email_placeholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="ps-10"
                    disabled={isSubmitting}
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="relative">
                  <Lock className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder={t("auth_password_placeholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="ps-10"
                    disabled={isSubmitting}
                    autoComplete={isSignUp ? "new-password" : "current-password"}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {isSignUp ? t("auth_creating_account") : t("auth_signing_in")}
                  </>
                ) : isSignUp ? (
                  t("auth_create_account")
                ) : (
                  t("auth_sign_in")
                )}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(!isSignUp);
                    setError(null);
                    setSuccess(null);
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isSignUp ? t("auth_switch_to_signin") : t("auth_switch_to_signup")}
                </button>
              </div>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          {t("auth_terms")}
        </p>
      </motion.div>
    </div>
  );
}
