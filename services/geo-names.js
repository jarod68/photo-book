// @ts-check
'use strict';
// Countries and continents for search (F6): "usa", "United States",
// "Estados Unidos", "amérique du nord" all find a photo placed in
// "New York, États-Unis". A place's country is recognised from its text
// (any comma-separated part, in any of LANGS — Nominatim answers in French,
// IPTC and admin edits may be in any language); the photo then also carries
// every name of that country and of its continent, its ISO code and the
// usual nicknames. Names come from Intl (ICU, in Node), so nothing to keep
// up to date but the short tables below.

const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt', 'nl'];

// Continents → ISO 3166-1 alpha-2 codes (the Americas split north / south;
// Central America and the Caribbean go north).
const CONTINENTS = {
  europe: 'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
  asia: 'AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE',
  africa: 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
  northAmerica: 'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
  southAmerica: 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  oceania: 'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS',
  antarctica: 'AQ',
};
const CONTINENT_NAMES = {
  europe: ['europe', 'europa'],
  asia: ['asie', 'asia', 'asien', 'azie'],
  africa: ['afrique', 'africa', 'afrika', 'africa'],
  northAmerica: ['amerique du nord', 'north america', 'america del norte', 'nordamerika', 'amerique', 'america', 'americas', 'ameriques'],
  southAmerica: ['amerique du sud', 'south america', 'america del sur', 'sudamerika', 'amerique latine', 'latin america', 'america latina', 'amerique', 'america', 'americas', 'ameriques'],
  oceania: ['oceanie', 'oceania', 'ozeanien'],
  antarctica: ['antarctique', 'antarctica', 'antartida', 'antarktis'],
};

// Nicknames and codes people type that Intl does not give (alpha-3, short
// forms, a country's best-known part).
const ALIASES = {
  US: ['usa', 'etats unis', 'etats unis d amerique', 'united states of america', 'america', 'amerique', 'eeuu', 'ee uu'],
  GB: ['uk', 'gbr', 'angleterre', 'england', 'ecosse', 'scotland', 'pays de galles', 'wales', 'grande bretagne', 'great britain', 'britain', 'royaume uni', 'inglaterra'],
  AE: ['uae', 'emirats', 'emirats arabes unis', 'dubai'],
  NL: ['hollande', 'holland', 'pays bas'],
  KR: ['coree', 'korea', 'south korea', 'coree du sud'],
  CZ: ['tchequie', 'czechia', 'czech republic', 'republique tcheque'],
  RU: ['russie', 'russia'],
  ZA: ['rsa', 'afrique du sud'],
  CN: ['chn', 'chine'],
  JP: ['jpn', 'nippon'],
  DE: ['deu', 'ger'],
  FR: ['fra'],
  ES: ['esp'],
  IT: ['ita'],
  PT: ['prt'],
  CH: ['sui', 'suisse'],
  AU: ['aus', 'oz'],
  NZ: ['nzl'],
  CA: ['can'],
  MX: ['mex'],
  BR: ['bra'],
  AR: ['arg'],
  IS: ['isl'],
  VA: ['vatican'],
};

const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

let index = null;    // normalised country name → code
let terms = null;    // code → the words to add to a photo's text

function build() {
  index = new Map();
  terms = new Map();
  const continentOf = new Map();
  for (const [c, codes] of Object.entries(CONTINENTS)) for (const code of codes.split(' ')) continentOf.set(code, c);
  const names = LANGS.map((l) => { try { return new Intl.DisplayNames([l], { type: 'region', fallback: 'none' }); } catch { return null; } })
    .filter(Boolean);
  for (const code of continentOf.keys()) {
    const words = new Set([code.toLowerCase(), ...(ALIASES[code] ?? [])]);
    for (const n of names) {
      const v = n.of(code);
      if (v && v !== code) words.add(norm(v));
    }
    // a two-letter code is no place name: only names of 3+ letters and the
    // nicknames ("UK") recognise a country in a place's text
    for (const w of words) if (w.length > 2 || ALIASES[code]?.includes(w)) index.set(w, code);
    for (const w of CONTINENT_NAMES[continentOf.get(code)]) words.add(w);
    terms.set(code, [...words].join(' '));
  }
}

/** ISO code of the country named in a place ("Manhattan, États-Unis" → "US"), or null. */
function countryOf(location) {
  if (!location) return null;
  if (!index) build();
  const parts = String(location).split(/[,;/]|\s[-–]\s/).map(norm).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {   // the country is usually last
    const code = index.get(parts[i]);
    if (code) return code;
  }
  return null;
}

/** Every searchable word of a country: its names, code, nicknames, continent. */
function countryTerms(code) {
  if (!index) build();
  return terms.get(code) ?? '';
}

module.exports = { countryOf, countryTerms, CONTINENTS, LANGS, _norm: norm };
