import React, { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  ReferenceLine,
  ReferenceArea,
  Brush,
} from 'recharts';
import { OHLCV, SupportResistanceLevel, OrderBlockLevel, OrderBlockVisibility } from '../types';

interface ChartProps {
  data: (OHLCV & { ema20?: number; ema50?: number })[];
  symbol: string;
  levels?: SupportResistanceLevel[];
  orderBlockLevels?: OrderBlockLevel[];
  theme: 'dark' | 'light';
  mode?: 'line' | 'candles';
  noDataLabel?: string;
  visibility?: OrderBlockVisibility;
}

const Chart: React.FC<ChartProps> = ({
  data,
  symbol,
  levels = [],
  orderBlockLevels = [],
  theme,
  mode = 'line',
  noDataLabel = 'NO DATA',
  visibility = { demand: true, supply: true, liquidity: true, highVolume: true },
}) => {
  if (!data || data.length === 0) return <div className="h-full flex items-center justify-center font-bold text-xs text-gray-400">{noDataLabel}</div>;

  const closes = data.map((d) => d.close);
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const span = Math.max(high - low, 1e-8);
  const yPadding = span * 0.08;
  const precision = span < 1 ? 6 : span < 10 ? 4 : 2;

  const colors = {
    grid: theme === 'dark' ? '#333' : '#e5e7eb',
    text: theme === 'dark' ? '#9ca3af' : '#374151',
    tooltipBg: theme === 'dark' ? '#1e1e1e' : '#ffffff',
    tooltipBorder: theme === 'dark' ? '#ffffff' : '#000000',
    tooltipText: theme === 'dark' ? '#ffffff' : '#000000',
    area: theme === 'dark' ? '#ccff00' : '#121212',
    support: theme === 'dark' ? '#22c55e' : '#16a34a',
    resistance: theme === 'dark' ? '#ef4444' : '#dc2626',
    demandFill: theme === 'dark' ? 'rgba(34, 197, 94, 0.16)' : 'rgba(22, 163, 74, 0.14)',
    supplyFill: theme === 'dark' ? 'rgba(239, 68, 68, 0.16)' : 'rgba(220, 38, 38, 0.12)',
    imbalanceFill: theme === 'dark' ? 'rgba(250, 204, 21, 0.15)' : 'rgba(202, 138, 4, 0.14)',
    hvn: theme === 'dark' ? '#38bdf8' : '#0284c7',
    liquidity: theme === 'dark' ? '#c084fc' : '#7e22ce',
    imbalance: theme === 'dark' ? '#facc15' : '#ca8a04',
  };

  const orderBlockLegend = useMemo(
    () => [
      { label: 'Demand zone', color: colors.support },
      { label: 'Supply zone', color: colors.resistance },
      { label: 'High-volume node', color: colors.hvn },
      { label: 'Liquidity cluster', color: colors.liquidity },
      { label: 'Imbalance', color: colors.imbalance },
    ],
    [colors.hvn, colors.imbalance, colors.liquidity, colors.resistance, colors.support],
  );

  const latestClose = data[data.length - 1]?.close ?? 0;

  const isVisibleType = (type: OrderBlockLevel['type']) => {
    if (type === 'demand') return visibility.demand;
    if (type === 'supply') return visibility.supply;
    if (type === 'liquidity') return visibility.liquidity;
    if (type === 'highVolume') return visibility.highVolume;
    return true;
  };

  return (
    <div className="w-full h-full min-h-[320px] relative">
      <div className="absolute top-4 left-4 z-10 pointer-events-none space-y-2">
        <div className="flex flex-wrap gap-3 text-[10px] font-bold uppercase tracking-wider bg-black/50 dark:bg-white/10 backdrop-blur px-2 py-1 rounded border border-white/20 max-w-[90vw]">
          <span className="text-cyan-400">EMA 20</span>
          <span className="text-yellow-400">EMA 50</span>
          <span className="text-gray-200">{symbol}</span>
        </div>
        <div className="flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-wide bg-black/40 dark:bg-white/10 backdrop-blur px-2 py-1 rounded border border-white/20 max-w-[90vw]">
          {orderBlockLegend
            .filter((item) => {
              if (item.label === 'Demand zone') return visibility.demand;
              if (item.label === 'Supply zone') return visibility.supply;
              if (item.label === 'High-volume node') return visibility.highVolume;
              if (item.label === 'Liquidity cluster') return visibility.liquidity;
              return true;
            })
            .map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1 text-gray-100 dark:text-gray-200">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
            ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height="100%" minHeight={320}>
        <ComposedChart data={data} margin={{ top: 14, right: 20, left: 2, bottom: 24 }}>
          <defs>
            <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={colors.area} stopOpacity={0.2} />
              <stop offset="95%" stopColor={colors.area} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} horizontal />

          <XAxis dataKey="time" hide />
          <YAxis
            domain={[low - yPadding, high + yPadding]}
            stroke={colors.text}
            tick={{ fontSize: 10, fill: colors.text, fontWeight: 700, fontFamily: 'monospace' }}
            tickFormatter={(v) => Number(v).toFixed(precision)}
            width={72}
            axisLine={false}
            tickLine={false}
            allowDataOverflow
          />

          <Tooltip
            contentStyle={{
              backgroundColor: colors.tooltipBg,
              borderColor: colors.tooltipBorder,
              borderWidth: '2px',
              color: colors.tooltipText,
              fontSize: '12px',
              fontWeight: 'bold',
              padding: '8px 12px',
              boxShadow: '4px 4px 0px 0px rgba(0,0,0,0.2)',
            }}
            formatter={(value: number, name: string) => [Number(value).toFixed(precision), name.toUpperCase()]}
            itemStyle={{ padding: 0 }}
            labelStyle={{ color: colors.text, marginBottom: '4px', fontSize: '10px', textTransform: 'uppercase' }}
            labelFormatter={(label) => new Date(label).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            cursor={{ stroke: colors.text, strokeWidth: 1, strokeDasharray: '4 4' }}
          />

          {orderBlockLevels
            .filter((level) => !!level.zone && (level.type === 'demand' || level.type === 'supply' || level.type === 'imbalance'))
            .filter((level) => isVisibleType(level.type))
            .map((level, i) => (
              <ReferenceArea
                key={`ob-zone-${level.type}-${i}`}
                y1={level.zone!.low}
                y2={level.zone!.high}
                stroke="none"
                fill={
                  level.type === 'demand'
                    ? colors.demandFill
                    : level.type === 'supply'
                      ? colors.supplyFill
                      : colors.imbalanceFill
                }
                ifOverflow="extendDomain"
              />
            ))}

          {levels.map((level, i) => (
            <ReferenceLine
              key={`sr-${i}`}
              y={level.price}
              stroke={level.type === 'support' ? colors.support : colors.resistance}
              strokeDasharray="4 2"
              strokeWidth={2}
              strokeOpacity={0.65}
              label={{ value: `${level.type.toUpperCase()} • ${level.price.toFixed(precision)}`, position: 'insideRight', fontSize: 9, fill: colors.text }}
            />
          ))}

          {orderBlockLevels
            .filter((l) => !l.zone || (l.type !== 'demand' && l.type !== 'supply' && l.type !== 'imbalance'))
            .filter((level) => isVisibleType(level.type))
            .map((level, i) => {
              const mapStyle = {
                highVolume: { color: colors.hvn, dash: '2 2' },
                liquidity: { color: colors.liquidity, dash: '1 3' },
                imbalance: { color: colors.imbalance, dash: '6 3' },
                demand: { color: colors.support, dash: '5 3' },
                supply: { color: colors.resistance, dash: '5 3' },
              } as const;
              const style = mapStyle[level.type];
              const distance = Math.abs(level.price - latestClose) / Math.max(latestClose, 1e-8);
              const strokeWidth = distance < 0.008 ? 2.4 : 1.8;
              return (
                <ReferenceLine
                  key={`ob-line-${level.type}-${i}`}
                  y={level.price}
                  stroke={style.color}
                  strokeDasharray={style.dash}
                  strokeWidth={strokeWidth}
                  strokeOpacity={0.95}
                  label={{
                    value: `${level.label} • ${level.price.toFixed(precision)}`,
                    position: 'insideLeft',
                    fontSize: 9,
                    fill: style.color,
                    fontWeight: 700,
                  }}
                  ifOverflow="extendDomain"
                />
              );
            })}

          {mode === 'line' ? (
            <Area
              type="monotone"
              dataKey="close"
              stroke={colors.area}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorClose)"
              isAnimationActive={false}
            />
          ) : (
            data.map((candle, idx) => {
              const isBull = candle.close >= candle.open;
              const bodyTop = Math.max(candle.open, candle.close);
              const bodyBottom = Math.min(candle.open, candle.close);
              return (
                <React.Fragment key={`candle-${idx}-${candle.time}`}>
                  <ReferenceLine
                    segment={[{ x: candle.time, y: candle.low }, { x: candle.time, y: candle.high }]}
                    stroke={isBull ? '#22c55e' : '#ef4444'}
                    strokeWidth={1.5}
                    ifOverflow="extendDomain"
                  />
                  <ReferenceLine
                    segment={[{ x: candle.time, y: bodyBottom }, { x: candle.time, y: bodyTop }]}
                    stroke={isBull ? '#16a34a' : '#dc2626'}
                    strokeWidth={6}
                    ifOverflow="extendDomain"
                  />
                </React.Fragment>
              );
            })
          )}

          <Line type="monotone" dataKey="ema20" name="EMA20" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="monotone" dataKey="ema50" name="EMA50" stroke="#facc15" dot={false} strokeWidth={2} isAnimationActive={false} />

          <Brush
            dataKey="time"
            height={22}
            stroke={theme === 'dark' ? '#d1d5db' : '#4b5563'}
            travellerWidth={10}
            fill={theme === 'dark' ? '#111827' : '#e5e7eb'}
            tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default Chart;
