import { clamp } from "../../core/utils.js";

type Region = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export class DirtyRegionTracker {
  private readonly cols: number;
  private readonly rows: number;
  private regions: Region[] = [];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  clear(): void {
    this.regions = [];
  }

  markTile(x: number, y: number, radius = 0): void {
    this.markRect(x - radius, y - radius, x + radius, y + radius);
  }

  markRect(minX: number, minY: number, maxX: number, maxY: number): void {
    if (this.cols <= 0 || this.rows <= 0) {
      return;
    }
    const clamped: Region = {
      minX: clamp(Math.floor(minX), 0, this.cols - 1),
      minY: clamp(Math.floor(minY), 0, this.rows - 1),
      maxX: clamp(Math.floor(maxX), 0, this.cols - 1),
      maxY: clamp(Math.floor(maxY), 0, this.rows - 1)
    };
    if (clamped.minX > clamped.maxX || clamped.minY > clamped.maxY) {
      return;
    }
    this.regions.push(clamped);
  }

  hasDirtyRegions(): boolean {
    return this.regions.length > 0;
  }

  getMergedRegions(expand = 0): Region[] {
    if (this.regions.length === 0) {
      return [];
    }
    const expanded = this.regions.map((region) => ({
      minX: clamp(region.minX - expand, 0, this.cols - 1),
      minY: clamp(region.minY - expand, 0, this.rows - 1),
      maxX: clamp(region.maxX + expand, 0, this.cols - 1),
      maxY: clamp(region.maxY + expand, 0, this.rows - 1)
    }));
    expanded.sort((a, b) => (a.minY - b.minY) || (a.minX - b.minX));
    const merged: Region[] = [];
    for (const region of expanded) {
      const last = merged[merged.length - 1];
      if (
        !last ||
        region.minX > last.maxX + 1 ||
        region.maxX < last.minX - 1 ||
        region.minY > last.maxY + 1 ||
        region.maxY < last.minY - 1
      ) {
        merged.push({ ...region });
        continue;
      }
      last.minX = Math.min(last.minX, region.minX);
      last.minY = Math.min(last.minY, region.minY);
      last.maxX = Math.max(last.maxX, region.maxX);
      last.maxY = Math.max(last.maxY, region.maxY);
    }
    return merged;
  }
}

