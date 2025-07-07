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
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

function App() {
  const [gapiLoaded, setGapiLoaded] = useState(false);
  const [tokenClient, setTokenClient] = useState(null);
  const [accessToken, setAccessToken] = useState(null);

  // Stage 1 & 2 state
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
        callback: (resp) => {
          if (resp.error) {
            console.error('Token client error', resp);
            return;
          }
          setAccessToken(resp.access_token);
        },
      });
      setTokenClient(client);
    }
  }, [gapiLoaded]);

  // Once we have an access token, load the breakdown data
  useEffect(() => {
    if (accessToken) {
      loadWalkthroughs();
    }
  }, [accessToken]);

  // Trigger GIS consent flow
  function handleAuth() {
    tokenClient.requestAccessToken({ prompt: '' });
  }

  // Load breakdown sheet for Stage 1
  async function loadWalkthroughs() {
    try {
      // Ensure Sheets API is loaded
      await window.gapi.client.load('sheets', 'v4');
    try {
      const sheets = window.gapi.client.sheets.spreadsheets.values;
      const resp = await sheets.get({ spreadsheetId: BREAKDOWN_SHEET_ID, range: `${BREAKDOWN_READ}!A1:D` });
      const data = resp.result.values || [];
      const options = data.map(r => r[0]);
      const map = {};
      data.forEach(r => { map[r[0]] = r[1]; });
            // All possible sections: collect from column D across all rows
      const sectionSet = new Set();
      data.forEach(r => {
        if (r[3]) {
          r[3].split(',').forEach(s => {
            const trimmed = s.trim();
            if (trimmed) sectionSet.add(trimmed);
          });
        }
      });
      const sections = Array.from(sectionSet);

      setWalkOptions(options);
      setRecommendedMap(map);
      setAllSections(sections);
      setSectionsList(sections);

      // Compute default walkthrough
      const now = new Date();
      const weekday = now.toLocaleDateString('en-US',{ weekday:'long' });
      const slots = [
        {label:'2am',hour:2},{label:'6am',hour:6},{label:'10am',hour:10},
        {label:'2pm',hour:14},{label:'6pm',hour:18},{label:'10pm',hour:22}
      ];
      const next = slots.find(s => s.hour > now.getHours()) || slots[0];
      const def = `${weekday}, ${next.label}`;
      setWalkthrough(def);
      setSection(map[def] || sections[0] || '');
    } catch (e) {
      console.error('loadWalkthroughs error', e);
      alert('Unable to load walkthroughs');
    }
  }

  // Stage 1 submit moves to Stage 2
  async function proceedToStage2() {
    if (!accessToken) { handleAuth(); return; }
    if (!walkthrough || !section || !userName) { alert('Complete Stage 1'); return; }
    try {
      const sheets = window.gapi.client.sheets.spreadsheets.values;
      const resp = await sheets.get({ spreadsheetId: CHECKLIST_SHEET_ID, range: `${section}!A1:M` });
      const data = resp.result.values || [];
      const locMap = {
        1:'Left 1',2:'Left 2',3:'Left 3',4:'Left 4',
        5:'Right 1',6:'Right 2',7:'Right 3',8:'Right 4',
        9:'Horizontal 1',10:'Horizontal 2',11:'Horizontal 3',12:'Horizontal 4'
      };
      const newRows = [];
      data.forEach(row => {
        const cab = row[0];
        for (let c=1; c<=12; c++) {
          if (row[c]) newRows.push({ cabinet: cab, loc: locMap[c], label: row[c], amperage:'', issue:false, info:'', extra:'' });
        }
      });
      setRows(newRows);
      setStage(2);
    } catch (e) {
      console.error('proceedToStage2 error', e);
      alert('Unable to load checklist');
    }
  }

  // Row handlers
  function updateRow(i, f, v) { const u = [...rows]; u[i][f] = v; setRows(u); }
  function addRow() { setRows([...rows, { cabinet:'', loc:'', label:'', amperage:'', issue:false, info:'', extra:'' }]); }
  function deleteRow(i) { setRows(rows.filter((_, j) => j !== i)); }

  // Submit Stage 2
  async function submitAudit() {
    if (!confirm('Finish audit?')) return;
    const now = new Date(), ds = now.toISOString().slice(0,10);
    const fileName = `Power Audit ${ds} ${walkthrough}.csv`;
    const header = ['Cabinet','Location','Label','Amperage','Issue','Info','Extra','DateTime','User','Walkthrough'];
    let csv = header.join(',') + '\n';
    rows.forEach(r => {
      csv += [r.cabinet,r.loc,r.label,r.amperage,r.issue,r.info,r.extra,now.toISOString(),userName,walkthrough].join(',') + '\n';
    });
    try {
      await window.gapi.client.drive.files.create({
        resource: { name: fileName, mimeType: 'text/csv', parents: [DRIVE_FOLDER_ID] },
        media: { mimeType: 'text/csv', body: csv }
      });
      const sheets = window.gapi.client.sheets.spreadsheets.values;
      const headResp = await sheets.get({ spreadsheetId: BREAKDOWN_SHEET_ID, range: `${BREAKDOWN_WRITE}!1:1` });
      const hdrRow = headResp.result.values[0] || [];
      const colIdx = hdrRow.indexOf(walkthrough);
      if (colIdx < 0) throw 'Walkthrough not found';
      const secResp = await sheets.get({ spreadsheetId: BREAKDOWN_SHEET_ID, range: `${BREAKDOWN_WRITE}!A1:A` });
      const secList = secResp.result.values.map(r=>r[0]);
      const rowIdx = secList.indexOf(section);
      if (rowIdx < 0) throw 'Section not found';
      const target = `${BREAKDOWN_WRITE}!${String.fromCharCode(65+colIdx)}${rowIdx+2}`;
      await sheets.update({ spreadsheetId: BREAKDOWN_SHEET_ID, range: target, valueInputOption:'RAW', resource:{ values:[[ds]] } });
      alert('Audit saved!');
      setStage(1); setWalkthrough(''); setSection(''); setUserName('');
    } catch (e) {
      console.error('submitAudit error', e);
      alert('Failed to submit audit');
    }
  }

  if (!gapiLoaded) return React.createElement('div', null, 'Loading Google API...');

  return React.createElement('div', { style:{ padding: 20 } },
    stage === 1
      ? React.createElement('div', null,
          React.createElement('h2', null, 'Power Audit - Stage 1'),
          accessToken == null
            ? React.createElement('button', { onClick: handleAuth }, 'Sign in with Google')
            : React.createElement('div', null,
                'Walkthrough: ', React.createElement('select', { value: walkthrough, onChange: e=> handleWalkthroughChange(e.target.value) }, React.createElement('option',{value:''}, '-- select --'), walkOptions.map(w=>React.createElement('option',{key:w,value:w}, w))), React.createElement('br'),
                'Section: ', React.createElement('select', { value: section, onChange:e=>setSection(e.target.value) }, React.createElement('option',{value:''}, '-- select --'), sectionsList.map(s=>React.createElement('option',{key:s,value:s}, s))), React.createElement('br'),
                'Auditor: ', React.createElement('input',{ value:userName, onChange:e=>setUserName(e.target.value), placeholder:'Your name' }), React.createElement('br'),
                React.createElement('button', { onClick: proceedToStage2 }, 'Proceed')
              )
        )
      : React.createElement('div', null,
          React.createElement('h2', null, 'Power Audit - Stage 2'),
          React.createElement('table', { border:1, cellPadding:5 },
            React.createElement('thead', null, React.createElement('tr', null, ['Cabinet','Location','Label','Amperage','Issue!','Info','Extra','Actions'].map(h=>React.createElement('th',{key:h},h)))),
            React.createElement('tbody', null, rows.map((r,i)=>React.createElement('tr',{key:i},
              React.createElement('td', null, React.createElement('input',{value:r.cabinet,readOnly:true})),
              React.createElement('td', null, React.createElement('input',{value:r.loc,readOnly:true})),
              React.createElement('td', null, React.createElement('input',{value:r.label,readOnly:true})),
              React.createElement('td', null, React.createElement('input',{type:'number',step:'0.1',value:r.amperage,onChange:e=>updateRow(i,'amperage',e.target.value)})),
              React.createElement('td', null, React.createElement('input',{type:'checkbox',checked:r.issue,onChange:e=>updateRow(i,'issue',e.target.checked)})),
              React.createElement('td', null, r.issue && React.createElement('select',{value:r.info,onChange:e=>updateRow(i,'info',e.target.value)}, React.createElement('option',{value:''}), React.createElement('option',null,'Previous information doesn\'t match'), React.createElement('option',null,'Other'))),
              React.createElement('td', null, (r.info==='Other') && React.createElement('input',{value:r.extra,onChange:e=>updateRow(i,'extra',e.target.value),placeholder:'Further explanation'})),
              React.createElement('td', null, React.createElement('button',{onClick:()=>deleteRow(i)},'Delete'))
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
