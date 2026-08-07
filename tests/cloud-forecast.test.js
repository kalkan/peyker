import { describe, it, expect } from 'vitest';
import { getCloudAtTime, enrichWithCloud } from '../src/util/cloud-forecast.js';

const forecast = {
  times: [
    '2026-08-07T10:00',
    '2026-08-07T11:00',
    '2026-08-07T12:00',
    '2026-08-07T13:00',
  ],
  total: [10, 40, 70, 95],
  low: [5, 20, 50, 80],
  mid: [3, 15, 15, 10],
  high: [2, 5, 5, 5],
};

describe('getCloudAtTime', () => {
  it('picks the nearest hour', () => {
    expect(getCloudAtTime(forecast, new Date('2026-08-07T11:20:00Z')).total).toBe(40);
    expect(getCloudAtTime(forecast, new Date('2026-08-07T11:40:00Z')).total).toBe(70);
  });

  it('returns all four layers', () => {
    const c = getCloudAtTime(forecast, new Date('2026-08-07T13:00:00Z'));
    expect(c).toEqual({ total: 95, low: 80, mid: 10, high: 5 });
  });

  it('clamps to the edges of the series', () => {
    expect(getCloudAtTime(forecast, new Date('2026-08-07T00:00:00Z')).total).toBe(10);
    expect(getCloudAtTime(forecast, new Date('2026-08-07T23:00:00Z')).total).toBe(95);
  });

  it('is null-safe', () => {
    expect(getCloudAtTime(null, new Date())).toBeNull();
    expect(getCloudAtTime({}, new Date())).toBeNull();
    expect(getCloudAtTime({ times: [] }, new Date())).toBeNull();
  });
});

describe('enrichWithCloud', () => {
  it('attaches cloudCover to each opportunity', () => {
    const opps = [
      { time: new Date('2026-08-07T10:05:00Z') },
      { time: new Date('2026-08-07T12:55:00Z') },
    ];
    enrichWithCloud(opps, forecast);
    expect(opps[0].cloudCover.total).toBe(10);
    expect(opps[1].cloudCover.total).toBe(95);
  });
});
