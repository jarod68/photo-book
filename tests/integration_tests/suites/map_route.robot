*** Settings ***
Resource          ../resources/admin.resource
Suite Setup       GPS Route Suite Setup
Suite Teardown    GPS Route Suite Teardown

*** Variables ***
${GPS_ALBUM}    robot-gps-route

*** Keywords ***
GPS Route Suite Setup
    Login As Admin And Go To Admin
    Delete Album If Exists    ${GPS_ALBUM}
    Create Album    ${GPS_ALBUM}
    Upload Photos To Album    ${GPS_ALBUM}
    ...    ${FIXTURE_DIR}/gps-a.tiff
    ...    ${FIXTURE_DIR}/gps-b.tiff
    ...    ${FIXTURE_DIR}/gps-c.tiff
    ...    ${FIXTURE_DIR}/gps-d.tiff
    ...    ${FIXTURE_DIR}/gps-e.tiff

GPS Route Suite Teardown
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${GPS_ALBUM}', {method:'DELETE'})
    Close Browser

Get Route Segments
    [Arguments]    ${album}
    ${segs}=    Evaluate JavaScript    ${NONE}
    ...    async () => {
    ...    const M=21,K=400,R=6371;
    ...    const hav=(a,b,c,d)=>{const t=Math.PI/180,dl=(c-a)*t,dn=(d-b)*t,x=Math.sin(dl/2)**2+Math.cos(a*t)*Math.cos(c*t)*Math.sin(dn/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))};
    ...    const photos=(await fetch('/api/map').then(r=>r.json())).filter(p=>p.album==='${album}');
    ...    const sorted=photos.filter(p=>p.date&&p.gps).sort((a,b)=>new Date(a.date)-new Date(b.date));
    ...    if(sorted.length<2)return [];
    ...    const out=[];let cur=[sorted[0]];
    ...    for(let i=1;i<sorted.length;i++){const p=cur[cur.length-1],n=sorted[i];
    ...    const d=(new Date(n.date)-new Date(p.date))/864e5,k=hav(p.gps.lat,p.gps.lng,n.gps.lat,n.gps.lng);
    ...    if(d<=M&&k<=K)cur.push(n);else{if(cur.length>=2)out.push(cur);cur=[n]}}
    ...    if(cur.length>=2)out.push(cur);
    ...    return out.map(s=>s.map(p=>p.name));
    ...    }
    RETURN    ${segs}

*** Test Cases ***

GPS Album Has Five Photos With GPS On Map
    ${count}=    Evaluate JavaScript    ${NONE}
    ...    async () => {
    ...    const all = await fetch('/api/map').then(r => r.json());
    ...    return all.filter(p => p.album === '${GPS_ALBUM}').length;
    ...    }
    Should Be Equal As Integers    ${count}    5

Two Route Segments Exist
    ${segs}=    Get Route Segments    ${GPS_ALBUM}
    Length Should Be    ${segs}    2

Recent Photos ABC Form One Segment
    ${segs}=    Get Route Segments    ${GPS_ALBUM}
    ${seg}=    Evaluate    next(s for s in $segs if 'gps-b' in s)
    Should Contain    ${seg}    gps-a
    Should Contain    ${seg}    gps-b
    Should Contain    ${seg}    gps-c

Old Photos DE Form One Segment
    ${segs}=    Get Route Segments    ${GPS_ALBUM}
    ${seg}=    Evaluate    next(s for s in $segs if 'gps-d' in s)
    Should Contain    ${seg}    gps-d
    Should Contain    ${seg}    gps-e
    Should Not Contain    ${seg}    gps-a

Recent And Old Groups Are In Different Segments
    ${segs}=    Get Route Segments    ${GPS_ALBUM}
    ${recent}=    Evaluate    next(s for s in $segs if 'gps-a' in s)
    ${old}=    Evaluate    next(s for s in $segs if 'gps-d' in s)
    Should Not Be Equal    ${recent}    ${old}
