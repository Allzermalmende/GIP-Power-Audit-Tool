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
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';

function App() {
  const [gapiLoaded, setGapiLoaded] = useState(false);
  const [tokenClient, setTokenClient] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  // Full list of sections from Read sheet column D
  const [allSections, setAllSections] = useState([]);

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
          // Apply the obtained token to gapi client for authorized requests
          window.gapi.client.setToken({ access_token: resp.access_token });
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

  // Fetch signed-in user's profile (displayName or permissionId) once authenticated
  useEffect(() => {
    if (!accessToken) return;
    // Load Drive API for about.get
    window.gapi.client.load('drive', 'v3')
      .then(() => window.gapi.client.drive.about.get({ fields: 'user(displayName,permissionId)' }))
      .then(resp => {
        const user = resp.result.user || {};
        let name = user.displayName || user.permissionId || '';
        // Use first name if full name present
        if (name.includes(' ')) name = name.split(' ')[0];
        setUserName(name);
      })
      .catch(err => console.error('Failed to fetch user profile', err));
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

      const sheetsValues = window.gapi.client.sheets.spreadsheets.values;
      const resp = await sheetsValues.get({
        spreadsheetId: BREAKDOWN_SHEET_ID,
        range: `${BREAKDOWN_READ}!A1:D`
      });
      const data = resp.result.values || [];

      // Walkthrough options and recommended map
      const walks = data.map(r => r[0] || '').filter(w => w);
      const map = {};
      data.forEach(r => {
        if (r[0]) map[r[0]] = r[1] || '';
      });

      // Collect all sections from column D across rows
      const sectionSet = new Set();
      data.forEach(r => {
        const cell = r[3] || '';
        cell.split(',').forEach(s => {
          const t = s.trim();
          if (t) sectionSet.add(t);
        });
      });
      const sections = Array.from(sectionSet);

      setWalkOptions(walks);
      setRecommendedMap(map);
      setAllSections(sections);
      setSectionsList(sections);

      // Determine default walkthrough based on current time
      const now = new Date();
      const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
      const slots = [
        { label: '2am', hour: 2 },
        { label: '6am', hour: 6 },
        { label: '10am', hour: 10 },
        { label: '2pm', hour: 14 },
        { label: '6pm', hour: 18 },
        { label: '10pm', hour: 22 }
      ];
      const nextSlot = slots.find(s => s.hour > now.getHours()) || slots[0];
      const defaultWalk = `${weekday}, ${nextSlot.label}`;

      setWalkthrough(defaultWalk);
      setSection(map[defaultWalk] || sections[0] || '');
    } catch (e) {
      console.error('loadWalkthroughs error', e);
      alert('Unable to load walkthroughs.');
    }
  }

  // Stage 1 submit moves to Stage 2
  async function proceedToStage2() {
    if (!accessToken) { handleAuth(); return; }
    if (!walkthrough || !section || !userName) { alert('Please complete Stage 1.'); return; }
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
          if (row[c]) newRows.push({ cabinet: cab, loc: locMap[c], label: row[c], amperage:'', issue:false, info:'', extra:'', userAdded: false });
        }
      });
      setRows(newRows);
      setStage(2);
    } catch (e) {
      console.error('proceedToStage2 error', e);
      alert('Unable to load checklist.');
    }
  }

  // Row handlers
  function updateRow(i, f, v) { const u = [...rows]; u[i][f] = v; setRows(u); }
  function addRow() { setRows([...rows, { cabinet:'', loc:'', label:'', amperage:'', issue:false, info:'', extra:'', userAdded: true }]); }
  function deleteRow(i) { setRows(rows.filter((_, j) => j !== i)); }

  // Submit Stage 2
  async function submitAudit() {
    // Capture user-selected walkthrough and section to use in submission
    const selWalkthrough = walkthrough;
    const selSection = section;
    // Validation: ensure required fields are filled
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.cabinet) { alert(`Please fill the Cabinet field in row ${i+1}.`); return; }
      if (!r.loc)     { alert(`Please select the Location in row ${i+1}.`); return; }
      if (!r.label)   { alert(`Please fill the Label field in row ${i+1}.`); return; }
      if (!r.amperage) { alert(`Please fill the Amperage field in row ${i+1}.`); return; }
      if (r.issue === true && r.info === '') { alert(`Please select the Issue Type in row ${i+1}.`); return; }
      if (r.issue === true && r.info === 'Reads as error' && !r.extra) { alert(`Please use the Further Explanation field in row ${i+1} to detail the error you found.`); return; }
      if (r.issue === true && r.info === 'Other' && !r.extra) { alert(`Please use the Further Explanation field in row ${i+1} to explain the issue you discovered.`); return; }
    }

    if (!confirm('Finish audit?')) return;
    // Ensure Drive & Sheets APIs are loaded before submission
    await window.gapi.client.load('drive', 'v3');
    await window.gapi.client.load('sheets', 'v4');
    const now = new Date(), ds = now.toISOString().slice(0,10);
    const fileName = `Power Audit ${ds} ${selWalkthrough}.csv`;
    const header = ['Cabinet','Location','Label','Amperage','Issue','Info','Extra','DateTime','User','Walkthrough'];
    let csv = header.join(',') + '\n';
    rows.forEach(r => {
      csv += [r.cabinet, r.loc, r.label, r.amperage, r.issue, r.info, r.extra, now.toISOString(), userName, selWalkthrough].join(',') + '\n';
    });
    try {
      // Multipart upload for CSV with metadata
      const boundary = 'foo_bar_baz_' + Math.random();
      const delimiter = `\r\n--${boundary}\r\n`;
      const close_delim = `\r\n--${boundary}--`;

      const metadata = {
        name: fileName,
        mimeType: 'text/csv',
        parents: [DRIVE_FOLDER_ID]
      };

      const multipartRequestBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: text/csv\r\n\r\n' +
        csv +
        close_delim;

      // ---- USE FETCH WITH OAUTH TOKEN ----
      const token = window.gapi.client.getToken().access_token;
      const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody
      });
      const result = await resp.json();
      console.log('Drive upload response:', result);
      if (!result.id) {
        console.error('Full Drive upload response:', result);
        throw new Error('Drive upload failed');
      }

      const sheets = window.gapi.client.sheets.spreadsheets.values;
      const headResp = await sheets.get({ spreadsheetId: BREAKDOWN_SHEET_ID, range: `${BREAKDOWN_WRITE}!1:1` });
      const hdrRow = headResp.result.values[0] || [];
      const colIdx = hdrRow.indexOf(selWalkthrough);
      if (colIdx < 0) throw 'Walkthrough not found';
      // Helper to convert zero-based index to spreadsheet column letter
      function idxToCol(n) {
        let s = '';
        let num = n + 1;
        while (num > 0) {
          const rem = (num - 1) % 26;
          s = String.fromCharCode(65 + rem) + s;
          num = Math.floor((num - 1) / 26);
        }
        return s;
      }
      if (colIdx < 0) throw 'Walkthrough not found';
      const colLetter = idxToCol(colIdx);
      const secResp = await sheets.get({ spreadsheetId: BREAKDOWN_SHEET_ID, range: `${BREAKDOWN_WRITE}!A1:A` });
      const secList = secResp.result.values.map(r=>r[0]);
      const rowIdx = secList.indexOf(selSection);
      if (rowIdx < 0) throw 'Section not found';
      const target = `${BREAKDOWN_WRITE}!${colLetter}${rowIdx+1}`;
      await sheets.update({ spreadsheetId: BREAKDOWN_SHEET_ID, range: target, valueInputOption:'RAW', resource:{ values:[[ds]] } });
      alert('Audit saved!');
      setStage(1); setWalkthrough(''); setSection(''); setUserName('');
    } catch (e) {
      console.error('submitAudit error', e);
      alert('Failed to submit audit.');
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
                'Walkthrough: ', React.createElement('select', { value: walkthrough, onChange: e => { const val = e.target.value; setWalkthrough(val); handleWalkthroughChange(val); } }, React.createElement('option',{value:''}, '-- select --'), walkOptions.map(w=>React.createElement('option',{key:w,value:w}, w))), React.createElement('br'),
                'Section: ', React.createElement('select', { value: section, onChange:e=>setSection(e.target.value) }, React.createElement('option',{value:''}, '-- select --'), sectionsList.map(s=>React.createElement('option',{key:s,value:s}, s))), React.createElement('br'),
                React.createElement('div', null, `Welcome, ${userName}`), React.createElement('br'),
                React.createElement('button', { onClick: proceedToStage2 }, 'Proceed')
              )
        )
      : React.createElement('div', null,
          React.createElement('h2', null, 'Power Audit - Stage 2'),
          React.createElement('table', { border:1, cellPadding:5 },
            React.createElement('thead', null, React.createElement('tr', null, ['Cabinet','Location','Label','Amperage','Issue!','Issue Type','Further Explanation','Delete Row'].map(h => h === 'Location'
              ? React.createElement('th', { key: h }, h,
                  React.createElement('button', {
                    onClick: () => alert('1=closest/highest, 4=farthest/lowest'),
                    style: { marginLeft: '4px', cursor: 'pointer' }
                  }, '?')
                )
              : React.createElement('th', { key: h }, h)
            ))),
            React.createElement('tbody', null, rows.map((r,i)=>React.createElement('tr',{key:i},
              React.createElement('td', null, React.createElement('input',{value:r.cabinet,onChange:e=>updateRow(i,'cabinet',e.target.value), disabled: r.info !== "Previous information doesn't match"})),
              React.createElement('td', null, React.createElement('select', {
                value: r.loc,
                onChange: e => updateRow(i, 'loc', e.target.value),
                disabled: r.info !== "Previous information doesn't match"
              },
                React.createElement('option', { value: '' }, '-- select --'),
                React.createElement('option', null, 'Left 1'),
                React.createElement('option', null, 'Left 2'),
                React.createElement('option', null, 'Left 3'),
                React.createElement('option', null, 'Left 4'),
                React.createElement('option', null, 'Right 1'),
                React.createElement('option', null, 'Right 2'),
                React.createElement('option', null, 'Right 3'),
                React.createElement('option', null, 'Right 4'),
                React.createElement('option', null, 'Horizontal 1'),
                React.createElement('option', null, 'Horizontal 2'),
                React.createElement('option', null, 'Horizontal 3'),
                React.createElement('option', null, 'Horizontal 4')
              )),
              React.createElement('td', null, React.createElement('input',{value:r.label,onChange:e=>updateRow(i,'label',e.target.value), disabled: r.info !== "Previous information doesn't match"})),
              React.createElement('td', null, React.createElement('input',{type:'number',step:'0.1',value:r.amperage,onChange:e=>updateRow(i,'amperage',e.target.value),onBlur:e=>{if(e.target.value==='0')alert('If devices are attached to the power strip and you see a reading of zero: please enter 0.0, otherwise: please log the issue.');}})),
              React.createElement('td', null, React.createElement('input',{type:'checkbox',checked:r.issue,onChange:e=>updateRow(i,'issue',e.target.checked)})),
              React.createElement('td', null, r.issue && React.createElement('select',{value:r.info,onChange:e=>updateRow(i,'info',e.target.value),onBlur:e=>{if(e.target.value==='Power strip not found' || e.target.value==='Reading screen not found')alert('Please make sure to check the other side of the cabinet.');}},
                    React.createElement('option', { value: '' }, '-- select --'),
                    React.createElement('option', null, "Previous information doesn't match"),
                    React.createElement('option', null, 'Cabinet not found'),
                    React.createElement('option', null, 'Power strip not found'),
                    React.createElement('option', null, 'Power strip unplugged'),
                    React.createElement('option', null, 'Power strip connected but has no power'),
                    React.createElement('option', null, 'Cabinet vacant'),
                    React.createElement('option', null, 'Power strp powered but no device is plugged into it'),
                    React.createElement('option', null, 'Reading screen not found'),
                    React.createElement('option', null, 'Reads as error'),
                    React.createElement('option', null, 'Reading unavailable'),
                    React.createElement('option', null, 'Other')
                  )),
              React.createElement('td', null, (r.info==='Other' || r.info==='Reads as error') && React.createElement('input',{value:r.extra,onChange:e=>updateRow(i,'extra',e.target.value),placeholder:'describe error or issue'})),
              React.createElement('td', null, r.userAdded && React.createElement('button', { onClick: () => deleteRow(i) }, 'Delete'))
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
