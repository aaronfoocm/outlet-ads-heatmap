// Shared types for the heatmap platform
export type Period = 'Day' | 'Week' | 'Month' | 'Quarter';
export type CompareMode = 'col' | 'self';

export type EntityType = 'outlet' | 'sku';

export interface HeatmapRow {
  date: string;
  entityCode: string;
  netSales: number;
  entityName: string;
  category: string;
}

export interface HoverInfo {
  entity: string;
  entityName: string;
  category: string;
  periodKey: string;
  periodAds: number | null;
  colAdsValue: number;
  colAds: number;
  selfAds: number;
  athSelf: number;
  colDev: number;
  selfDev: number;
  x: number;
  y: number;
}
