import { motion } from 'framer-motion';
import { pageTransition } from '@/lib/animations';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface PageWrapperProps {
  children: ReactNode;
  className?: string;
}

export function PageWrapper({ children, className }: PageWrapperProps) {
  return (
    <motion.div
      initial={pageTransition.initial}
      animate={pageTransition.animate}
      exit={pageTransition.exit}
      transition={pageTransition.transition}
      className={cn('flex-1 p-4 md:p-6', className)}
    >
      {children}
    </motion.div>
  );
}
