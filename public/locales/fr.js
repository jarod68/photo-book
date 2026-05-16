export default {
  // Navigation
  'nav.back':    '← Retour',
  'nav.signIn':  'Connexion',
  'nav.signOut': 'Déconnexion',
  'nav.admin':   'Admin',

  // Home
  'home.empty':           'Ajoutez des dossiers dans <code>photos/</code> pour créer des albums.',
  'home.mapCard.name':    'Carte',
  'home.mapCard.sub':     'Toutes les localisations',
  'word.album':           'album{s}',
  'word.photo':           'photo{s}',

  // Album card
  'album.empty':      'Album vide',
  'album.restricted': 'Album restreint',
  'album.photos':     '{n} photo{s}',

  // Viewer
  'viewer.map':          'Carte',
  'viewer.albumMap':     "Carte de l'album",
  'viewer.download':     'Télécharger',
  'viewer.delete':       'Supprimer',
  'viewer.actions':      'Actions',
  'viewer.emptyTitle':   "Oups, y'a rien ici !",
  'viewer.emptySub':     'Cet album est aussi vide que mon frigo un dimanche soir.',
  'viewer.like':         "J'aime",
  'viewer.zoomIn':       'Zoom avant',
  'viewer.zoomOut':      'Zoom arrière',
  'viewer.recenter':     'Recentrer',
  'viewer.gyro':         'Gyroscope',
  'viewer.scrollLeft':   'Défiler à gauche',
  'viewer.scrollRight':  'Défiler à droite',
  'viewer.expandMap':    'Agrandir la carte',
  'viewer.close':        'Fermer',
  'viewer.deleteConfirm':'Supprimer « {filename} » ?',
  'viewer.deleteError':  'Erreur lors de la suppression : {msg}',

  // Login
  'login.back':         '← Retour',
  'login.username':     'Identifiant',
  'login.password':     'Mot de passe',
  'login.submit':       'Se connecter',
  'login.signingIn':    'Connexion…',
  'login.errorInvalid': 'Identifiant ou mot de passe incorrect.',
  'login.errorGeneric': 'Impossible de se connecter. Veuillez réessayer.',
  'login.errorNetwork': 'Erreur réseau. Veuillez réessayer.',

  // Map
  'map.title':     'Carte',
  'map.back':      'Retour',
  'map.showRoute': 'Afficher le tracé',
  'map.hideRoute': 'Masquer le tracé',
  'map.viewInAlbum': "Voir dans l'album",
  'map.noPhotos':  'Aucune photo géolocalisée',
  'map.photos':    '{n} photo{s} géolocalisée{s}',

  // Format (views)
  'format.view':    '{n} vue',
  'format.views':   '{n} vues',
  'format.views_k': '{n} k vues',
  'format.views_M': '{n} M vues',

  // Admin — header
  'admin.title':   'Admin',
  'admin.back':    '← Photo Book',
  'admin.signOut': 'Déconnexion',

  // Admin — albums
  'admin.albums':         'Albums',
  'admin.newAlbum':       '+ Nouvel album',
  'admin.albumName':      "Nom de l'album",
  'admin.settings':       'Paramètres d\'accès',
  'admin.uploadPhotos':   'Ajouter des photos',
  'admin.rename':         'Renommer',
  'admin.create':         'Créer',
  'admin.cancel':         'Annuler',
  'admin.save':           'Enregistrer',

  // Admin — users
  'admin.users':    'Utilisateurs',
  'admin.newUser':  '+ Nouvel utilisateur',
  'admin.generate': 'Générer',

  // Admin — misc sections
  'admin.system':    'Système',
  'admin.topPhotos': 'Meilleures photos',

  // Admin — activity log
  'admin.activityLog':        "Journal d'activité",
  'admin.clearLogs':          'Effacer les logs',
  'admin.clearLogsConfirm':   "Effacer tous les journaux d'activité ?",
  'admin.allActions':         'Toutes les actions',

  // Admin — log action labels
  'admin.log.login':        'Connexion',
  'admin.log.logout':       'Déconnexion',
  'admin.log.photo_like':   "J'aime",
  'admin.log.photo_upload': 'Téléversement',
  'admin.log.photo_delete': 'Suppression photo',
  'admin.log.album_create': 'Création album',
  'admin.log.album_rename': 'Renommage album',
  'admin.log.album_delete': 'Suppression album',
  'admin.log.user_create':  'Création utilisateur',
  'admin.log.user_delete':  'Suppression utilisateur',

  // Admin — table columns
  'admin.col.album':     'Album',
  'admin.col.photos':    'Photos',
  'admin.col.views':     'Vues',
  'admin.col.likes':     "J'aime",
  'admin.col.username':  'Utilisateur',
  'admin.col.role':      'Rôle',
  'admin.col.created':   'Créé',
  'admin.col.lastLogin': 'Dernière connexion',
  'admin.col.container': 'Conteneur',
  'admin.col.image':     'Image',
  'admin.col.reference': 'Référence / condensé',
  'admin.col.status':    'Statut',
  'admin.col.photo':     'Photo',
  'admin.col.date':      'Date',
  'admin.col.action':    'Action',
  'admin.col.user':      'Utilisateur',
  'admin.col.ip':        'IP',
  'admin.col.details':   'Détails',

  // Admin — states
  'admin.loading':        'Chargement…',
  'admin.noAlbums':       'Aucun album.',
  'admin.noUsers':        'Aucun utilisateur.',
  'admin.noData':         'Aucune donnée.',
  'admin.noEntries':      'Aucune entrée.',
  'admin.noDockerSocket': 'Socket Docker indisponible.',
  'admin.noBasicUsers':   'Aucun utilisateur de base.',
  'admin.failedLoad':     'Échec du chargement.',
  'admin.guest':          'Invité',

  // Admin — log pagination
  'admin.prev':       '← Préc.',
  'admin.next':       'Suiv. →',
  'admin.pageInfo':   'Page {page} / {pages} · {total} entrée{s}',

  // Admin — confirm / alert
  'admin.confirmDeleteAlbum': 'Supprimer l\'album « {name} » et toutes ses photos ?\nCette action est irréversible.',
  'admin.confirmDeleteUser':  'Supprimer l\'utilisateur « {name} » ?\nCette action est irréversible.',
  'admin.renameFailed':       'Échec du renommage',
  'admin.deleteFailed':       'Échec de la suppression',
  'admin.createFailed':       'Échec de la création',
  'admin.roleFailed':         'Échec de la mise à jour du rôle',
  'admin.pwdFailed':          'Échec de la mise à jour du mot de passe',
  'admin.saveFailed':         'Échec de la sauvegarde',

  // Admin — upload modal
  'admin.uploadTo':      'Téléverser vers',
  'admin.dropHere':      'Déposez vos photos ici',
  'admin.addFiles':      'Ajouter des fichiers',
  'admin.upload':        'Téléverser',
  'admin.filesSelected': '{n} fichier{s} sélectionné{s}',
  'admin.networkError':  'Erreur réseau',

  // Admin — password modal
  'admin.changePassword': 'Changer le mot de passe',
  'admin.newPassword':    'Nouveau mot de passe',

  // Admin — password validation
  'admin.pwd.minLength': '8 caractères minimum',
  'admin.pwd.uppercase': 'Au moins une majuscule',
  'admin.pwd.lowercase': 'Au moins une minuscule',
  'admin.pwd.digit':     'Au moins un chiffre',
  'admin.pwd.special':   'Au moins un caractère spécial',

  // Admin — album settings modal
  'admin.access':          'Accès',
  'admin.visPublic':       'Public',
  'admin.visPublicHint':   '— accessible sans connexion',
  'admin.visRestricted':   'Restreint',
  'admin.visRestrictedHint':'— utilisateurs sélectionnés uniquement',
  'admin.authorizedUsers': 'Utilisateurs autorisés',
};
