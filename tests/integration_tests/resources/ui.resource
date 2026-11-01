*** Settings ***
Documentation     Helpers for the end-to-end UI suites (suites/ui_*.robot): test data
...               made through the API from the page (the browser's session), photos
...               generated in the page (a canvas → a real PNG), files dropped on an
...               element the way a browser does (DataTransfer + drag events).
...               JavaScript here avoids `${…}` template literals: Robot would read them.
Resource          admin.resource

*** Keywords ***
Admin API
    [Documentation]    fetch() with the page's session; ${body} is a JSON string. Returns the HTTP status.
    [Arguments]    ${method}    ${path}    ${body}=null
    ${status}=    Evaluate JavaScript    ${NONE}
    ...    async () => {
    ...      const opts = { method: '${method}' };
    ...      const body = ${body};
    ...      if (body !== null) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    ...      return (await fetch('${path}', opts)).status;
    ...    }
    RETURN    ${status}

Create Album By API
    [Arguments]    ${name}
    Admin API    DELETE    /api/admin/albums/${name}
    ${s}=    Admin API    POST    /api/admin/albums    {"name": "${name}"}
    Should Be Equal As Integers    ${s}    201

Delete Albums By API
    [Arguments]    @{names}
    FOR    ${n}    IN    @{names}
        Run Keyword And Ignore Error    Admin API    DELETE    /api/admin/albums/${n}
    END

Upload Generated Photos
    [Documentation]    ${count} small PNGs drawn in the page (random colours: never identical,
    ...                unless ${colour} is given), uploaded to ${url}. Returns the count accepted.
    [Arguments]    ${url}    ${count}=1    ${prefix}=gen    ${colour}=${EMPTY}
    ${n}=    Evaluate JavaScript    ${NONE}
    ...    async () => {
    ...      const fd = new FormData();
    ...      for (let i = 0; i < ${count}; i++) {
    ...        const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    ...        const g = c.getContext('2d');
    ...        g.fillStyle = '${colour}' || ('hsl(' + Math.floor(Math.random() * 360) + ' 70% 50%)');
    ...        g.fillRect(0, 0, 64, 48);
    ...        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    ...        fd.append('photos', blob, '${prefix}-' + i + '.png');
    ...      }
    ...      const r = await fetch('${url}', { method: 'POST', body: fd });
    ...      return r.ok ? (await r.json()).count : -r.status;
    ...    }
    RETURN    ${n}

Upload Generated Photos As Admin
    [Arguments]    ${album}    ${count}=1    ${prefix}=gen    ${colour}=${EMPTY}
    ${n}=    Upload Generated Photos    /api/admin/albums/${album}/photos    ${count}    ${prefix}    ${colour}
    RETURN    ${n}

Drop Generated Photos On
    [Documentation]    Drop ${count} generated PNG files on the element ${selector}.
    [Arguments]    ${selector}    ${count}=1    ${prefix}=drop
    Evaluate JavaScript    ${selector}
    ...    async (el) => {
    ...      const dt = new DataTransfer();
    ...      for (let i = 0; i < ${count}; i++) {
    ...        const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    ...        const g = c.getContext('2d');
    ...        g.fillStyle = 'hsl(' + Math.floor(Math.random() * 360) + ' 70% 50%)'; g.fillRect(0, 0, 64, 48);
    ...        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    ...        dt.items.add(new File([blob], '${prefix}-' + i + '-' + Date.now() + '.png', { type: 'image/png' }));
    ...      }
    ...      for (const type of ['dragenter', 'dragover', 'drop']) {
    ...        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    ...      }
    ...    }

Album Photo Count
    [Documentation]    The number of photos the API lists for ${album}.
    [Arguments]    ${album}
    ${n}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${album}').then((r) => r.json()).then((d) => (d.photos || []).length)
    RETURN    ${n}

User Id
    [Arguments]    ${username}
    ${id}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/users').then((r) => r.json()).then((d) => (d.users.find((u) => u.username === '${username}') || {}).id || 0)
    RETURN    ${id}

Make Album Restricted For
    [Documentation]    Restricted album, readable and changeable by the given user ids only.
    [Arguments]    ${album}    @{user_ids}
    ${ids}=    Evaluate    ",".join(str(i) for i in $user_ids)
    ${s}=    Admin API    PUT    /api/admin/albums/${album}/settings    {"visibility": "restricted", "userIds": [${ids}], "notifyNew": true, "gpsPrivacy": "exact"}
    Should Be Equal As Integers    ${s}    200

Open Page As
    [Documentation]    A fresh browser context signed in as ${user}, on ${path}.
    [Arguments]    ${user}    ${password}    ${path}=/
    New Context    locale=fr-FR
    New Page       ${BASE_URL}/login.html
    Submit Login Form    ${user}    ${password}
    Wait For Elements State    css=body.page-home    visible    timeout=12s
    Go To    ${BASE_URL}${path}

Open Page Anonymously
    [Arguments]    ${path}=/
    New Context    locale=fr-FR
    New Page       ${BASE_URL}${path}

Topmost Element Is
    [Documentation]    The element at the centre of ${selector} is it (or inside it): nothing covers it.
    [Arguments]    ${selector}
    ${ok}=    Evaluate JavaScript    ${selector}
    ...    (el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }
    Should Be True    ${ok}
