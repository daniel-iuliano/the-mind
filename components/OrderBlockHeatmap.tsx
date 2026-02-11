import React, { useMemo } from 'react';
import { ResponsiveContainer, ScatterChart, XAxis, YAxis, CartesianGrid, ZAxis, Scatter, Tooltip, Cell } from 'recharts';
import { OHLCV, OrderBlockLevel } from '../types';

interface OrderBlockHeatmapProps {
  data: OHLCV[];
  orderBlockLevels?: OrderBlockLevel[];
  theme: 'dark' | 'light';
  noDataLabel?: string;
}

type HeatmapPoint = {
  x: number;
  y: number;
  z: number;
  intensity: number;
  side: 'LONG' | 'SHORT';
  priceLevel: number;
  volumeProxy: number;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const OrderBlockHeatmap: React.FC<OrderBlockHeatmapProps> = ({
  data,
  orderBlockLevels = [],
  theme,
  noDataLabel = 'NO DATA',
}) => {
  const heatmapData = useMemo<HeatmapPoint[]>(() => {
    if (!data.length) return [];

    const priceLow = Math.min(...data.map((d) => d.low));
    const priceHigh = Math.max(...data.map((d) => d.high));
    const priceSpan = Math.max(priceHigh - priceLow, 1e-8);

    const blockData = orderBlockLevels
      .filter((level) => level.type === 'demand' || level.type === 'supply' || level.type === 'liquidity' || level.type === 'highVolume')
      .map((level) => {
        const side: HeatmapPoint['side'] = level.type === 'supply' ? 'SHORT' : 'LONG';
        const zoneMid = level.zone ? (level.zone.low + level.zone.high) / 2 : level.price;
        const zoneSize = level.zone ? Math.max(level.zone.high - level.zone.low, 1e-8) : priceSpan * 0.01;
        const normalizedPosition = clamp((zoneMid - priceLow) / priceSpan, 0, 1);
        const edgeBias = Math.abs(normalizedPosition - 0.5) * 2;

        const volumeProxy = Math.max(level.strength, 1);
        const imbalanceBoost = level.type === 'liquidity' ? 1.15 : level.type === 'highVolume' ? 1.25 : 1;
        const rawIntensity = volumeProxy * imbalanceBoost * (1 + edgeBias * 0.75) * (1 + zoneSize / priceSpan);

        return {
          x: normalizedPosition,
          y: zoneMid,
          z: rawIntensity,
          intensity: rawIntensity,
          side,
          priceLevel: zoneMid,
          volumeProxy,
        };
      });

    if (!blockData.length) return [];

    const maxIntensity = Math.max(...blockData.map((d) => d.intensity), 1e-8);

    return blockData.map((point) => ({
      ...point,
      z: clamp(30 + (point.intensity / maxIntensity) * 250, 30, 280),
      intensity: clamp(point.intensity / maxIntensity, 0.05, 1),
    }));
  }, [data, orderBlockLevels]);

  if (!data?.length || heatmapData.length === 0) {
    return <div className="h-full flex items-center justify-center font-bold text-xs text-gray-400">{noDataLabel}</div>;
  }

  const priceLow = Math.min(...data.map((d) => d.low));
  const priceHigh = Math.max(...data.map((d) => d.high));
  const priceSpan = Math.max(priceHigh - priceLow, 1e-8);
  const precision = priceSpan < 1 ? 6 : priceSpan < 10 ? 4 : 2;

  const axisColor = theme === 'dark' ? '#9ca3af' : '#374151';
  const gridColor = theme === 'dark' ? '#334155' : '#e5e7eb';
  const tooltipBg = theme === 'dark' ? '#111827' : '#ffffff';
  const tooltipText = theme === 'dark' ? '#f8fafc' : '#0f172a';

  const colorForPoint = (point: HeatmapPoint) => {
    const alpha = clamp(0.2 + point.intensity * 0.8, 0.2, 1);
    return point.side === 'SHORT' ? `rgba(239, 68, 68, ${alpha})` : `rgba(34, 197, 94, ${alpha})`;
  };

  return (
    <div className="w-full h-full min-h-[280px] relative">
      <div className="absolute top-3 left-3 z-10 text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded border border-white/20 bg-black/40 dark:bg-white/10 text-gray-100 dark:text-gray-200">
        Liquidity Heatmap • Red = Short Liquidity • Green = Long Liquidity
      </div>
      <ResponsiveContainer width="100%" height="100%" minHeight={280}>
        <ScatterChart margin={{ top: 28, right: 18, left: 2, bottom: 14 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, 1]}
            tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
            tick={{ fill: axisColor, fontSize: 10, fontWeight: 700 }}
            stroke={axisColor}
            label={{ value: 'Relative Price Position', position: 'insideBottom', dy: 10, fill: axisColor, fontSize: 10 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[priceLow * 0.995, priceHigh * 1.005]}
            tickFormatter={(v) => Number(v).toFixed(precision)}
            tick={{ fill: axisColor, fontSize: 10, fontWeight: 700 }}
            stroke={axisColor}
            width={70}
            label={{ value: 'Price', angle: -90, position: 'insideLeft', fill: axisColor, fontSize: 10 }}
          />
          <ZAxis type="number" dataKey="z" range={[60, 360]} />
          <Tooltip
            cursor={{ strokeDasharray: '4 4', stroke: axisColor }}
            contentStyle={{
              backgroundColor: tooltipBg,
              color: tooltipText,
              border: '2px solid #94a3b8',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
            }}
            formatter={(_, __, payload) => {
              const row = payload?.payload as HeatmapPoint;
              return [
                `Intensity ${(row.intensity * 100).toFixed(0)}% • Volume x${row.volumeProxy.toFixed(2)}`,
                row.side === 'SHORT' ? 'Short liquidity zone' : 'Long liquidity zone',
              ];
            }}
            labelFormatter={(label) => `Position ${(Number(label) * 100).toFixed(0)}%`}
          />
          <Scatter data={heatmapData}>
            {heatmapData.map((point, idx) => (
              <Cell key={`heatmap-cell-${idx}-${point.priceLevel}`} fill={colorForPoint(point)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

export default OrderBlockHeatmap;
