import React from 'react';
import type { HypeSnapshot } from '../types/hypecut';
import { cn, getHypeColorClass } from '../lib/utils';

export function HypeMeter({
  snapshot,
  threshold,
  isDemo,
}: {
  snapshot: HypeSnapshot;
  threshold: number;
  isDemo: boolean;
}) {
  const radius = 74;
  const circumference = Math.PI * radius; // 180-deg semi-circle arc
  const clamped = Math.max(0, Math.min(100, snapshot.score));
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  const strokeColor =
    clamped >= 85
      ? '#EF4444'
      : clamped >= 70
        ? '#F59E0B'
        : clamped >= 50
          ? '#3B82F6'
          : '#64748B';

  // Calculate threshold marker angle on the semi-circle
  const thresholdAngleRad = Math.PI - (threshold / 100) * Math.PI;
  const markerX = 96 + radius * Math.cos(thresholdAngleRad);
  const markerY = 94 - radius * Math.sin(thresholdAngleRad);

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between border-b border-slate-800/80 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Live Hype Meter</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {isDemo ? 'Simulated chat input' : 'Real Twitch EventSub stream'}
            <span className="mx-1.5 text-slate-600">·</span>
            Threshold {threshold}/100
          </p>
        </div>
        <span className={cn('text-xs font-semibold tabular-nums', getHypeColorClass(clamped))}>
          {snapshot.level}
        </span>
      </div>

      {/* Semi-circular gauge */}
      <div className="relative mx-auto mt-4 flex w-full max-w-[216px] flex-col items-center">
        <svg viewBox="0 0 192 108" className="w-full overflow-visible" role="img" aria-label={`Hype score ${clamped} out of 100`}>
          {/* Track */}
          <path
            d="M 22 94 A 74 74 0 0 1 170 94"
            fill="none"
            stroke="#1E293B"
            strokeWidth="12"
            strokeLinecap="round"
          />
          {/* Active Arc */}
          <path
            d="M 22 94 A 74 74 0 0 1 170 94"
            fill="none"
            stroke={strokeColor}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{ transition: 'stroke-dashoffset 220ms cubic-bezier(0.16, 1, 0.3, 1), stroke 220ms ease' }}
          />
          {/* Threshold notch */}
          <circle cx={markerX} cy={markerY} r="3.5" fill="#F8FAFC" stroke="#090C12" strokeWidth="1.5" />
        </svg>

        <div className="-mt-11 flex flex-col items-center text-center">
          <div className="flex items-baseline gap-1 font-mono tabular-nums">
            <span className={cn('text-4xl font-bold tracking-tight', getHypeColorClass(clamped))}>
              {clamped}
            </span>
            <span className="text-sm text-slate-500">/ 100</span>
          </div>
          <span className="mt-1 text-xs text-slate-400">
            {snapshot.inCooldown
              ? `Trigger cooldown · ${snapshot.cooldownRemainingSec}s`
              : clamped >= threshold
                ? 'Above highlight trigger threshold'
                : 'Monitoring rolling chat window'}
          </span>
        </div>
      </div>

      {/* Structured metric table (clean hairline dividers, no nested cards) */}
      <div className="mt-5 divide-y divide-slate-800/70 border-t border-slate-800/80 text-xs">
        <div className="flex items-center justify-between py-2.5">
          <span className="text-slate-400">Messages per minute</span>
          <span className="font-mono font-medium text-slate-100 tabular-nums">
            {snapshot.messagesPerMinute.toLocaleString()} <span className="text-slate-500">({snapshot.messagesPerSecond}/s)</span>
          </span>
        </div>
        <div className="flex items-center justify-between py-2.5">
          <span className="text-slate-400">Chat velocity vs baseline</span>
          <span
            className={cn(
              'font-mono font-medium tabular-nums',
              snapshot.velocityPercent >= 100
                ? 'text-amber-400'
                : snapshot.velocityPercent >= 30
                  ? 'text-blue-400'
                  : 'text-slate-200'
            )}
          >
            {snapshot.velocityPercent >= 0 ? `+${snapshot.velocityPercent}%` : `${snapshot.velocityPercent}%`}
          </span>
        </div>
        <div className="flex items-center justify-between py-2.5">
          <span className="text-slate-400">Unique active users</span>
          <span className="font-mono font-medium text-slate-100 tabular-nums">
            {snapshot.uniqueUsers.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between py-2.5">
          <span className="text-slate-400">Emote activity</span>
          <span className="font-medium text-slate-200">{snapshot.emoteActivity}</span>
        </div>
        <div className="flex items-center justify-between py-2.5">
          <span className="text-slate-400">Repeated reactions</span>
          <span className="font-medium text-slate-200">{snapshot.repeatedReactions}</span>
        </div>
      </div>

      {snapshot.topReactions.length > 0 ? (
        <div className="mt-3 border-t border-slate-800/80 pt-3">
          <p className="text-xs text-slate-400">Top reactions in window</p>
          <p className="mt-1 font-mono text-xs text-slate-200 tabular-nums">
            {snapshot.topReactions.map((r) => `${r.token} (${r.count})`).join(' · ')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
