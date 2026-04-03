import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { fadeIn } from '@/lib/animations';

export function NotFoundPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={fadeIn.initial}
        animate={fadeIn.animate}
        transition={fadeIn.transition}
        className="text-center"
      >
        <h1 className="text-8xl font-bold text-primary mb-4">404</h1>
        <p className="text-xl text-foreground mb-2">{t('notFound.title')}</p>
        <p className="text-muted-foreground mb-8">{t('notFound.desc')}</p>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('notFound.goBack')}
          </Button>
          <Button onClick={() => navigate('/')}>
            <Home className="h-4 w-4 mr-2" />
            {t('notFound.home')}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
