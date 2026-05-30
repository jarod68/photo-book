*** Settings ***
Resource          ../resources/admin.resource
Suite Setup       Login As Admin And Go To Admin
Suite Teardown    Close Browser

*** Test Cases ***

GET Stats Returns Albums Array
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/stats').then(r => r.json())
    Should Be True    isinstance(${data}[albums], list)

GET Stats Album Entries Have Required Fields
    ${valid}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/stats').then(r => r.json())
    ...    .then(d => d.albums.length === 0 ||
    ...    d.albums.every(a => 'album' in a && 'photos' in a && 'views' in a && 'likes' in a && 'visibility' in a))
    Should Be True    ${valid}

GET Stats Albums Are Sorted By Views Descending
    ${sorted}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/stats').then(r => r.json())
    ...    .then(d => {
    ...    const a = d.albums;
    ...    if (a.length < 2) return true;
    ...    for (let i = 1; i < a.length; i++) if (a[i].views > a[i-1].views) return false;
    ...    return true;
    ...    })
    Should Be True    ${sorted}

GET Stats Returns 401 For Anonymous
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/stats', {credentials:'omit'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    401

GET System Returns Node Version And Uptime
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/system').then(r => r.json())
    Should Match Regexp    ${data}[node]    ^v\\d+
    Should Be True    ${data}[uptime] >= 0

GET System Returns Containers Array
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/system').then(r => r.json())
    Should Be True    isinstance(${data}[containers], list)

GET System Returns 401 For Anonymous
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/system', {credentials:'omit'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    401

GET Top Photos Returns Photos Array
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/top-photos').then(r => r.json())
    Should Be True    isinstance(${data}[photos], list)

GET Top Photos Default Limit Is At Most Ten
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/top-photos').then(r => r.json())
    ${count}=    Get Length    ${data}[photos]
    Should Be True    ${count} <= 10

GET Top Photos Respects Limit Param
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/top-photos?limit=2').then(r => r.json())
    ${count}=    Get Length    ${data}[photos]
    Should Be True    ${count} <= 2

GET Top Photos Enforces Max Limit Of 50
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/top-photos?limit=999').then(r => r.json())
    ${count}=    Get Length    ${data}[photos]
    Should Be True    ${count} <= 50

GET Top Photos Photo Objects Have Required Fields
    ${valid}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/top-photos').then(r => r.json())
    ...    .then(d => d.photos.length === 0 ||
    ...    d.photos.every(p => p.album && p.filename && 'views' in p && 'likes' in p && p.url))
    Should Be True    ${valid}

GET Top Photos Returns 401 For Anonymous
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/top-photos', {credentials:'omit'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    401
