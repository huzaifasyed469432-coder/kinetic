/* ----------------------------------------------------------------------------
   Optional GitHub content source.
   ----------------------------------------------------------------------------
   The editable marketing content (site/content.json) can live in a Git repo so
   the owner can publish copy without a redeploy. Configure the repo once in
   site/kinetic.config.js → contentRepo; this file just hands it to the loaders.

   Leave contentRepo blank and the storefront runs entirely from the bundled
   site/content.json — nothing breaks, no request leaves the page.
   -------------------------------------------------------------------------- */
window.__GH__ = (function () {
  var cfg = (window.KINETIC_CONFIG && window.KINETIC_CONFIG.contentRepo) || {};
  return {
    owner: String(cfg.owner || '').trim(),
    repo: String(cfg.repo || '').trim(),
    branch: String(cfg.branch || 'main').trim() || 'main'
  };
})();
