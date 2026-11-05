*** Settings ***
Documentation     The admin's albums, through the interface — what a click does, not
...               only what the API answers: the toolbar (filter, sort, group, remembered),
...               the album line (collection, dates), rename, settings, photo editor
...               (title, cover, collection), the upload window, drops on a row,
...               duplicates.
Resource          ../resources/ui.resource
Suite Setup       Prepare Albums
Suite Teardown    Clean Up

*** Variables ***
${A}    ui-alpha
${B}    ui-beta
${C}    ui-gamma

*** Keywords ***
Prepare Albums
    Login As Admin And Go To Admin
    Evaluate JavaScript    ${NONE}    () => localStorage.removeItem('pb.adminAlbums')
    Create Album By API    ${A}
    Create Album By API    ${B}
    Create Album By API    ${C}
    Upload Generated Photos As Admin    ${A}    2    alpha
    Upload Generated Photos As Admin    ${B}    1    beta
    Admin API    PUT    /api/admin/albums/${A}/details    {"collection": "Voyages"}
    Admin API    PUT    /api/admin/albums/${B}/settings    {"visibility": "restricted", "userIds": [], "notifyNew": true, "gpsPrivacy": "exact"}
    Go To Admin Page
    Wait For Elements State    css=tr[data-album="${C}"]    visible    timeout=8s

Clean Up
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}    () => localStorage.removeItem('pb.adminAlbums')
    Delete Albums By API    ${A}    ${B}    ${C}    ui-alpha-renamed    ui-dup-1    ui-dup-2
    Close Browser

Reset Toolbar
    Fill Text    id=album-filter-q    ${EMPTY}
    Select Options By    id=album-filter-vis    value    ${EMPTY}
    Select Options By    id=album-filter-coll    value    ${EMPTY}
    Select Options By    id=album-group-by    value    ${EMPTY}
    Select Options By    id=album-sort-by    value    views

Visible Albums
    ${names}=    Evaluate JavaScript    ${NONE}
    ...    () => [...document.querySelectorAll('#albums-body tr[data-album]')].map((r) => r.dataset.album).filter((n) => n.startsWith('ui-'))
    RETURN    ${names}

*** Test Cases ***
Filter By Text Narrows The Table And The Count
    Reset Toolbar
    Fill Text    id=album-filter-q    alph
    ${names}=    Visible Albums
    Should Be Equal    ${names}    ${{ ['${A}'] }}
    Get Text    id=album-filter-count    matches    ^1\\b

Filter By Text Also Matches The Collection
    Reset Toolbar
    Fill Text    id=album-filter-q    voyag
    ${names}=    Visible Albums
    Should Be Equal    ${names}    ${{ ['${A}'] }}

Filter Without Match Says So
    Reset Toolbar
    Fill Text    id=album-filter-q    zzz-nothing
    Get Element Count    css=#albums-body tr[data-album]    ==    0
    Get Element Count    css=#albums-body .admin-empty    ==    1

Filter By Visibility Keeps Only Restricted Albums
    Reset Toolbar
    Select Options By    id=album-filter-vis    value    restricted
    ${names}=    Visible Albums
    Should Be Equal    ${names}    ${{ ['${B}'] }}

Filter By Collection And Without Collection
    Reset Toolbar
    Select Options By    id=album-filter-coll    value    Voyages
    ${names}=    Visible Albums
    Should Be Equal    ${names}    ${{ ['${A}'] }}
    Select Options By    id=album-filter-coll    value    -
    ${names}=    Visible Albums
    Should Not Contain    ${names}    ${A}
    Should Contain    ${names}    ${C}

Sort A To Z Orders The Rows
    Reset Toolbar
    Select Options By    id=album-sort-by    value    name
    ${names}=    Visible Albums
    Should Be Equal    ${names}    ${{ ['${A}', '${B}', '${C}'] }}

Sort By Photos Puts The Fullest First
    Reset Toolbar
    Select Options By    id=album-sort-by    value    photos
    ${names}=    Visible Albums
    Should Be Equal    ${names}[0]    ${A}

Group By Collection Shows Headings With Counts
    Reset Toolbar
    Select Options By    id=album-group-by    value    collection
    Get Element Count    css=#albums-body tr.admin-group-row    >=    2
    Get Text    css=#albums-body tr.admin-group-row >> nth=0    contains    Voyages

Group By Visibility Separates Public And Restricted
    Reset Toolbar
    Select Options By    id=album-group-by    value    visibility
    ${titles}=    Get Elements    css=#albums-body tr.admin-group-row
    Length Should Be    ${titles}    2

Toolbar Choices Are Remembered After A Reload
    Reset Toolbar
    Fill Text    id=album-filter-q    gam
    Select Options By    id=album-sort-by    value    name
    Reload
    Wait For Elements State    css=#albums-body tr[data-album]    visible    timeout=8s
    Get Property    id=album-filter-q    value    ==    gam
    Get Selected Options    id=album-sort-by    value    ==    name
    ${names}=    Visible Albums
    Should Be Equal    ${names}    ${{ ['${C}'] }}
    Reset Toolbar

Album Line Shows Its Collection
    Reset Toolbar
    Get Text    css=tr[data-album="${A}"] .admin-album-meta    contains    Voyages

Rename Then Cancel Keeps The Name
    Reset Toolbar
    Click    css=[data-rename="${C}"]
    Wait For Elements State    css=tr[data-album="${C}"] .admin-rename-form input    visible
    Fill Text    css=tr[data-album="${C}"] .admin-rename-form input    something-else
    Click    css=tr[data-album="${C}"] .admin-rename-cancel
    Get Text    css=tr[data-album="${C}"] td >> nth=0    contains    ${C}

Rename Through The Form
    Reset Toolbar
    Click    css=[data-rename="${A}"]
    Fill Text    css=tr[data-album="${A}"] .admin-rename-form input    ui-alpha-renamed
    Click    css=tr[data-album="${A}"] .admin-rename-form button[type="submit"]
    Wait For Elements State    css=tr[data-album="ui-alpha-renamed"]    visible    timeout=8s
    Get Element Count    css=tr[data-album="${A}"]    ==    0
    # and back, for the following tests
    Click    css=[data-rename="ui-alpha-renamed"]
    Fill Text    css=tr[data-album="ui-alpha-renamed"] .admin-rename-form input    ${A}
    Click    css=tr[data-album="ui-alpha-renamed"] .admin-rename-form button[type="submit"]
    Wait For Elements State    css=tr[data-album="${A}"]    visible    timeout=8s

Settings Window Makes An Album Restricted And Back
    Reset Toolbar
    Click    css=[data-settings="${C}"]
    Wait For Elements State    id=album-settings-overlay    visible    timeout=5s
    Click    id=vis-restricted
    Wait For Elements State    id=album-settings-users    visible
    Click    id=album-settings-save-btn
    Wait For Elements State    id=album-settings-overlay    hidden    timeout=5s
    Get Text    css=tr[data-album="${C}"] .admin-visibility-badge    ==    restricted
    Click    css=[data-settings="${C}"]
    Wait For Elements State    id=album-settings-overlay    visible    timeout=5s
    Get Checkbox State    id=vis-restricted    ==    checked
    Click    id=vis-public
    Click    id=album-settings-save-btn
    Wait For Elements State    id=album-settings-overlay    hidden    timeout=5s
    Get Text    css=tr[data-album="${C}"] .admin-visibility-badge    ==    public

Settings Window Keeps The GPS Privacy Choice
    Click    css=[data-settings="${C}"]
    Wait For Elements State    id=album-settings-overlay    visible    timeout=5s
    Click    css=input[name="album-gps"][value="approx"]
    Click    id=album-settings-save-btn
    Wait For Elements State    id=album-settings-overlay    hidden    timeout=5s
    Click    css=[data-settings="${C}"]
    Wait For Elements State    id=album-settings-overlay    visible    timeout=5s
    Get Checkbox State    css=input[name="album-gps"][value="approx"]    ==    checked
    Click    css=input[name="album-gps"][value="exact"]
    Click    id=album-settings-save-btn
    Wait For Elements State    id=album-settings-overlay    hidden    timeout=5s

Photo Editor Saves A Title Shown In The Viewer
    Click    css=[data-photos="${A}"]
    Wait For Elements State    css=#photos-editor .photo-edit-row >> nth=0    visible    timeout=8s
    Fill Text    css=#photos-editor .photo-edit-row >> nth=0 >> css=[data-field="title"]    Titre robot
    Click    css=#photos-editor .photo-edit-row >> nth=0 >> css=[data-save]
    Get Text    css=#photos-editor .photo-edit-row >> nth=0 >> css=.photo-edit-status    !=    ${EMPTY}
    ${titles}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${A}').then((r) => r.json()).then((d) => d.photos.map((p) => p.name))
    Should Contain    ${titles}    Titre robot
    Click    id=photos-close-btn

Photo Editor Sets The Cover
    Click    css=[data-photos="${A}"]
    Wait For Elements State    css=#photos-editor [data-cover] >> nth=1    visible    timeout=8s
    ${file}=    Get Attribute    css=#photos-editor [data-cover] >> nth=1    data-cover
    Click    css=#photos-editor [data-cover] >> nth=1
    Get Classes    css=#photos-editor [data-cover] >> nth=1    contains    is-cover
    ${cover}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums').then((r) => r.json()).then((l) => l.find((a) => a.name === '${A}').cover)
    Should Contain    ${cover}    ${file}
    Click    id=photos-close-btn

Photo Editor Saves The Collection
    Click    css=[data-photos="${C}"]
    Wait For Elements State    id=album-coll-input    visible    timeout=8s
    Fill Text    id=album-coll-input    Famille
    Click    id=album-desc-save
    Get Text    id=album-desc-status    !=    ${EMPTY}
    Click    id=photos-close-btn
    Go To Admin Page
    Reset Toolbar
    Get Text    css=tr[data-album="${C}"] .admin-album-meta    contains    Famille

Upload Window Lets A File Be Removed Before Upload
    Click    css=[data-upload="${C}"]
    Wait For Elements State    id=upload-overlay    visible    timeout=5s
    Upload File By Selector    id=upload-file-input    ${FIXTURE_DIR}/test-photo-1.png
    Upload File By Selector    id=upload-file-input    ${FIXTURE_DIR}/test-photo-2.png
    Get Element Count    css=#upload-file-list .upload-file-item    ==    2
    Click    css=#upload-file-list .upload-file-remove >> nth=0
    Get Element Count    css=#upload-file-list .upload-file-item    ==    1
    Get Element States    id=upload-start-btn    contains    enabled
    Click    css=#upload-file-list .upload-file-remove >> nth=0
    Get Element States    id=upload-start-btn    contains    disabled
    Click    id=upload-close-btn
    Wait For Elements State    id=upload-overlay    hidden

Upload Window Reports A Duplicate
    Click    css=[data-upload="${C}"]
    Wait For Elements State    id=upload-overlay    visible    timeout=5s
    Upload File By Selector    id=upload-file-input    ${FIXTURE_DIR}/test-photo-3.png
    Click    id=upload-start-btn
    Wait For Elements State    id=upload-overlay    hidden    timeout=30s
    # the same file again: dropped as identical, the window says so
    Click    css=[data-upload="${C}"]
    Upload File By Selector    id=upload-file-input    ${FIXTURE_DIR}/test-photo-3.png
    Click    id=upload-start-btn
    Wait For Elements State    id=upload-report    visible    timeout=30s
    Get Text    id=upload-report    contains    test-photo-3.png
    Click    id=upload-close-btn

Photos Dropped On A Row Go Into That Album
    Reset Toolbar
    ${before}=    Album Photo Count    ${C}
    Drop Generated Photos On    css=tr[data-album="${C}"] td >> nth=0    2    rowdrop
    Wait Until Keyword Succeeds    20s    1s    Album Has At Least    ${C}    ${before + 2}
    Get Text    css=tr[data-album="${C}"] td >> nth=1    ==    ${{ str(${before} + 2) }}

Duplicates Lists Identical Files Across Albums And Deletes One
    Create Album By API    ui-dup-1
    Create Album By API    ui-dup-2
    Upload Generated Photos As Admin    ui-dup-1    1    same    \#123456
    Upload Generated Photos As Admin    ui-dup-2    1    same    \#123456
    Go To Admin Page
    Click    id=dup-btn
    # this test's pair (other suites' photos may form groups too)
    Wait For Elements State    css=#dup-results .admin-dup-group >> text=ui-dup-1    visible    timeout=30s
    Get Text    id=dup-results    contains    ui-dup-1
    Get Text    id=dup-results    contains    ui-dup-2
    Handle Future Dialogs    action=accept
    Click    css=#dup-results [data-album="ui-dup-2"][data-dup-delete]
    Wait Until Keyword Succeeds    20s    1s    Album Has Exactly    ui-dup-2    0

An Album Just Created Is On The Home Page When Coming Back
    Go To    ${BASE_URL}/
    Wait For Elements State    css=a[href="/admin.html"]    visible    timeout=10s
    Click    css=a[href="/admin.html"] >> nth=0
    Wait For Elements State    id=new-album-btn    visible    timeout=10s
    Create Album    ui-back-new
    Go Back
    Wait For Elements State    css=#album-grid a.album-card[href*="ui-back-new"]    visible    timeout=10s
    Run Keyword And Ignore Error    Admin API    DELETE    /api/admin/albums/ui-back-new

*** Keywords ***
Album Has At Least
    [Arguments]    ${album}    ${n}
    ${count}=    Album Photo Count    ${album}
    Should Be True    ${count} >= ${n}

Album Has Exactly
    [Arguments]    ${album}    ${n}
    ${count}=    Album Photo Count    ${album}
    Should Be Equal As Integers    ${count}    ${n}
