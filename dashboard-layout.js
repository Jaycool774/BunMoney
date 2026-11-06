/* Layout now lives in index.html. Preserve all original DOM nodes and handlers.
   Ask responsive canvas to remeasure once all deferred scripts have mounted. */
(() => {
  function ready() {
    const grid=document.querySelector('.bun-command-grid');
    if (!grid) return;
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',ready,{once:true});
  else ready();
})();
