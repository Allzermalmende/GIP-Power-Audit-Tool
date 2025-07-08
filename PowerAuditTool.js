// Note: Ensure index.html includes GIS client script in <head> before this JS

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

// Discovery docs and scopes
const DISCOVERY_DOCS = [
  'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
  'https://sheets.googleapis.com/$discovery/rest?version=v4'
];
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

function App() {
  const [gapiLoaded, setGapiLoaded] = useState(false);
  const [tokenClient, setTokenClient] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
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

  // Load gapi client
  useEffect(() => {
    window.gapi.load('client', () => {
      window.gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS })
        .then(() => setGapiLoaded(true))
        .catch(e => console.error('gapi.client.init error', e));
    });
  }, []);

  // Initialize token client
  useEffect(() => {
    if (gapiLoaded && !tokenClient) {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: resp => {
          if (resp.error) console.error('Token client error', resp);
          else setAccessToken(resp.access_token);
        }
      });
      setTokenClient(client);
    }
  }, [gapiLoaded]);

  // Fetch data once authenticated
  useEffect(() => {
    if (accessToken) {
      loadWalkthroughs();
      // Fetch user profile if needed...
    }
  }, [accessToken]);

  // Stage 1: load walkthroughs
  async function loadWalkthroughs() {
    try {
      await window.gapi.client.load('sheets', 'v4');
      const sheet = window.gapi.client.sheets.spreadsheets.values;
      const resp = await sheet.get({ spreadsheetId: BREAKDOWN_SHEET_ID, range: `${BREAKDOWN_READ}!A1:D` });
      const data = resp.result.values || [];
      const walks = data.map(r => r[0] || '').filter(Boolean);
      const map = {};
      data.forEach(r => { if (r[0]) map[r[0]] = r[1] || ''; });
      const sectionSet = new Set();
      data.forEach(r => (r[3] || '').split(',').forEach(s => { const t=s.trim(); if(t) sectionSet.add(t); }));
      const sections = Array.from(sectionSet);
      setWalkOptions(walks);
      setRecommendedMap(map);
      setAllSections(sections);
      setSectionsList(sections);
      const now = new Date();
      const weekday = now.toLocaleDateString('en-US', { weekday:'long' });
      const slots = [{label:'2am',hour:2},{label:'6am',hour:6},{label:'10am',hour:10},{label:'2pm',hour:14},{label:'6pm',hour:18},{label:'10pm',hour:22}];
      const nextSlot = slots.find(s=>s.hour>now.getHours())||slots[0];
      const def = `${weekday}, ${nextSlot.label}`;
      setWalkthrough(def);
      setSection(map[def]||sections[0]||'');
    } catch(e) {
      console.error('loadWalkthroughs', e);
      alert('Unable to load walkthroughs.');
    }
  }

  function handleWalkthroughChange(val) {
    setWalkthrough(val);
    setSectionsList(allSections);
    setSection(recommendedMap[val]||allSections[0]||'');
  }

  async function proceedToStage2() {
    if (!accessToken) { tokenClient.requestAccessToken({prompt:'consent'}); return; }
    if (!walkthrough||!section||!userName) { alert('Complete Stage 1.'); return; }
    try {
      const sheet=window.gapi.client.sheets.spreadsheets.values;
      const resp=await sheet.get({ spreadsheetId:CHECKLIST_SHEET_ID, range:`${section}!A1:M` });
      const data=resp.result.values||[];
      const locMap={1:'Left 1',2:'Left 2',3:'Left 3',4:'Left 4',5:'Right 1',6:'Right 2',7:'Right 3',8:'Right 4',9:'Horizontal 1',10:'Horizontal 2',11:'Horizontal 3',12:'Horizontal 4'};
      const newRows=[];
      data.forEach(r=>{const cab=r[0];for(let c=1;c<=12;c++)if(r[c])newRows.push({cabinet:cab,loc:locMap[c],label:r[c],amperage:'',issue:false,info:'',extra:'',userAdded:false});});
      setRows(newRows);setStage(2);
    } catch(e) { console.error(e);alert('Unable to load checklist.'); }
  }

  function updateRow(i,f,v){const u=[...rows];u[i][f]=v;setRows(u);}
  function addRow(){setRows([...rows,{cabinet:'',loc:'',label:'',amperage:'',issue:false,info:'',extra:'',userAdded:true}]);}
  function deleteRow(i){setRows(rows.filter((_,j)=>j!==i));}

  async function submitAudit(){
    for(let i=0;i<rows.length;i++){const r=rows[i];if(!r.cabinet){alert(`Please fill Cabinet in row ${i+1}`);return;}if(!r.loc){alert(`Please select Location in row ${i+1}`);return;}if(!r.label){alert(`Please fill Label in row ${i+1}`);return;}if(!r.amperage){alert(`Please fill Amperage in row ${i+1}`);return;}if(r.issue&&!r.info){alert(`Please select Issue Type in row ${i+1}`);return;}if(r.issue&&(r.info==='Other'||r.info==='Reads as error')&&!r.extra){alert(`Please fill Further Explanation in row ${i+1}`);return;}}
    if(!confirm('Finish audit?'))return;
    try{
      const now=new Date(),ds=now.toISOString().slice(0,10);
      let csv=['Cabinet,Location,Label,Amperage,Issue,Info,Extra,DateTime,User,Walkthrough'];rows.forEach(r=>csv.push([r.cabinet,r.loc,r.label,r.amperage,r.issue,r.info,r.extra,now.toISOString(),userName,walkthrough].join(',')));
      const blob=csv.join('\n');
      await window.gapi.client.drive.files.create({resource:{name:`Power Audit ${ds} ${walkthrough}.csv`,mimeType:'text/csv',parents:[DRIVE_FOLDER_ID]},media:{mimeType:'text/csv',body:blob}});
      const vals=window.gapi.client.sheets.spreadsheets.values;
      const h=await vals.get({spreadsheetId:BREAKDOWN_SHEET_ID,range:`${BREAKDOWN_WRITE}!1:1`});
      const col=h.result.values[0].indexOf(walkthrough);if(col<0)throw'';
      const s=await vals.get({spreadsheetId:BREAKDOWN_SHEET_ID,range:`${BREAKDOWN_WRITE}!A1:A`});
      const ridx=s.result.values.map(r=>r[0]).indexOf(section);if(ridx<0)throw'';
      await vals.update({spreadsheetId:BREAKDOWN_SHEET_ID,range:`${BREAKDOWN_WRITE}!${String.fromCharCode(65+col)}${ridx+1}`,valueInputOption:'RAW',resource:{values:[[ds]]}});
      alert('Audit saved!');setStage(1);
    }catch(e){console.error(e);alert('Save failed.');}
  }

  if(!gapiLoaded) return React.createElement('div',null,'Loading Google API...');

  return React.createElement('div',{style:{padding:20}},
    stage===1?
      React.createElement('div',null,
        React.createElement('h2',null,'Power Audit - Stage 1'),
        accessToken==null?
          React.createElement('button',{onClick:handleAuth},'Sign in with Google'):
          React.createElement('div',null,
            'Walkthrough: ',React.createElement('select',{value:walkthrough,onChange:e=>handleWalkthroughChange(e.target.value)},React.createElement('option',{value:''},'-- select --'),walkOptions.map(w=>React.createElement('option',{key:w,value:w},w))),React.createElement('br'),
            'Section: ',React.createElement('select',{value:section,onChange:e=>setSection(e.target.value)},React.createElement('option',{value:''},'-- select --'),sectionsList.map(s=>React.createElement('option',{key:s,value:s},s))),React.createElement('br'),
            React.createElement('div',null,`Welcome, ${userName}`),React.createElement('br'),
            React.createElement('button',{onClick:proceedToStage2},'Proceed')
          )
      ):
      React.createElement('div',null,
        React.createElement('h2',null,'Power Audit - Stage 2'),
        React.createElement('table',{border:1,cellPadding:5},
          React.createElement('thead',null,React.createElement('tr',null,['Cabinet','Location','Label','Amperage','Issue!','Issue Type','Further Explanation','Delete Row'].map(h=>h==='Location'?React.createElement('th',{key:h},h,React.createElement('button',{onClick:()=>alert('1=closest/highest, 4=farthest/lowest'),style:{marginLeft:'4px',cursor:'pointer'}},'?')):React.createElement('th',{key:h},h))),
          React.createElement('tbody',null,rows.map((r,i)=>React.createElement('tr',{key:i},
            React.createElement('td',null,React.createElement('input',{value:r.cabinet,readOnly:r.info!="Previous information doesn't match"})),
            React.createElement('td',null,React.createElement('input',{value:r.loc,readOnly:r.info!="Previous information doesn't match"})),
            React.createElement('td',null,React.createElement('input',{value:r.label,readOnly:r.info!="Previous information doesn't match"})),
            React.createElement('td',null,React.createElement('input',{type:'number',step:'0.1',value:r.amperage,onChange:e=>updateRow(i,'amperage',e.target.value),onBlur:e=>{if(e.target.value==='0')alert('If devices are attached to the power strip and you see a reading of zero: please enter 0.0, otherwise: please log the issue.')}})),
            React.createElement('td',null,React.createElement('input',{type:'checkbox',checked:r.issue,onChange:e=>updateRow(i,'issue',e.target.checked)})),
            React.createElement('td',null,r.issue&&React.createElement('select',{value:r.info,onChange:e=>updateRow(i,'info',e.target.value),onBlur:e=>{if(e.target.value==='Power strip not found'||e.target.value==='Reading screen not found')alert('Please make sure to check the other side of the cabinet.');}},
              React.createElement('option',{value:''},'-- select --'),
              React.createElement('option',null,"Previous information doesn't match"),
              React.createElement('option',null,'Cabinet not found'),
              React.createElement('option',null,'Power strip not found'),
              React.createElement('option',null,'Power strip unplugged'),
              React.createElement('option',null,'Power strip connected but has no power'),
              React.createElement('option',null,'Cabinet vacant'),
              React.createElement('option',null,'Power strp powered but no device is plugged into it'),
              React.createElement('option',null,'Reading screen not found'),
              React.createElement('option',null,'Reads as error'),
              React.createElement('option',null,'Reading unavailable'),
              React.createElement('option',null,'Other')
            )),
            React.createElement('td',null,(r.info==='Other'||r.info==='Reads as error')&&React.createElement('input',{value:r.extra,onChange:e=>updateRow(i,'extra',e.target.value),placeholder:'describe error or issue'})),
            React.createElement('td',null,r.userAdded&&React.createElement('button',{onClick:()=>deleteRow(i)},'Delete'))
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
