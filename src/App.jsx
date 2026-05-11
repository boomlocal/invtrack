import { useState, useCallback, useEffect } from "react";

function uid() { return Math.random().toString(36).slice(2, 10); }
function now() { return new Date().toISOString(); }
function defaultStore() {
  return { vendors: [], clients: [], inventory: [], rfps: [], invoices: [], activityLog: [] };
}

function generateBarcodeSVG(text, width = 280, height = 80) {
  const C = { " ":[2,1,2,2,2,2],"0":[1,2,3,1,2,2],"1":[1,2,3,2,2,1],"2":[2,2,3,2,1,1],"3":[2,2,1,1,3,2],"4":[2,2,1,2,3,1],"5":[2,1,3,2,1,2],"6":[2,2,3,1,1,2],"7":[3,1,2,1,3,1],"8":[3,1,1,2,2,2],"9":[3,2,1,1,2,2],"A":[3,2,1,2,2,1],"B":[3,1,2,2,1,2],"C":[3,2,2,1,1,2],"D":[3,2,2,2,1,1],"E":[2,1,2,1,2,3],"F":[2,1,2,3,2,1],"G":[2,3,2,1,2,1],"H":[1,1,1,3,2,3],"I":[1,3,1,1,2,3],"J":[1,3,1,3,2,1],"K":[1,1,2,3,1,3],"L":[1,3,2,1,1,3],"M":[1,3,2,3,1,1],"N":[2,1,1,3,1,3],"O":[2,3,1,1,1,3],"P":[2,3,1,3,1,1],"Q":[1,1,2,1,3,3],"R":[1,1,2,3,3,1],"S":[1,3,2,1,3,1],"T":[1,1,3,1,2,3],"U":[1,1,3,3,2,1],"V":[1,3,3,1,2,1],"W":[3,1,3,1,2,1],"X":[2,1,1,3,3,1],"Y":[2,3,1,1,3,1],"Z":[2,1,3,1,1,3],"-":[1,2,2,1,3,2],".":[1,2,2,2,3,1],"/":[1,1,3,2,2,2] };
  const START=[2,1,1,4,1,2], STOP=[2,3,3,1,1,1,2];
  const chars=text.toUpperCase().replace(/[^A-Z0-9 \-./]/g,"?");
  const patterns=[START,...chars.split("").map(c=>C[c]||C["?"]),STOP];
  const total=patterns.reduce((s,p)=>s+p.reduce((a,b)=>a+b,0),0)+2;
  const uw=width/total; let bars=[],x=uw;
  patterns.forEach(p=>p.forEach((u,i)=>{if(i%2===0)bars.push({x,w:u*uw});x+=u*uw;}));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="white"/>${bars.map(b=>`<rect x="${b.x.toFixed(1)}" y="0" width="${b.w.toFixed(1)}" height="${height-16}" fill="#000"/>`).join("")}<text x="${width/2}" y="${height-2}" text-anchor="middle" font-family="monospace" font-size="11">${text}</text></svg>`;
}

async function parseFileWithClaude(fileData, fileType) {
  const isImage = fileType.startsWith("image/");
  const msgContent = isImage
    ? [{type:"image",source:{type:"base64",media_type:fileType,data:fileData}},{type:"text",text:'You are a data extraction assistant. Look at this pricing catalog image carefully. Extract EVERY product you can see into a JSON array. Each product needs: name (product name), sku (abbreviation/code), price (number only, no $ sign), strength (dosage/size/specification). Return ONLY the raw JSON array with no markdown, no explanation, no code blocks. Example format: [{"name":"BPC-157","sku":"BP5","price":45,"strength":"5mg*10vials"}]. Extract ALL products visible, even if there are hundreds.'}]
    : [{type:"document",source:{type:"base64",media_type:"application/pdf",data:fileData}},{type:"text",text:'You are a data extraction assistant. Extract EVERY product from this pricing document. Each product needs: name (product name), sku (abbreviation/code), price (number only, no $ sign), strength (dosage/size/specification). Return ONLY the raw JSON array with no markdown, no explanation, no code blocks. Example format: [{"name":"BPC-157","sku":"BP5","price":45,"strength":"5mg*10vials"}]. Extract ALL products, even if there are hundreds.'}];

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),30000);

  try{
    const res=await fetch("/.netlify/functions/claude",{
      method:"POST",
      signal:controller.signal,
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({content:msgContent})
    });
    clearTimeout(timeout);
    if(!res.ok){console.error("API error:",res.status);return [];}
    const data=await res.json();
    console.log("API response:",JSON.stringify(data).slice(0,500));
    const raw=(data.text||"[]");
    // Strip any markdown code fences
    const stripped=raw.replace(/```json/gi,"").replace(/```/g,"").trim();
    // Try direct parse first
    try{return JSON.parse(stripped);}catch{}
    // Try to extract array from anywhere in the text
    const match=stripped.match(/\[[\s\S]*\]/);
    if(match){
      try{return JSON.parse(match[0]);}catch(e){
        // Array found but malformed - try to fix truncation
        console.error("Parse error:",e.message);
      }
    }
    // Try line by line extraction as last resort
    const lines=stripped.split("\n");
    const products=[];
    let current={};
    for(const line of lines){
      const nameMatch=line.match(/"name"\s*:\s*"([^"]+)"/);
      const skuMatch=line.match(/"sku"\s*:\s*"([^"]+)"/);
      const priceMatch=line.match(/"price"\s*:\s*([\d.]+)/);
      const strengthMatch=line.match(/"strength"\s*:\s*"([^"]+)"/);
      if(nameMatch)current.name=nameMatch[1];
      if(skuMatch)current.sku=skuMatch[1];
      if(priceMatch)current.price=parseFloat(priceMatch[1]);
      if(strengthMatch){current.strength=strengthMatch[1];if(current.name){products.push({...current});current={};}}
    }
    if(products.length>0)return products;
    return [];
  }catch(err){
    clearTimeout(timeout);
    console.error("Claude API error:",err);
    return [];
  }
}

const DARK = { bg:"#060c18",bgPanel:"#0b1525",bgCard:"#0f1e34",border:"rgba(0,200,255,0.13)",borderHi:"rgba(0,200,255,0.38)",accent:"#00c8ff",accentDim:"rgba(0,200,255,0.14)",accentGlow:"rgba(0,200,255,0.35)",green:"#00e5a0",greenDim:"rgba(0,229,160,0.14)",amber:"#ffb547",amberDim:"rgba(255,181,71,0.14)",red:"#ff4d6a",redDim:"rgba(255,77,106,0.14)",purple:"#c4b5fd",purpleDim:"rgba(196,181,253,0.14)",text:"#eef5ff",textMid:"#9dbcd8",textDim:"#4a7090",inputBg:"#0b1525",scrollThumb:"rgba(0,200,255,0.3)" };
const LIGHT = { bg:"#f3f6fb",bgPanel:"#ffffff",bgCard:"#eaeff8",border:"rgba(0,100,180,0.14)",borderHi:"rgba(0,100,180,0.42)",accent:"#0068c0",accentDim:"rgba(0,104,192,0.11)",accentGlow:"rgba(0,104,192,0.28)",green:"#046c4a",greenDim:"rgba(4,108,74,0.1)",amber:"#9a5000",amberDim:"rgba(154,80,0,0.1)",red:"#b81c38",redDim:"rgba(184,28,56,0.1)",purple:"#5b21b6",purpleDim:"rgba(91,33,182,0.1)",text:"#0c1a2e",textMid:"#2a4a6a",textDim:"#507090",inputBg:"#ffffff",scrollThumb:"rgba(0,104,192,0.28)" };

let T = {...DARK, font:"'Poppins',system-ui,sans-serif", mono:"'Roboto Mono','Courier New',monospace", radius:"10px", radiusLg:"14px" };

function buildT(mode, fontId) {
  const base = mode === "dark" ? DARK : LIGHT;
  const font = fontId === "roboto" ? "'Roboto',system-ui,sans-serif" : "'Poppins',system-ui,sans-serif";
  return {...base, font, mono:"'Roboto Mono','Courier New',monospace", radius:"10px", radiusLg:"14px"};
}

function getSC(t) {
  return { "Draft":{color:t.textMid,bg:t.textMid+"28"},"Sent":{color:t.accent,bg:t.accent+"22"},"Quote Received":{color:t.purple,bg:t.purple+"22"},"Accepted":{color:t.green,bg:t.green+"22"},"Pending":{color:t.amber,bg:t.amber+"22"},"Declined":{color:t.red,bg:t.red+"22"},"Paid":{color:t.green,bg:t.green+"22"},"Overdue":{color:t.red,bg:t.red+"22"},"Cancelled":{color:t.textDim,bg:t.textDim+"28"} };
}
let SC = getSC(T);
let STATUS_COLORS = Object.fromEntries(Object.entries(SC).map(([k,v])=>[k,v.color]));

function getIS() { return { width:"100%",background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"9px 12px",fontSize:13,fontFamily:T.font,outline:"none",boxSizing:"border-box" }; }
let IS = getIS();

function getTIER() { return { Complete:{bg:T.greenDim,border:T.green+"55",text:T.green},Partial:{bg:T.amberDim,border:T.amber+"55",text:T.amber},Minimal:{bg:T.textDim+"22",border:T.textDim+"44",text:T.textMid} }; }
let TIER = getTIER();

const INDUSTRIES = ["Medical Supplies","Pharmaceuticals","Peptide Manufacturer","Lab Equipment","Office Supplies","Technology","Wholesale","Distribution","Manufacturing","Other"];
const PAYMENT_TERMS = ["Net 15","Net 30","Net 60","Due on Receipt","COD","Prepaid"];
const US_STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"];
const COUNTRIES = [{code:"US",label:"🇺🇸 United States"},{code:"CA",label:"🇨🇦 Canada"},{code:"GB",label:"🇬🇧 United Kingdom"},{code:"AU",label:"🇦🇺 Australia"},{code:"DE",label:"🇩🇪 Germany"},{code:"OTHER",label:"🌐 Other"}];
const NAV = [{id:"dashboard",label:"Dashboard",icon:"⬡"},{id:"vendors",label:"Vendors",icon:"◈"},{id:"rfp",label:"RFPs",icon:"◎"},{id:"inventory",label:"Inventory",icon:"▦"},{id:"clients",label:"Clients",icon:"◉"},{id:"invoices",label:"Invoices",icon:"◫"},{id:"log",label:"Activity",icon:"≡"},{id:"admin",label:"Admin",icon:"⚙"}];
const RFP_STATUSES = ["Draft","Sent","Quote Received","Accepted","Pending","Declined"];
const INV_STATUSES = ["Draft","Sent","Paid","Overdue","Cancelled"];

function vendorInitials(n){return n.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase();}
function vendorCompleteness(v){const c=[!!v.name,!!v.contactName,!!v.contactPhone,!!v.email,!!v.businessNumber,!!v.industry,!!v.address,!!v.city,!!(v.state||v.country!=="US"),!!v.zip,!!v.country,!!v.paymentTerms,!!v.notes];const s=c.filter(Boolean).length;const p=Math.round((s/c.length)*100);return{pct:p,tier:p>=75?"Complete":p>=35?"Partial":"Minimal"};}

function Btn({children,onClick,small,ghost,danger,disabled,style={}}){
  const bg=danger?T.redDim:ghost?"transparent":T.accentDim;
  const border=danger?`1px solid ${T.red}55`:ghost?`1px solid ${T.border}`:`1px solid ${T.borderHi}`;
  const color=danger?T.red:ghost?T.textMid:T.accent;
  return <button onClick={onClick} disabled={disabled} style={{background:bg,border,color,borderRadius:8,padding:small?"5px 13px":"8px 20px",cursor:disabled?"not-allowed":"pointer",fontSize:small?12:13,fontWeight:600,fontFamily:T.font,opacity:disabled?0.4:1,whiteSpace:"nowrap",...style}}>{children}</button>;
}
function Lbl({children}){return <div style={{fontSize:11,color:T.textMid,fontFamily:T.font,fontWeight:700,letterSpacing:0.5,marginBottom:6,textTransform:"uppercase"}}>{children}</div>;}
function Chip({children,color}){return <span style={{background:color+"22",border:`1px solid ${color}44`,color,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600}}>{children}</span>;}
function SBadge({status}){const s=getSC(T)[status]||{color:T.textMid,bg:T.textMid+"28"};return <span style={{background:s.bg,color:s.color,borderRadius:20,padding:"3px 10px",fontSize:10,fontWeight:700,fontFamily:T.mono,border:`1px solid ${s.color}44`}}>{status}</span>;}

function AdminPanel({themeMode,setThemeMode,fontChoice,setFontChoice}){
  return(
    <div style={{padding:"40px 48px",maxWidth:640}}>
      <div style={{fontSize:11,color:T.accent,fontFamily:T.mono,letterSpacing:3,textTransform:"uppercase",marginBottom:6}}>System Configuration</div>
      <h1 style={{fontSize:26,fontWeight:700,color:T.text,marginBottom:32}}>Admin Settings</h1>
      <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radiusLg,padding:"28px 32px",marginBottom:24}}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:4}}>Appearance</div>
        <div style={{fontSize:13,color:T.textMid,marginBottom:20}}>Choose between a dark or light background theme.</div>
        <div style={{display:"flex",gap:16}}>
          {[{id:"dark",label:"Dark Mode",desc:"Deep navy — easy on the eyes",previewBg:"#060c18",previewPanel:"#0b1525",previewText:"#eef5ff",previewAccent:"#00c8ff"},{id:"light",label:"Light Mode",desc:"Clean white — crisp and bright",previewBg:"#f3f6fb",previewPanel:"#ffffff",previewText:"#0c1a2e",previewAccent:"#0068c0"}].map(opt=>{
            const active=themeMode===opt.id;
            return(
              <div key={opt.id} onClick={()=>setThemeMode(opt.id)} style={{flex:1,border:`2px solid ${active?T.accent:T.border}`,borderRadius:T.radius,padding:18,cursor:"pointer",background:active?T.accentDim:T.bgPanel}}>
                <div style={{background:opt.previewBg,borderRadius:8,padding:"10px 12px",marginBottom:14,display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{width:38,background:opt.previewPanel,borderRadius:5,padding:"6px 0",display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
                    {[opt.previewAccent,opt.previewText+"aa",opt.previewText+"55"].map((c,i)=><div key={i} style={{width:26,height:4,borderRadius:2,background:c}}/>)}
                  </div>
                  <div style={{flex:1,display:"flex",flexDirection:"column",gap:4}}>
                    <div style={{height:6,borderRadius:3,background:opt.previewText,width:"70%",opacity:0.9}}/>
                    <div style={{height:4,borderRadius:3,background:opt.previewText,width:"50%",opacity:0.5}}/>
                    <div style={{height:18,borderRadius:4,background:opt.previewAccent+"33",width:"100%",marginTop:4}}/>
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:2}}>{opt.label}</div>
                    <div style={{fontSize:12,color:T.textMid}}>{opt.desc}</div>
                  </div>
                  <div style={{width:20,height:20,borderRadius:"50%",border:`2px solid ${active?T.accent:T.border}`,background:active?T.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {active&&<div style={{width:8,height:8,borderRadius:"50%",background:T.bg}}/>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radiusLg,padding:"28px 32px"}}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:4}}>Typography</div>
        <div style={{fontSize:13,color:T.textMid,marginBottom:20}}>Select the primary font used throughout the app.</div>
        <div style={{display:"flex",gap:16}}>
          {[{id:"poppins",label:"Poppins"},{id:"roboto",label:"Roboto"}].map(f=>{
            const active=fontChoice===f.id;
            const ff=f.id==="roboto"?"'Roboto',system-ui,sans-serif":"'Poppins',system-ui,sans-serif";
            return(
              <div key={f.id} onClick={()=>setFontChoice(f.id)} style={{flex:1,border:`2px solid ${active?T.accent:T.border}`,borderRadius:T.radius,padding:"18px 20px",cursor:"pointer",background:active?T.accentDim:T.bgPanel}}>
                <div style={{fontFamily:ff,fontSize:22,fontWeight:700,color:T.text,marginBottom:6}}>{f.label}</div>
                <div style={{fontFamily:ff,fontSize:13,color:T.textMid,marginBottom:8}}>The quick brown fox jumps over the lazy dog</div>
                <div style={{fontFamily:ff,fontSize:11,color:T.textDim}}>ABCDEFGHIJKLMNOPQRSTUVWXYZ · 0123456789</div>
                <div style={{marginTop:12,display:"flex",justifyContent:"flex-end"}}>
                  <div style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${active?T.accent:T.border}`,background:active?T.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {active&&<div style={{width:7,height:7,borderRadius:"50%",background:T.bg}}/>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Dashboard({store,setTab,lowStock,outOfStock}){
  const totalVal=store.inventory.reduce((s,i)=>s+(i.qty*(i.costPrice||0)),0);
  const openRFPs=store.rfps.filter(r=>["Sent","Quote Received","Pending"].includes(r.status)).length;
  const savings=store.rfps.reduce((s,r)=>s+parseFloat(r.savings||0),0);
  const unpaid=store.invoices.filter(i=>["Sent","Overdue"].includes(i.status));
  const unpaidTotal=unpaid.reduce((s,i)=>s+i.total,0);
  const kpis=[{label:"Inventory Value",value:`$${totalVal.toFixed(2)}`,sub:`${store.inventory.length} products`,color:T.accent,icon:"▦"},{label:"Open RFPs",value:openRFPs,sub:`${store.rfps.length} total`,color:T.purple,icon:"◎"},{label:"Total Savings",value:`$${savings.toFixed(2)}`,sub:"from accepted RFPs",color:T.green,icon:"↓"},{label:"Outstanding",value:`$${unpaidTotal.toFixed(2)}`,sub:`${unpaid.length} invoices`,color:T.amber,icon:"◫"}];
  return(
    <div style={{padding:"32px 36px"}}>
      <div style={{marginBottom:32,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
        <div>
          <div style={{fontSize:11,color:T.accent,fontFamily:T.mono,letterSpacing:3,textTransform:"uppercase",marginBottom:6}}>System Overview</div>
          <h1 style={{fontSize:28,fontWeight:700,color:T.text}}>Dashboard</h1>
        </div>
        <div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,fontWeight:500}}>{new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:28}}>
        {kpis.map(k=>(
          <div key={k.label} style={{background:T.bgCard,border:`1px solid ${k.color}30`,borderRadius:T.radiusLg,padding:"20px 22px",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${k.color},transparent)`}}/>
            <div style={{position:"absolute",top:16,right:18,fontSize:22,opacity:0.1,color:k.color}}>{k.icon}</div>
            <div style={{fontSize:10,color:T.textMid,fontFamily:T.mono,letterSpacing:2,textTransform:"uppercase",marginBottom:10,fontWeight:700}}>{k.label}</div>
            <div style={{fontSize:26,fontWeight:700,color:k.color}}>{k.value}</div>
            <div style={{fontSize:12,color:T.textMid,marginTop:5,fontWeight:500}}>{k.sub}</div>
          </div>
        ))}
      </div>
      {(lowStock.length>0||outOfStock.length>0)&&(
        <div style={{background:T.redDim,border:`1px solid ${T.red}44`,borderRadius:T.radius,padding:"14px 20px",marginBottom:24,display:"flex",alignItems:"flex-start",gap:14}}>
          <div style={{fontSize:18,color:T.red,flexShrink:0}}>⚠</div>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:T.red,marginBottom:8}}>Stock Alerts</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {outOfStock.map(i=><Chip key={i.id} color={T.red}>{i.name}: OUT OF STOCK</Chip>)}
              {lowStock.map(i=><Chip key={i.id} color={T.amber}>{i.name}: {i.qty} left</Chip>)}
            </div>
          </div>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        {[{title:"Recent RFPs",items:store.rfps.slice(0,6),render:r=>{const v=store.vendors.find(vv=>vv.id===r.vendorId);return(<div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${T.border}`}}><span style={{fontSize:13,color:T.text,fontWeight:500}}>{v?.name||"Unknown"}</span><SBadge status={r.status}/></div>);},empty:"No RFPs yet"},{title:"Recent Invoices",items:store.invoices.slice(0,6),render:inv=>{const c=store.clients.find(cc=>cc.id===inv.clientId);return(<div key={inv.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${T.border}`}}><span style={{fontSize:13,color:T.text,fontWeight:500}}>{c?.name||"Unknown"}</span><div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:13,fontWeight:700,color:T.accent,fontFamily:T.mono}}>${inv.total.toFixed(2)}</span><SBadge status={inv.status}/></div></div>);},empty:"No invoices yet"}].map(panel=>(
          <div key={panel.title} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.radiusLg,padding:22,position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,${T.accent}55,transparent)`}}/>
            <div style={{fontSize:11,color:T.accent,fontFamily:T.mono,letterSpacing:2,textTransform:"uppercase",marginBottom:14,fontWeight:600}}>{panel.title}</div>
            {panel.items.length?panel.items.map(panel.render):<div style={{fontSize:13,color:T.textMid,padding:"12px 0"}}>{panel.empty}</div>}
          </div>
        ))}
      </div>
      {!store.vendors.length&&!store.inventory.length&&(
        <div style={{marginTop:24,background:T.accentDim,border:`1px solid ${T.borderHi}`,borderRadius:T.radiusLg,padding:"20px 24px"}}>
          <div style={{fontSize:11,color:T.accent,fontFamily:T.mono,letterSpacing:2,marginBottom:10,fontWeight:700}}>GETTING STARTED</div>
          <div style={{fontSize:13,color:T.textMid,lineHeight:1.7}}>
            1. Add <strong style={{color:T.accent}}>Vendors</strong> and upload their pricing sheets (AI-powered) → 2. Create <strong style={{color:T.accent}}>RFPs</strong> to request quotes → 3. Add <strong style={{color:T.accent}}>Inventory</strong> items → 4. Add <strong style={{color:T.accent}}>Clients</strong> and create <strong style={{color:T.accent}}>Invoices</strong>
          </div>
        </div>
      )}
    </div>
  );
}

function PricingSection({vendor,update,showToast,log}){
  const [mode,setMode]=useState("list");
  const [preview,setPreview]=useState([]);
  const [np,setNp]=useState({name:"",sku:"",price:"",strength:""});
  const [editId,setEditId]=useState(null);
  const [editBuf,setEditBuf]=useState({});
  const [drag,setDrag]=useState(false);
  const [parsing,setParsing]=useState(false);
  const products=vendor.products||[];

  async function runParse(file){
    // Guard: only allow PDF/image files under 10MB
    if(file.size>10*1024*1024){showToast("File too large — max 10MB",T.amber);return;}
    const allowed=["application/pdf","image/png","image/jpeg","image/jpg","image/webp"];
    if(!allowed.includes(file.type)&&!file.type.startsWith("image/")){showToast("Please upload a PDF or image file",T.amber);return;}
    setParsing(true);
    setMode("list");
    showToast("AI is reading the pricing sheet...",T.accent);
    try{
      // Wrap FileReader in a Promise so async errors are properly caught
      const b64=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=ev=>resolve(ev.target.result.split(",")[1]);
        reader.onerror=()=>reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      const parsed=await parseFileWithClaude(b64,file.type);
      if(Array.isArray(parsed)&&parsed.length>0){
        setPreview(parsed.map(p=>({...p,_id:uid(),_keep:true})));
        setMode("preview");
        showToast("Found "+parsed.length+" products — review before saving",T.purple);
      } else {
        showToast("No products found — try a clearer image or add manually",T.amber);
      }
    }catch(err){
      console.error("Parse error:",err);
      showToast("Could not read file — try a different format",T.red);
    }finally{
      setParsing(false);
    }
  }

  function commitPreview(){
    const toAdd=preview.filter(p=>p._keep).map(({_id,_keep,...p})=>({...p,id:uid(),price:parseFloat(p.price)||0}));
    update(s=>{
      s.vendors=s.vendors.map(v=>v.id===vendor.id?{...v,products:[...(v.products||[]),...toAdd]}:v);
      return s;
    });
    log("Imported "+toAdd.length+" products to "+vendor.name);showToast("✓ "+toAdd.length+" products added");setPreview([]);setMode("list");
  }
  function saveManual(){
    if(!np.name.trim())return;
    const newProd={id:uid(),name:np.name.trim(),sku:np.sku.trim(),price:parseFloat(np.price)||0,strength:np.strength.trim()};
    update(s=>{
      s.vendors=s.vendors.map(v=>v.id===vendor.id?{...v,products:[...(v.products||[]),newProd]}:v);
      return s;
    });
    showToast("Product added");setNp({name:"",sku:"",price:"",strength:""});
  }
  function delProd(pid){update(s=>{s.vendors=s.vendors.map(v=>v.id===vendor.id?{...v,products:(v.products||[]).filter(p=>p.id!==pid)}:v);return s;});}
  function startEdit(p){setEditId(p.id);setEditBuf({name:p.name,sku:p.sku||"",price:p.price||0,strength:p.strength||""});}
  function saveEdit(pid){update(s=>{s.vendors=s.vendors.map(v=>v.id===vendor.id?{...v,products:(v.products||[]).map(p=>p.id===pid?{...p,...editBuf,price:parseFloat(editBuf.price)||0}:p)}:v);return s;});setEditId(null);}
  const th={textAlign:"left",padding:"7px 10px",fontSize:11,color:T.textMid,fontFamily:T.mono,borderBottom:`1px solid ${T.border}`,fontWeight:600};
  const td={padding:"8px 10px",fontSize:13,verticalAlign:"middle"};

  return(
    <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,marginBottom:16,overflow:"hidden"}}>
      <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:13,color:T.textMid,fontFamily:T.mono,letterSpacing:1,fontWeight:600}}>PRICING CATALOG {products.length>0&&<span style={{color:T.textDim,fontWeight:400}}>· {products.length} items</span>}</span>
        <div style={{display:"flex",gap:8}}>
          {["list","upload","manual"].map(m=>(
            <button key={m} onClick={()=>setMode(m===mode&&m!=="list"?"list":m)} style={{background:mode===m?T.accentDim:"transparent",border:`1px solid ${T.borderHi}`,color:mode===m?T.accent:T.textMid,borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:12,fontFamily:T.font,fontWeight:600}}>
              {m==="list"?"All":m==="upload"?"⬆ Upload":"+ Manual"}
            </button>
          ))}
        </div>
      </div>

      {mode==="upload"&&(
        <div style={{padding:20}}>
          <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)runParse(f);}} onClick={()=>{const i=document.createElement("input");i.type="file";i.accept=".pdf,.png,.jpg,.jpeg";i.onchange=e=>{const f=e.target.files[0];if(f)runParse(f);};i.click();}} style={{border:`2px dashed ${drag?T.accent:T.borderHi}`,borderRadius:8,padding:"36px 24px",textAlign:"center",cursor:"pointer",background:drag?T.bgCard:T.bg}}>
            <div style={{fontSize:28,marginBottom:10}}>⬆</div>
            <div style={{fontSize:14,color:T.text,marginBottom:6,fontWeight:600}}>Drop your pricing document here</div>
            <div style={{fontSize:12,color:T.textMid}}>or click to browse · PDF, PNG, JPG</div>
          </div>
          {parsing&&<div style={{marginTop:14,background:T.bgCard,border:`1px solid ${T.borderHi}`,borderRadius:6,padding:"12px 16px",display:"flex",alignItems:"center",gap:12}}><div style={{width:16,height:16,border:"2px solid #7c9be0",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/><span style={{fontSize:13,color:T.purple,fontWeight:500}}>AI is reading your pricing sheet...</span></div>}
        </div>
      )}

      {mode==="preview"&&(
        <div style={{padding:20}}>
          <div style={{background:T.greenDim,border:`1px solid ${T.green}44`,borderRadius:6,padding:"10px 14px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:13,color:T.green,fontWeight:600}}>✓ Found {preview.length} products — review then import</span>
            <div style={{display:"flex",gap:8}}><Btn small onClick={commitPreview}>Import {preview.filter(p=>p._keep).length}</Btn><Btn small ghost onClick={()=>{setPreview([]);setMode("list");}}>Cancel</Btn></div>
          </div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th style={th}></th>{["Product Name","SKU","Price","Strength"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{preview.map((p,i)=>(
              <tr key={p._id} style={{opacity:p._keep?1:0.4}}>
                <td style={{...td,textAlign:"center"}}><input type="checkbox" checked={p._keep} onChange={e=>setPreview(prev=>prev.map((pp,j)=>j===i?{...pp,_keep:e.target.checked}:pp))}/></td>
                {["name","sku","price","strength"].map(f=><td key={f} style={td}><input value={f==="price"?p[f]:(p[f]||"")} type={f==="price"?"number":"text"} onChange={e=>setPreview(prev=>prev.map((pp,j)=>j===i?{...pp,[f]:e.target.value}:pp))} style={{...IS,padding:"4px 8px",fontSize:12}}/></td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {mode==="manual"&&(
        <div style={{padding:20,borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr auto",gap:10,alignItems:"end"}}>
            {[{k:"name",l:"Product Name",ph:"e.g. Nitrile Gloves"},{k:"sku",l:"SKU",ph:"SKU-001"},{k:"price",l:"Unit Price ($)",ph:"0.00",t:"number"},{k:"strength",l:"Strength/Size",ph:"500mg"}].map(col=>(
              <div key={col.k}><Lbl>{col.l}</Lbl><input type={col.t||"text"} value={np[col.k]} placeholder={col.ph} onChange={e=>setNp(p=>({...p,[col.k]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&saveManual()} style={{...IS,padding:"7px 10px"}}/></div>
            ))}
            <div><Btn onClick={saveManual}>Add</Btn></div>
          </div>
        </div>
      )}

      {(mode==="list"||mode==="manual")&&(
        products.length>0?(
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Product Name","SKU","Unit Price","Strength",""].map(h=><th key={h} style={{...th,paddingLeft:h==="Product Name"?20:10}}>{h}</th>)}</tr></thead>
            <tbody>{products.map(p=>(
              <tr key={p.id} style={{borderBottom:`1px solid ${T.border}`}}>
                {editId===p.id?(
                  <>{["name","sku","price","strength"].map(f=><td key={f} style={{...td,paddingLeft:f==="name"?20:10}}><input type={f==="price"?"number":"text"} value={editBuf[f]} onChange={e=>setEditBuf(b=>({...b,[f]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&saveEdit(p.id)} style={{...IS,padding:"4px 8px",fontSize:12}} autoFocus={f==="name"}/></td>)}
                  <td style={{...td,display:"flex",gap:6}}><Btn small onClick={()=>saveEdit(p.id)}>✓</Btn><Btn small ghost onClick={()=>setEditId(null)}>✕</Btn></td></>
                ):(
                  <><td style={{...td,color:T.text,paddingLeft:20,fontWeight:500}}>{p.name}</td>
                  <td style={{...td,color:T.textMid,fontFamily:T.mono,fontSize:12}}>{p.sku||"—"}</td>
                  <td style={{...td,color:T.accent,fontWeight:700}}>${parseFloat(p.price||0).toFixed(2)}</td>
                  <td style={{...td,color:T.textMid,fontSize:12}}>{p.strength||"—"}</td>
                  <td style={{...td,display:"flex",gap:6,alignItems:"center"}}>
                    <button onClick={()=>startEdit(p)} style={{background:"none",border:"none",color:T.textMid,cursor:"pointer",fontSize:13}}>✎</button>
                    <button onClick={()=>delProd(p.id)} style={{background:"none",border:"none",color:T.textMid,cursor:"pointer",fontSize:14}}>✕</button>
                  </td></>
                )}
              </tr>
            ))}</tbody>
          </table>
        ):mode!=="manual"&&(
          <div style={{padding:"40px 20px",textAlign:"center"}}>
            <div style={{fontSize:24,marginBottom:12,color:T.textDim}}>◈</div>
            <div style={{fontSize:14,color:T.textMid,fontWeight:500,marginBottom:6}}>No pricing catalog yet</div>
            <div style={{display:"flex",gap:10,justifyContent:"center",marginTop:16}}>
              <Btn onClick={()=>setMode("upload")}>⬆ Upload Sheet</Btn>
              <Btn ghost onClick={()=>setMode("manual")}>+ Add Manually</Btn>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function VendorForm({initial,onSave,onCancel}){
  const [f,setF]=useState({name:"",contactName:"",contactTitle:"",contactPhone:"",email:"",businessNumber:"",industry:"",website:"",address:"",city:"",state:"",zip:"",country:"US",paymentTerms:"",preferredContact:"",notes:"",...initial});
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const {pct,tier}=vendorCompleteness(f);const tc=getTIER()[tier];const circ=113,off=circ-(circ*pct/100);
  return(
    <div style={{maxWidth:640}}>
      <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,letterSpacing:3,marginBottom:6,textTransform:"uppercase"}}>Vendor Management</div>
      <h2 style={{fontSize:22,fontWeight:700,color:T.text,marginBottom:22}}>{initial?.id?"Edit Vendor":"New Vendor"}</h2>
      <div style={{background:T.bgCard,border:`1px solid ${tc.border}`,borderRadius:T.radius,padding:"14px 20px",display:"flex",alignItems:"center",gap:16,marginBottom:24}}>
        <div style={{position:"relative",width:44,height:44,flexShrink:0}}>
          <svg width="44" height="44" viewBox="0 0 44 44" style={{transform:"rotate(-90deg)"}}>
            <circle cx="22" cy="22" r="18" fill="none" stroke={T.border} strokeWidth="3.5"/>
            <circle cx="22" cy="22" r="18" fill="none" stroke={tc.text} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off}/>
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:tc.text,fontFamily:T.mono}}>{pct}%</div>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>Profile completeness</div>
          <div style={{fontSize:11,color:T.textMid}}>{pct>=75?"Well documented — great for RFPs":pct>=35?"A few more fields will help":"Add details to improve vendor records"}</div>
        </div>
        <div style={{background:tc.bg,border:`1px solid ${tc.border}`,color:tc.text,borderRadius:20,padding:"4px 14px",fontSize:11,fontWeight:700}}>{tier}</div>
      </div>
      {[["Business Info",[{span:true,k:"name",l:"Business Name",req:true,ph:"e.g. Sunrise Medical Supply"},{k:"businessNumber",l:"Business/Tax #",ph:"EIN/Tax ID"},{k:"industry",l:"Industry",sel:INDUSTRIES},{k:"website",l:"Website",ph:"https://"},{k:"paymentTerms",l:"Payment Terms",sel:PAYMENT_TERMS}]],["Primary Contact",[{k:"contactName",l:"Contact Name",ph:"First & last"},{k:"contactTitle",l:"Title/Role",ph:"e.g. Account Manager"},{k:"contactPhone",l:"Phone",ph:"(555) 000-0000"},{k:"email",l:"Email",ph:"vendor@company.com"},{k:"preferredContact",l:"Preferred Contact",sel:["Email","Phone","Both"]}]],["Business Address",[{span:true,k:"address",l:"Street Address",ph:"123 Commerce Blvd"},{k:"country",l:"Country",ctry:true},{k:"city",l:"City",ph:"City"},{k:"zip",l:"ZIP / Postal",ph:"00000"}]]].map(([section,fields])=>(
        <div key={section}>
          <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,letterSpacing:2,textTransform:"uppercase",margin:"24px 0 14px",display:"flex",alignItems:"center",gap:10}}>{section}<div style={{flex:1,height:1,background:`linear-gradient(90deg,${T.border},transparent)`}}/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {fields.map(field=>(
              <div key={field.k} style={field.span?{gridColumn:"1/-1"}:{}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:6,fontWeight:700,textTransform:"uppercase"}}>
                  <span>{field.l}{field.req&&<span style={{color:T.red,marginLeft:3}}>*</span>}</span>
                </div>
                {field.ctry?<select value={f.country} onChange={e=>set("country",e.target.value)} style={IS}><option value="">Select...</option>{COUNTRIES.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}</select>
                :field.sel?<select value={f[field.k]} onChange={e=>set(field.k,e.target.value)} style={IS}><option value="">Select...</option>{field.sel.map(o=><option key={o}>{o}</option>)}</select>
                :<input value={f[field.k]||""} onChange={e=>set(field.k,e.target.value)} style={{...IS,borderColor:field.req&&!f[field.k]?.trim()?T.red+"66":T.border}} placeholder={field.ph}/>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,letterSpacing:2,textTransform:"uppercase",margin:"24px 0 8px",fontWeight:700}}>Notes</div>
      <textarea value={f.notes} onChange={e=>set("notes",e.target.value)} style={{...IS,height:90,resize:"vertical"}} placeholder="Payment terms, lead times..."/>
      <div style={{display:"flex",gap:10,marginTop:22}}><Btn onClick={()=>{if(!f.name.trim()){alert("Business name required");return;}onSave(f);}}>Save Vendor</Btn><Btn ghost onClick={onCancel}>Cancel</Btn></div>
    </div>
  );
}

function Vendors({store,update,log,showToast}){
  const [sel,setSel]=useState(null);const [form,setForm]=useState(null);const [search,setSearch]=useState("");
  const vendor=sel?store.vendors.find(v=>v.id===sel):null;
  const filtered=store.vendors.filter(v=>v.name.toLowerCase().includes(search.toLowerCase()));
  function save(data){
    const isNew=!data.id;
    if(isNew){data={...data,id:uid(),createdAt:now(),products:[]};}
    update(s=>{
      if(!isNew)s.vendors=s.vendors.map(v=>v.id===data.id?{...v,...data}:v);
      else s.vendors=[...s.vendors,data];
      return s;
    });
    log("Vendor "+data.name+" saved");showToast("Vendor saved");setForm(null);setSel(data.id);
  }
  function del(id){if(!confirm("Delete this vendor?"))return;update(s=>{s.vendors=s.vendors.filter(v=>v.id!==id);return s;});log("Vendor deleted","warn");setSel(null);}
  const vRFPs=vendor?store.rfps.filter(r=>r.vendorId===vendor.id):[];
  const vSavings=vRFPs.reduce((s,r)=>s+parseFloat(r.savings||0),0);
  const vSpend=vRFPs.filter(r=>r.vendorTotal).reduce((s,r)=>s+parseFloat(r.vendorTotal||0),0);
  return(
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      <div style={{width:260,borderRight:`1px solid ${T.border}`,overflow:"auto",padding:20,flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{margin:0,fontSize:16,color:T.accent,fontWeight:700}}>Vendors</h3><Btn small onClick={()=>{setForm({});setSel(null);}}>+ New</Btn></div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search vendors..." style={{...IS,marginBottom:8}}/>
        <div style={{fontSize:11,color:T.textMid,marginBottom:12,fontWeight:500}}>{filtered.length} vendor{filtered.length!==1?"s":""}</div>
        {filtered.map(v=>{const {tier}=vendorCompleteness(v);const tc=getTIER()[tier];return(
          <div key={v.id} onClick={()=>{setSel(v.id);setForm(null);}} style={{padding:"10px 12px",borderRadius:6,cursor:"pointer",background:sel===v.id?T.bgPanel:"transparent",border:sel===v.id?`1px solid ${T.borderHi}`:"1px solid transparent",marginBottom:4}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:30,height:30,borderRadius:"50%",background:T.bgCard,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:T.purple,flexShrink:0}}>{vendorInitials(v.name)}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:sel===v.id?T.accent:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600}}>{v.name}</div>
                <div style={{fontSize:10,color:T.textMid,fontFamily:T.mono}}>{(v.products||[]).length} products</div>
              </div>
              <div style={{width:6,height:6,borderRadius:"50%",background:tc.text,flexShrink:0}}/>
            </div>
          </div>
        );})}
        {!filtered.length&&<div style={{color:T.textMid,fontSize:12,marginTop:16,textAlign:"center"}}>No vendors yet</div>}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"32px 36px"}}>
        {!vendor&&!form&&<div style={{textAlign:"center",marginTop:80}}><div style={{fontSize:32,marginBottom:12}}>⬡</div><div style={{color:T.textMid,fontSize:14,fontWeight:500}}>Select a vendor or create a new one</div></div>}
        {form&&<VendorForm initial={form} onSave={data=>save(form.id?{...form,...data}:{...data})} onCancel={()=>setForm(null)}/>}
        {vendor&&!form&&(()=>{
          const {pct,tier}=vendorCompleteness(vendor);const tc=getTIER()[tier];
          return(<>
            <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:10,marginBottom:20,overflow:"hidden"}}>
              <div style={{padding:"20px 24px",display:"flex",gap:16,alignItems:"flex-start",borderBottom:`1px solid ${T.border}`}}>
                <div style={{width:54,height:54,borderRadius:"50%",background:T.bgPanel,display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,fontWeight:700,color:T.purple,flexShrink:0}}>{vendorInitials(vendor.name)}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:22,fontWeight:700,color:T.text}}>{vendor.name}</div>
                  <div style={{fontSize:12,color:T.textMid,marginTop:3,fontWeight:500}}>{[vendor.industry,vendor.paymentTerms].filter(Boolean).join(" · ")}</div>
                  <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
                    <div style={{background:tc.bg,border:`1px solid ${tc.border}`,color:tc.text,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700}}>{tier} · {pct}%</div>
                    <div style={{background:T.bgPanel,border:`1px solid ${T.borderHi}`,color:T.textMid,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600}}>{(vendor.products||[]).length} products</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}><Btn small onClick={()=>setForm({...vendor})}>Edit</Btn><Btn small danger onClick={()=>del(vendor.id)}>Delete</Btn></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)"}}>
                {[{label:"Total Spend",val:`$${vSpend.toFixed(2)}`},{label:"Total Saved",val:`$${vSavings.toFixed(2)}`},{label:"RFPs",val:vRFPs.length}].map((s,i)=>(
                  <div key={s.label} style={{padding:"14px 20px",textAlign:"center",borderRight:i<2?`1px solid ${T.border}`:"none"}}>
                    <div style={{fontSize:18,fontWeight:700,color:T.accent}}>{s.val}</div>
                    <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,marginTop:3,fontWeight:600}}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
              <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:18}}>
                <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:14,fontWeight:700}}>PRIMARY CONTACT</div>
                {[["Name",vendor.contactName],["Title",vendor.contactTitle],["Phone",vendor.contactPhone],["Email",vendor.email],["Business #",vendor.businessNumber]].map(([l,v])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${T.border}`}}>
                    <span style={{fontSize:11,color:T.textMid,fontFamily:T.mono,fontWeight:600}}>{l}</span>
                    <span style={{fontSize:12,color:v?T.text:T.textDim,fontStyle:v?"normal":"italic",fontWeight:v?500:400}}>{v||"—"}</span>
                  </div>
                ))}
              </div>
              <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:18}}>
                <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:14,fontWeight:700}}>ADDRESS</div>
                {vendor.address?<div style={{fontSize:13,color:T.text,lineHeight:1.8,fontWeight:500}}><div>{vendor.address}</div>{(vendor.city||vendor.state)&&<div>{[vendor.city,vendor.state].filter(Boolean).join(", ")}{vendor.zip?` ${vendor.zip}`:""}</div>}</div>:<div style={{fontSize:13,color:T.textMid,fontStyle:"italic"}}>No address on file</div>}
                {vendor.website&&<a href={vendor.website} target="_blank" rel="noreferrer" style={{color:T.purple,fontSize:12,display:"block",marginTop:10,fontWeight:500}}>{vendor.website}</a>}
              </div>
            </div>
            <PricingSection vendor={vendor} update={update} showToast={showToast} log={log}/>
            {vendor.notes&&<div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:18}}><div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:8,fontWeight:700}}>NOTES</div><div style={{fontSize:13,color:T.text,lineHeight:1.7,whiteSpace:"pre-wrap",fontWeight:400}}>{vendor.notes}</div></div>}
          </>);
        })()}
      </div>
    </div>
  );
}

function RFPs({store,update,log,showToast}){
  const [sel,setSel]=useState(null);const [creating,setCreating]=useState(false);const [newRFP,setNewRFP]=useState({vendorId:"",lines:[]});const [filter,setFilter]=useState("all");
  const rfp=sel?store.rfps.find(r=>r.id===sel):null;const rfpV=rfp?store.vendors.find(v=>v.id===rfp.vendorId):null;
  const filtered=store.rfps.filter(r=>filter==="all"||r.status===filter);
  function sub(lines){return lines.reduce((s,l)=>s+(l.qty*l.unitPrice),0);}
  function savings(r){if(!r.vendorTotal||!r.subtotal)return 0;return Math.max(0,r.subtotal-parseFloat(r.vendorTotal));}
  function create(){
    if(!newRFP.vendorId)return showToast("Select a vendor",T.amber);
    if(!newRFP.lines.length)return showToast("Add at least one line",T.amber);
    const newId=uid();
    const obj={...newRFP,id:newId,status:"Draft",subtotal:sub(newRFP.lines),createdAt:now()};
    update(s=>{s.rfps=[obj,...s.rfps];return s;});
    log("RFP created for "+(store.vendors.find(v=>v.id===newRFP.vendorId)?.name||""));
    showToast("RFP created");setCreating(false);setNewRFP({vendorId:"",lines:[]});setSel(newId);
  }
  function upd(id,patch){update(s=>{s.rfps=s.rfps.map(r=>r.id===id?{...r,...patch}:r);return s;});}

  function RFPDetail(){
    const [vt,setVt]=useState(rfp.vendorTotal||"");const [sh,setSh]=useState(rfp.shipping||"");
    const sav=savings(rfp);
    function saveReply(){const v=parseFloat(vt),s=parseFloat(sh)||0;upd(rfp.id,{vendorTotal:v,shipping:s,savings:Math.max(0,rfp.subtotal-v),status:"Quote Received"});showToast("Quote saved");}
    return(
      <div style={{maxWidth:720}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
          <div><h2 style={{fontSize:22,fontWeight:700,color:T.text,margin:0}}>RFP — {rfpV?.name}</h2><div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,marginTop:4,fontWeight:500}}>#{rfp.id.slice(0,8).toUpperCase()} · {new Date(rfp.createdAt).toLocaleDateString()}</div></div>
        </div>
        <div style={{marginBottom:16}}><Lbl>Status</Lbl><select value={rfp.status} onChange={e=>upd(rfp.id,{status:e.target.value})} style={{...IS,width:"auto",color:T.accent}}>{RFP_STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
        <table style={{width:"100%",borderCollapse:"collapse",marginBottom:24}}>
          <thead><tr>{["Product","SKU","Strength","Qty","Unit Price","Line Total"].map(h=><th key={h} style={{textAlign:"left",padding:"6px 8px",fontSize:11,color:T.textMid,fontFamily:T.mono,borderBottom:`1px solid ${T.border}`,fontWeight:700}}>{h}</th>)}</tr></thead>
          <tbody>{rfp.lines.map(l=><tr key={l.id}><td style={{padding:"8px",fontSize:13,color:T.text,fontWeight:500}}>{l.productName}</td><td style={{padding:"8px",fontSize:12,color:T.textMid,fontFamily:T.mono}}>{l.sku}</td><td style={{padding:"8px",fontSize:12,color:T.textMid}}>{l.strength||"-"}</td><td style={{padding:"8px",fontSize:13,color:T.text,fontWeight:500}}>{l.qty}</td><td style={{padding:"8px",fontSize:13,color:T.accent,fontWeight:700}}>${l.unitPrice.toFixed(2)}</td><td style={{padding:"8px",fontSize:13,color:T.accent,fontWeight:700}}>${(l.qty*l.unitPrice).toFixed(2)}</td></tr>)}</tbody>
        </table>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:20}}>
            <div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:12,fontWeight:700}}>VENDOR REPLY</div>
            <Lbl>Vendor Total ($)</Lbl><input type="number" value={vt} onChange={e=>setVt(e.target.value)} style={{...IS,marginBottom:12}} placeholder="0.00"/>
            <Lbl>Shipping Fee ($)</Lbl><input type="number" value={sh} onChange={e=>setSh(e.target.value)} style={{...IS,marginBottom:12}} placeholder="0.00"/>
            <Btn onClick={saveReply}>Save Reply</Btn>
          </div>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:20}}>
            <div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:12,fontWeight:700}}>SUMMARY</div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,fontSize:13}}><span style={{color:T.textMid,fontWeight:600}}>Our Estimate</span><span style={{color:T.text,fontWeight:600}}>${rfp.subtotal?.toFixed(2)}</span></div>
            {rfp.vendorTotal&&<><div style={{display:"flex",justifyContent:"space-between",marginBottom:8,fontSize:13}}><span style={{color:T.textMid,fontWeight:600}}>Vendor Total</span><span style={{color:T.text,fontWeight:600}}>${parseFloat(rfp.vendorTotal).toFixed(2)}</span></div>
            <div style={{borderTop:`1px solid ${T.border}`,paddingTop:12,marginTop:8}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:18,fontWeight:700}}><span style={{color:T.text}}>Grand Total</span><span style={{color:T.accent}}>${(parseFloat(rfp.vendorTotal)+parseFloat(rfp.shipping||0)).toFixed(2)}</span></div>
              {sav>0&&<div style={{background:T.greenDim,border:`1px solid ${T.green}55`,borderRadius:6,padding:"10px 14px",marginTop:12,display:"flex",justifyContent:"space-between"}}><span style={{color:T.green,fontSize:13,fontWeight:600}}>💰 Savings</span><span style={{color:T.green,fontWeight:700,fontSize:16}}>${sav.toFixed(2)}</span></div>}
            </div></>}
          </div>
        </div>
      </div>
    );
  }

  return(
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      <div style={{width:280,borderRight:`1px solid ${T.border}`,overflow:"auto",padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{margin:0,fontSize:16,color:T.accent,fontWeight:700}}>RFPs</h3><Btn small onClick={()=>{setCreating(true);setSel(null);}}>+ New</Btn></div>
        <select value={filter} onChange={e=>setFilter(e.target.value)} style={{...IS,marginBottom:12}}><option value="all">All Statuses</option>{RFP_STATUSES.map(s=><option key={s}>{s}</option>)}</select>
        {filtered.map(r=>{const v=store.vendors.find(vv=>vv.id===r.vendorId);return(
          <div key={r.id} onClick={()=>{setSel(r.id);setCreating(false);}} style={{padding:"10px 12px",borderRadius:6,cursor:"pointer",background:sel===r.id?T.bgPanel:"transparent",border:sel===r.id?`1px solid ${T.borderHi}`:"1px solid transparent",marginTop:6}}>
            <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:13,color:T.text,fontWeight:600}}>{v?.name||"Unknown"}</span><SBadge status={r.status}/></div>
            <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,marginTop:3,fontWeight:500}}>{new Date(r.createdAt).toLocaleDateString()} · {r.lines.length} items · ${r.subtotal?.toFixed(2)}</div>
          </div>
        );})}
        {!filtered.length&&<div style={{color:T.textMid,fontSize:12,marginTop:16,fontWeight:500}}>No RFPs</div>}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"32px 36px"}}>
        {creating&&(()=>{
          const vendor=store.vendors.find(v=>v.id===newRFP.vendorId);const vp=vendor?.products||[];const st=newRFP.lines.reduce((s,l)=>s+(l.qty*l.unitPrice),0);
          function ul(id,patch){setNewRFP(r=>({...r,lines:r.lines.map(l=>l.id===id?{...l,...patch}:l)}));}
          function addLine(){if(!vp.length)return showToast("Add products to this vendor first",T.amber);const p=vp[0];setNewRFP(r=>({...r,lines:[...r.lines,{id:uid(),productId:p.id,productName:p.name,sku:p.sku,strength:p.strength,unitPrice:parseFloat(p.price||0),qty:1}]}));}
          return(
            <div style={{maxWidth:700}}>
              <h3 style={{fontSize:22,fontWeight:700,color:T.text,marginBottom:24}}>New RFP</h3>
              <Lbl>Vendor</Lbl>
              <select value={newRFP.vendorId} onChange={e=>setNewRFP({...newRFP,vendorId:e.target.value,lines:[]})} style={{...IS,marginBottom:24}}><option value="">Select vendor...</option>{store.vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
              {vendor&&<>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><Lbl>Line Items</Lbl><Btn small onClick={addLine}>+ Add Line</Btn></div>
                {newRFP.lines.length>0&&<table style={{width:"100%",borderCollapse:"collapse",marginBottom:16}}>
                  <thead><tr>{["Product","SKU","Strength","Unit Price","Qty","Line Total",""].map(h=><th key={h} style={{textAlign:"left",padding:"6px 8px",fontSize:11,color:T.textMid,fontFamily:T.mono,borderBottom:`1px solid ${T.border}`,fontWeight:700}}>{h}</th>)}</tr></thead>
                  <tbody>{newRFP.lines.map(l=><tr key={l.id}>
                    <td style={{padding:"6px 8px"}}><select value={l.productId} onChange={e=>{const p=vp.find(pp=>pp.id===e.target.value);if(p)ul(l.id,{productId:p.id,productName:p.name,sku:p.sku,strength:p.strength,unitPrice:parseFloat(p.price||0)});}} style={{...IS,padding:"4px 8px",fontSize:12}}>{vp.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
                    <td style={{padding:"6px 8px",fontSize:12,color:T.textMid,fontFamily:T.mono,fontWeight:500}}>{l.sku}</td>
                    <td style={{padding:"6px 8px",fontSize:12,color:T.textMid,fontWeight:500}}>{l.strength||"-"}</td>
                    <td style={{padding:"6px 8px",fontSize:13,color:T.accent,fontWeight:700}}>${l.unitPrice.toFixed(2)}</td>
                    <td style={{padding:"6px 8px"}}><input type="number" min="1" value={l.qty} onChange={e=>ul(l.id,{qty:parseInt(e.target.value)||1})} style={{...IS,width:60,padding:"4px 8px",textAlign:"center"}}/></td>
                    <td style={{padding:"6px 8px",fontSize:13,color:T.accent,fontWeight:700}}>${(l.qty*l.unitPrice).toFixed(2)}</td>
                    <td><button onClick={()=>setNewRFP(r=>({...r,lines:r.lines.filter(ll=>ll.id!==l.id)}))} style={{background:"none",border:"none",color:T.textMid,cursor:"pointer"}}>✕</button></td>
                  </tr>)}</tbody>
                </table>}
                <div style={{textAlign:"right",fontSize:20,color:T.accent,marginBottom:24,fontWeight:700}}>Subtotal: ${st.toFixed(2)}</div>
              </>}
              <div style={{display:"flex",gap:10}}><Btn onClick={create}>Create RFP</Btn><Btn ghost onClick={()=>setCreating(false)}>Cancel</Btn></div>
            </div>
          );
        })()}
        {rfp&&!creating&&<RFPDetail/>}
        {!rfp&&!creating&&<div style={{color:T.textMid,marginTop:80,textAlign:"center",fontSize:14,fontWeight:500}}>Select an RFP or create one</div>}
      </div>
    </div>
  );
}

function Inventory({store,update,log,showToast,lowStock,outOfStock}){
  const [sel,setSel]=useState(null);const [form,setForm]=useState(null);const [search,setSearch]=useState("");const [bcText,setBcText]=useState("");
  const item=sel?store.inventory.find(i=>i.id===sel):null;
  const filtered=store.inventory.filter(i=>i.name.toLowerCase().includes(search.toLowerCase())||(i.sku||"").toLowerCase().includes(search.toLowerCase()));
  function save(data){
    const isNew=!data.id;
    if(isNew){data={...data,id:uid(),createdAt:now()};}
    update(s=>{
      if(!isNew)s.inventory=s.inventory.map(i=>i.id===data.id?{...i,...data}:i);
      else s.inventory=[...s.inventory,data];
      return s;
    });
    log("Item \""+data.name+"\" saved");showToast("Item saved");setForm(null);setSel(data.id);
  }
  function adj(id,d){update(s=>{s.inventory=s.inventory.map(i=>i.id===id?{...i,qty:Math.max(0,(i.qty||0)+d)}:i);return s;});}
  function genBarcode(id,text){if(!text)return;const svg=generateBarcodeSVG(text);const enc="data:image/svg+xml;base64,"+btoa(svg);update(s=>{s.inventory=s.inventory.map(i=>i.id===id?{...i,barcodeSvg:enc,barcodeText:text}:i);return s;});showToast("Barcode generated");}
  const sc=i=>{if(!i)return T.textMid;if(i.qty===0)return T.red;if(i.qty<=(i.reorderAt||5))return T.amber;return T.green;};
  return(
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      <div style={{width:280,borderRight:`1px solid ${T.border}`,overflow:"auto",padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{margin:0,fontSize:16,color:T.accent,fontWeight:700}}>Inventory</h3><Btn small onClick={()=>{setForm({name:"",sku:"",qty:0,costPrice:0,salePrice:0,strength:"",reorderAt:5,category:""});setSel(null);}}>+ Add</Btn></div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name/SKU..." style={{...IS,marginBottom:8}}/>
        {filtered.map(i=>(
          <div key={i.id} onClick={()=>{setSel(i.id);setForm(null);}} style={{padding:"10px 12px",borderRadius:6,cursor:"pointer",background:sel===i.id?T.bgPanel:"transparent",border:sel===i.id?`1px solid ${T.borderHi}`:"1px solid transparent",marginTop:6}}>
            <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:13,color:T.text,fontWeight:600}}>{i.name}</span><span style={{color:sc(i),fontSize:12,fontWeight:700}}>{i.qty}</span></div>
            <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,fontWeight:500}}>{i.sku||"No SKU"} · ${parseFloat(i.salePrice||0).toFixed(2)}</div>
          </div>
        ))}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"32px 36px"}}>
        {form&&<div style={{maxWidth:560}}>
          <h3 style={{fontSize:20,fontWeight:700,color:T.text,marginBottom:24}}>{form.id?"Edit Item":"New Inventory Item"}</h3>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {[["name","Product Name"],["sku","SKU"],["category","Category"],["strength","Strength"]].map(([f,l])=><div key={f}><Lbl>{l}</Lbl><input value={form[f]||""} onChange={e=>setForm({...form,[f]:e.target.value})} style={IS}/></div>)}
            {[["qty","Qty on Hand"],["reorderAt","Reorder At"],["costPrice","Cost Price ($)"],["salePrice","Sale Price ($)"]].map(([f,l])=><div key={f}><Lbl>{l}</Lbl><input type="number" value={form[f]||0} onChange={e=>setForm({...form,[f]:parseFloat(e.target.value)||0})} style={IS}/></div>)}
          </div>
          <div style={{display:"flex",gap:10,marginTop:20}}><Btn onClick={()=>save(form)}>Save</Btn><Btn ghost onClick={()=>setForm(null)}>Cancel</Btn></div>
        </div>}
        {item&&!form&&<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
            <div><h2 style={{fontSize:24,fontWeight:700,color:T.text,margin:0}}>{item.name}</h2><div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,marginTop:4,fontWeight:500}}>SKU: {item.sku||"—"} · {item.category||"Uncategorized"}</div></div>
            <div style={{display:"flex",gap:8}}><Btn small onClick={()=>setForm({...item})}>Edit</Btn><Btn small danger onClick={()=>{if(!confirm("Delete?"))return;update(s=>{s.inventory=s.inventory.filter(i=>i.id!==item.id);return s;});setSel(null);}}>Delete</Btn></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,marginBottom:24}}>
            {[{l:"In Stock",v:item.qty,c:sc(item)},{l:"Cost Price",v:`$${parseFloat(item.costPrice||0).toFixed(2)}`,c:T.accent},{l:"Sale Price",v:`$${parseFloat(item.salePrice||0).toFixed(2)}`,c:T.purple},{l:"Margin",v:item.salePrice&&item.costPrice?`${(((item.salePrice-item.costPrice)/item.salePrice)*100).toFixed(1)}%`:"—",c:T.green},{l:"Reorder At",v:item.reorderAt||5,c:T.textMid},{l:"Strength",v:item.strength||"—",c:T.textMid}].map(k=>(
              <div key={k.l} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:6,padding:14}}>
                <div style={{fontSize:10,color:T.textMid,fontFamily:T.mono,letterSpacing:1,fontWeight:700}}>{k.l}</div>
                <div style={{fontSize:22,color:k.c,fontWeight:700,marginTop:4}}>{k.v}</div>
              </div>
            ))}
          </div>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:20,marginBottom:20}}>
            <div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:16,fontWeight:700}}>QTY ADJUSTMENT</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {[-10,-5,-1,+1,+5,+10].map(d=><button key={d} onClick={()=>adj(item.id,d)} style={{background:d<0?T.redDim:T.greenDim,border:`1px solid ${d<0?T.red+"44":T.green+"44"}`,color:d<0?T.red:T.green,borderRadius:8,padding:"8px 14px",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:T.mono}}>{d>0?`+${d}`:d}</button>)}
            </div>
          </div>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:20}}>
            <div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:16,fontWeight:700}}>BARCODE GENERATOR</div>
            {item.barcodeSvg&&<img src={item.barcodeSvg} alt="barcode" style={{display:"block",marginBottom:12,background:"white",padding:8,borderRadius:4}}/>}
            <div style={{display:"flex",gap:10}}>
              <input value={bcText||item.barcodeText||item.sku||""} onChange={e=>setBcText(e.target.value)} placeholder="Enter barcode text..." style={{...IS,flex:1}}/>
              <Btn onClick={()=>genBarcode(item.id,bcText||item.barcodeText||item.sku||item.id.slice(0,8))}>Generate</Btn>
            </div>
          </div>
        </>}
        {!item&&!form&&<div style={{color:T.textMid,marginTop:80,textAlign:"center",fontSize:14,fontWeight:500}}>Select an item or add one</div>}
      </div>
    </div>
  );
}

function Clients({store,update,log,showToast}){
  const [sel,setSel]=useState(null);const [form,setForm]=useState(null);const [search,setSearch]=useState("");
  const client=sel?store.clients.find(c=>c.id===sel):null;
  const filtered=store.clients.filter(c=>c.name.toLowerCase().includes(search.toLowerCase()));
  const cInv=client?store.invoices.filter(i=>i.clientId===client.id):[];
  function save(data){
    const isNew=!data.id;
    if(isNew){data={...data,id:uid(),createdAt:now()};}
    update(s=>{
      if(!isNew)s.clients=s.clients.map(c=>c.id===data.id?{...c,...data}:c);
      else s.clients=[...s.clients,data];
      return s;
    });
    log("Client "+data.name+" saved");showToast("Client saved");setForm(null);setSel(data.id);
  }
  return(
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      <div style={{width:260,borderRight:`1px solid ${T.border}`,overflow:"auto",padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{margin:0,fontSize:16,color:T.accent,fontWeight:700}}>Clients</h3><Btn small onClick={()=>{setForm({name:"",email:"",phone:"",address:"",notes:""});setSel(null);}}>+ New</Btn></div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{...IS,marginBottom:8}}/>
        {filtered.map(c=><div key={c.id} onClick={()=>{setSel(c.id);setForm(null);}} style={{padding:"10px 12px",borderRadius:6,cursor:"pointer",background:sel===c.id?T.bgPanel:"transparent",border:sel===c.id?`1px solid ${T.borderHi}`:"1px solid transparent",marginTop:6}}>
          <div style={{fontSize:14,color:sel===c.id?T.accent:T.text,fontWeight:600}}>{c.name}</div>
          <div style={{fontSize:11,color:T.textMid,fontWeight:500}}>{c.email}</div>
        </div>)}
        {!filtered.length&&<div style={{color:T.textMid,fontSize:12,marginTop:16,textAlign:"center",fontWeight:500}}>No clients yet</div>}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"32px 36px"}}>
        {form&&<div style={{maxWidth:480}}>
          <h3 style={{fontSize:20,fontWeight:700,color:T.text,marginBottom:24}}>{form.id?"Edit Client":"New Client"}</h3>
          {["name","email","phone","address"].map(f=><div key={f} style={{marginBottom:14}}><Lbl>{f.charAt(0).toUpperCase()+f.slice(1)}</Lbl><input value={form[f]||""} onChange={e=>setForm({...form,[f]:e.target.value})} style={IS}/></div>)}
          <Lbl>Notes</Lbl><textarea value={form.notes||""} onChange={e=>setForm({...form,notes:e.target.value})} style={{...IS,height:80,resize:"vertical"}}/>
          <div style={{display:"flex",gap:10,marginTop:16}}><Btn onClick={()=>save(form)}>Save</Btn><Btn ghost onClick={()=>setForm(null)}>Cancel</Btn></div>
        </div>}
        {client&&!form&&<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
            <div><h2 style={{fontSize:24,fontWeight:700,color:T.text,margin:0}}>{client.name}</h2><div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,marginTop:4,fontWeight:500}}>{client.email}{client.phone?` · ${client.phone}`:""}</div></div>
            <div style={{display:"flex",gap:8}}><Btn small onClick={()=>setForm({...client})}>Edit</Btn><Btn small danger onClick={()=>{if(!confirm("Delete?"))return;update(s=>{s.clients=s.clients.filter(c=>c.id!==client.id);return s;});setSel(null);}}>Delete</Btn></div>
          </div>
          <div style={{display:"flex",gap:16,marginBottom:24}}>
            {[{l:"Total Invoices",v:cInv.length},{l:"Total Billed",v:`$${cInv.reduce((s,i)=>s+i.total,0).toFixed(2)}`},{l:"Paid",v:`$${cInv.filter(i=>i.status==="Paid").reduce((s,i)=>s+i.total,0).toFixed(2)}`}].map(k=><div key={k.l} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:6,padding:"14px 20px"}}><div style={{fontSize:10,color:T.textMid,fontFamily:T.mono,fontWeight:700}}>{k.l}</div><div style={{fontSize:20,color:T.accent,fontWeight:700}}>{k.v}</div></div>)}
          </div>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:20}}>
            <div style={{fontSize:12,color:T.textMid,fontFamily:T.mono,letterSpacing:1,marginBottom:12,fontWeight:700}}>INVOICES</div>
            {cInv.map(inv=><div key={inv.id} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${T.border}`,fontSize:13}}>
              <span style={{color:T.textMid,fontFamily:T.mono,fontWeight:500}}>#{inv.id.slice(0,8).toUpperCase()}</span>
              <span style={{color:T.text,fontWeight:500}}>{new Date(inv.createdAt).toLocaleDateString()}</span>
              <span style={{color:T.accent,fontWeight:700}}>${inv.total.toFixed(2)}</span>
              <SBadge status={inv.status}/>
            </div>)}
            {!cInv.length&&<div style={{color:T.textMid,fontSize:13,fontWeight:500}}>No invoices</div>}
          </div>
        </>}
        {!client&&!form&&<div style={{color:T.textMid,marginTop:80,textAlign:"center",fontSize:14,fontWeight:500}}>Select a client or create one</div>}
      </div>
    </div>
  );
}

function Invoices({store,update,log,showToast}){
  const [sel,setSel]=useState(null);const [creating,setCreating]=useState(false);const [newInv,setNewInv]=useState({clientId:"",lines:[],taxRate:0,dueDate:"",notes:""});const [filter,setFilter]=useState("all");
  const inv=sel?store.invoices.find(i=>i.id===sel):null;const invClient=inv?store.clients.find(c=>c.id===inv.clientId):null;
  const filtered=store.invoices.filter(i=>filter==="all"||i.status===filter);
  const pSub=newInv.lines.reduce((s,l)=>s+(l.qty*l.unitPrice),0);const pTax=pSub*(parseFloat(newInv.taxRate)/100);const pTotal=pSub+pTax;
  function ul(id,patch){setNewInv(n=>({...n,lines:n.lines.map(l=>l.id===id?{...l,...patch}:l)}));}
  function create(){
    if(!newInv.clientId)return showToast("Select a client",T.amber);
    if(!newInv.lines.length)return showToast("Add at least one line",T.amber);
    const newId=uid();
    const obj={...newInv,id:newId,status:"Draft",subtotal:pSub,tax:pTax,total:pTotal,createdAt:now()};
    update(s=>{s.invoices=[obj,...s.invoices];return s;});
    log("Invoice created for "+(store.clients.find(c=>c.id===newInv.clientId)?.name||""));
    showToast("Invoice created");setCreating(false);setNewInv({clientId:"",lines:[],taxRate:0,dueDate:"",notes:""});setSel(newId);
  }
  return(
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      <div style={{width:280,borderRight:`1px solid ${T.border}`,overflow:"auto",padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{margin:0,fontSize:16,color:T.accent,fontWeight:700}}>Invoices</h3><Btn small onClick={()=>{setCreating(true);setSel(null);}}>+ New</Btn></div>
        <select value={filter} onChange={e=>setFilter(e.target.value)} style={{...IS,marginBottom:12}}><option value="all">All Statuses</option>{INV_STATUSES.map(s=><option key={s}>{s}</option>)}</select>
        {filtered.map(i=>{const c=store.clients.find(cc=>cc.id===i.clientId);return(
          <div key={i.id} onClick={()=>{setSel(i.id);setCreating(false);}} style={{padding:"10px 12px",borderRadius:6,cursor:"pointer",background:sel===i.id?T.bgPanel:"transparent",border:sel===i.id?`1px solid ${T.borderHi}`:"1px solid transparent",marginTop:6}}>
            <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:13,color:T.text,fontWeight:600}}>{c?.name||"Unknown"}</span><span style={{color:T.accent,fontSize:13,fontWeight:700}}>${i.total.toFixed(2)}</span></div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}><span style={{fontSize:11,color:T.textMid,fontFamily:T.mono,fontWeight:500}}>{new Date(i.createdAt).toLocaleDateString()}</span><SBadge status={i.status}/></div>
          </div>
        );})}
        {!filtered.length&&<div style={{color:T.textMid,fontSize:12,marginTop:16,fontWeight:500}}>No invoices</div>}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"32px 36px"}}>
        {creating&&<div style={{maxWidth:720}}>
          <h3 style={{fontSize:22,fontWeight:700,color:T.text,marginBottom:24}}>New Invoice</h3>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
            <div><Lbl>Client</Lbl><select value={newInv.clientId} onChange={e=>setNewInv({...newInv,clientId:e.target.value})} style={IS}><option value="">Select client...</option>{store.clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><Lbl>Due Date</Lbl><input type="date" value={newInv.dueDate} onChange={e=>setNewInv({...newInv,dueDate:e.target.value})} style={IS}/></div>
            <div><Lbl>Tax Rate (%)</Lbl><input type="number" value={newInv.taxRate} onChange={e=>setNewInv({...newInv,taxRate:e.target.value})} style={IS}/></div>
            <div><Lbl>Notes</Lbl><input value={newInv.notes} onChange={e=>setNewInv({...newInv,notes:e.target.value})} style={IS}/></div>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><Lbl>Line Items</Lbl><Btn small onClick={()=>setNewInv(n=>({...n,lines:[...n.lines,{id:uid(),inventoryId:"",productName:"",sku:"",unitPrice:0,qty:1}]}))}>+ Add Line</Btn></div>
          {newInv.lines.length>0&&<table style={{width:"100%",borderCollapse:"collapse",marginBottom:16}}>
            <thead><tr>{["Product","SKU","Unit Price","Qty","Total",""].map(h=><th key={h} style={{textAlign:"left",padding:"6px 8px",fontSize:11,color:T.textMid,fontFamily:T.mono,borderBottom:`1px solid ${T.border}`,fontWeight:700}}>{h}</th>)}</tr></thead>
            <tbody>{newInv.lines.map(l=><tr key={l.id}>
              <td style={{padding:"6px 8px"}}>
                <select value={l.inventoryId} onChange={e=>{const it=store.inventory.find(i=>i.id===e.target.value);if(it)ul(l.id,{inventoryId:it.id,productName:it.name,sku:it.sku,unitPrice:parseFloat(it.salePrice||0)});else ul(l.id,{inventoryId:"",productName:"",sku:"",unitPrice:0});}} style={{...IS,padding:"4px 8px",fontSize:12,marginBottom:4}}><option value="">Select from inventory...</option>{store.inventory.map(i=><option key={i.id} value={i.id}>{i.name} (Qty: {i.qty})</option>)}</select>
                {!l.inventoryId&&<input value={l.productName} onChange={e=>ul(l.id,{productName:e.target.value})} placeholder="Or type manually" style={{...IS,padding:"4px 8px",fontSize:12}}/>}
              </td>
              <td style={{padding:"6px 8px",fontSize:12,color:T.textMid,fontFamily:T.mono,fontWeight:500}}>{l.sku}</td>
              <td style={{padding:"6px 8px"}}><input type="number" value={l.unitPrice} onChange={e=>ul(l.id,{unitPrice:parseFloat(e.target.value)||0})} style={{...IS,width:80,padding:"4px 8px"}}/></td>
              <td style={{padding:"6px 8px"}}><input type="number" min="1" value={l.qty} onChange={e=>ul(l.id,{qty:parseInt(e.target.value)||1})} style={{...IS,width:60,padding:"4px 8px"}}/></td>
              <td style={{padding:"6px 8px",color:T.accent,fontWeight:700}}>${(l.qty*l.unitPrice).toFixed(2)}</td>
              <td><button onClick={()=>setNewInv(n=>({...n,lines:n.lines.filter(ll=>ll.id!==l.id)}))} style={{background:"none",border:"none",color:T.textMid,cursor:"pointer"}}>✕</button></td>
            </tr>)}</tbody>
          </table>}
          <div style={{textAlign:"right",marginBottom:24}}>
            <div style={{fontSize:13,color:T.textMid,fontWeight:600}}>Subtotal: ${pSub.toFixed(2)}</div>
            {parseFloat(newInv.taxRate)>0&&<div style={{fontSize:13,color:T.textMid,fontWeight:600}}>Tax ({newInv.taxRate}%): ${pTax.toFixed(2)}</div>}
            <div style={{fontSize:22,color:T.accent,fontWeight:700}}>Total: ${pTotal.toFixed(2)}</div>
          </div>
          <div style={{display:"flex",gap:10}}><Btn onClick={create}>Create Invoice</Btn><Btn ghost onClick={()=>setCreating(false)}>Cancel</Btn></div>
        </div>}
        {inv&&!creating&&<div style={{maxWidth:720}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
            <div><h2 style={{fontSize:22,fontWeight:700,color:T.text,margin:0}}>Invoice — {invClient?.name}</h2><div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,marginTop:4,fontWeight:500}}>#{inv.id.slice(0,8).toUpperCase()} · {new Date(inv.createdAt).toLocaleDateString()}</div></div>
          </div>
          <div style={{marginBottom:16}}><Lbl>Status</Lbl><select value={inv.status} onChange={e=>update(s=>{s.invoices=s.invoices.map(i=>i.id===inv.id?{...i,status:e.target.value}:i);return s;})} style={{...IS,width:"auto",color:T.accent}}>{INV_STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
          <table style={{width:"100%",borderCollapse:"collapse",marginBottom:20}}>
            <thead><tr>{["Product","SKU","Qty","Unit Price","Total"].map(h=><th key={h} style={{textAlign:"left",padding:"6px 8px",fontSize:11,color:T.textMid,fontFamily:T.mono,borderBottom:`1px solid ${T.border}`,fontWeight:700}}>{h}</th>)}</tr></thead>
            <tbody>{inv.lines.map(l=><tr key={l.id}><td style={{padding:"8px",fontSize:13,color:T.text,fontWeight:500}}>{l.productName}</td><td style={{padding:"8px",fontSize:12,color:T.textMid,fontFamily:T.mono,fontWeight:500}}>{l.sku}</td><td style={{padding:"8px",fontSize:13,color:T.text,fontWeight:500}}>{l.qty}</td><td style={{padding:"8px",fontSize:13,color:T.accent,fontWeight:700}}>${l.unitPrice.toFixed(2)}</td><td style={{padding:"8px",fontSize:13,color:T.accent,fontWeight:700}}>${(l.qty*l.unitPrice).toFixed(2)}</td></tr>)}</tbody>
          </table>
          <div style={{textAlign:"right"}}><div style={{fontSize:13,color:T.textMid,fontWeight:600}}>Subtotal: ${inv.subtotal.toFixed(2)}</div>{inv.tax>0&&<div style={{fontSize:13,color:T.textMid,fontWeight:600}}>Tax ({inv.taxRate}%): ${inv.tax.toFixed(2)}</div>}<div style={{fontSize:24,color:T.accent,fontWeight:700}}>Total: ${inv.total.toFixed(2)}</div></div>
        </div>}
        {!inv&&!creating&&<div style={{color:T.textMid,marginTop:80,textAlign:"center",fontSize:14,fontWeight:500}}>Select an invoice or create one</div>}
      </div>
    </div>
  );
}

function ActivityLog({store}){
  return(
    <div style={{padding:"32px 36px"}}>
      <div style={{fontSize:11,color:T.accent,fontFamily:T.mono,letterSpacing:3,textTransform:"uppercase",marginBottom:6,fontWeight:700}}>System</div>
      <h1 style={{fontSize:24,fontWeight:700,color:T.text,marginBottom:28}}>Activity Log</h1>
      <div style={{maxWidth:760}}>
        {store.activityLog.map(e=>(
          <div key={e.id} style={{display:"flex",gap:20,padding:"10px 16px",borderBottom:`1px solid ${T.border}`,alignItems:"flex-start"}}>
            <div style={{fontSize:11,color:T.textMid,fontFamily:T.mono,whiteSpace:"nowrap",marginTop:3,minWidth:140,fontWeight:600}}>{new Date(e.at).toLocaleString()}</div>
            <div style={{width:4,height:4,borderRadius:"50%",background:e.type==="warn"?T.amber:T.accent,marginTop:5,flexShrink:0}}/>
            <div style={{fontSize:13,color:e.type==="warn"?T.amber:T.text,fontWeight:500}}>{e.msg}</div>
          </div>
        ))}
        {!store.activityLog.length&&<div style={{fontSize:13,color:T.textMid,padding:"32px 0",textAlign:"center",fontWeight:500}}>No activity recorded yet</div>}
      </div>
    </div>
  );
}

const STORE_KEY="invtrack_store_v1";
const PREFS_KEY="invtrack_prefs_v1";

// Detect environment: Claude artifact uses window.storage, Netlify uses localStorage
const storage={
  async get(key){
    if(typeof window.storage!=="undefined"){
      try{const r=await window.storage.get(key);return r?.value||null;}catch{return null;}
    }
    try{return localStorage.getItem(key);}catch{return null;}
  },
  async set(key,val){
    if(typeof window.storage!=="undefined"){
      try{await window.storage.set(key,val);}catch{}
    } else {
      try{localStorage.setItem(key,val);}catch{}
    }
  }
};

async function loadFromStorage(){
  try{
    const val=await storage.get(STORE_KEY);
    if(val){const parsed=JSON.parse(val);if(parsed&&parsed.vendors)return parsed;}
  }catch(e){}
  return null;
}
async function saveToStorage(data){
  try{await storage.set(STORE_KEY,JSON.stringify(data));}catch(e){}
}
async function loadPrefs(){
  try{
    const val=await storage.get(PREFS_KEY);
    if(val)return JSON.parse(val);
  }catch(e){}
  return {themeMode:"dark",fontChoice:"poppins"};
}
async function savePrefs(prefs){
  try{await storage.set(PREFS_KEY,JSON.stringify(prefs));}catch(e){}
}

export default function App(){
  const [store,setStore]=useState(defaultStore);
  const [tab,setTab]=useState("dashboard");
  const [toast,setToast]=useState(null);
  const [themeMode,setThemeMode]=useState("dark");
  const [fontChoice,setFontChoice]=useState("poppins");
  const [loaded,setLoaded]=useState(false);

  // Load persisted data on mount
  useEffect(()=>{
    Promise.all([loadFromStorage(),loadPrefs()]).then(([savedStore,prefs])=>{
      if(savedStore)setStore(savedStore);
      if(prefs){setThemeMode(prefs.themeMode||"dark");setFontChoice(prefs.fontChoice||"poppins");}
      setLoaded(true);
    });
  },[]);

  const fontMap={poppins:"'Poppins',system-ui,sans-serif",roboto:"'Roboto',system-ui,sans-serif"};
  Object.assign(T,buildT(themeMode,fontChoice));
  IS=getIS(); TIER=getTIER(); SC=getSC(T); STATUS_COLORS=Object.fromEntries(Object.entries(SC).map(([k,v])=>[k,v.color]));

  const update=useCallback(fn=>setStore(s=>{
    const copy={...s,vendors:[...s.vendors],clients:[...s.clients],inventory:[...s.inventory],rfps:[...s.rfps],invoices:[...s.invoices],activityLog:[...s.activityLog]};
    const next=fn(copy);
    saveToStorage(next);
    return next;
  }),[]);

  const setThemeModeAndSave=(mode)=>{setThemeMode(mode);savePrefs({themeMode:mode,fontChoice});};
  const setFontChoiceAndSave=(font)=>{setFontChoice(font);savePrefs({themeMode,fontChoice:font});};

  const log=useCallback((msg,type="info")=>update(s=>{s.activityLog=[{id:uid(),msg,type,at:now()},...s.activityLog.slice(0,199)];return s;}),[update]);
  const showToast=(msg,color=T.green)=>{setToast({msg,color});setTimeout(()=>setToast(null),3500);};
  const lowStock=store.inventory.filter(i=>i.qty<=(i.reorderAt||5)&&i.qty>0);
  const outOfStock=store.inventory.filter(i=>i.qty===0);
  const alertCount=lowStock.length+outOfStock.length;

  if(!loaded)return(
    <div style={{display:"flex",height:"100vh",background:"#060c18",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{width:32,height:32,border:"3px solid rgba(0,200,255,0.2)",borderTopColor:"#00c8ff",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
      <div style={{color:"#9dbcd8",fontFamily:"system-ui",fontSize:14}}>Loading your data...</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const GS=`
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    ::-webkit-scrollbar{width:4px;height:4px;}
    ::-webkit-scrollbar-track{background:transparent;}
    ::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:4px;}
    @keyframes pulse-glow{0%,100%{opacity:0.6}50%{opacity:1}}
    @keyframes slide-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes spin{to{transform:rotate(360deg)}}
  `;

  const gridColor=themeMode==="light"?"rgba(0,80,160,0.06)":T.border;

  return(
    <div style={{display:"flex",height:"100vh",background:T.bg,color:T.text,fontFamily:T.font,overflow:"hidden",position:"relative"}}>
      <style>{GS}</style>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,backgroundImage:`linear-gradient(${gridColor} 1px,transparent 1px),linear-gradient(90deg,${gridColor} 1px,transparent 1px)`,backgroundSize:"48px 48px"}}/>

      <nav style={{width:220,background:T.bgPanel,borderRight:`1px solid ${T.border}`,display:"flex",flexDirection:"column",flexShrink:0,zIndex:10,position:"relative",boxShadow:themeMode==="light"?"2px 0 12px rgba(0,0,0,0.06)":"none"}}>
        <div style={{padding:"28px 24px 24px",borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:32,height:32,borderRadius:8,background:`linear-gradient(135deg,${T.accent},${T.green})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#fff",flexShrink:0}}>IT</div>
            <div>
              <div style={{fontSize:15,fontWeight:700,letterSpacing:1.5,color:T.text,textTransform:"uppercase",fontFamily:T.font}}>InvTrack</div>
              <div style={{fontSize:9,color:T.textMid,letterSpacing:2,fontFamily:T.mono,textTransform:"uppercase",fontWeight:600}}>Pro System</div>
            </div>
          </div>
        </div>
        <div style={{flex:1,padding:"16px 12px",display:"flex",flexDirection:"column",gap:2,overflowY:"auto"}}>
          {NAV.map(t=>{
            const active=tab===t.id;const isAdmin=t.id==="admin";
            return(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"10px 12px",borderRadius:T.radius,background:active?T.accentDim:"transparent",border:active?`1px solid ${T.borderHi}`:"1px solid transparent",color:active?T.accent:T.textMid,cursor:"pointer",fontSize:13,fontWeight:active?700:500,textAlign:"left",fontFamily:T.font,position:"relative",overflow:"hidden",marginTop:isAdmin?8:0}}>
                {active&&<div style={{position:"absolute",left:0,top:"20%",bottom:"20%",width:2,borderRadius:2,background:T.accent,boxShadow:`0 0 8px ${T.accentGlow}`}}/>}
                <span style={{fontSize:15,opacity:active?1:0.75}}>{t.icon}</span>
                <span>{t.label}</span>
                {t.id==="inventory"&&alertCount>0&&<span style={{marginLeft:"auto",background:T.red,color:"white",borderRadius:20,fontSize:9,fontWeight:700,padding:"2px 7px",fontFamily:T.mono}}>{alertCount}</span>}
              </button>
            );
          })}
        </div>
        <div style={{padding:"16px 20px",borderTop:`1px solid ${T.border}`}}>
          <div style={{fontSize:10,color:T.textMid,fontFamily:T.mono,fontWeight:600}}>v2.0 · {new Date().toLocaleDateString()}</div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:T.green,boxShadow:`0 0 6px ${T.green}`,animation:"pulse-glow 2s ease-in-out infinite"}}/>
            <span style={{fontSize:10,color:T.textMid,fontFamily:T.mono,fontWeight:600}}>SYSTEM ONLINE</span>
          </div>
        </div>
      </nav>

      <main style={{flex:1,overflow:"auto",position:"relative",zIndex:1}}>
        {tab==="dashboard"&&<Dashboard store={store} setTab={setTab} lowStock={lowStock} outOfStock={outOfStock}/>}
        {tab==="vendors"&&<Vendors store={store} update={update} log={log} showToast={showToast}/>}
        {tab==="rfp"&&<RFPs store={store} update={update} log={log} showToast={showToast}/>}
        {tab==="inventory"&&<Inventory store={store} update={update} log={log} showToast={showToast} lowStock={lowStock} outOfStock={outOfStock}/>}
        {tab==="clients"&&<Clients store={store} update={update} log={log} showToast={showToast}/>}
        {tab==="invoices"&&<Invoices store={store} update={update} log={log} showToast={showToast}/>}
        {tab==="log"&&<ActivityLog store={store}/>}
        {tab==="admin"&&<AdminPanel themeMode={themeMode} setThemeMode={setThemeModeAndSave} fontChoice={fontChoice} setFontChoice={setFontChoiceAndSave}/>}
      </main>

      {toast&&<div style={{position:"fixed",bottom:28,right:28,zIndex:9999,background:T.bgCard,border:`1px solid ${toast.color}50`,color:toast.color,padding:"12px 20px",borderRadius:T.radius,fontSize:13,fontFamily:T.font,fontWeight:600,boxShadow:`0 4px 32px rgba(0,0,0,0.3)`,animation:"slide-in 0.25s ease",display:"flex",alignItems:"center",gap:10,maxWidth:340}}>
        <div style={{width:6,height:6,borderRadius:"50%",background:toast.color,flexShrink:0,boxShadow:`0 0 8px ${toast.color}`}}/>
        {toast.msg}
      </div>}
    </div>
  );
}
