export default {
  // Navigation
  'nav.back':    '← Back',
  'nav.signIn':  'Sign in',
  'nav.signOut': 'Sign out',
  'nav.admin':   'Admin',

  // Home
  'home.empty':        'Add folders inside <code>photos/</code> to create albums.',
  'home.mapCard.name':  'Map',
  'home.mapCard.sub':   'All locations',
  'home.globeCard.name': '3D Globe',
  'home.globeCard.sub':  '3D view of Earth',
  'word.album':        'album{s}',
  'word.photo':        'photo{s}',

  // Album card
  'album.empty':      'Empty album',
  'album.restricted': 'Restricted album',
  'album.photos':     '{n} photo{s}',

  // Viewer
  'viewer.map':          'Map',
  'viewer.albumMap':     'Album map',
  'viewer.download':     'Download',
  'viewer.delete':       'Delete',
  'viewer.actions':      'Actions',
  'viewer.emptyTitle':   'Oops, nothing here!',
  'viewer.emptySub':     'This album is as empty as my fridge on a Sunday night.',
  'viewer.like':         'Like',
  'viewer.zoomIn':       'Zoom in',
  'viewer.zoomOut':      'Zoom out',
  'viewer.recenter':     'Recenter',
  'viewer.gyro':         'Gyroscope',
  'viewer.scrollLeft':   'Scroll left',
  'viewer.scrollRight':  'Scroll right',
  'viewer.expandMap':    'Expand map',
  'viewer.close':        'Close',
  'viewer.deleteConfirm':'Delete "{filename}"?',
  'viewer.deleteError':  'Delete failed: {msg}',
  'viewer.downloadZip':  'Download album (ZIP)',
  'viewer.share':        'Share',
  'viewer.shareTitle':   'Share album',
  'viewer.shareDuration':'Duration',
  'viewer.share1d':      '1 day',
  'viewer.share7d':      '7 days',
  'viewer.share30d':     '30 days',
  'viewer.shareCreate':  'Create link',
  'viewer.shareCopy':    'Copy',
  'viewer.shareCopied':  'Copied!',
  'viewer.shareExpires': 'Expires on {date}',
  'viewer.shareError':   'Could not create share link.',
  'viewer.exif':         'EXIF info',

  // EXIF fields
  'exif.camera':       'Camera',
  'exif.lens':         'Lens',
  'exif.dateTime':     'Date / Time',
  'exif.iso':          'ISO',
  'exif.aperture':     'Aperture',
  'exif.shutterSpeed': 'Shutter speed',
  'exif.focalLength':  'Focal length',
  'exif.dimensions':   'Dimensions',

  // Login
  'login.back':         '← Back',
  'login.username':     'Username',
  'login.password':     'Password',
  'login.submit':       'Sign in',
  'login.signingIn':    'Signing in…',
  'login.errorInvalid': 'Incorrect username or password.',
  'login.errorGeneric': 'Unable to sign in. Please try again.',
  'login.errorNetwork': 'Network error. Please try again.',

  // Map
  'globe.title':     '3D Globe',

  'map.title':       'Map',
  'map.back':        'Back',
  'map.showRoute':   'Show route',
  'map.hideRoute':   'Hide route',
  'map.viewInAlbum': 'View in album',
  'map.noPhotos':    'No geotagged photos',
  'map.photos':      '{n} geotagged photo{s}',

  // Format (views)
  'format.view':    '{n} view',
  'format.views':   '{n} views',
  'format.views_k': '{n}k views',
  'format.views_M': '{n}M views',

  // Admin — header
  'admin.title':   'Admin',
  'admin.back':    '← Photo Book',
  'admin.signOut': 'Sign out',

  // Admin — albums
  'admin.albums':       'Albums',
  'admin.newAlbum':     '+ New album',
  'admin.albumName':    'Album name',
  'admin.settings':     'Access settings',
  'admin.uploadPhotos': 'Upload photos',
  'admin.rename':       'Rename',
  'admin.create':       'Create',
  'admin.cancel':       'Cancel',
  'admin.save':         'Save',

  // Admin — users
  'admin.users':    'Users',
  'admin.newUser':  '+ New user',
  'admin.generate': 'Generate',

  // Admin — misc sections
  'admin.system':    'System',
  'admin.topPhotos': 'Top photos',

  // Admin — activity log
  'admin.activityLog':      'Activity log',
  'admin.clearLogs':        'Clear logs',
  'admin.clearLogsConfirm': 'Clear all activity logs?',
  'admin.allActions':       'All actions',

  // Admin — log action labels
  'admin.log.login':        'Login',
  'admin.log.logout':       'Logout',
  'admin.log.photo_like':   'Like',
  'admin.log.photo_upload': 'Upload',
  'admin.log.photo_delete': 'Delete photo',
  'admin.log.album_create': 'Create album',
  'admin.log.album_rename': 'Rename album',
  'admin.log.album_delete': 'Delete album',
  'admin.log.user_create':  'Create user',
  'admin.log.user_delete':  'Delete user',

  // Admin — table columns
  'admin.col.album':     'Album',
  'admin.col.photos':    'Photos',
  'admin.col.views':     'Views',
  'admin.col.likes':     'Likes',
  'admin.col.username':  'Username',
  'admin.col.role':      'Role',
  'admin.col.created':   'Created',
  'admin.col.lastLogin': 'Last login',
  'admin.col.container': 'Container',
  'admin.col.image':     'Image',
  'admin.col.reference': 'Reference / digest',
  'admin.col.status':    'Status',
  'admin.col.photo':     'Photo',
  'admin.col.date':      'Date',
  'admin.col.action':    'Action',
  'admin.col.user':      'User',
  'admin.col.ip':        'IP',
  'admin.col.details':   'Details',

  // Admin — states
  'admin.loading':        'Loading…',
  'admin.noAlbums':       'No albums yet.',
  'admin.noUsers':        'No users.',
  'admin.noData':         'No data yet.',
  'admin.noEntries':      'No entries.',
  'admin.noDockerSocket': 'Docker socket unavailable.',
  'admin.noBasicUsers':   'No basic users.',
  'admin.failedLoad':     'Failed to load.',
  'admin.guest':          'Guest',

  // Admin — log pagination
  'admin.prev':     '← Prev',
  'admin.next':     'Next →',
  'admin.pageInfo': 'Page {page} / {pages} · {total} entries',

  // Admin — confirm / alert
  'admin.confirmDeleteAlbum': 'Delete album "{name}" and all its photos?\nThis cannot be undone.',
  'admin.confirmDeleteUser':  'Delete user "{name}"?\nThis cannot be undone.',
  'admin.renameFailed':       'Rename failed',
  'admin.deleteFailed':       'Delete failed',
  'admin.createFailed':       'Create failed',
  'admin.roleFailed':         'Failed to update role',
  'admin.pwdFailed':          'Failed to update password',
  'admin.saveFailed':         'Failed to save',

  // Admin — upload modal
  'admin.uploadTo':       'Upload to',
  'admin.dropHere':       'Drop photos here',
  'admin.addFiles':       'Add files',
  'admin.upload':         'Upload',
  'admin.filesSelected':  '{n} file{s} selected',
  'admin.networkError':   'Network error',

  // Admin — password modal
  'admin.changePassword': 'Change password',
  'admin.newPassword':    'New password',

  // Admin — password validation
  'admin.pwd.minLength': 'At least 8 characters required',
  'admin.pwd.uppercase': 'At least one uppercase letter required',
  'admin.pwd.lowercase': 'At least one lowercase letter required',
  'admin.pwd.digit':     'At least one digit required',
  'admin.pwd.special':   'At least one special character required',

  // Admin — album settings modal
  'admin.access':           'Access',
  'admin.visPublic':        'Public',
  'admin.visPublicHint':    '— accessible without login',
  'admin.visRestricted':    'Restricted',
  'admin.visRestrictedHint':'— selected users only',
  'admin.authorizedUsers':  'Authorized users',

  // Push notifications
  'viewer.subscribe':      'Subscribe to notifications',
  'viewer.unsubscribe':    'Unsubscribe from notifications',
  'viewer.subscribed':     'Subscribed',
  'admin.pushSubscribers': 'Push subscribers',
  'admin.notifyTitle':     'Title',
  'admin.notifyBody':      'Message',
  'admin.notifySend':      'Send',
  'admin.notifySent':      'Sent!',
};
