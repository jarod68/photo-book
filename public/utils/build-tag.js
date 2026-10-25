// Build stamp: the commit this image was built from (version.json, written by
// the Docker build — absent in dev), shown discreetly in a page corner so a QA
// tester knows which build to promote to prod.
export function showBuildTag() {
  fetch('/version.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((v) => {
      const el = document.createElement('div');
      el.className = 'build-tag';
      el.textContent = `build ${v?.sha?.slice(0, 7) || 'dev'}`;
      document.body.append(el);
    });
}
