*** Settings ***
Documentation     Articles: the admin writes one in the editor (photos chosen in the
...               picker, a live preview), readers find it on the home page and in the
...               album's journal, a draft stays hidden, an album may hold articles only
...               (photos borrowed from another album), a restricted album's stories stay
...               restricted, a member cannot write; the globe's route button.
Resource          ../resources/ui.resource
Suite Setup       Prepare
Suite Teardown    Clean Up

*** Variables ***
${TRIP}       ui-art-trip
${NOTES}      ui-art-notes
${SECRET}     ui-art-secret

*** Keywords ***
Prepare
    Login As Admin
    Delete Albums By API    ${TRIP}    ${NOTES}    ${SECRET}
    Create Album By API    ${TRIP}
    Create Album By API    ${NOTES}
    Create Album By API    ${SECRET}
    ${n}=    Upload Generated Photos As Admin    ${TRIP}    3    trip
    Should Be Equal As Integers    ${n}    3
    Upload Generated Photos As Admin    ${SECRET}    1    secret
    Make Album Restricted For    ${SECRET}
    ${admin_ctx}=    Get Context Ids    Active
    Set Suite Variable    ${ADMIN_CTX}    ${admin_ctx}[0]
    # a reader's own browser, signed out
    Open Page Anonymously    /
    ${reader_ctx}=    Get Context Ids    Active
    Set Suite Variable    ${READER_CTX}    ${reader_ctx}[0]

Clean Up
    Run Keyword And Ignore Error    Switch Context    ${ADMIN_CTX}
    Delete Albums By API    ${TRIP}    ${NOTES}    ${SECRET}
    Close Browser

As Admin
    Switch Context    ${ADMIN_CTX}

As Reader
    Switch Context    ${READER_CTX}

Create Article By API
    [Documentation]    ${fields}: JSON members after "album". Returns the slug.
    [Arguments]    ${album}    ${fields}
    As Admin
    ${slug}=    Evaluate JavaScript    ${NONE}
    ...    async () => {
    ...      const r = await fetch('/api/admin/articles', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    ...        body: JSON.stringify(Object.assign({ album: '${album}' }, ${fields})) });
    ...      return r.status === 201 ? (await r.json()).slug : 'HTTP ' + r.status;
    ...    }
    Should Not Start With    ${slug}    HTTP
    RETURN    ${slug}

*** Test Cases ***
Admin Writes An Article With Photos From The Picker
    As Admin
    Go To    ${BASE_URL}/write.html?album=${TRIP}
    Wait For Elements State    id=write-title    visible    timeout=10s
    Fill Text    id=write-title    Le premier jour
    Fill Text    id=write-summary    Une arrivée sous la pluie.
    Fill Text    id=write-body    Nous sommes **arrivés**.
    Get Text    id=write-status    ==    Non enregistré
    # the cursor at the end of the text, then two photos: a gallery
    Evaluate JavaScript    id=write-body    (ta) => ta.setSelectionRange(ta.value.length, ta.value.length)
    Click    id=write-photo
    Wait For Elements State    css=.picker-item >> nth=1    visible    timeout=8s
    Click    css=.picker-item >> nth=0
    Click    css=.picker-item >> nth=1
    Get Text    css=.picker-item >> nth=1 >> css=.picker-n    ==    2
    Click    id=picker-insert
    Get Property    id=write-body    value    contains    ![](<trip-
    Wait For Elements State    css=#write-preview-body .art-gallery--2    visible    timeout=5s
    Get Text    css=#write-preview-body strong    ==    arrivés
    Check Checkbox    id=write-published
    Click    id=write-save
    Wait For Elements State    css=.write-status--saved    visible    timeout=8s
    ${url}=    Get Url
    Should Contain    ${url}    a=le-premier-jour
    Get Element Count    css=#write-delete:not([hidden])    ==    1

Reader Finds It On The Home Page And Reads It
    As Reader
    Go To    ${BASE_URL}/
    Wait For Elements State    css=#home-articles a.article-card >> text=Le premier jour    visible    timeout=10s
    # the album with stories opens on its journal
    Get Attribute    css=#album-grid a.album-card[href*="${TRIP}"]    href    contains    album.html
    Click    css=#home-articles a.article-card >> text=Le premier jour
    Wait For Elements State    css=h1.article-title    visible    timeout=10s
    Get Text    css=h1.article-title    ==    Le premier jour
    Get Text    css=.article-lead    ==    Une arrivée sous la pluie.
    Get Element Count    css=#article-body .art-gallery figure    ==    2
    # a photo opens in the viewer
    Get Attribute    css=#article-body .art-photo-link >> nth=0    href    contains    viewer.html?album=${TRIP}&photo=trip-
    Get Element Count    css=#article-edit:not([hidden])    ==    0

A Draft Stays Hidden From Readers
    ${slug}=    Create Article By API    ${TRIP}    { title: 'Pas encore', date: '2026-01-02', published: false }
    As Reader
    Go To    ${BASE_URL}/album.html?album=${TRIP}
    Wait For Elements State    css=#carnet-list .article-card >> nth=0    visible    timeout=10s
    Get Element Count    css=#carnet-list .article-card    ==    1
    Go To    ${BASE_URL}/article.html?album=${TRIP}&a=${slug}
    Wait For Elements State    id=article-message    visible    timeout=8s
    # the admin sees it, marked as a draft, and may write a new one
    As Admin
    Go To    ${BASE_URL}/album.html?album=${TRIP}
    Wait For Elements State    css=.article-card--draft    visible    timeout=10s
    Get Element Count    css=#carnet-new:not([hidden])    ==    1

The Journal Lists Stories In Trip Order With The Photos
    Create Article By API    ${TRIP}    { title: 'Le retour', date: '2030-05-01', published: true }
    As Reader
    Go To    ${BASE_URL}/album.html?album=${TRIP}
    Wait For Elements State    css=#carnet-list .article-card >> nth=1    visible    timeout=10s
    Get Text    css=#carnet-list .article-card-title >> nth=-1    ==    Le retour
    Get Element Count    css=#carnet-grid .carnet-thumb    ==    3
    Get Attribute    id=carnet-all    href    contains    viewer.html?album=${TRIP}

An Album Of Articles Only Borrows Photos
    Create Article By API    ${NOTES}    { title: 'Carnet de notes', published: true, cover: '${TRIP}/trip-2.png', body: '![Empruntée](<${TRIP}/trip-2.png>)' }
    As Reader
    Go To    ${BASE_URL}/
    Wait For Elements State    css=#album-grid a.album-card[href*="${NOTES}"]    visible    timeout=10s
    Get Text    css=#album-grid a.album-card[href*="${NOTES}"] .album-card-count    contains    1 article
    Get Element Count    css=#album-grid a.album-card[href*="${NOTES}"] img    ==    1
    Go To    ${BASE_URL}/album.html?album=${NOTES}
    Wait For Elements State    css=#carnet-list .article-card    visible    timeout=10s
    Get Element Count    css=#carnet-photos[hidden]    ==    1
    Click    css=#carnet-list .article-card
    Wait For Elements State    css=#article-body figure img    visible    timeout=10s
    Get Text    css=#article-body figcaption    ==    Empruntée

A Restricted Album Keeps Its Stories
    ${slug}=    Create Article By API    ${SECRET}    { title: 'Secret', published: true, body: '![](secret-0.png)' }
    As Reader
    Go To    ${BASE_URL}/article.html?album=${SECRET}&a=${slug}
    Wait For Elements State    id=article-message    visible    timeout=8s
    Get Element Count    css=#article-message a[href="login.html"]    ==    1
    Go To    ${BASE_URL}/
    Wait For Elements State    css=#home-articles a.article-card >> nth=0    visible    timeout=10s
    Get Element Count    css=#home-articles a.article-card >> text=Secret    ==    0

A Member Cannot Write
    Open Page As    ${BASIC_USER}    ${BASIC_PASS}    /write.html?album=${TRIP}
    Wait For Elements State    id=write-message    visible    timeout=8s
    Get Element Count    css=#write[hidden]    ==    1
    ${s}=    Admin API    POST    /api/admin/articles    {"album": "${TRIP}", "title": "Non"}
    Should Be Equal As Integers    ${s}    403
    Close Context

The Viewer Links To The Journal
    As Reader
    Go To    ${BASE_URL}/viewer.html?album=${TRIP}
    Wait For Elements State    id=album-articles-btn    visible    timeout=10s
    Get Attribute    id=album-articles-btn    href    contains    album.html?album=${TRIP}

Editing Keeps The Address, Deleting Goes Back To The Journal
    ${slug}=    Create Article By API    ${TRIP}    { title: 'Brouillon à jeter', published: false }
    As Admin
    Go To    ${BASE_URL}/write.html?album=${TRIP}&a=${slug}
    Wait For Elements State    id=write-title    visible    timeout=10s
    Fill Text    id=write-title    Nouveau titre
    Keyboard Key    press    Control+s
    Wait For Elements State    css=.write-status--saved    visible    timeout=8s
    ${url}=    Get Url
    Should Contain    ${url}    a=${slug}
    Handle Future Dialogs    action=accept
    Click    id=write-delete
    Wait For Elements State    css=body.page-album    visible    timeout=10s
    ${n}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/articles/${TRIP}').then((r) => r.json()).then((d) => d.articles.filter((a) => a.slug === '${slug}').length)
    Should Be Equal As Integers    ${n}    0

The Globe Route Button Is Remembered
    As Reader
    Go To    ${BASE_URL}/globe.html?still
    Wait For Elements State    id=globe-route-btn    visible    timeout=10s
    Get Attribute    id=globe-route-btn    aria-pressed    ==    true
    Click    id=globe-route-btn
    Get Attribute    id=globe-route-btn    aria-pressed    ==    false
    Reload
    Wait For Elements State    id=globe-route-btn    visible    timeout=10s
    Get Attribute    id=globe-route-btn    aria-pressed    ==    false
    Click    id=globe-route-btn
    Get Attribute    id=globe-route-btn    aria-pressed    ==    true

Back From The Editor Returns To The Journal, Then Home
    As Admin
    Go To    ${BASE_URL}/
    Wait For Elements State    css=#album-grid a.album-card[href*="${TRIP}"]    visible    timeout=10s
    Click    css=#album-grid a.album-card[href*="${TRIP}"]
    Wait For Elements State    css=body.page-album #carnet-new:not([hidden])    visible    timeout=10s
    Click    id=carnet-new
    Wait For Elements State    id=write-title    visible    timeout=10s
    Click    css=.write-back
    Wait For Elements State    css=body.page-album    visible    timeout=10s
    Click    css=.map-page-back
    Wait For Elements State    css=body.page-home    visible    timeout=10s

An Article Edited Shows Its New Title Once Back
    ${slug}=    Create Article By API    ${TRIP}    { title: 'Avant', published: true }
    As Admin
    Go To    ${BASE_URL}/article.html?album=${TRIP}&a=${slug}
    Wait For Elements State    id=article-edit    visible    timeout=10s
    Click    id=article-edit
    Wait For Elements State    id=write-title    visible    timeout=10s
    Fill Text    id=write-title    Après
    Click    id=write-save
    Wait For Elements State    css=.write-status--saved    visible    timeout=8s
    Click    css=.write-back
    Wait For Elements State    css=h1.article-title >> text=Après    visible    timeout=10s
