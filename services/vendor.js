'use strict';
// Third-party browser libraries, served by the app itself under /vendor/
// (T6): no CDN at run time, so the Content-Security-Policy can stay 'self'.
// They are devDependencies with exact versions; `npm run build` copies these
// files to dist/public/vendor/. Without that copy (running from the
// repository), the server maps the same paths to node_modules.
//
// published path under /vendor/  →  path under node_modules/ (a trailing "/" copies a folder)
const VENDOR_FILES = {
  'leaflet/leaflet.js':                         'leaflet/dist/leaflet.js',
  'leaflet/leaflet.css':                        'leaflet/dist/leaflet.css',
  'leaflet/images/':                            'leaflet/dist/images/',
  'leaflet.markercluster/leaflet.markercluster.js':    'leaflet.markercluster/dist/leaflet.markercluster.js',
  'leaflet.markercluster/MarkerCluster.css':           'leaflet.markercluster/dist/MarkerCluster.css',
  'leaflet.markercluster/MarkerCluster.Default.css':   'leaflet.markercluster/dist/MarkerCluster.Default.css',
  'pannellum/pannellum.js':                     'pannellum/build/pannellum.js',
  'pannellum/pannellum.css':                    'pannellum/build/pannellum.css',
  'three/three.module.js':                      'three/build/three.module.js',
  'three/addons/controls/OrbitControls.js':     'three/examples/jsm/controls/OrbitControls.js',
  'three/addons/renderers/CSS2DRenderer.js':    'three/examples/jsm/renderers/CSS2DRenderer.js',
  'three/addons/lines/':                        'three/examples/jsm/lines/',
  'topojson-client/topojson-client.min.js':     'topojson-client/dist/topojson-client.min.js',
  'world-atlas/countries-110m.json':            'world-atlas/countries-110m.json',
  'world-atlas/countries-50m.json':             'world-atlas/countries-50m.json',
};

module.exports = { VENDOR_FILES };
