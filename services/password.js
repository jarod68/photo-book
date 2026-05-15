'use strict';
const crypto = require('crypto');

// prettier-ignore
const _w = [
  'amber','arch','ash','azure','bark','bay','beam','birch','blaze','bleak',
  'bluff','bloom','blunt','bolt','bond','bough','brave','brim','brink','brook',
  'briar','brisk','bud','burr','calm','cape','cave','cedar','chalk','chill',
  'clay','cleft','cliff','cloud','coal','coast','coil','cone','cord','cove',
  'crag','creek','crest','crop','crown','dale','dawn','dell','dew','dome',
  'drift','drum','dune','dusk','dust','echo','edge','elm','fang','fawn',
  'fell','fern','flame','flare','fleck','flint','flood','fog','ford','forge',
  'frost','gale','gem','glade','glen','glint','glow','gold','gorse','grain',
  'grove','gull','gust','haven','hawk','heath','herb','hill','hive','holt',
  'horn','hull','hush','iris','jade','jay','keen','kelp','kite','knoll',
  'lake','larch','lark','leaf','ledge','lime','loch','loft','loom','luna',
  'lynx','mane','maple','mast','mead','mint','mist','moor','moss','mote',
  'musk','nave','nook','oak','opal','orb','owl','peak','peat','pine',
  'plum','pond','pool','port','rain','reef','reed','ridge','rift','rind',
  'rook','rope','rose','rune','rush','rye','sage','salt','sand','seal',
  'sheen','shoal','silk','sleet','slope','snow','soil','spar','spire','sprig',
  'star','stem','stone','storm','surge','swan','swift','tarn','teal','thorn',
  'tide','turf','vale','veil','vine','vole','volt','wand','wave','wild',
  'wind','wolf','wren','yew','zone','bold','broad','clear','cold','cool',
  'damp','dark','deep','dense','dry','fair','fast','firm','flat','free',
  'fresh','full','glad','good','gray','grim','grit','hard','harsh','hazy',
  'high','lean','light','lithe','long','mild','neat','pale','plain','raw',
  'round','rough','sharp','sheer','slim','slow','soft','stark','still','stout',
  'tall','thick','thin','tough','trim','vast','warm','wide','worn','bear',
  'boar','bull','colt','crow','deer','dove','duck','elk','finch','fox',
  'frog','mink','moth','pike','wasp',
];

const _s = ['!', '@', '#', '$', '&', '*', '+', '='];

function _r(n) { return crypto.randomInt(n); }

function generatePassword() {
  const a = _w[_r(_w.length)];
  const b = _w[_r(_w.length)];
  return a[0].toUpperCase() + a.slice(1) + _s[_r(_s.length)] + b + _r(1000).toString().padStart(3, '0');
}

function validatePassword(password) {
  if (typeof password !== 'string' || !password) return 'Password is required';
  if (password.length < 8)                        return 'At least 8 characters required';
  if (!/[A-Z]/.test(password))                    return 'At least one uppercase letter required';
  if (!/[a-z]/.test(password))                    return 'At least one lowercase letter required';
  if (!/[0-9]/.test(password))                    return 'At least one digit required';
  if (!/[^A-Za-z0-9]/.test(password))             return 'At least one special character required';
  return null;
}

module.exports = { generatePassword, validatePassword };
