/* Tamhas Trading - futures contract point values.
   Each value was read from CME Group's published contract specs on 2026-10-28 (links below).
   Stored as whole cents per index point so risk math stays exact. */
(function (root) {
  var CME_ENANO = 'https://www.cmegroup.com/markets/equities/files/e-nano-equity-index-futures-fact-card.pdf';
  // Gold: CME's "1 oz futures comparison" sheet states GC = 100 oz, minimum fluctuation 0.10 per troy ounce = $10.00 (so $100 per point); MGC = 1/10 of Gold, 0.10 per troy ounce = $1.00 (so $10 per point). Read 2026-10-29.
  var CME_GOLD = 'https://cmegroup.com/markets/metals/files/1-oz-futures-comparison.pdf';
  var list = [
    { id: 'NNQ', name: 'E-nano Nasdaq-100',   centsPerPoint: 20,   label: '$0.20', url: CME_ENANO },
    { id: 'NES', name: 'E-nano S&P 500',      centsPerPoint: 50,   label: '$0.50', url: CME_ENANO },
    { id: 'MNQ', name: 'Micro E-mini Nasdaq-100', centsPerPoint: 200,  label: '$2',  url: 'https://cmegroup.com/trading/equity-index/us-index/micro-e-mini-nasdaq-100_contractSpecs_futures.html' },
    { id: 'NQ',  name: 'E-mini Nasdaq-100',   centsPerPoint: 2000, label: '$20',   url: 'https://cmegroup.com/markets/equities/nasdaq/e-mini-nasdaq-100.contractSpecs.html' },
    { id: 'MES', name: 'Micro E-mini S&P 500', centsPerPoint: 500,  label: '$5',   url: 'https://cmegroup.com/markets/equities/sp/micro-e-mini-sandp-500.contractSpecs.html' },
    { id: 'MGC', name: 'Micro Gold (10 troy oz)', centsPerPoint: 1000, label: '$10', url: CME_GOLD },
    { id: 'GC',  name: 'Gold (100 troy oz)', centsPerPoint: 10000, label: '$100', url: CME_GOLD },
    { id: 'ES',  name: 'E-mini S&P 500',      centsPerPoint: 5000, label: '$50',   url: 'https://www.cmegroup.com/education/courses/micro-e-mini-futures/micro-e-mini-futures-products-overview.html' }
  ];
  var byId = {}; list.forEach(function (i) { byId[i.id] = i; });
  var api = { list: list, byId: byId, defaultId: 'NNQ', verifiedOn: '2026-10-28' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTInstruments = api;
})(typeof window !== 'undefined' ? window : globalThis);
