import React, { useMemo } from 'react';
import { OHLCV, OrderBlockLevel } from '../types';

interface OrderBlockHeatmapProps {
  data: OHLCV[];
  orderBlockLevels?: OrderBlockLevel[];
  theme: 'dark' | 'light';
  noDataLabel?: string;
}

type HeatmapBand = {
  price: number;
  side: 'LONG' | 'SHORT';
  intensity: number;
  widthPct: number;
  strength: number;
  label: string;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const OrderBlockHeatmap: React.FC<OrderBlockHeatmapProps> = ({
  data,
  orderBlockLevels = [],
  theme,
  noDataLabel = 'NO DATA',
}) => {
  const levels = useMemo(() => {
    if (!data.length) return null;

    const priceLow = Math.min(...data.map((d) => d.low));
    const priceHigh = Math.max(...data.map((d) => d.high));
    const span = Math.max(priceHigh - priceLow, 1e-8);

    const source = orderBlockLevels.filter((level) =>
      ['demand', 'supply', 'liquidity', 'highVolume'].includes(level.type),
    );

    if (!source.length) return null;

    const mapped = source.map((level) => {
      const side: HeatmapBand['side'] = level.type === 'supply' ? 'SHORT' : 'LONG';
      const price = level.zone ? (level.zone.low + level.zone.high) / 2 : level.price;
      const zoneSize = level.zone ? level.zone.high - level.zone.low : span * 0.012;
      const edgeBias = Math.abs((price - (priceLow + span / 2)) / (span / 2));
      const base = Math.max(level.strength, 0.5);
      const typeBoost = level.type === 'highVolume' ? 1.25 : level.type === 'liquidity' ? 1.15 : 1;
      const intensityRaw = base * typeBoost * (1 + zoneSize / span) * (1 + clamp(edgeBias, 0, 1) * 0.65);

      return { side, price, strength: level.strength, intensityRaw, label: level.label };
    });

    const maxIntensity = Math.max(...mapped.map((m) => m.intensityRaw), 1e-8);

    const bands: HeatmapBand[] = mapped
      .map((m) => ({
        price: m.price,
        side: m.side,
        strength: m.strength,
        label: m.label,
        intensity: clamp(m.intensityRaw / maxIntensity, 0.08, 1),
        widthPct: clamp(28 + (m.intensityRaw / maxIntensity) * 68, 28, 96),
      }))
      .sort((a, b) => b.price - a.price);

    return {
      priceLow,
      priceHigh,
      span,
      bands,
    };
  }, [data, orderBlockLevels]);

  if (!levels || levels.bands.length === 0) {
    return <div className="h-full flex items-center justify-center font-bold text-xs text-gray-400">{noDataLabel}</div>;
  }

  const { priceLow, priceHigh, span, bands } = levels;
  const precision = span < 1 ? 6 : span < 10 ? 4 : 2;
  const axisTicks = Array.from({ length: 6 }).map((_, index) => {
    const ratio = index / 5;
    return priceHigh - ratio * span;
  });

  return (
    <div className="h-full w-full bg-[#020617] border-t border-white/10 text-gray-100">
      <div className="px-3 pt-2 pb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-gray-400">
        <span>Order Block Liquidity Map</span>
        <span>Red = Short • Green = Long</span>
      </div>
      <div className="h-[calc(100%-28px)] px-3 pb-3">
        <div className="h-full rounded-md border border-white/15 bg-[#050c1a] grid grid-cols-[1fr_68px] overflow-hidden">
          <div className="relative">
            <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(148,163,184,0.10)_1px,transparent_1px)] bg-[length:100%_14.285%]" />
            {bands.map((band, index) => {
              const yPct = clamp(((priceHigh - band.price) / span) * 100, 0, 100);
              const alpha = clamp(0.22 + band.intensity * 0.72, 0.22, 0.94);
              const glow = band.side === 'SHORT' ? `rgba(248,113,113,${alpha})` : `rgba(74,222,128,${alpha})`;
              const core = band.side === 'SHORT' ? `rgba(220,38,38,${alpha})` : `rgba(22,163,74,${alpha})`;

              return (
                <div
                  key={`${band.price}-${band.side}-${index}`}
                  className="absolute left-1/2 -translate-x-1/2 h-3 rounded-sm"
                  style={{
                    top: `calc(${yPct}% - 6px)`,
                    width: `${band.widthPct}%`,
                    background: `linear-gradient(90deg, transparent 0%, ${glow} 16%, ${core} 50%, ${glow} 84%, transparent 100%)`,
                    boxShadow: `0 0 14px ${glow}`,
                  }}
                  title={`${band.side} • ${band.label} • ${band.price.toFixed(precision)} • intensity ${(band.intensity * 100).toFixed(0)}%`}
                />
              );
            })}
          </div>

          <div className="relative border-l border-white/10 bg-[#020617]/80">
            {axisTicks.map((tick) => {
              const yPct = clamp(((priceHigh - tick) / span) * 100, 0, 100);
              return (
                <div
                  key={tick}
                  className="absolute right-2 text-[10px] font-semibold text-gray-300"
                  style={{ top: `calc(${yPct}% - 7px)` }}
                >
                  {tick.toFixed(precision)}
                </div>
              );
            })}
            <div className="absolute bottom-2 right-2 text-[9px] uppercase tracking-[0.12em] text-gray-500">
              Price Axis
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderBlockHeatmap;
