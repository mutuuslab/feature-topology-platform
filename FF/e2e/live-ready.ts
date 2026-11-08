// Refuse to run against an unready, wrong-version or smaller fallback dataset.
export default async function ready() {
  const api=`http://localhost:${process.env.E2E_API_PORT}`;
  const web=`http://localhost:${process.env.E2E_WEB_PORT}`;
  const get=async(url:string)=>{
    const response=await fetch(url,{signal:AbortSignal.timeout(10_000)});
    if(!response.ok)throw new Error(`Live E2E prerequisite ${url}: HTTP ${response.status}`);
    return response.json();
  };
  const [health,release]=await Promise.all([get(`${api}/api/health`),get(`${web}/release.json`)]);
  const expected=process.env.E2E_BUILD_SHA;
  if(!expected)throw new Error('E2E_BUILD_SHA must pin the tested source');
  if(release.commit!==expected || health.commit!==expected)throw new Error(`Live E2E source mismatch: expected ${expected}, frontend ${release.commit}, API ${health.commit}`);
  if(health.status!=='ok' || health.mode!=='demo')throw new Error('Live E2E requires the ready isolated demo API');
  const counts:Record<string,number>={};
  if(process.env.E2E_SHOWCASE_SCALE==='2'){
    for(const [path,minimum] of [['products',46],['features',370],['vehicles',960]] as const){
      const value=await get(`${api}/api/${path}`);
      if(!Array.isArray(value.items)||value.items.length<minimum)throw new Error(`Live E2E requires doubled ${path}: ${value.items?.length??'unavailable'} < ${minimum}`);
      counts[path]=value.items.length;
    }
  }
  console.log('live-ready '+JSON.stringify({commit:expected,api,web,showcaseScale:process.env.E2E_SHOWCASE_SCALE??'unspecified',counts}));
}
