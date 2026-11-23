'use strict';

const localStorageDetails = (() => {
  const groups = [
    { id: 'history', matches: key => key === 'instagramFluxoReviewState' },
    { id: 'queue', matches: key => key.startsWith('instagramFluxoDatabase:v2:') },
    { id: 'cleaner', matches: key => key.startsWith('instagramFluxoCleaner:v1:') },
    { id: 'photos', matches: key => key === 'instagramFluxoPhotoCache:v1' },
    { id: 'logs', matches: key => key === 'instagramFluxoDiagnosticOutbox:v1' },
    { id: 'legacy', matches: key => key.startsWith('instagramFluxoDatabase:v1:') || key.startsWith('instagramComparison:') },
  ];

  async function read() {
    const area = chrome.storage.local;
    const [all, keys, estimate] = await Promise.all([
      area.getBytesInUse(null),
      area.getKeys ? area.getKeys() : Promise.resolve(null),
      Promise.resolve().then(() => globalThis.navigator?.storage?.estimate?.()).catch(() => undefined),
    ]);
    const byGroup = keys ? await Promise.all(groups.map(async ({ id, matches }) => {
      const selected = keys.filter(matches);
      return { id, bytes: selected.length ? await area.getBytesInUse(selected) : 0 };
    })) : [];
    if (keys) byGroup.push({ id: 'other', bytes: Math.max(0, all - byGroup.reduce((sum, item) => sum + item.bytes, 0)) });
    const indexed = estimate?.usageDetails?.indexedDB;
    return { all, byGroup, indexed: typeof indexed === 'number' && indexed >= 0 ? indexed : null };
  }

  return { read };
})();
