// Build + environment stamp (GET /version.json → { sha, env }):
// - the commit this image was built from, in a page corner, so a tester knows
//   which build to promote to prod ("dev" when running from source);
// - outside production (env "qa"): "[QA]" in the tab title and a hi-vis strip
//   along the top of the screen, so QA can never be mistaken for prod.
export function showBuildTag() {
  fetch('/version.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((v) => {
      const sha = v?.sha?.slice(0, 7) || 'dev';
      const env = v?.env && v.env !== 'production' ? String(v.env).toUpperCase() : null;

      const tag = document.createElement('div');
      tag.className = 'build-tag';
      tag.textContent = env ? `build ${sha} · ${env}` : `build ${sha}`;
      document.body.append(tag);

      if (env) {
        document.documentElement.classList.add('env-nonprod');
        if (!document.title.startsWith(`[${env}]`)) document.title = `[${env}] ${document.title}`;
        const strip = document.createElement('div');
        strip.className = 'env-strip';
        strip.setAttribute('role', 'note');
        strip.setAttribute('aria-label', `${env} environment`);
        strip.innerHTML = `<span class="env-strip-label"></span>`;
        strip.firstChild.textContent = env;
        document.body.append(strip);
      }
    });
}
