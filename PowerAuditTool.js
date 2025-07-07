const { useEffect, useState } = React;

// OAuth 2.0 Client ID and API key
const CLIENT_ID = '335120852310-nhoebt829sm5eaam53ga54fnifuct4g2.apps.googleusercontent.com';
const API_KEY   = 'AIzaSyCPGFbUcMmnS3HB4XKfiY9I2TdTC1hvx4I';

// Spreadsheet and Drive IDs
const BREAKDOWN_SHEET_ID  = '1qaPCSmzUxybBdFBikhxYZcYHqVbpcU5lDN-3eT0XI4A';
const CHECKLIST_SHEET_ID  = '1U9osGNgffaoBxewfyEgNO2WGy_rmMKPFENjpQ_-Z0O0';
const BREAKDOWN_READ      = 'Read';
const BREAKDOWN_WRITE     = 'Write';
const DRIVE_FOLDER_ID     = '1IQNHuSZMDoqO5zh1qcIgFAYCtXdxjShN';

// Google API discovery docs and scopes
const DISCOVERY_DOCS = [
  'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
  'https://sheets.googleapis.com/$discovery/rest?version=v4'
];
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

function App() {
  const [gapiReady, setGapiReady] = useState(false);
  const [stage, setStage]     = useState(1);

  // Stage 1 state
  const [walkOptions, setWalkOptions]       = useState([]);
  const [recommendedMap, setRecommendedMap] = useState({});
  const [allSections, setAllSections]       = useState([]);
  const [sectionsList, setSectionsList]     = useState([]);
  const [walkthrough, setWalkthrough]       = useState('');
  const [section, setSection]               = useState('');
  const [userName, setUserName]             = useState('');

  // Stage 2 rows
  const [rows, setRows] = useState([]);

  // Initialize Google API
  useEffect(() => {
    window.gapi.load('client:auth2', () => {
      window.gapi.client
        .init({ apiKey: API_KEY, clientId: CLIENT_ID, discoveryDocs: DISCOVERY_DOCS, scope: SCOPES })
        .then(() => { setGapiReady(true); loadWalkthroughs(); });
    });
  }, []);

  async function loadWalkthroughs() {
    try {
      const sheetsAPI = window.gapi.client.sheets.spreadsheets.values;
      const resp = await sheetsAPI.get({ spreadsheetId: BREAKDOWN_SHEET_ID, range: `${BREAKDOWN_READ}!A2:D` });
      const data = resp.result.values || [];
      const walks = data.map(r => r[0]);
      const map   = {};
      data.forEach(r => { map[r[0]] = r[1]; });
      const secs = data[0] && data[0][3] ? data[0][3].split(',').map(s => s.trim()) : [];

      setWalkOptions(walks);
      setRecommendedMap(map);
      setAllSections(secs);
      setSectionsList(secs);

      const now = new Date();
      const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
      const slots = [
        { label: '2am', hour: 2 },{ label: '6am', hour: 6 },{ label: '10am', hour: 10 },
        { label: '2pm', hour: 14 },{ label: '6pm', hour: 18 },{ label: '10pm', hour: 22 }
      ];
      let nextSlot = slots.find(s => s.hour > now.getHours()) || slots[0];
      const defaultWalk = `${weekday}, ${nextSlot.label}`;
      setWalkthrough(defaultWalk);
      setSection(map[defaultWalk] || secs[0] || '');
    } catch (err) {
      console.error('Error loading breakdown:', err);
      alert('Failed to load audit breakdown.');
    }
  }

  function handleWalkthroughChange(val) {
    setWalkthrough(val);
    setSectionsList(allSections);
    setSection(recommendedMap[val] || allSections[0] || '');
  }

  async function proceedToStage2() {
    if (!walkthrough || !section || !userName) {
      alert('Please complete all Stage 1 fields.');
      return;
    }
    try {
      const sheetsAPI = window.gapi.client.sheets.spreadsheets.values;
      const resp = await sheetsAPI.get({ spreadsheetId: CHECKLIST_SHEET_ID, range: `${section}!A2:M` });
      const data = resp.result.values || [];
      const locMap = {
        1:'Left 1',2:'Left 2',3:'Left 3',4:'Left 4',
        5:'Right 1',6:'Right 2',7:'Right 3',8:'Right 4',
        9:'Horizontal 1',10:'Horizontal 2',11:'Horizontal 3',12:'Horizontal 4'
      };
      const newRows = [];
      data.forEach(row => {
        const cab = row[0];
        for (let c = 1; c <= 12; c++) {
          if (row[c]) {
            newRows.push({ cabinet: cab, loc: locMap[c], label: row[c], amperage: '', issue: false, info: '', extra: '' });
          }
        }
      });
      setRows(newRows);
      setStage(2);
    } catch (err) {
      console.error('Error fetching checklist:', err);
      alert('Failed fetching checklist.');
    }
  }

  function updateRow(i, f, v) {
    const u = [...rows]; u[i][f] = v; setRows(u);
  }
  function addRow() { setRows([...rows, { cabinet:'', loc:'', label:'', amperage:'', issue:false, info:'', extra:'' }]); }
  function deleteRow(i) { setRows(rows.filter((_, j) => j !== i)); }

  async function submitAudit() {
    if (!window.confirm('Are you sure you are finished?')) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const fileName = `Power Audit ${dateStr} ${walkthrough}.csv`;
    const header = ['Cabinet','Location','Label','Amperage','Issue','Info','Extra','DateTime','User','Walkthrough'];
    const lines = [header.join(',')];
    rows.forEach(r => lines.push([
      r.cabinet, r.loc, r.label, r.amperage, r.issue, r.info, r.extra,
      now.toISOString(), userName, walkthrough
    ].join(',')));
    const csv = lines.join('\n');

    try {
      await window.gapi.client.drive.files.create({ resource: { name: fileName, mimeType: 'text/csv', parents: [DRIVE_FOLDER_ID] }, media: { mimeType: 'text/csv', body: csv } });
      const sheetsAPI = window.gapi.client.sheets.spreadsheets.values;
      const headResp = await sheetsAPI.get({ spreadsheetId: BREAKDOWN_SHEET_ID, range: `${BREAKDOWN_WRITE}!1:1` });
      const headers = headResp.result.values[0] || [];
      const colIdx = headers.indexOf(walkthrough);
      if (colIdx < 0) throw new Error('Walkthrough not found');
      const secResp = await sheetsAPI.get({ spreadsheetId: BREAKDOWN_SHEET_ID, range: `${BREAKDOWN_WRITE}!A2:A` });
      const secs = secResp.result.values.map(r => r[0]);
      const rowIdx = secs.indexOf(section);
      if (rowIdx < 0) throw new Error('Section not found');
      const colLetter = String.fromCharCode(65 + colIdx);
      const target = `${BREAKDOWN_WRITE}!${colLetter}${rowIdx+2}`;
      await sheetsAPI.update({ spreadsheetId: BREAKDOWN_SHEET_ID, range: target, valueInputOption: 'RAW', resource: { values: [[dateStr]] } });
      alert('Audit saved and breakdown updated!');
      setStage(1); setWalkthrough(''); setSection(''); setUserName('');
    } catch (err) {
      console.error('Error during submission:', err);
      alert('Submission failed.');
    }
  }

  if (!gapiReady) return React.createElement('div', null, 'Loading Google API...');

  return React.createElement('div', { style: { padding: 20 } },
    stage === 1
      ? React.createElement('div', null,
          React.createElement('h2', null, 'Power Audit - Stage 1'),
          'Walkthrough: ', React.createElement('select', { value: walkthrough, onChange: e => handleWalkthroughChange(e.target.value) },
            React.createElement('option', { value: '' }, '-- select --'),
            walkOptions.map(w => React.createElement('option', { key: w, value: w }, w))
          ), React.createElement('br'),
          'Section: ', React.createElement('select', { value: section, onChange: e => setSection(e.target.value) },
            React.createElement('option', { value: '' }, '-- select --'),
            sectionsList.map(s => React.createElement('option', { key: s, value: s }, s))
          ), React.createElement('br'),
          'Auditor: ', React.createElement('input', { value: userName, onChange: e => setUserName(e.target.value), placeholder: 'Your name' }), React.createElement('br'),
          React.createElement('button', { onClick: proceedToStage2 }, 'Proceed')
        )
      : React.createElement('div', null,
          React.createElement('h2', null, 'Power Audit - Stage 2'),
          React.createElement('table', { border: 1, cellPadding: 5 },
            React.createElement('thead', null, React.createElement('tr', null,
              ['Cabinet','Location','Label','Amperage','Issue!','Info','Extra','Actions'].map(h => React.createElement('th', { key: h }, h))
            )),
            React.createElement('tbody', null,
              rows.map((r, i) => React.createElement('tr', { key: i },
                React.createElement('td', null, React.createElement('input', { value: r.cabinet, readOnly: true })),
                React.createElement('td', null, React.createElement('input', { value: r.loc, readOnly: true })),
                React.createElement('td', null, React.createElement('input', { value: r.label, readOnly: true })),
                React.createElement('td', null, React.createElement('input', { type: 'number', step: '0.1', value: r.amperage, onChange: e => updateRow(i, 'amperage', e.target.value) })),
                React.createElement('td', null, React.createElement('input', { type: 'checkbox', checked: r.issue, onChange: e => updateRow(i, 'issue', e.target.checked) })),
                React.createElement('td', null, r.issue && React.createElement('select', { value: r.info, onChange: e => updateRow(i, 'info', e.target.value) },
                  React.createElement('option', { value: '' }), React.createElement('option', null, "Previous information doesn't match"), React.createElement('option', null, 'Other')
                )),
                React.createElement('td', null, (r.info==='Other' || r.info==='Reads as error') && React.createElement('input', { value: r.extra, onChange: e => updateRow(i, 'extra', e.target.value), placeholder: 'Further explanation' })),
                React.createElement('td', null, React.createElement('button', { onClick: () => deleteRow(i) }, 'Delete'))
              ))
            )
          ),
          React.createElement('button', { onClick: addRow }, 'Add Row'),
          React.createElement('button', { onClick: submitAudit }, 'Submit Audit')
        )
  );
}

// Use React 18 createRoot API
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
