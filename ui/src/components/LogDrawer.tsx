import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useStore } from '../lib/store';
import { Activity } from './Activity';
import { Fleet, Memory } from './Panels';
import { Segmented } from './ui';

type Tab = 'log' | 'fleet' | 'memory';

/** Everything secondary lives here: the full agent conversation and tool trace, the fleet and memory. */
export function LogDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('log');
  const prefs = useStore((s) => s.preferences.length + s.workarounds.length);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-30 bg-black/30 lg:bg-black/10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-label="Agent log"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 42 }}
            className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[520px] flex-col border-l border-line bg-bg shadow-pop"
          >
            <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3">
              <Segmented
                size="sm"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'log', label: 'Agent log' },
                  { value: 'fleet', label: 'Fleet' },
                  { value: 'memory', label: 'Memory', count: prefs },
                ]}
              />
              <button type="button" onClick={onClose} aria-label="Close" className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'log' && <Activity className="h-full rounded-none border-0" />}
              {tab === 'fleet' && <Fleet />}
              {tab === 'memory' && <Memory />}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
