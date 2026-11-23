import React, { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, Trash2 } from 'lucide-react';
import { TerminalLogEntry } from '../types/backup';

interface TerminalConsoleProps {
  logs: TerminalLogEntry[];
  hostname: string;
  onExecuteCommand: (command: string) => Promise<void> | void;
  onClear: () => void;
  compact?: boolean;
}

const LEVEL_STYLES: Record<TerminalLogEntry['level'], { tag: string; text: string }> = {
  info: { tag: 'text-[#8B949E]', text: 'text-[#C9D1D9]' },
  success: { tag: 'text-emerald-400', text: 'text-emerald-200' },
  warn: { tag: 'text-amber-400', text: 'text-amber-200' },
  error: { tag: 'text-red-400', text: 'text-red-200' },
  cmd: { tag: 'text-emerald-400', text: 'text-[#E6EDF3] font-medium' },
  crypto: { tag: 'text-sky-400', text: 'text-[#C9D1D9]' },
  cloud: { tag: 'text-emerald-300', text: 'text-[#C9D1D9]' },
};

const LEVEL_LABELS: Record<TerminalLogEntry['level'], string> = {
  info: 'INFO',
  success: 'OK  ',
  warn: 'WARN',
  error: 'ERR ',
  cmd: 'EXEC',
  crypto: 'ENC ',
  cloud: 'SYNC',
};

export const TerminalConsole: React.FC<TerminalConsoleProps> = ({
  logs,
  hostname,
  onExecuteCommand,
  onClear,
  compact = false,
}) => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setHistory((prev) => [trimmed, ...prev.slice(0, 29)]);
    setHistoryIdx(-1);
    setInput('');
    await onExecuteCommand(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(nextIdx);
      setInput(history[nextIdx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx <= 0) {
        setHistoryIdx(-1);
        setInput('');
      } else {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInput(history[nextIdx]);
      }
    }
  };

  return (
    <section
      aria-label="Live Backup Terminal"
      className="flex flex-col overflow-hidden rounded-lg border border-[#222933] bg-[#090C0F]"
    >
      <div className="flex items-center justify-between gap-4 border-b border-[#1E242D] bg-[#10141A] px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <TerminalIcon className="h-4 w-4 shrink-0 text-emerald-400" />
          <span className="truncate font-mono text-xs font-medium text-[#E6EDF3]">
            ops@{hostname}:/var/lib/termvault
          </span>
          <span className="hidden sm:inline font-mono text-xs text-[#6E7681]">
            · tty0 · {logs.length} lines
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden md:flex items-center gap-2 font-mono text-xs text-[#6E7681]">
            <button
              type="button"
              onClick={() => onExecuteCommand('diff')}
              className="transition-colors hover:text-emerald-400 whitespace-nowrap"
            >
              diff
            </button>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              onClick={() => onExecuteCommand('backup')}
              className="transition-colors hover:text-emerald-400 whitespace-nowrap"
            >
              backup
            </button>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              onClick={() => onExecuteCommand('verify')}
              className="transition-colors hover:text-emerald-400 whitespace-nowrap"
            >
              verify
            </button>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              onClick={() => onExecuteCommand('help')}
              className="transition-colors hover:text-emerald-400 whitespace-nowrap"
            >
              help
            </button>
          </div>
          <button
            type="button"
            onClick={onClear}
            title="Clear terminal output"
            aria-label="Clear terminal output"
            className="rounded p-1 text-[#6E7681] transition-colors hover:bg-[#1C222B] hover:text-[#E6EDF3] focus-visible:outline-2 focus-visible:outline-emerald-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onClick={() => inputRef.current?.focus()}
        className={`terminal-scanlines cursor-text overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed ${
          compact ? 'h-56' : 'h-72'
        }`}
      >
        {logs.length === 0 ? (
          <div className="text-[#6E7681]">
            Terminal buffer cleared. Type <span className="text-emerald-400">help</span> for available commands.
          </div>
        ) : (
          <div className="space-y-1">
            {logs.map((entry) => {
              const style = LEVEL_STYLES[entry.level];
              return (
                <div key={entry.id} className="flex items-start gap-2.5 break-words">
                  <span className="shrink-0 select-none text-[#586270] tabular-nums">
                    {entry.timestamp}
                  </span>
                  <span className={`shrink-0 select-none font-medium ${style.tag}`}>
                    [{LEVEL_LABELS[entry.level]}]
                  </span>
                  <span className={`min-w-0 flex-1 whitespace-pre-wrap ${style.text}`}>
                    {entry.message}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-[#1E242D] bg-[#0C1015] px-4 py-2.5 font-mono text-xs"
      >
        <span className="shrink-0 select-none text-emerald-400">
          ops@{hostname}:~$
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type command (help, status, diff, backup, sync, verify, ls)..."
          aria-label="Terminal command input"
          className="min-w-0 flex-1 bg-transparent text-[#E6EDF3] placeholder-[#586270] focus:outline-none"
        />
        <span
          aria-hidden="true"
          className="terminal-cursor h-3.5 w-1.5 shrink-0 bg-emerald-400"
        />
      </form>
    </section>
  );
};
