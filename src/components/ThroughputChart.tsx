import React from 'react';
import { StoredSnapshot } from '../types/backup';
import { formatBytes } from '../services/cryptoEngine';

interface ThroughputChartProps {
  snapshots: StoredSnapshot[];
}

export const ThroughputChart: React.FC<ThroughputChartProps> = ({ snapshots }) => {
  const ordered = [...snapshots].slice(0, 10).reverse();

  if (ordered.length === 0) {
    return (
      <div className="flex h-56 flex-col items-center justify-center rounded-md border border-dashed border-[#222933] bg-[#0B0E11] px-4 text-center">
        <p className="text-sm font-medium text-[#C9D1D9]">No snapshot metrics recorded yet</p>
        <p className="mt-1 max-w-sm text-xs text-[#8B949E]">
          Run your first backup to inspect raw dataset volume against encrypted incremental delta storage.
        </p>
      </div>
    );
  }

  const maxBytes = Math.max(
    ...ordered.map((s) => Math.max(s.totalRawBytes, s.storedEncryptedBytes)),
    1024
  );

  const width = 640;
  const height = 210;
  const padLeft = 58;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const slotW = plotW / Math.max(ordered.length, 1);
  const barW = Math.min(22, Math.max(8, slotW * 0.28));

  const yTicks = [0, 0.5, 1];

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#8B949E]">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs bg-[#2B3645]" />
            <span>Logical dataset</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs bg-emerald-400" />
            <span>Encrypted delta written</span>
          </span>
        </div>
        <span className="font-mono tabular-nums text-[#8B949E]">
          Last {ordered.length} snapshot{ordered.length === 1 ? '' : 's'}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-52 w-full"
        role="img"
        aria-label="Bar chart comparing logical backup size with encrypted delta written per snapshot"
      >
        {yTicks.map((ratio) => {
          const y = padTop + plotH * (1 - ratio);
          const labelVal = formatBytes(Math.round(maxBytes * ratio));
          return (
            <g key={ratio}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#1E242D"
                strokeDasharray={ratio === 0 ? undefined : '3 3'}
                strokeWidth="1"
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                fill="#6E7681"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {labelVal}
              </text>
            </g>
          );
        })}

        {ordered.map((snap, idx) => {
          const cx = padLeft + slotW * idx + slotW / 2;
          const rawH = Math.max(2, (snap.totalRawBytes / maxBytes) * plotH);
          const storedH = Math.max(2, (snap.storedEncryptedBytes / maxBytes) * plotH);
          const shortLabel = snap.id.slice(-4);

          return (
            <g key={snap.id}>
              <rect
                x={cx - barW - 2}
                y={padTop + plotH - rawH}
                width={barW}
                height={rawH}
                rx="2"
                fill="#2B3645"
              >
                <title>
                  {snap.id} ({snap.mode}) — Logical: {formatBytes(snap.totalRawBytes)}
                </title>
              </rect>
              <rect
                x={cx + 2}
                y={padTop + plotH - storedH}
                width={barW}
                height={storedH}
                rx="2"
                fill="#34D399"
              >
                <title>
                  {snap.id} ({snap.mode}) — Encrypted Written: {formatBytes(snap.storedEncryptedBytes)} ({snap.dedupRatioPercent}% deduplicated)
                </title>
              </rect>
              <text
                x={cx}
                y={height - 14}
                textAnchor="middle"
                fill="#8B949E"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {shortLabel}
              </text>
              <text
                x={cx}
                y={height - 3}
                textAnchor="middle"
                fill="#586270"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
              >
                {snap.mode === 'incremental' ? 'inc' : 'full'}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
