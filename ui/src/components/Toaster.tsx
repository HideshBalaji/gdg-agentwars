import { AnimatePresence, motion } from 'framer-motion';
import { CircleAlert, CircleCheck, Info, Sparkles, X } from 'lucide-react';
import { useStore } from '../lib/store';

const ICON = {
  ok: [CircleCheck, 'text-green'],
  bad: [CircleAlert, 'text-red'],
  info: [Info, 'text-fg-3'],
  learn: [Sparkles, 'text-violet'],
} as const;

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const [Icon, color] = ICON[t.tone];
          return (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface p-3 shadow-pop">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-fg">{t.title}</div>
                {t.body && <div className="mt-0.5 line-clamp-2 text-2xs text-fg-3">{t.body}</div>}
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => useStore.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))} className="text-fg-4 hover:text-fg">
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
