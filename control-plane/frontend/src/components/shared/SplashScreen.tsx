import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const STEP_KEYS = [
  'loading.initCore',
  'loading.connectDb',
  'loading.loadData',
  'loading.syncNodes',
  'loading.ready',
] as const;

const STAGGER_DELAY = 0.4;

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: STAGGER_DELAY },
  },
};

const lineVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, ease: 'easeOut' },
  },
};

interface SplashScreenProps {
  onFinished: () => void;
}

export function SplashScreen({ onFinished }: SplashScreenProps) {
  const { t } = useTranslation('auth');
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Complete each step sequentially
    const timers: ReturnType<typeof setTimeout>[] = [];

    STEP_KEYS.forEach((_, index) => {
      const delay = (index + 1) * STAGGER_DELAY * 1000 + 300;
      timers.push(
        setTimeout(() => {
          setCompletedSteps((prev) => [...prev, index]);
        }, delay)
      );
    });

    // Start fade-out after all steps complete
    const totalTime = (STEP_KEYS.length + 1) * STAGGER_DELAY * 1000 + 400;
    timers.push(
      setTimeout(() => {
        setExiting(true);
      }, totalTime)
    );

    // Signal finished after fade-out animation
    timers.push(
      setTimeout(() => {
        sessionStorage.setItem('df-loaded', '1');
        onFinished();
      }, totalTime + 500)
    );

    return () => timers.forEach(clearTimeout);
  }, [onFinished]);

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />

          <div className="relative flex flex-col items-center gap-10">
            {/* Logo */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="flex flex-col items-center gap-3"
            >
              <div className="h-14 w-14 rounded-xl bg-primary flex items-center justify-center">
                <Database className="h-7 w-7 text-primary-foreground" />
              </div>
              <span className="text-3xl font-bold text-foreground">DataForge</span>
            </motion.div>

            {/* Status lines */}
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="flex flex-col gap-3 min-w-[320px]"
            >
              {STEP_KEYS.map((key, index) => {
                const isCompleted = completedSteps.includes(index);
                return (
                  <motion.div
                    key={key}
                    variants={lineVariants}
                    className="flex items-center gap-3 font-mono text-sm"
                  >
                    {isCompleted ? (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                      >
                        <Check className="h-4 w-4 text-green-500" />
                      </motion.span>
                    ) : (
                      <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                    )}
                    <span className={isCompleted ? 'text-green-500' : 'text-muted-foreground'}>
                      {t(key)}
                    </span>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
