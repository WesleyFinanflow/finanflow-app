export const transactionSeriesKey = item => item.seriesId ? `${item.spaceId}:${item.seriesId}` : null;
export function buildSeriesTotals(transactions) {
 const cents=new Map();
 for(const item of transactions){const key=transactionSeriesKey(item);if(key)cents.set(key,(cents.get(key)||0)+Math.round(Number(item.amount||0)*100));}
 return new Map([...cents].map(([key,value])=>[key,value/100]));
}
