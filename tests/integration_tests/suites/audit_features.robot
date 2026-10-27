*** Settings ***
Documentation     End-to-end checks of the 2026-10 audit features: photo edits (F2),
...               album cover / description (F3), search (F6), uploads that never
...               overwrite (F7), System tab (F8), notification switch (F9), GPS
...               privacy (F10), CSP and self-hosted libraries (T6).
Resource          ../resources/admin.resource
Library           Collections
Suite Setup       Audit Suite Setup
Suite Teardown    Audit Suite Teardown

*** Variables ***
${ALBUM}    robot-audit

*** Keywords ***
Audit Suite Setup
    Login As Admin And Go To Admin
    Delete Album If Exists    ${ALBUM}
    Create Album    ${ALBUM}
    Upload Photos To Album    ${ALBUM}
    ...    ${FIXTURE_DIR}/test-photo-1.png
    ...    ${FIXTURE_DIR}/test-photo-2.png

Audit Suite Teardown
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${ALBUM}', {method:'DELETE'})
    Close Browser

Upload As Admin
    [Arguments]    ${fixture}    ${as_name}    ${type}=image/png
    ${b64}=    Evaluate    base64.b64encode(open(r'${FIXTURE_DIR}/${fixture}', 'rb').read()).decode()    modules=base64
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    async () => {
    ...      const bytes = Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0));
    ...      const fd = new FormData(); fd.append('photos', new Blob([bytes], {type: '${type}'}), '${as_name}');
    ...      return fetch('/api/admin/albums/${ALBUM}/photos', {method: 'POST', body: fd}).then(r => r.json());
    ...    }
    RETURN    ${data}

*** Test Cases ***

F2 Edited Title Caption And Place Replace The File Values
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${ALBUM}/photos/test-photo-1.png/meta', {method:'PUT',
    ...      headers:{'Content-Type':'application/json'},
    ...      body: JSON.stringify({title:'Robot title', description:'Robot caption', location:'Robotville'})}).then(r => r.status)
    Should Be Equal As Integers    ${s}    200
    ${p}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${ALBUM}').then(r => r.json()).then(d => d.photos.find(p => p.filename === 'test-photo-1.png'))
    Should Be Equal    ${p}[name]           Robot title
    Should Be Equal    ${p}[description]    Robot caption
    Should Be Equal    ${p}[location]       Robotville

F3 Chosen Cover And Description Appear In The Album List
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${ALBUM}/details', {method:'PUT', headers:{'Content-Type':'application/json'},
    ...      body: JSON.stringify({cover:'test-photo-2.png', description:'Robot album'})}).then(r => r.status)
    Should Be Equal As Integers    ${s}    200
    ${a}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums').then(r => r.json()).then(l => l.find(a => a.name === '${ALBUM}'))
    Should Contain     ${a}[cover]          test-photo-2.png
    Should Be Equal    ${a}[description]    Robot album

F6 Search Finds The Edited Title Without Accents Or Case
    ${r}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/search?q=ROBOT%20TITLE&album=${ALBUM}').then(r => r.json())
    Should Be Equal As Integers    ${r}[total]    1
    Should Be Equal    ${r}[results][0][filename]    test-photo-1.png

F6 Search Page Shows Results
    Go To    ${BASE_URL}/search.html?q=robotville
    Wait For Elements State    css=.search-tile >> nth=0    visible    timeout=8s
    Get Text    css=.search-tile-name    ==    Robot title

F7 Upload Never Overwrites And Drops Identical Files
    ${same}=    Upload As Admin    test-photo-1.png    test-photo-1.png
    Should Be Equal As Integers    ${same}[count]    0
    Should Be Equal    ${same}[duplicates][0]    test-photo-1.png
    ${other}=    Upload As Admin    test-photo-3.png    test-photo-1.png
    Should Be Equal    ${other}[files][0]    test-photo-1 (2).png
    Should Be Equal    ${other}[renamed][0][to]    test-photo-1 (2).png

F8 System Tab Shows Build Database And Disk
    Go To Admin Page
    Wait For Elements State    css=.sys-card >> nth=3    visible    timeout=8s
    Get Text    id=system-meta    contains    build
    Get Text    id=system-migrations-count    matches    \\(\\d+\\)

F9 Automatic Notifications Can Be Turned Off Per Album
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${ALBUM}/settings', {method:'PUT', headers:{'Content-Type':'application/json'},
    ...      body: JSON.stringify({visibility:'public', userIds:[], notifyNew:false})}).then(r => r.status)
    Should Be Equal As Integers    ${s}    200
    ${settings}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${ALBUM}/settings').then(r => r.json())
    Should Not Be True    ${settings}[notifyNew]

F10 Approximate Position For Visitors, Exact For Admins, No EXIF In Served Files
    Upload As Admin    gps-a.tiff    gps-a.tiff    image/tiff
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${ALBUM}/settings', {method:'PUT', headers:{'Content-Type':'application/json'},
    ...      body: JSON.stringify({visibility:'public', userIds:[], gpsPrivacy:'approx'})}).then(r => r.status)
    Should Be Equal As Integers    ${s}    200
    ${visitor}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${ALBUM}', {credentials:'omit'}).then(r => r.json()).then(d => d.photos.find(p => p.filename === 'gps-a.tiff').gps)
    Should Be Equal As Numbers    ${visitor}[lat]    45.5
    Should Be Equal As Numbers    ${visitor}[lng]    -73.57
    ${admin}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${ALBUM}').then(r => r.json()).then(d => d.photos.find(p => p.filename === 'gps-a.tiff').gps)
    Should Be Equal As Numbers    ${admin}[lat]    45.5017
    # the original TIFF (with its EXIF) only for the admin; visitors get a JPEG copy without metadata
    ${types}=    Evaluate JavaScript    ${NONE}
    ...    () => Promise.all([
    ...      fetch('/photos/${ALBUM}/gps-a.tiff', {credentials:'omit'}).then(r => r.headers.get('content-type') + ' ' + r.headers.get('cache-control')),
    ...      fetch('/photos/${ALBUM}/gps-a.tiff').then(r => r.headers.get('content-type'))])
    Should Start With    ${types}[0]    image/jpeg
    Should Contain       ${types}[0]    private
    Should Start With    ${types}[1]    image/tiff

T6 Pages Carry A Strict CSP And Load Libraries From The Site
    ${h}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/viewer.html').then(r => r.headers.get('content-security-policy'))
    Should Contain    ${h}    default-src 'self'
    Should Contain    ${h}    frame-ancestors 'none'
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/vendor/pannellum/pannellum.js').then(r => r.status)
    Should Be Equal As Integers    ${s}    200
