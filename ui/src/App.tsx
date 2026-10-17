import { useCallback, useEffect, useState } from 'react';
import { useStore } from './lib/store';
import { CARRIER_SYSTEMS } from './lib/meta';
import { applyTheme, runComparable, startBreakdown, toggleCarrier } from './lib/actions';
import { CommandMenu, TopBar } from './components/TopBar';
import { IncidentView, StartScreen } from './components/Story';
import { LogDrawer } from './components/LogDrawer';
import { Toaster } from './components/Toaster';

export default function App() {
  const [menu, setMenu] = useState(false);
  const [log, setLog] = useState(false);
  const [seen, setSeen] = useState(0);
  const incident = useStore((s) => !!s.incident);
  const feedLength = useStore((s) => s.feed.length);

  const openLog = useCallback(() => setLog(true), []);
  const closeLog = useCallback(() => setLog(false), []);
  // Unread = timeline items added since the drawer was last open.
  useEffect(() => {
    if (log || feedLength < seen) setSeen(feedLength);
  }, [log, feedLength, seen]);

  useEffect(() => {
    applyTheme();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMenu((m) => !m);
        return;
      }
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest('input, textarea, [contenteditable="true"], [aria-label="Command menu"]')) return;
      const key = e.key.toLowerCase();
      if (key === '1') startBreakdown();
      if (key === 'k') toggleCarrier(useStore.getState().chaos?.system ?? CARRIER_SYSTEMS[0]);
      if (key === 'l') setLog((o) => !o);
      if (key === 'c' && useStore.getState().preferences.some((p) => p.status === 'active')) runComparable();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg text-fg">
      <TopBar onCommand={() => setMenu(true)} onLog={openLog} unread={log ? 0 : Math.max(0, feedLength - seen)} />
      <main className="min-h-0 flex-1 overflow-y-auto">{incident ? <IncidentView onLog={openLog} /> : <StartScreen />}</main>
      <LogDrawer open={log} onClose={closeLog} />
      <CommandMenu open={menu} onClose={() => setMenu(false)} onLog={openLog} />
      <Toaster />
    </div>
  );
}
