export default {
  // Navigation
  'nav.back':    '← Volver',
  'nav.signIn':  'Iniciar sesión',
  'nav.signOut': 'Cerrar sesión',
  'nav.admin':   'Admin',

  // Home
  'home.empty':        'Añade carpetas en <code>photos/</code> para crear álbumes.',
  'home.mapCard.name': 'Mapa',
  'home.mapCard.sub':  'Todas las ubicaciones',
  'word.album':        'álbum{s}',
  'word.photo':        'foto{s}',

  // Album card
  'album.empty':      'Álbum vacío',
  'album.restricted': 'Álbum restringido',
  'album.photos':     '{n} foto{s}',

  // Viewer
  'viewer.map':          'Mapa',
  'viewer.albumMap':     'Mapa del álbum',
  'viewer.download':     'Descargar',
  'viewer.delete':       'Eliminar',
  'viewer.actions':      'Acciones',
  'viewer.emptyTitle':   '¡Vaya, aquí no hay nada!',
  'viewer.emptySub':     'Este álbum está tan vacío como mi nevera un domingo por la noche.',
  'viewer.like':         'Me gusta',
  'viewer.zoomIn':       'Acercar',
  'viewer.zoomOut':      'Alejar',
  'viewer.recenter':     'Recentrar',
  'viewer.gyro':         'Giroscopio',
  'viewer.scrollLeft':   'Desplazar a la izquierda',
  'viewer.scrollRight':  'Desplazar a la derecha',
  'viewer.expandMap':    'Ampliar mapa',
  'viewer.close':        'Cerrar',
  'viewer.deleteConfirm':'¿Eliminar "{filename}"?',
  'viewer.deleteError':  'Error al eliminar: {msg}',

  // Login
  'login.back':         '← Volver',
  'login.username':     'Usuario',
  'login.password':     'Contraseña',
  'login.submit':       'Iniciar sesión',
  'login.signingIn':    'Conectando…',
  'login.errorInvalid': 'Usuario o contraseña incorrectos.',
  'login.errorGeneric': 'No se puede iniciar sesión. Inténtelo de nuevo.',
  'login.errorNetwork': 'Error de red. Inténtelo de nuevo.',

  // Map
  'map.title':       'Mapa',
  'map.back':        'Volver',
  'map.showRoute':   'Mostrar ruta',
  'map.hideRoute':   'Ocultar ruta',
  'map.viewInAlbum': 'Ver en el álbum',
  'map.noPhotos':    'No hay fotos geolocalizadas',
  'map.photos':      '{n} foto{s} geolocalizada{s}',

  // Format (views)
  'format.view':    '{n} vista',
  'format.views':   '{n} vistas',
  'format.views_k': '{n} k vistas',
  'format.views_M': '{n} M vistas',

  // Admin — header
  'admin.title':   'Admin',
  'admin.back':    '← Photo Book',
  'admin.signOut': 'Cerrar sesión',

  // Admin — albums
  'admin.albums':       'Álbumes',
  'admin.newAlbum':     '+ Nuevo álbum',
  'admin.albumName':    'Nombre del álbum',
  'admin.settings':     'Configuración de acceso',
  'admin.uploadPhotos': 'Subir fotos',
  'admin.rename':       'Renombrar',
  'admin.create':       'Crear',
  'admin.cancel':       'Cancelar',
  'admin.save':         'Guardar',

  // Admin — users
  'admin.users':    'Usuarios',
  'admin.newUser':  '+ Nuevo usuario',
  'admin.generate': 'Generar',

  // Admin — misc sections
  'admin.system':    'Sistema',
  'admin.topPhotos': 'Mejores fotos',

  // Admin — activity log
  'admin.activityLog':      'Registro de actividad',
  'admin.clearLogs':        'Borrar registros',
  'admin.clearLogsConfirm': '¿Borrar todos los registros de actividad?',
  'admin.allActions':       'Todas las acciones',

  // Admin — log action labels
  'admin.log.login':        'Inicio de sesión',
  'admin.log.logout':       'Cierre de sesión',
  'admin.log.photo_like':   'Me gusta',
  'admin.log.photo_upload': 'Subida',
  'admin.log.photo_delete': 'Eliminar foto',
  'admin.log.album_create': 'Crear álbum',
  'admin.log.album_rename': 'Renombrar álbum',
  'admin.log.album_delete': 'Eliminar álbum',
  'admin.log.user_create':  'Crear usuario',
  'admin.log.user_delete':  'Eliminar usuario',

  // Admin — table columns
  'admin.col.album':     'Álbum',
  'admin.col.photos':    'Fotos',
  'admin.col.views':     'Vistas',
  'admin.col.likes':     'Me gusta',
  'admin.col.username':  'Usuario',
  'admin.col.role':      'Rol',
  'admin.col.created':   'Creado',
  'admin.col.lastLogin': 'Último acceso',
  'admin.col.container': 'Contenedor',
  'admin.col.image':     'Imagen',
  'admin.col.reference': 'Referencia / resumen',
  'admin.col.status':    'Estado',
  'admin.col.photo':     'Foto',
  'admin.col.date':      'Fecha',
  'admin.col.action':    'Acción',
  'admin.col.user':      'Usuario',
  'admin.col.ip':        'IP',
  'admin.col.details':   'Detalles',

  // Admin — states
  'admin.loading':        'Cargando…',
  'admin.noAlbums':       'Sin álbumes.',
  'admin.noUsers':        'Sin usuarios.',
  'admin.noData':         'Sin datos.',
  'admin.noEntries':      'Sin entradas.',
  'admin.noDockerSocket': 'Socket de Docker no disponible.',
  'admin.noBasicUsers':   'Sin usuarios básicos.',
  'admin.failedLoad':     'Error al cargar.',
  'admin.guest':          'Invitado',

  // Admin — log pagination
  'admin.prev':     '← Ant.',
  'admin.next':     'Sig. →',
  'admin.pageInfo': 'Página {page} / {pages} · {total} entrada{s}',

  // Admin — confirm / alert
  'admin.confirmDeleteAlbum': '¿Eliminar el álbum "{name}" y todas sus fotos?\nEsta acción es irreversible.',
  'admin.confirmDeleteUser':  '¿Eliminar el usuario "{name}"?\nEsta acción es irreversible.',
  'admin.renameFailed':       'Error al renombrar',
  'admin.deleteFailed':       'Error al eliminar',
  'admin.createFailed':       'Error al crear',
  'admin.roleFailed':         'Error al actualizar el rol',
  'admin.pwdFailed':          'Error al actualizar la contraseña',
  'admin.saveFailed':         'Error al guardar',

  // Admin — upload modal
  'admin.uploadTo':      'Subir a',
  'admin.dropHere':      'Suelta las fotos aquí',
  'admin.addFiles':      'Añadir archivos',
  'admin.upload':        'Subir',
  'admin.filesSelected': '{n} archivo{s} seleccionado{s}',
  'admin.networkError':  'Error de red',

  // Admin — password modal
  'admin.changePassword': 'Cambiar contraseña',
  'admin.newPassword':    'Nueva contraseña',

  // Admin — password validation
  'admin.pwd.minLength': 'Mínimo 8 caracteres',
  'admin.pwd.uppercase': 'Al menos una mayúscula',
  'admin.pwd.lowercase': 'Al menos una minúscula',
  'admin.pwd.digit':     'Al menos un número',
  'admin.pwd.special':   'Al menos un carácter especial',

  // Admin — album settings modal
  'admin.access':           'Acceso',
  'admin.visPublic':        'Público',
  'admin.visPublicHint':    '— accesible sin iniciar sesión',
  'admin.visRestricted':    'Restringido',
  'admin.visRestrictedHint':'— solo usuarios seleccionados',
  'admin.authorizedUsers':  'Usuarios autorizados',
};
