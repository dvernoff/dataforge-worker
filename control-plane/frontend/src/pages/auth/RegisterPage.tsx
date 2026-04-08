import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Database, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Progress } from '@/components/ui/progress';
import { fadeIn, buttonTap } from '@/lib/animations';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/auth.store';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/api/client';

function getPasswordStrength(password: string): { score: number; color: string } {
  let score = 0;
  if (password.length >= 6) score += 20;
  if (password.length >= 10) score += 20;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 20;
  if (/\d/.test(password)) score += 20;
  if (/[^a-zA-Z0-9]/.test(password)) score += 20;

  if (score <= 20) return { score, color: 'bg-destructive' };
  if (score <= 40) return { score, color: 'bg-orange-500' };
  if (score <= 60) return { score, color: 'bg-yellow-500' };
  if (score <= 80) return { score, color: 'bg-blue-500' };
  return { score, color: 'bg-green-500' };
}

export function RegisterPage() {
  const { t } = useTranslation('auth');
  usePageTitle(t('register.title'));
  const [showPassword, setShowPassword] = useState(false);
  const [skipInvite, setSkipInvite] = useState(false);
  const { register, isRegistering } = useAuth();
  const { isAuthenticated } = useAuthStore();

  // Fetch public registration settings
  const { data: regSettings } = useQuery({
    queryKey: ['registration-settings-public'],
    queryFn: () => api.get<{ settings: Record<string, string> }>('/system/settings/public'),
    staleTime: 60_000,
  });

  const requireInvite = regSettings?.settings?.require_invite !== 'false';
  const inviteRequired = requireInvite && !skipInvite;

  const registerSchema = z.object({
    name: z.string().min(1, t('register.validation.nameRequired')).max(255),
    email: z.string().email(t('register.validation.invalidEmail')),
    password: z.string().min(6, t('register.validation.passwordMin')),
    confirmPassword: z.string(),
    inviteKey: inviteRequired
      ? z.string().min(1, t('register.validation.inviteRequired'))
      : z.string().optional(),
  }).refine((data) => data.password === data.confirmPassword, {
    message: t('register.validation.passwordMatch'),
    path: ['confirmPassword'],
  });

  type RegisterForm = z.infer<typeof registerSchema>;

  const form = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '', inviteKey: '' },
  });

  const password = form.watch('password');
  const strength = useMemo(() => getPasswordStrength(password ?? ''), [password]);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = (data: RegisterForm) => {
    register({
      name: data.name,
      email: data.email,
      password: data.password,
      inviteKey: data.inviteKey,
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <motion.div
        initial={fadeIn.initial}
        animate={fadeIn.animate}
        transition={fadeIn.transition}
        className="relative w-full max-w-md"
      >
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <Database className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-2xl font-bold">DataForge</span>
          </div>
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle>{t('register.subtitle')}</CardTitle>
            <CardDescription>{t('register.subtitleDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('register.name')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('register.namePlaceholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('register.email')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('register.emailPlaceholder')} type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('register.password')}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            placeholder={t('register.passwordPlaceholder')}
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      {password && (
                        <Progress
                          value={strength.score}
                          className={`h-1 mt-1 ${strength.color}`}
                        />
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('register.confirmPassword')}</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder={t('register.confirmPasswordPlaceholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="inviteKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('register.inviteKey')}
                        {!inviteRequired && <span className="text-muted-foreground ml-1 text-xs">({t('register.optional')})</span>}
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input className="pl-10" placeholder={t('register.inviteKeyPlaceholder')} {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!requireInvite && !skipInvite && (
                  <button
                    type="button"
                    onClick={() => setSkipInvite(true)}
                    className="text-sm text-primary hover:underline"
                  >
                    {t('register.noInviteCode')}
                  </button>
                )}

                {skipInvite && (
                  <p className="text-sm text-muted-foreground">
                    {t('register.noInviteCodeDesc')}
                  </p>
                )}

                <motion.div {...buttonTap}>
                  <Button type="submit" className="w-full" disabled={isRegistering}>
                    {isRegistering ? t('register.submitting') : t('register.submit')}
                  </Button>
                </motion.div>
              </form>
            </Form>

            <p className="text-center text-sm text-muted-foreground mt-4">
              {t('register.hasAccount')}{' '}
              <Link to="/login" className="text-primary hover:underline">
                {t('register.login')}
              </Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
