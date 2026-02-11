import React from 'react';
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
} from 'recharts';
import { OHLCV, SupportResistanceLevel } from '../types';

interface ChartProps {
  data: (OHLCV & { ema20?: number; ema50?: number })[];
  symbol: string;
  levels?: SupportResistanceLevel[];
  theme: 'dark' | 'light';
  mode?: 'line' | 'candles';
}

const Chart: React.FC<ChartProps> = ({ data, symbol, levels = [], theme, mode = 'line' }) => {
  if (!data || data.length === 0) return <div className="h-full flex items-center justify-center font-bold text-xs text-gray-400">NO DATA</div>;

  // Theme Colors
  const colors = {
    grid: theme === 'dark' ? '#333' : '#e5e7eb',
    text: theme === 'dark' ? '#9ca3af' : '#374151', // Darker gray in light mode for legibility
    tooltipBg: theme === 'dark' ? '#1e1e1e' : '#ffffff',
    tooltipBorder: theme === 'dark' ? '#ffffff' : '#000000',
    tooltipText: theme === 'dark' ? '#ffffff' : '#000000',
    area: theme === 'dark' ? '#ccff00' : '#121212', // Acid Green vs Black
    support: theme === 'dark' ? '#22c55e' : '#16a34a',
    resistance: theme === 'dark' ? '#ef4444' : '#dc2626',
  };

  return (
    <div className="w-full h-full relative">
      <div className="absolute top-4 left-4 z-10 pointer-events-none">
         <div className="flex gap-3 text-[10px] font-bold uppercase tracking-wider bg-black/50 dark:bg-white/10 backdrop-blur px-2 py-1 rounded border border-white/20">
            <span className="text-cyan-400">EMA 20</span>
            <span className="text-yellow-400">EMA 50</span>
         </div>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={colors.area} stopOpacity={0.2}/>
              <stop offset="95%" stopColor={colors.area} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} horizontal={true} />
          
          <XAxis dataKey="time" hide={true} />
          <YAxis 
            domain={['auto', 'auto']} 
            stroke={colors.text}
            tick={{fontSize: 10, fill: colors.text, fontWeight: 600, fontFamily: 'monospace'}}
            width={40}
            axisLine={false}
            tickLine={false}
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
                boxShadow: '4px 4px 0px 0px rgba(0,0,0,0.2)'
            }}
            itemStyle={{ padding: 0 }}
            labelStyle={{ color: colors.text, marginBottom: '4px', fontSize: '10px', textTransform: 'uppercase' }}
            labelFormatter={(label) => new Date(label).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            cursor={{ stroke: colors.text, strokeWidth: 1, strokeDasharray: '4 4' }}
          />
          
          {levels.map((level, i) => (
             <ReferenceLine 
                key={i} 
                y={level.price} 
                stroke={level.type === 'support' ? colors.support : colors.resistance} 
                strokeDasharray="4 2"
                strokeWidth={2}
                strokeOpacity={0.7}
             />
          ))}

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
                    segment={[
                      { x: candle.time, y: candle.low },
                      { x: candle.time, y: candle.high },
                    ]}
                    stroke={isBull ? '#22c55e' : '#ef4444'}
                    strokeWidth={1.5}
                    ifOverflow="extendDomain"
                  />
                  <ReferenceLine
                    segment={[
                      { x: candle.time, y: bodyBottom },
                      { x: candle.time, y: bodyTop },
                    ]}
                    stroke={isBull ? '#16a34a' : '#dc2626'}
                    strokeWidth={6}
                    ifOverflow="extendDomain"
                  />
                </React.Fragment>
              );
            })
          )}
          <Line type="monotone" dataKey="ema20" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="monotone" dataKey="ema50" stroke="#facc15" dot={false} strokeWidth={2} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default Chart;
