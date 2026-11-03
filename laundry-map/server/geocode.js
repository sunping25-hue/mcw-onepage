// Two owner-provided addresses only. No user-controlled remote URLs or unbounded geocoding.
export async function locateKnownStores(db,{fetcher=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms)),log=console.log}={}){
 const rows=db.prepare('SELECT id,document FROM stores').all();
 for(const row of rows){
  const s=JSON.parse(row.document);if(!s.confirmed||!s.published||s.lat!==null||s.lng!==null)continue;
  if(!['高雄市三民區大豐一路26號','屏東縣新園鄉仙吉路32號'].includes(s.address))continue;
  const key='geocode-attempt-v1:'+row.id;
  if(db.prepare('SELECT key FROM bootstrap_records WHERE key=?').get(key))continue;
  db.prepare('INSERT OR IGNORE INTO bootstrap_records VALUES(?,?)').run(key,new Date().toISOString());
  try{
   const url=new URL('https://nominatim.openstreetmap.org/search');for(const [k,v] of Object.entries({q:s.address,format:'jsonv2',addressdetails:'1',countrycodes:'tw',limit:'3'}))url.searchParams.set(k,v);
   const response=await fetcher(url,{headers:{'User-Agent':'MCW-Laundry-Map/1.0 (https://mcw-laundry-map.onrender.com)','Accept-Language':'zh-TW'},signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('Geocoding HTTP '+response.status);
   const results=await response.json();const number=s.address.match(/(\d+)號$/)?.[1];const road=s.address.includes('大豐一路')?'大豐一路':'仙吉路';const city=s.city;
   const matches=Array.isArray(results)?results.filter(r=>{const a=r.address||{};return a.house_number===number&&(a.road||'').includes(road)&&[a.city,a.county,a.state,a.municipality].some(v=>v?.includes(city))&&Number(r.lat)>21&&Number(r.lat)<26&&Number(r.lon)>118&&Number(r.lon)<123}):[];
   const unique=[...new Map(matches.map(r=>[`${Number(r.lat).toFixed(5)},${Number(r.lon).toFixed(5)}`,r])).values()];
   if(unique.length!==1){log('門市地址定位未取得唯一且門牌相符的結果：'+s.address);continue}
   // Re-read so an asynchronous lookup cannot overwrite headquarters edits or a deletion.
   const current=db.prepare('SELECT document FROM stores WHERE id=?').get(row.id);if(!current)continue;const latest=JSON.parse(current.document);if(latest.address!==s.address||latest.lat!==null||latest.lng!==null)continue;
   latest.lat=Number(unique[0].lat);latest.lng=Number(unique[0].lon);db.prepare('UPDATE stores SET document=?,updated_at=? WHERE id=?').run(JSON.stringify(latest),new Date().toISOString(),row.id);log('門市地址定位完成：'+s.address);
  }catch(e){log('門市地址定位暫未完成：'+s.address+'；'+e.message)}
  finally{await pause(1100)}
 }
}
