// Note: Make sure your index.html includes:
// <script src="https://accounts.google.com/gsi/client" async defer></script>
// in the <head> before loading PowerAuditTool.js

const { useState, useEffect } = React;

// OAuth 2.0 Client ID and API key
const CLIENT_ID = '335120852310-nhoebt829sm5eaam53ga54fnifuct4g2.apps.googleusercontent.com';
const API_KEY   = 'AIzaSyCPGFbUcMmnS3HB4XKfiY9I2TdTC1hvx4I';

// Spreadsheet and Drive IDs
const BREAKDOWN_SHEET_ID  = '1qaPCSmzUxybBdFBikhxYZcYHqVbpcU5lDN-3eT0XI4A';
const CHECKLIST_SHEET_ID  = '1U9osGNgffaoBxewfyEgNO2WGy_rmMKPFENjpQ_-Z0O0';
const BREAKDOWN_READ      = 'Read';
const BREAKDOWN_WRITE     = 'Write';
const DRIVE_FOLDER_ID     = '1IQNHuSZMDoqO5zh1qcIgFAYCtXdxjShN';

// Discovery docs
const DISCOVERY_DOCS = [
  'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
  'https://sheets.googleapis.com/$discovery/rest?version=v4'
];
// OAuth scopes
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive';

// Helper to upload CSV via raw multipart HTTP
async function uploadCsvToDrive({ csv, fileName, folderId, accessToken }) {
  const boundary = '-------314159265358979323846';
  const delimiter = "\r\n--" + boundary + "\r\n";
  const closeDelim = "\r\n--" + boundary + "--";

  const metadata = {
    name: fileName,
    mimeType: 'text/csv',
    parents: [folderId]
  };

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: text/csv\r\n\r\n' +
    csv +
    closeDelim;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'multipart/related; boundary=' + boundary
      },
      body: multipartRequestBody
    }
  );
  return res.json();
}

function App() {
  const [gapiLoaded, setGapiLoaded] = useState(false);
  const [tokenClient, setTokenClient] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [allSections, setAllSections] = useState([]);
  const [stage, setStage] = useState(1);
  const [walkOptions, setWalkOptions] = useState([]);
  const [recommendedMap, setRecommendedMap] = useState({});
  const [sectionsList, setSectionsList] = useState([]);
  const [walkthrough, setWalkthrough] = useState('');
  const [section, setSection] = useState('');
  const [userName, setUserName] = useState('');
  const [rows, setRows] = useState([]);

  // Load gapi client libraries
  useEffect(() => {
    window.gapi.load('client', () => {
      window.gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS })
        .then(() => setGapiLoaded(true))
        .catch(e => console.error('gapi.client.init error', e));
    });
  }, []);

  // Initialize GIS token client once gapi is ready
  useEffect(() => {
    if (gapiLoaded && !tokenClient) {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: resp => {
          if (resp.error) return console.error('Token client error', resp);
          window.gapi.client.setToken({ access_token: resp.access_token });
          setAccessToken(resp.access_token);
        }
      });
      setTokenClient(client);
    }
  }, [gapiLoaded]);

  // Load breakdowns after auth
  useEffect(() => {
    if (accessToken) loadWalkthroughs();
  }, [accessToken]);

  // Fetch user profile
  useEffect(() => {
    if (!accessToken) return;
    window.gapi.client.load('drive', 'v3')
      .then(() => window.gapi.client.drive.about.get({ fields: 'user(displayName,permissionId)' }))
      .then(resp => {
        const u = resp.result.user || {};
        let name = u.displayName || u.permissionId || '';
        if (name.includes(' ')) name = name.split(' ')[0];
        setUserName(name);
      })
      .catch(e => console.error('Profile fetch error', e));
  }, [accessToken]);

  function handleAuth() { tokenClient.requestAccessToken({ prompt: 'consent' }); }

  async function loadWalkthroughs() {
    try {
      await window.gapi.client.load('sheets', 'v4');
      const resp = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: BREAKDOWN_SHEET_ID,
        range: `${BREAKDOWN_READ}!A1:D`
      });
      const data = resp.result.values || [];
      const walks = data.map(r=>r[0]).filter(Boolean);
      const map = {};
      data.forEach(r=>{ if(r[0]) map[r[0]] = r[1]||''; });
      const setS = new Set();
      data.forEach(r=>{(r[3]||'').split(',').forEach(s=>{const t=s.trim(); if(t) setS.add(t);});});
      const secs = Array.from(setS);
      setWalkOptions(walks);
      setRecommendedMap(map);
      setAllSections(secs);
      setSectionsList(secs);
      const now = new Date();
      const wd = now.toLocaleDateString('en-US',{weekday:'long'});
      const slots=[{l:'2am',h:2},{l:'6am',h:6},{l:'10am',h:10},{l:'2pm',h:14},{l:'6pm',h:18},{l:'10pm',h:22}];
      const nxt = slots.find(s=>s.h>now.getHours())||slots[0];
      const def=`${wd}, ${nxt.l}`;
      setWalkthrough(def);
      setSection(map[def]||secs[0]||'');
    } catch(e) { console.error(e); alert('Unable to load walkthroughs.'); }
  }

  async function proceedToStage2() {
    if (!accessToken) { handleAuth(); return; }
    if (!walkthrough||!section||!userName) { return alert('Complete Stage 1'); }
    const resp = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: CHECKLIST_SHEET_ID, range: `${section}!A1:M`
    });
    const data = resp.result.values||[];
    const locMap={1:'Left 1',2:'Left 2',3:'Left 3',4:'Left 4',5:'Right 1',6:'Right 2',7:'Right 3',8:'Right 4',9:'Horizontal 1',10:'Horizontal 2',11:'Horizontal 3',12:'Horizontal 4'};
    const nr=[];
    data.forEach(r=>{const c=r[0];for(let i=1;i<=12;i++)if(r[i]) nr.push({cabinet:c,loc:locMap[i],label:r[i],amperage:'',issue:false,info:'',extra:'',userAdded:false});});
    setRows(nr); setStage(2);
  }

  const uploadCsv = uploadCsvToDrive;

  async function submitAudit() {
    const selWalk=walkthrough, selSec=section;
    for(let i=0;i<rows.length;i++){const r=rows[i]; if(!r.cabinet) return alert(`Fill Cabinet row ${i+1}`); if(!r.loc) return alert(`Fill Location row ${i+1}`); if(!r.label) return alert(`Fill Label row ${i+1}`); if(!r.amperage) return alert(`Fill Amperage row ${i+1}`); if(r.issue&&!r.info) return alert(`Select Issue Type row ${i+1}`); if(r.issue&&(r.info==='Other'||r.info==='Reads as error')&&!r.extra) return alert(`Explain issue row ${i+1}`);}    
    if(!confirm('Finish audit?')) return;
    const now=new Date(), ds=now.toISOString().slice(0,10);
    const fileName=`Power Audit ${ds} ${selWalk}`;
    const hdr=['Cabinet','Location','Label','Amperage','Issue','Info','Extra','DateTime','User','Walkthrough'];
    let csv=hdr.join(',')+'\n'; rows.forEach(r=>{csv+=[r.cabinet,r.loc,r.label,r.amperage,r.issue,r.info,r.extra,now.toISOString(),userName,selWalk].join(',')+'\n';});
    try {
      const fr=await uploadCsv({csv,fileName,folderId:DRIVE_FOLDER_ID,accessToken});
      console.log('Upload result:',fr);
      // update breakdown sheet
      const head=await window.gapi.client.sheets.spreadsheets.values.get({spreadsheetId:BREAKDOWN_SHEET_ID,range:`${BREAKDOWN_WRITE}!1:1`});
      const hdrRow=head.result.values[0]||[];
      const col=hdrRow.indexOf(selWalk); if(col<0) throw 'Walk not found';
      const sec=await window.gapi.client.sheets.spreadsheets.values.get({spreadsheetId:BREAKDOWN_SHEET_ID,range:`${BREAKDOWN_WRITE}!A1:A`});
      const idx=sec.result.values.map(r=>r[0]).indexOf(selSec); if(idx<0) throw 'Section not found';
      const cell=`${BREAKDOWN_WRITE}!${String.fromCharCode(65+col)}${idx+1}`;
      await window.gapi.client.sheets.spreadsheets.values.update({spreadsheetId:BREAKDOWN_SHEET_ID,range:cell,valueInputOption:'USER_ENTERED',resource:{values:[[ds]]}});
      alert('Audit saved!'); setStage(1);setWalkthrough('');setSection('');
    } catch(e){console.error('submitAudit error',e);alert('Failed to submit audit.');}
  }

  if (!gapiLoaded) return React.createElement('div',null,'Loading Google API...');

  return React.createElement('div',{style:{padding:20}},
    stage===1
      ?React.createElement('div',null,
        React.createElement('h2',null,'Power Audit - Stage 1'),
        accessToken==null
          ?React.createElement('button',{onClick:handleAuth},'Sign in with Google')
          :React.createElement('div',null,
            'Walkthrough: ',React.createElement('select',{value:walkthrough,onChange:e=>{const v=e.target.value; setWalkthrough(v); setSection(recommendedMap[v]||allSections[0]||'');}},React.createElement('option',{value:''},'-- select --'),walkOptions.map(w=>React.createElement('option',{key:w,value:w},w))),React.createElement('br'),
            'Section: ',React.createElement('select',{value:section,onChange:e=>setSection(e.target.value)},React.createElement('option',{value:''},'-- select --'),sectionsList.map(s=>React.createElement('option',{key:s,value:s},s))),React.createElement('br'),
            React.createElement('div',null,`Welcome, ${userName}`),React.createElement('br'),
            React.createElement('button',{onClick:proceedToStage2},'Proceed')
          )
      )
      :React.createElement('div',null,
        React.createElement('h2',null,'Power Audit - Stage 2'),
        React.createElement('table',{border:1,cellPadding:5},
          React.createElement('thead',null,React.createElement('tr',null,['Cabinet','Location','Label','Amperage','Issue!','Issue Type','Further Explanation','Delete Row'].map(h=>React.createElement('th',{key:h},h)))),
          React.createElement('tbody',null,rows.map((r,i)=>React.createElement('tr',{key:i},
            React.createElement('td',null,React.createElement('input',{value:r.cabinet,onChange:e=>updateRow(i,'cabinet',e.target.value),disabled:r.info!="Previous information doesn't match"})),
            React.createElement('td',null,React.createElement('select',{value:r.loc,onChange:e=>updateRow(i,'loc',e.target.value),disabled:r.info!="Previous information doesn't match"},
              React.createElement('option',{value:''},'-- select --'),
              React.createElement('option',null,'Left 1'),React.createElement('option',null,'Left 2'),React.createElement('option',null,'Left 3'),React.createElement('option',null,'Left 4'),
              React.createElement('option',null,'Right 1'),React.createElement('option',null,'Right 2'),React.createElement('option',null,'Right 3'),React.createElement('option',null,'Right 4'),
              React.createElement('option',null,'Horizontal 1'),React.createElement('option',null,'Horizontal 2'),React.createElement('option',null,'Horizontal 3'),React.createElement('option',null,'Horizontal 4')
            )),
            React.createElement('td',null,React.createElement('input',{value:r.label,onChange:e=>updateRow(i,'label',e.target.value),disabled:r.info!="Previous information doesn't match"})),
            React.createElement('td',null,React.createElement('input',{type:'number',step:'0.1',value:r.amperage,onChange:e=>updateRow(i,'amperage',e.target.value),onBlur:e=>{if(e.target.value==='0')alert('If devices are attached to the power strip and you see a reading of zero: please enter 0.0, otherwise: please log the issue.');}})),
            React.createElement('td',null,React.createElement('input',{type:'checkbox',checked:r.issue,onChange:e=>updateRow(i,'issue',e.target.checked)})),
            React.createElement('td',null,r.issue&&React.createElement('select',{value:r.info,onChange:e=>updateRow(i,'info',e.target.value)},
              React.createElement('option',{value:''},'-- select --'),
              React.createElement('option',null,"Previous information doesn't match"),
              React.createElement('option',null,'Cabinet not found'),React.createElement('option',null,'Power strip not found'),React.createElement('option',null,'Power strip unplugged'),
              React.createElement('option',null,'Power strip connected but has no power'),React.createElement('option',null,'Cabinet vacant'),React.createElement('option',null,'Power strp powered but no device is plugged into it'),
              React.createElement('option',null,'Reading screen not found'),React.createElement('option',null,'Reads as error'),React.createElement('option',null,'Reading unavailable'),React.createElement('option',null,'Other')
            )),
            React.createElement('td',null,(r.info==='Other'||r.info==='Reads as error')&&React.createElement('input',{value:r.extra,onChange:e=>updateRow(i,'extra',e.target.value),placeholder:'describe error or issue'})),
            React.createElement('td',null,r.userAdded&&React.createElement('button',{onClick:() => deleteRow(i)},'Delete'))
          )))
        ),
        React.createElement('button',{onClick:addRow},'Add Row'),
        React.createElement('button',{onClick:submitAudit},'Submit Audit')
      )
  );
}

// Mount the app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
