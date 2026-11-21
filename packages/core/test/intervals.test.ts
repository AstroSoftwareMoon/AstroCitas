import { describe, expect, it } from 'vitest';
import { mergeIntervals, subtractIntervals } from '../src/intervals';

describe('intervalos', () => {
  it('fusiona solapados y contiguos', () => {
    expect(mergeIntervals([{ start: 5, end: 8 }, { start: 0, end: 3 }, { start: 3, end: 4 }, { start: 7, end: 10 }])).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 10 },
    ]);
  });
  it('resta ocupados de libres', () => {
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 2, end: 3 }, { start: 5, end: 12 }])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: -5, end: 20 }])).toEqual([]);
  });
});
