(()=>{try{
  if (window.__universalSliders) return;
  window.__universalSliders = true;

  const labelFor = (input)=>{
    if (!input.id) return '';
    const L = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (L) return (L.textContent||'').trim().toLowerCase();
    // fallback—look upward for a nearby label
    let p=input; for(let i=0;i<4 && (p=p.parentElement); i++){
      const l=p.querySelector('label'); if(l) return (l.textContent||'').trim().toLowerCase();
    }
    return '';
  };

  const guessRange = (num)=>{
    const name = (num.name||'').toLowerCase();
    const lbl  = labelFor(num);
    const t = (name + ' ' + lbl).trim();

    // Defaults
    let min=0, max=100, step=1;

    // Angles
    if (/\b(angle|rotation)\b/.test(t)) { min=0; max=90; step=1; }
    // Sizes / % of canvas
    else if (/\b(max element|tile max size|tile min size|size\b)/.test(t)) {
      min=0; max=100; step=(t.includes('min')||t.includes('max'))?0.5:1;
    }
    // Opacity / contrast / diversity / randomness
    else if (/\b(opacity|contrast|diversity|randomness)\b/.test(t)) {
      min=0; max=100; step=1;
    }
    // Counts
    else if (/\b(count|tiles per cluster|tile count|strips)\b/.test(t)) {
      min=0; max=400; step=1;
    }
    // Canvas size
    else if (/\b(width|height)\b/.test(t)) {
      min=256; max=8000; step=1;
    }

    // If HTML already provides min/max/step, honor them
    const nmin = num.min!=='' ? Number(num.min) : null;
    const nmax = num.max!=='' ? Number(num.max) : null;
    const nstep= num.step && num.step!=='any' ? Number(num.step) : null;
    if (Number.isFinite(nmin)) min=nmin;
    if (Number.isFinite(nmax)) max=nmax;
    if (Number.isFinite(nstep))step=nstep;

    // Use decimals if number has decimals
    if ((String(num.value||'').includes('.')) && step===1) step=0.1;

    return {min,max,step};
  };

  const makeSlider = (num)=>{
    const r=document.createElement('input');
    r.type='range';
    const {min,max,step}=guessRange(num);
    r.min=min; r.max=max; r.step=step;
    // initial
    const v = (num.value!==''?Number(num.value):min);
    r.value = Number.isFinite(v)? v : min;

    // styling: slim, right column
    r.style.width='100%';
    r.style.margin='6px 0 12px 0';

    // two-way sync — the NUMBER is authoritative; slider follows exactly
    num.addEventListener('input', (e)=>{
      const v = num.value;
      // do not quantize number to slider step; just mirror as-is
      r.value = v===''? r.value : v;
      r.dispatchEvent(new Event('change',{bubbles:false}));
    }, false);

    r.addEventListener('input', ()=>{
      // slider drives number—but leave typed precision alone if decimals
      const v = r.value;
      if (num.value!==v){ num.value = v; num.dispatchEvent(new Event('change',{bubbles:true})); }
    }, false);

    return r;
  };

  const wire = (num)=>{
    // already wired?
    if (num.dataset.__pairedRange) return;
    const row = num.closest?.('.row,.dial-row,.input-row,.control,.field') || num.parentElement;
    const slot = row || num.parentElement || num;
    const slider = makeSlider(num);

    // place slider after the numeric input
    num.insertAdjacentElement('afterend', slider);
    num.dataset.__pairedRange='1';
  };

  const scan = ()=>{
    document.querySelectorAll('input[type="number"]').forEach(wire);
  };

  if (document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', scan); }
  else scan();

  // Keep wiring for late-added inputs
  new MutationObserver(scan).observe(document.body,{subtree:true,childList:true});

  // Small toast when loaded
  setTimeout(()=>{
    const t=document.createElement('div');
    t.textContent='SLIDERS ACTIVE';
    Object.assign(t.style,{
      position:'fixed',right:'12px',top:'12px',padding:'6px 10px',
      background:'rgba(92,225,230,.12)',color:'#a7f3f5',border:'1px solid #245',
      borderRadius:'10px',font:'600 12px ui-sans-serif,system-ui',zIndex:99998,
      boxShadow:'0 4px 10px rgba(0,0,0,.25)',backdropFilter:'blur(3px)'
    });
    document.body.appendChild(t); setTimeout(()=>t.remove(),2200);
  },120);
}catch(e){console.warn('universal sliders init error', e);}})();
