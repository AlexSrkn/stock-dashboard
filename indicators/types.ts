export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Lightweight Charts–compatible point (omit value until defined). */
export type TimeSeriesPoint = {
  time: number;
  value?: number;
};

export type VolumeProfileBin = {
  price: number;
  volume: number;
};

export type MacdResult = {
  macdLine: TimeSeriesPoint[];
  signalLine: TimeSeriesPoint[];
  histogram: TimeSeriesPoint[];
};

export type BollingerResult = {
  upper: TimeSeriesPoint[];
  middle: TimeSeriesPoint[];
  lower: TimeSeriesPoint[];
};
