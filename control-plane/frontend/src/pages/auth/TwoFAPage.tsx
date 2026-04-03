import { useState } from 'react';
import { useLocation, Navigate, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Database, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { fadeIn, buttonTap } from '@/lib/animations';
import { useAuthStore } from '@/stores/auth.store';
import { usePageTitle } from '@/hooks/usePageTitle';
import { authApi } from '@/api/auth.api';
import { toast } from 'sonner';

export function TwoFAPage() {
  const { t } = useTranslation('auth');
  usePageTitle(t('twofa.title'));
  const location = useLocation();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);

  const tempToken = (location.state as { temp_token?: string })?.temp_token;

  const verifyMutation = useMutation({
    mutationFn: () => authApi.twoFAVerify(code, tempToken!),
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken);
      toast.success('Logged in successfully');
      navigate('/');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const backupMutation = useMutation({
    mutationFn: () => authApi.twoFABackupVerify(code, tempToken!),
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken);
      toast.success('Logged in successfully');
      navigate('/');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  if (!tempToken) {
    return <Navigate to="/login" replace />;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (useBackup) {
      backupMutation.mutate();
    } else {
      verifyMutation.mutate();
    }
  };

  const isPending = verifyMutation.isPending || backupMutation.isPending;

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
            <div className="flex justify-center mb-2">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>{t('twofa.title')}</CardTitle>
            <CardDescription>
              {useBackup
                ? t('twofa.enterBackupCode', 'Enter a backup code')
                : t('twofa.enterCode')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">
                  {useBackup ? t('twofa.backupCode', 'Backup code') : t('twofa.code', 'Code')}
                </Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={useBackup ? 'XXXXXXXX' : '000000'}
                  maxLength={useBackup ? 8 : 6}
                  className="text-center text-lg tracking-widest"
                  autoFocus
                />
              </div>

              <motion.div {...buttonTap}>
                <Button type="submit" className="w-full" disabled={isPending || !code}>
                  {isPending ? '...' : t('twofa.verify')}
                </Button>
              </motion.div>
            </form>

            <div className="text-center mt-4">
              <button
                type="button"
                onClick={() => {
                  setUseBackup(!useBackup);
                  setCode('');
                }}
                className="text-sm text-primary hover:underline"
              >
                {useBackup
                  ? t('twofa.useAuthenticator', 'Use authenticator app')
                  : t('twofa.useBackup')}
              </button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
