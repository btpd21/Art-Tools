(()=>{try{
  const OG = window.generateCollage;
  if(typeof OG!=='function' || OG.__featureWrap) return;

  function bump(v,m){ v=Number(v); return Number.isFinite(v)?Math.max(0, v*m):v; }

  window.generateCollage = function(params,...rest){
    try{
      const p = (params && typeof params==='object') ? {...params} : {};

      // Deckle / edge emphasis (conservative multipliers)
      if (p.tornRough        != null) p.tornRough        = bump(p.tornRough,        1.35);
      if (p.scissorJag       != null) p.scissorJag       = bump(p.scissorJag,       1.25);
      if (p.edgeContrast     != null) p.edgeContrast     = bump(p.edgeContrast,     1.20);
      if (p.shapeIrregularity!= null) p.shapeIrregularity= bump(p.shapeIrregularity,1.20);

      // Strips sanity: cap to <= 2x tiles so they don't dominate
      if (p.strips && typeof p.strips==='object'){
        const sc = Number(p.strips.count||0);
        const tc = Number(p.tileCount||0);
        if (sc>0 && tc>0 && sc > tc*2) p.strips.count = Math.round(tc*2);
      }

      // Shapes sanity: if %Special>0 but no shapes ticked, allow Rect
      const allowKeys=['allowRect','allowScissor','allowTorn','allowEllipse','allowTriangle','allowDiamond','allowHex'];
      const anyAllow = allowKeys.some(k=>!!p[k]);
      if (Number(p.specialPct||0)>0 && !anyAllow) p.allowRect=true;

      // Seed stabilizer
      if (!p.seed || p.seed==='random') p.seed = Date.now()%1000000000;

      return OG(p, ...rest);
    }catch(e){ console.warn('feature pack error', e); return OG(params,...rest); }
  };
  window.generateCollage.__featureWrap = true;

  // One-time toast
  setTimeout(()=>{
    const t=document.createElement('div');
    t.textContent='FEATURE PACK ACTIVE';
    Object.assign(t.style,{
      position:'fixed',left:'12px',top:'12px',padding:'6px 10px',
      background:'rgba(32,166,255,.12)',color:'#9fd3ff',border:'1px solid #245',
      borderRadius:'10px',font:'600 12px ui-sans-serif,system-ui',zIndex:99998,
      boxShadow:'0 4px 10px rgba(0,0,0,.25)',backdropFilter:'blur(3px)'
    });
    document.body.appendChild(t); setTimeout(()=>t.remove(),2400);
  },100);
}catch(e){console.warn('feature pack init error', e);}})();
